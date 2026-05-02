import { Router, type IRouter } from "express";
import { db, planDaysTable, planWeeksTable, workoutsTable, type PlanDayRow, type WorkoutRow } from "@workspace/db";
import { eq, asc, sql, and, gte, lte } from "drizzle-orm";
import {
  UpdatePlanDayBody,
  SwapPlanDayBody,
} from "@workspace/api-zod";
import { toPlanDay, toPlanWeek, toWorkout } from "../lib/transforms";

const router: IRouter = Router();

const RACE_DATE = "2027-05-01";
const START_DATE = "2026-05-01";
const START_WEIGHT = 281.6;
const GOAL_WEIGHT = 210;

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

async function currentWeek(): Promise<{ week: number; phase: string }> {
  const today = todayISO();
  const rows = await db
    .select()
    .from(planWeeksTable)
    .where(and(lte(planWeeksTable.startDate, today), gte(planWeeksTable.endDate, today)))
    .limit(1);
  if (rows[0]) return { week: rows[0].week, phase: rows[0].phase };
  // before plan starts -> week 1; after race -> last week
  const first = await db.select().from(planWeeksTable).orderBy(asc(planWeeksTable.week)).limit(1);
  const last = await db.select().from(planWeeksTable).orderBy(sql`${planWeeksTable.week} DESC`).limit(1);
  if (first[0] && today < first[0].startDate) return { week: first[0].week, phase: first[0].phase };
  if (last[0]) return { week: last[0].week, phase: last[0].phase };
  return { week: 1, phase: "Foundation Build" };
}

router.get("/plan/overview", async (_req, res) => {
  const { week, phase } = await currentWeek();
  const allWeeks = await db.select().from(planWeeksTable).orderBy(asc(planWeeksTable.week));
  const totalWeeks = allWeeks.length;
  const weekRow = allWeeks.find((w) => w.week === week);
  const lastMeasurement = await db.execute<{ weight: number | null }>(
    sql`SELECT weight FROM measurements WHERE weight IS NOT NULL ORDER BY date DESC LIMIT 1`,
  );
  const currentWeight = lastMeasurement.rows[0]?.weight ?? null;
  res.json({
    currentWeek: week,
    currentPhase: phase,
    totalWeeks,
    weeksRemaining: Math.max(0, totalWeeks - week),
    raceDate: RACE_DATE,
    startDate: START_DATE,
    startWeight: START_WEIGHT,
    currentWeight,
    goalWeight: GOAL_WEIGHT,
    weeklyMilesTarget: weekRow?.plannedMiles ?? 0,
    longRunTarget: weekRow?.longRunMi ?? 0,
  });
});

router.get("/plan/weeks", async (_req, res) => {
  const today = todayISO();
  const weeks = await db.select().from(planWeeksTable).orderBy(asc(planWeeksTable.week));
  // Aggregate actuals per week
  const actuals = await db.execute<{
    week: number;
    actual_miles: number;
    completed_sessions: number;
    total_sessions: number;
    missed_sessions: number;
  }>(
    sql`
      SELECT pw.week,
        COALESCE(SUM(w.distance_mi) FILTER (WHERE w.session_type <> 'Skipped'), 0)::float AS actual_miles,
        COUNT(DISTINCT w.id) FILTER (WHERE w.session_type <> 'Skipped')::int AS completed_sessions,
        (SELECT COUNT(*) FROM plan_days pd WHERE pd.week = pw.week AND pd.is_rest = false)::int AS total_sessions,
        (
          SELECT COUNT(*)
          FROM plan_days pd
          WHERE pd.week = pw.week
            AND pd.is_rest = false
            AND pd.date < ${today}
            AND NOT EXISTS (
              SELECT 1 FROM workouts w2 WHERE w2.date = pd.date
            )
        )::int AS missed_sessions
      FROM plan_weeks pw
      LEFT JOIN workouts w ON w.date BETWEEN pw.start_date AND pw.end_date
      GROUP BY pw.week
    `,
  );
  const byWeek = new Map(actuals.rows.map((r) => [r.week, r]));
  res.json(
    weeks.map((w) => {
      const a = byWeek.get(w.week);
      return toPlanWeek(w, {
        actualMiles: a?.actual_miles ?? 0,
        completedSessions: a?.completed_sessions ?? 0,
        totalSessions: a?.total_sessions ?? 0,
        missedSessions: a?.missed_sessions ?? 0,
      });
    }),
  );
});

router.get("/plan/weeks/:week", async (req, res): Promise<void> => {
  const week = Number(req.params.week);
  const weekRow = (await db.select().from(planWeeksTable).where(eq(planWeeksTable.week, week)).limit(1))[0];
  if (!weekRow) {
    res.status(404).json({ error: "week not found" });
    return;
  }
  const days = await db.select().from(planDaysTable).where(eq(planDaysTable.week, week)).orderBy(asc(planDaysTable.date));
  const actuals = await db.execute<{ actual_miles: number; completed: number }>(
    sql`SELECT
          COALESCE(SUM(distance_mi) FILTER (WHERE session_type <> 'Skipped'), 0)::float AS actual_miles,
          COUNT(*) FILTER (WHERE session_type <> 'Skipped')::int AS completed
        FROM workouts WHERE date BETWEEN ${weekRow.startDate} AND ${weekRow.endDate}`,
  );
  const totalSessions = days.filter((d) => !d.isRest).length;
  const today = todayISO();
  const nonRestDays = days.filter((d) => !d.isRest);
  const recentByPair = await fetchRecentWorkoutsByPair(nonRestDays, today);
  const daysWithSuggestions = days.map((d) => {
    const base = toPlanDay(d);
    if (d.isRest) return { ...base, suggestions: null };
    const recent = recentByPair.get(pairKey(d.sessionType, d.equipment)) ?? [];
    return { ...base, suggestions: buildSuggestions(d, recent) };
  });
  res.json({
    ...toPlanWeek(weekRow, {
      actualMiles: actuals.rows[0]?.actual_miles ?? 0,
      completedSessions: actuals.rows[0]?.completed ?? 0,
      totalSessions,
    }),
    days: daysWithSuggestions,
  });
});

function parsePaceToSeconds(pace: string | null | undefined): number | null {
  if (!pace) return null;
  const match = pace.match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || seconds >= 60) return null;
  return minutes * 60 + seconds;
}

function formatSecondsAsPace(totalSeconds: number): string {
  const rounded = Math.round(totalSeconds);
  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function pairKey(sessionType: string, equipment: string): string {
  return `${sessionType}\u0000${equipment}`;
}

// SQL ordering expression for the workouts.time_of_day tag. AM sorts first,
// then PM, then Other, then untagged rows. Used together with createdAt to
// produce a stable same-day ordering of multi-session days.
const timeOfDayOrderExpr = sql`
  CASE ${workoutsTable.timeOfDay}
    WHEN 'AM' THEN 0
    WHEN 'PM' THEN 1
    WHEN 'Other' THEN 2
    ELSE 3
  END
`;

// Build the suggestions payload for a plan day from a pre-fetched list of its
// recent comparable workouts (already filtered to the same session_type +
// equipment, ordered most-recent first, capped to N).
function buildSuggestions(plan: PlanDayRow, recent: readonly WorkoutRow[]) {
  const rpeValues = recent.map((r) => r.rpe).filter((v): v is number => v != null);
  const hrValues = recent.map((r) => r.avgHr).filter((v): v is number => v != null);
  const paceSeconds = recent
    .map((r) => parsePaceToSeconds(r.pace))
    .filter((v): v is number => v != null);

  const avg = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;

  const rpe = rpeValues.length ? Math.round(avg(rpeValues)) : null;
  const avgHr = hrValues.length ? Math.round(avg(hrValues)) : null;
  // Prefer the planned pace (e.g. from the session prescription) when available;
  // otherwise fall back to the average of recent comparable sessions. Surface
  // which source produced the pace so the UI can label it accurately.
  let pace: string | null;
  let paceSource: "plan" | "history" | null;
  if (plan.pace) {
    pace = plan.pace;
    paceSource = "plan";
  } else if (paceSeconds.length) {
    pace = formatSecondsAsPace(avg(paceSeconds));
    paceSource = "history";
  } else {
    pace = null;
    paceSource = null;
  }

  return { rpe, avgHr, pace, paceSource, sampleSize: recent.length };
}

const RECENT_LIMIT = 5;

// Fetch the most-recent RECENT_LIMIT workouts per (session_type, equipment)
// pair represented by `days`, in a single round-trip. Uses ROW_NUMBER() so we
// only ship the rows we'll actually average over, regardless of total history
// size. Returns a Map keyed by pairKey(sessionType, equipment).
async function fetchRecentWorkoutsByPair(
  days: readonly PlanDayRow[],
  today: string,
): Promise<Map<string, WorkoutRow[]>> {
  const result = new Map<string, WorkoutRow[]>();
  if (days.length === 0) return result;

  const uniquePairs = new Map<string, { sessionType: string; equipment: string }>();
  for (const d of days) {
    const key = pairKey(d.sessionType, d.equipment);
    if (!uniquePairs.has(key)) {
      uniquePairs.set(key, { sessionType: d.sessionType, equipment: d.equipment });
    }
  }
  for (const key of uniquePairs.keys()) result.set(key, []);

  const pairValues = sql.join(
    Array.from(uniquePairs.values()).map((p) => sql`(${p.sessionType}, ${p.equipment})`),
    sql`, `,
  );

  const rows = await db.execute<{
    id: number;
    plan_day_id: number | null;
    date: string;
    equipment: string;
    session_type: string;
    duration_min: number | null;
    distance_mi: number | null;
    pace: string | null;
    avg_hr: number | null;
    rpe: number | null;
    strength_load: number | null;
    total_load: number | null;
    notes: string | null;
    time_of_day: string | null;
    created_at: Date;
  }>(sql`
    WITH ranked AS (
      SELECT
        w.*,
        ROW_NUMBER() OVER (
          PARTITION BY w.session_type, w.equipment
          ORDER BY w.date DESC, w.created_at DESC
        ) AS rn
      FROM workouts w
      WHERE w.date < ${today}
        AND (w.session_type, w.equipment) IN (${pairValues})
    )
    SELECT id, plan_day_id, date, equipment, session_type, duration_min,
           distance_mi, pace, avg_hr, rpe, strength_load, total_load, notes,
           time_of_day, created_at
    FROM ranked
    WHERE rn <= ${RECENT_LIMIT}
    ORDER BY session_type, equipment, date DESC, created_at DESC
  `);

  for (const r of rows.rows) {
    const key = pairKey(r.session_type, r.equipment);
    const list = result.get(key);
    if (!list) continue;
    list.push({
      id: r.id,
      planDayId: r.plan_day_id,
      date: r.date,
      equipment: r.equipment,
      sessionType: r.session_type,
      durationMin: r.duration_min,
      distanceMi: r.distance_mi,
      pace: r.pace,
      avgHr: r.avg_hr,
      rpe: r.rpe,
      strengthLoad: r.strength_load,
      totalLoad: r.total_load,
      notes: r.notes,
      timeOfDay: r.time_of_day,
      createdAt: r.created_at instanceof Date ? r.created_at : new Date(r.created_at),
    });
  }

  return result;
}

async function suggestionsForPlan(plan: PlanDayRow, today: string) {
  const byPair = await fetchRecentWorkoutsByPair([plan], today);
  const recent = byPair.get(pairKey(plan.sessionType, plan.equipment)) ?? [];
  return buildSuggestions(plan, recent);
}

router.get("/plan/today", async (_req, res) => {
  const today = todayISO();
  const planRow = (await db.select().from(planDaysTable).where(eq(planDaysTable.date, today)).limit(1))[0];
  // Order same-day sessions by their time-of-day tag (AM, PM, Other, then
  // untagged) and then by createdAt ascending so tagged AM workouts logged
  // late in the evening still surface above PM ones.
  const loggedRows = await db
    .select()
    .from(workoutsTable)
    .where(eq(workoutsTable.date, today))
    .orderBy(asc(timeOfDayOrderExpr), asc(workoutsTable.createdAt));
  const suggestions = planRow && !planRow.isRest ? await suggestionsForPlan(planRow, today) : null;
  res.json({
    date: today,
    hasPlan: !!planRow,
    plan: planRow ? toPlanDay(planRow) : null,
    loggedWorkouts: loggedRows.map(toWorkout),
    suggestions,
  });
});

// --- Plan editing ---------------------------------------------------------
//
// PATCH /plan/days/:id - edit the prescribed values on a plan day in place.
// POST  /plan/days/:id/swap - swap session content with another day. Partner
//                             may be in the same week or in any other week
//                             of the plan; calendar dates stay put.
// POST  /plan/days/:id/reset - restore the row to its seeded prescription.
//
// All three keep `plan_weeks` aggregates (plannedMiles, plannedTotalLoad,
// plannedStrength, plannedCardio, longRunMi) consistent by recomputing them
// from each affected week's plan_days inside a single transaction (one week
// for in-week edits, both weeks for cross-week swaps), and lazily snapshot
// the current row into the seed_* columns the first time it is mutated so
// reset always has something to restore from on already-deployed databases.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

interface PlanDayMutableFields {
  sessionType: string;
  equipment: string;
  description: string;
  distanceMi: number | null;
  cardioMin: number | null;
  pace: string | null;
  strengthLoad: number | null;
  totalLoad: number;
  isRest: boolean;
}

function pickMutableFields(row: PlanDayRow): PlanDayMutableFields {
  return {
    sessionType: row.sessionType,
    equipment: row.equipment,
    description: row.description,
    distanceMi: row.distanceMi,
    cardioMin: row.cardioMin,
    pace: row.pace,
    strengthLoad: row.strengthLoad,
    totalLoad: row.totalLoad,
    isRest: row.isRest,
  };
}

// Lazily snapshot the row's current prescription into seed_* the first time
// it is about to change, so already-deployed databases (which were never
// re-seeded after the seed_* columns were added) can still be reset later.
async function ensureSeedSnapshot(tx: Tx, row: PlanDayRow): Promise<void> {
  if (row.seedSessionType != null) return;
  await tx
    .update(planDaysTable)
    .set({
      seedSessionType: row.sessionType,
      seedEquipment: row.equipment,
      seedDescription: row.description,
      seedDistanceMi: row.distanceMi,
      seedCardioMin: row.cardioMin,
      seedPace: row.pace,
      seedStrengthLoad: row.strengthLoad,
      seedTotalLoad: row.totalLoad,
      seedIsRest: row.isRest,
    })
    .where(eq(planDaysTable.id, row.id));
}

// Recompute and persist the planned aggregates for `week` from its plan_days.
// Mirrors the same shape the seed script writes (sum of distance, total_load,
// strength_load, cardio_min, and the max distance as the long run).
async function recomputeWeekTotals(tx: Tx, week: number): Promise<void> {
  const days = await tx
    .select()
    .from(planDaysTable)
    .where(eq(planDaysTable.week, week));
  const plannedMiles = days.reduce((s, d) => s + (d.distanceMi ?? 0), 0);
  const plannedTotalLoad = days.reduce((s, d) => s + (d.totalLoad ?? 0), 0);
  const plannedStrength = days.reduce((s, d) => s + (d.strengthLoad ?? 0), 0);
  const plannedCardio = days.reduce((s, d) => s + (d.cardioMin ?? 0), 0);
  const longRunMi = days.reduce(
    (max, d) => Math.max(max, d.distanceMi ?? 0),
    0,
  );
  await tx
    .update(planWeeksTable)
    .set({
      plannedMiles,
      plannedTotalLoad,
      plannedStrength,
      plannedCardio,
      longRunMi,
    })
    .where(eq(planWeeksTable.week, week));
}

router.patch("/plan/days/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "invalid id" });
    return;
  }
  const parsed = UpdatePlanDayBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const updated = await db.transaction(async (tx) => {
    const existing = (
      await tx.select().from(planDaysTable).where(eq(planDaysTable.id, id)).limit(1)
    )[0];
    if (!existing) return null;
    await ensureSeedSnapshot(tx, existing);
    const next = await tx
      .update(planDaysTable)
      .set(parsed.data)
      .where(eq(planDaysTable.id, id))
      .returning();
    await recomputeWeekTotals(tx, existing.week);
    return next[0]!;
  });
  if (!updated) {
    res.status(404).json({ error: "plan day not found" });
    return;
  }
  req.log.info({ planDayId: id, week: updated.week }, "plan day updated");
  res.json(toPlanDay(updated));
});

router.post("/plan/days/:id/swap", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "invalid id" });
    return;
  }
  const parsed = SwapPlanDayBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const withDayId = parsed.data.withDayId;
  if (withDayId === id) {
    res.status(400).json({ error: "cannot swap a day with itself" });
    return;
  }
  const result = await db.transaction(async (tx) => {
    const a = (
      await tx.select().from(planDaysTable).where(eq(planDaysTable.id, id)).limit(1)
    )[0];
    const b = (
      await tx
        .select()
        .from(planDaysTable)
        .where(eq(planDaysTable.id, withDayId))
        .limit(1)
    )[0];
    if (!a || !b) return { kind: "not-found" as const };
    await ensureSeedSnapshot(tx, a);
    await ensureSeedSnapshot(tx, b);
    const aFields = pickMutableFields(a);
    const bFields = pickMutableFields(b);
    // Overwrite a with b's prescription and vice-versa. date / day / week /
    // phase / id / seed_* stay put so the calendar position, the phase
    // boundaries, and the original prescription snapshot are preserved even
    // when the two days come from different weeks.
    const updatedA = await tx
      .update(planDaysTable)
      .set(bFields)
      .where(eq(planDaysTable.id, a.id))
      .returning();
    const updatedB = await tx
      .update(planDaysTable)
      .set(aFields)
      .where(eq(planDaysTable.id, b.id))
      .returning();
    // Recompute aggregates for every week touched by the swap. For a
    // cross-week swap that's both weeks (deduped); for an in-week swap it's
    // just the one. Both happen inside this transaction so the two weeks
    // either both get their new totals or the swap rolls back together.
    const weeksAffected = a.week === b.week ? [a.week] : [a.week, b.week];
    for (const w of weeksAffected) {
      await recomputeWeekTotals(tx, w);
    }
    return {
      kind: "ok" as const,
      a: updatedA[0]!,
      b: updatedB[0]!,
      weeksAffected,
      phaseChanged: a.phase !== b.phase,
    };
  });
  if (result.kind === "not-found") {
    res.status(404).json({ error: "plan day not found" });
    return;
  }
  req.log.info(
    {
      fromId: id,
      toId: withDayId,
      weeksAffected: result.weeksAffected,
      phaseChanged: result.phaseChanged,
    },
    "plan days swapped",
  );
  res.json({
    from: toPlanDay(result.a),
    to: toPlanDay(result.b),
    weeksAffected: result.weeksAffected,
    phaseChanged: result.phaseChanged,
  });
});

// Restoring a row to its seed clears the seed_* snapshot too, so the row's
// "edited" marker (seed_session_type IS NOT NULL) returns to false. That keeps
// reset operations idempotent: a second reset reports 0 days touched.
const CLEAR_SEED_FIELDS = {
  seedSessionType: null,
  seedEquipment: null,
  seedDescription: null,
  seedDistanceMi: null,
  seedCardioMin: null,
  seedPace: null,
  seedStrengthLoad: null,
  seedTotalLoad: null,
  seedIsRest: null,
} as const;

router.post("/plan/days/:id/reset", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "invalid id" });
    return;
  }
  const result = await db.transaction(async (tx) => {
    const existing = (
      await tx.select().from(planDaysTable).where(eq(planDaysTable.id, id)).limit(1)
    )[0];
    if (!existing) return null;
    // Nothing to restore from -> the row has never been edited, so just hand
    // back the current prescription unchanged.
    if (existing.seedSessionType == null) return existing;
    const reset = await tx
      .update(planDaysTable)
      .set({
        sessionType: existing.seedSessionType,
        equipment: existing.seedEquipment ?? existing.equipment,
        description: existing.seedDescription ?? existing.description,
        distanceMi: existing.seedDistanceMi,
        cardioMin: existing.seedCardioMin,
        pace: existing.seedPace,
        strengthLoad: existing.seedStrengthLoad,
        totalLoad: existing.seedTotalLoad ?? 0,
        isRest: existing.seedIsRest ?? existing.isRest,
        ...CLEAR_SEED_FIELDS,
      })
      .where(eq(planDaysTable.id, id))
      .returning();
    await recomputeWeekTotals(tx, existing.week);
    return reset[0]!;
  });
  if (!result) {
    res.status(404).json({ error: "plan day not found" });
    return;
  }
  req.log.info({ planDayId: id, week: result.week }, "plan day reset");
  res.json(toPlanDay(result));
});

// Restore every previously-edited plan day in a single week back to the
// seeded prescription. Days that have never been touched (seed_* still null)
// are skipped because there is nothing to restore from. Week aggregates are
// recomputed once at the end so the response from /plan/weeks/:week reflects
// the new totals immediately.
function resetRow(row: PlanDayRow): PlanDayMutableFields {
  return {
    sessionType: row.seedSessionType ?? row.sessionType,
    equipment: row.seedEquipment ?? row.equipment,
    description: row.seedDescription ?? row.description,
    distanceMi: row.seedDistanceMi,
    cardioMin: row.seedCardioMin,
    pace: row.seedPace,
    strengthLoad: row.seedStrengthLoad,
    totalLoad: row.seedTotalLoad ?? 0,
    isRest: row.seedIsRest ?? row.isRest,
  };
}

router.post("/plan/weeks/:week/reset", async (req, res): Promise<void> => {
  const week = Number(req.params.week);
  if (!Number.isInteger(week) || week <= 0) {
    res.status(400).json({ error: "invalid week" });
    return;
  }
  const result = await db.transaction(async (tx) => {
    const weekRow = (
      await tx
        .select()
        .from(planWeeksTable)
        .where(eq(planWeeksTable.week, week))
        .limit(1)
    )[0];
    if (!weekRow) return null;
    const days = await tx
      .select()
      .from(planDaysTable)
      .where(eq(planDaysTable.week, week));
    const editedDays = days.filter((d) => d.seedSessionType != null);
    for (const d of editedDays) {
      await tx
        .update(planDaysTable)
        .set({ ...resetRow(d), ...CLEAR_SEED_FIELDS })
        .where(eq(planDaysTable.id, d.id));
    }
    if (editedDays.length > 0) {
      await recomputeWeekTotals(tx, week);
    }
    return { daysReset: editedDays.length, daysTotal: days.length };
  });
  if (!result) {
    res.status(404).json({ error: "week not found" });
    return;
  }
  req.log.info(
    { week, daysReset: result.daysReset, daysTotal: result.daysTotal },
    "plan week reset",
  );
  res.json({ week, ...result });
});

router.post("/plan/reset", async (req, res): Promise<void> => {
  const result = await db.transaction(async (tx) => {
    const days = await tx.select().from(planDaysTable);
    const editedDays = days.filter((d) => d.seedSessionType != null);
    const weeksTouched = new Set<number>();
    for (const d of editedDays) {
      await tx
        .update(planDaysTable)
        .set({ ...resetRow(d), ...CLEAR_SEED_FIELDS })
        .where(eq(planDaysTable.id, d.id));
      weeksTouched.add(d.week);
    }
    for (const w of weeksTouched) {
      await recomputeWeekTotals(tx, w);
    }
    return {
      weeksReset: weeksTouched.size,
      daysReset: editedDays.length,
      daysTotal: days.length,
    };
  });
  req.log.info(result, "entire plan reset");
  res.json(result);
});

export default router;
