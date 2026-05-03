import { Router, type IRouter } from "express";
import {
  db,
  planDaysTable,
  planWeeksTable,
  workoutsTable,
  measurementsTable,
  type PlanDayRow,
  type WorkoutRow,
} from "@workspace/db";
import { eq, asc, sql, and, gte, lte } from "drizzle-orm";
import {
  UpdatePlanDayBody,
  SwapPlanDayBody,
  UndoPlanResetBody,
} from "@workspace/api-zod";
import { generatePlan, generatePlanFromConfig } from "@workspace/plan-generator";
import { readLastAppliedPlannerConfig } from "./planner";
import { toPlanDay, toPlanWeek, toWorkout } from "../lib/transforms";
import {
  consumeResetSnapshot,
  releaseResetSnapshot,
  snapshotPlanDay,
  storeResetSnapshot,
  type PlanDaySnapshot,
} from "../lib/reset-undo";

const router: IRouter = Router();

const RACE_DATE = "2027-05-02";
const START_DATE = "2026-05-04";
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
  // Per-week dominant cardio machine: the equipment with the highest total
  // cardio_min across non-rest plan days. Used by the weekly summary cards
  // to surface "X min cardio · Peloton Bike" for bike-only / row-only weeks
  // where plannedMiles is 0 but plannedCardio is high (task #107). Ties
  // broken by equipment name (deterministic) so repeated requests agree.
  const cardioEq = await db.execute<{ week: number; equipment: string }>(
    sql`
      SELECT DISTINCT ON (week) week, equipment
      FROM (
        SELECT week, equipment, SUM(cardio_min)::int AS total_min
        FROM plan_days
        WHERE is_rest = false AND COALESCE(cardio_min, 0) > 0
        GROUP BY week, equipment
      ) agg
      ORDER BY week, total_min DESC, equipment ASC
    `,
  );
  const dominantByWeek = new Map(
    cardioEq.rows.map((r) => [r.week, r.equipment]),
  );
  res.json(
    weeks.map((w) => {
      const a = byWeek.get(w.week);
      return toPlanWeek(w, {
        actualMiles: a?.actual_miles ?? 0,
        completedSessions: a?.completed_sessions ?? 0,
        totalSessions: a?.total_sessions ?? 0,
        missedSessions: a?.missed_sessions ?? 0,
        dominantCardioEquipment: dominantByWeek.get(w.week) ?? null,
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
  // Same dominant-cardio computation as /plan/weeks (task #107) but scoped
  // to this single week — sum cardio_min per equipment across non-rest
  // days and pick the highest, with equipment name as the tiebreaker.
  const cardioTotals = new Map<string, number>();
  for (const d of nonRestDays) {
    const m = d.cardioMin ?? 0;
    if (m <= 0) continue;
    cardioTotals.set(d.equipment, (cardioTotals.get(d.equipment) ?? 0) + m);
  }
  let dominantCardioEquipment: string | null = null;
  if (cardioTotals.size > 0) {
    const ranked = [...cardioTotals.entries()].sort((a, b) =>
      b[1] !== a[1] ? b[1] - a[1] : a[0].localeCompare(b[0]),
    );
    dominantCardioEquipment = ranked[0][0];
  }
  res.json({
    ...toPlanWeek(weekRow, {
      actualMiles: actuals.rows[0]?.actual_miles ?? 0,
      completedSessions: actuals.rows[0]?.completed ?? 0,
      totalSessions,
      dominantCardioEquipment,
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
    // Per-bucket actual minutes (Task #76). Selected so the recent-row
    // sample we hand back to the suggestions / plan-vs-actual logic
    // carries the same shape as the rest of the workouts surface.
    strength_min: number | null;
    cardio_min: number | null;
    run_min: number | null;
    distance_mi: number | null;
    pace: string | null;
    avg_hr: number | null;
    rpe: number | null;
    strength_load: number | null;
    total_load: number | null;
    notes: string | null;
    time_of_day: string | null;
    modality: string | null;
    equipment_list: string[] | null;
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
    SELECT id, plan_day_id, date, equipment, equipment_list, session_type, duration_min,
           strength_min, cardio_min, run_min,
           distance_mi, pace, avg_hr, rpe, strength_load, total_load, notes,
           time_of_day, modality, created_at
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
      equipmentList: r.equipment_list,
      sessionType: r.session_type,
      durationMin: r.duration_min,
      strengthMin: r.strength_min,
      cardioMin: r.cardio_min,
      runMin: r.run_min,
      distanceMi: r.distance_mi,
      pace: r.pace,
      avgHr: r.avg_hr,
      rpe: r.rpe,
      strengthLoad: r.strength_load,
      totalLoad: r.total_load,
      notes: r.notes,
      timeOfDay: r.time_of_day,
      modality: r.modality,
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

// Number of whole UTC days between two ISO date strings (yyyy-mm-dd). Both
// inputs are treated as midnight UTC so the result matches what the user sees
// when they look at their calendar — independent of the server's local TZ
// and of any time-of-day component. Returns a positive number when `to` is in
// the future relative to `from`.
function daysBetweenISO(from: string, to: string): number {
  const fromMs = Date.parse(`${from}T00:00:00.000Z`);
  const toMs = Date.parse(`${to}T00:00:00.000Z`);
  return Math.round((toMs - fromMs) / (1000 * 60 * 60 * 24));
}

// Look up the first non-rest plan day in calendar order. Used to power the
// "campaign starts in N days" countdown on /plan/today during the pre-launch
// window. Rest days at the very start of week 1 are skipped on purpose so
// the countdown reflects the first day the user actually has to train, not
// the technical start of week 1 (which may be a Mon rest day).
async function fetchFirstSessionDay(): Promise<PlanDayRow | null> {
  const rows = await db
    .select()
    .from(planDaysTable)
    .where(eq(planDaysTable.isRest, false))
    .orderBy(asc(planDaysTable.date))
    .limit(1);
  return rows[0] ?? null;
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

  // Pre-launch countdown: when today is before the first scheduled (non-rest)
  // session, surface the gap so the UI can render a friendly countdown card
  // instead of the generic "no plan for today" empty state. We key off the
  // first non-rest day rather than the very first plan_day so a Mon rest day
  // at the start of week 1 still shows the countdown.
  let daysUntilStart: number | null = null;
  let firstSession: ReturnType<typeof toPlanDay> | null = null;
  const firstSessionRow = await fetchFirstSessionDay();
  if (firstSessionRow && today < firstSessionRow.date) {
    daysUntilStart = daysBetweenISO(today, firstSessionRow.date);
    firstSession = toPlanDay(firstSessionRow);
  }

  res.json({
    date: today,
    hasPlan: !!planRow,
    plan: planRow ? toPlanDay(planRow) : null,
    loggedWorkouts: loggedRows.map(toWorkout),
    suggestions,
    daysUntilStart,
    firstSession,
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
  // Generator-owned chip rail; carried through swaps so a moved day brings
  // its multi-machine display along with it. Nullable to round-trip rows
  // that predate the task #77 backfill.
  equipmentList: string[] | null;
  description: string;
  distanceMi: number | null;
  strengthMin: number | null;
  cardioMin: number | null;
  runMin: number | null;
  pace: string | null;
  strengthLoad: number | null;
  totalLoad: number;
  isRest: boolean;
}

function pickMutableFields(row: PlanDayRow): PlanDayMutableFields {
  return {
    sessionType: row.sessionType,
    equipment: row.equipment,
    equipmentList: row.equipmentList,
    description: row.description,
    distanceMi: row.distanceMi,
    strengthMin: row.strengthMin,
    cardioMin: row.cardioMin,
    runMin: row.runMin,
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
      // Normalize the chip rail to `[equipment]` for legacy rows whose
      // equipment_list column is still NULL (pre-backfill). Otherwise a
      // subsequent scalar-equipment edit + reset cycle would restore a
      // null seed list, causing the reset path to fall back to the
      // edited live `equipmentList=[newEquipment]` and produce a
      // mismatched scalar/list pair (scalar = original, list = edited).
      // Storing the canonical fallback at snapshot time keeps the
      // round-trip consistent regardless of whether the backfill has run.
      seedEquipmentList: row.equipmentList ?? [row.equipment],
      seedDescription: row.description,
      seedDistanceMi: row.distanceMi,
      seedStrengthMin: row.strengthMin,
      seedCardioMin: row.cardioMin,
      seedRunMin: row.runMin,
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
    // Manual single-equipment edits collapse the chip rail back to
    // [equipment]: the form only edits the scalar, so a stale generator
    // chip rail like ["Tonal", "Peloton Tread"] would misrepresent a row
    // the runner just changed to "Outdoor". The list stays a single
    // element until the next /plan/full-reset rebuilds the rail from the
    // generator. Only refresh when equipment actually changed so other
    // edits (e.g. distance-only) don't churn the list.
    const patch: Record<string, unknown> = { ...parsed.data };
    if (
      typeof parsed.data.equipment === "string" &&
      parsed.data.equipment !== existing.equipment
    ) {
      patch.equipmentList = [parsed.data.equipment];
    }
    const next = await tx
      .update(planDaysTable)
      .set(patch)
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
  seedEquipmentList: null,
  seedDescription: null,
  seedDistanceMi: null,
  seedStrengthMin: null,
  seedCardioMin: null,
  seedRunMin: null,
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
        equipmentList: existing.seedEquipmentList ?? existing.equipmentList,
        description: existing.seedDescription ?? existing.description,
        distanceMi: existing.seedDistanceMi,
        strengthMin: existing.seedStrengthMin,
        cardioMin: existing.seedCardioMin,
        runMin: existing.seedRunMin,
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
    equipmentList: row.seedEquipmentList ?? row.equipmentList,
    description: row.seedDescription ?? row.description,
    distanceMi: row.seedDistanceMi,
    strengthMin: row.seedStrengthMin,
    cardioMin: row.seedCardioMin,
    runMin: row.seedRunMin,
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
    // Capture a full snapshot of every edited row before we wipe it so an
    // immediate "Undo" on the toast can put the customizations back exactly
    // as they were (including the seed_* "edited" markers).
    const snapshots: PlanDaySnapshot[] = editedDays.map(snapshotPlanDay);
    for (const d of editedDays) {
      await tx
        .update(planDaysTable)
        .set({ ...resetRow(d), ...CLEAR_SEED_FIELDS })
        .where(eq(planDaysTable.id, d.id));
    }
    if (editedDays.length > 0) {
      await recomputeWeekTotals(tx, week);
    }
    return {
      daysReset: editedDays.length,
      daysTotal: days.length,
      snapshots,
    };
  });
  if (!result) {
    res.status(404).json({ error: "week not found" });
    return;
  }
  // Only stash an undo snapshot when there was actually something to wipe;
  // a no-op reset (daysReset === 0) doesn't need an undo button.
  let undoToken: string | null = null;
  let undoExpiresInSeconds: number | null = null;
  if (result.snapshots.length > 0) {
    const stored = await storeResetSnapshot(result.snapshots, [week]);
    undoToken = stored.token;
    undoExpiresInSeconds = stored.expiresInSeconds;
  }
  req.log.info(
    { week, daysReset: result.daysReset, daysTotal: result.daysTotal },
    "plan week reset",
  );
  res.json({
    week,
    daysReset: result.daysReset,
    daysTotal: result.daysTotal,
    undoToken,
    undoExpiresInSeconds,
  });
});

router.post("/plan/reset", async (req, res): Promise<void> => {
  const result = await db.transaction(async (tx) => {
    const days = await tx.select().from(planDaysTable);
    const editedDays = days.filter((d) => d.seedSessionType != null);
    const snapshots: PlanDaySnapshot[] = editedDays.map(snapshotPlanDay);
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
      snapshots,
      weeksAffected: Array.from(weeksTouched).sort((a, b) => a - b),
    };
  });
  let undoToken: string | null = null;
  let undoExpiresInSeconds: number | null = null;
  if (result.snapshots.length > 0) {
    const stored = await storeResetSnapshot(
      result.snapshots,
      result.weeksAffected,
    );
    undoToken = stored.token;
    undoExpiresInSeconds = stored.expiresInSeconds;
  }
  req.log.info(
    {
      weeksReset: result.weeksReset,
      daysReset: result.daysReset,
      daysTotal: result.daysTotal,
    },
    "entire plan reset",
  );
  res.json({
    weeksReset: result.weeksReset,
    daysReset: result.daysReset,
    daysTotal: result.daysTotal,
    undoToken,
    undoExpiresInSeconds,
  });
});

// Nuclear "start over" reset. Wipes every logged workout, every body
// measurement, the race-week checklist, any pending reset-undo snapshots,
// and every plan_weeks/plan_days customization, then reseeds the canonical
// 52-week plan and the seeded baseline body row from the in-process
// generator. There is intentionally NO undo token here — the whole point
// is "I want to truly start over from day one", and offering an undo for a
// destructive bulk delete invites footguns (a 30-second TTL undo for
// hundreds of rows would surprise rather than help).
router.post("/plan/full-reset", async (req, res): Promise<void> => {
  // Generate plan rows OUTSIDE the transaction so a generator bug can't
  // leave us with truncated tables. Pivot off the most recently APPLIED
  // Planner config so a saved-but-never-applied draft does not silently
  // change what Full Reset reseeds. With no applied config, fall back to
  // the canonical hard-coded plan.
  const appliedConfig = await readLastAppliedPlannerConfig();
  const plan = appliedConfig
    ? generatePlanFromConfig(appliedConfig)
    : generatePlan();

  const result = await db.transaction(async (tx) => {
    // Take ACCESS EXCLUSIVE locks on every table we're about to wipe BEFORE
    // counting, so a concurrent insert cannot commit between our COUNT(*)
    // and the TRUNCATE that follows. Without this lock, a row inserted +
    // committed in another transaction during the count→truncate window
    // would get wiped by the TRUNCATE but be missing from the response
    // counts. ACCESS EXCLUSIVE matches the lock TRUNCATE itself takes, so
    // this just hoists that lock acquisition earlier in the transaction.
    await tx.execute(
      sql`LOCK TABLE workouts, plan_days, plan_weeks, measurements, race_week_checklist, reset_undo_snapshots IN ACCESS EXCLUSIVE MODE`,
    );

    // Snapshot pre-wipe counts so the response can tell the user exactly
    // how much was destroyed. Safe to count now — we hold the strongest
    // lock on every table involved.
    const [{ count: workoutsBefore } = { count: 0 }] = (
      await tx.execute<{ count: number }>(
        sql`SELECT COUNT(*)::int AS count FROM workouts`,
      )
    ).rows;
    const [{ count: measurementsBefore } = { count: 0 }] = (
      await tx.execute<{ count: number }>(
        sql`SELECT COUNT(*)::int AS count FROM measurements`,
      )
    ).rows;
    const [{ count: checklistBefore } = { count: 0 }] = (
      await tx.execute<{ count: number }>(
        sql`SELECT COUNT(*)::int AS count FROM race_week_checklist`,
      )
    ).rows;
    const [{ count: snapshotsBefore } = { count: 0 }] = (
      await tx.execute<{ count: number }>(
        sql`SELECT COUNT(*)::int AS count FROM reset_undo_snapshots`,
      )
    ).rows;

    // Single TRUNCATE so RESTART IDENTITY resets every serial id back to 1
    // and CASCADE handles any plan_day_id FKs from workouts in one shot.
    // Listing every table the runner can mutate makes this the canonical
    // "delete everything I've put in" operation.
    await tx.execute(
      sql`TRUNCATE TABLE workouts, plan_days, plan_weeks, measurements, race_week_checklist, reset_undo_snapshots RESTART IDENTITY CASCADE`,
    );

    // Reseed plan_weeks first so the plan_days FK targets exist.
    await tx.insert(planWeeksTable).values(
      plan.weekly.map((w) => ({
        week: w.week,
        phase: w.phase,
        startDate: w.start,
        endDate: w.end,
        plannedStrength: w.planned_strength,
        plannedCardio: w.planned_cardio,
        plannedTotalLoad: w.planned_total_load,
        plannedMiles: w.planned_miles,
        longRunMi: w.long_run_mi,
      })),
    );

    // Chunk plan_days inserts to keep parameter counts well under the
    // postgres bind-parameter limit; mirrors the chunk size used by the
    // CLI seeder so the two reseed paths stay aligned.
    const chunk = 100;
    for (let i = 0; i < plan.daily.length; i += chunk) {
      const slice = plan.daily.slice(i, i + chunk);
      await tx.insert(planDaysTable).values(
        slice.map((d) => {
          const equipment = d.equipment ?? "Rest";
          const equipmentList = d.equipment_list ?? [equipment];
          const description = d.description ?? "";
          const sessionType = d.session_type ?? "Rest";
          const isRest = !!d.is_rest;
          const totalLoad = d.total_load ?? 0;
          return {
            week: d.week,
            phase: d.phase,
            date: d.date,
            day: d.day,
            strengthLoad: d.strength_load,
            equipment,
            equipmentList,
            description,
            strengthMin: d.strength_min,
            cardioMin: d.cardio_min,
            runMin: d.run_min,
            distanceMi: d.distance_mi,
            pace: d.pace,
            sessionType,
            isRest,
            totalLoad,
            // Mirror the prescribed values into the seed_* columns so a
            // subsequent /plan/days/:id/reset has a clean snapshot to
            // restore from after the runner edits this freshly-seeded row.
            seedSessionType: sessionType,
            seedEquipment: equipment,
            seedEquipmentList: equipmentList,
            seedDescription: description,
            seedDistanceMi: d.distance_mi,
            seedStrengthMin: d.strength_min,
            seedCardioMin: d.cardio_min,
            seedRunMin: d.run_min,
            seedPace: d.pace,
            seedStrengthLoad: d.strength_load,
            seedTotalLoad: totalLoad,
            seedIsRest: isRest,
          };
        }),
      );
    }

    // Reinsert only the seeded baseline measurement (week 1) so the
    // dashboard "starting weight" card has data to show on a fresh
    // campaign. Empty placeholder rows for weeks 2..52 are intentionally
    // skipped — the runner enters real measurements as they go.
    let measurementsSeeded = 0;
    const baseline = plan.body.find(
      (b) =>
        b.weight != null ||
        b.l_arm != null ||
        b.r_arm != null ||
        b.l_leg != null ||
        b.r_leg != null ||
        b.belly != null ||
        b.chest != null,
    );
    if (baseline) {
      await tx.insert(measurementsTable).values({
        date: baseline.date,
        weight: baseline.weight,
        lArm: baseline.l_arm,
        rArm: baseline.r_arm,
        lLeg: baseline.l_leg,
        rLeg: baseline.r_leg,
        belly: baseline.belly,
        chest: baseline.chest,
        notes: baseline.notes,
      });
      measurementsSeeded = 1;
    }

    return {
      weeksSeeded: plan.weekly.length,
      daysSeeded: plan.daily.length,
      workoutsWiped: workoutsBefore,
      measurementsWiped: measurementsBefore,
      measurementsSeeded,
      checklistItemsWiped: checklistBefore,
      undoSnapshotsWiped: snapshotsBefore,
    };
  });

  // Logged at warn level because this is a destructive, irreversible
  // operation and we want it to stand out in the operator log even at
  // default log levels.
  req.log.warn(
    {
      weeksSeeded: result.weeksSeeded,
      daysSeeded: result.daysSeeded,
      workoutsWiped: result.workoutsWiped,
      measurementsWiped: result.measurementsWiped,
      measurementsSeeded: result.measurementsSeeded,
      checklistItemsWiped: result.checklistItemsWiped,
      undoSnapshotsWiped: result.undoSnapshotsWiped,
    },
    "full plan reset (no undo) — campaign reseeded from day one",
  );
  res.json(result);
});

// Restore the customizations that the most recent week-reset or plan-reset
// just wiped, identified by the short-lived token returned in that response.
// Each snapshot is single-use: once it's been consumed (or has expired) the
// endpoint returns 404 so a double-click on Undo can't double-restore.
router.post("/plan/reset/undo", async (req, res): Promise<void> => {
  const parsed = UndoPlanResetBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  // Atomically reserve the snapshot so a concurrent double-click can't run
  // the restore twice. If the transaction below fails we release it back
  // into the store so the user can retry within the remaining TTL.
  const snapshot = await consumeResetSnapshot(parsed.data.undoToken);
  if (!snapshot) {
    res.status(404).json({ error: "undo token not found or expired" });
    return;
  }
  let result: { daysRestored: number; weeksAffected: number[] };
  try {
    result = await db.transaction(async (tx) => {
      const touched = new Set<number>();
      let restored = 0;
      for (const d of snapshot.days) {
        // It's possible (though unusual) for the row to have been deleted or
        // re-edited between the reset and the undo. Restoring by id is still
        // the right thing to do: we're putting the snapshot back verbatim.
        const existing = (
          await tx
            .select()
            .from(planDaysTable)
            .where(eq(planDaysTable.id, d.id))
            .limit(1)
        )[0];
        if (!existing) continue;
        await tx
          .update(planDaysTable)
          .set({
            sessionType: d.sessionType,
            equipment: d.equipment,
            equipmentList: d.equipmentList,
            description: d.description,
            distanceMi: d.distanceMi,
            strengthMin: d.strengthMin,
            cardioMin: d.cardioMin,
            runMin: d.runMin,
            pace: d.pace,
            strengthLoad: d.strengthLoad,
            totalLoad: d.totalLoad,
            isRest: d.isRest,
            seedSessionType: d.seedSessionType,
            seedEquipment: d.seedEquipment,
            seedEquipmentList: d.seedEquipmentList,
            seedDescription: d.seedDescription,
            seedDistanceMi: d.seedDistanceMi,
            seedStrengthMin: d.seedStrengthMin,
            seedCardioMin: d.seedCardioMin,
            seedRunMin: d.seedRunMin,
            seedPace: d.seedPace,
            seedStrengthLoad: d.seedStrengthLoad,
            seedTotalLoad: d.seedTotalLoad,
            seedIsRest: d.seedIsRest,
          })
          .where(eq(planDaysTable.id, d.id));
        restored += 1;
        // Use the row's current week (not the snapshot's) so aggregate
        // recomputation targets the week the row actually lives in today,
        // in case anything moved it between the reset and the undo.
        touched.add(existing.week);
        if (existing.week !== d.week) {
          // The row moved since the snapshot; the snapshot's original week
          // also needs recomputing because we just changed totals there too.
          touched.add(d.week);
        }
      }
      for (const w of touched) {
        await recomputeWeekTotals(tx, w);
      }
      return {
        daysRestored: restored,
        weeksAffected: Array.from(touched).sort((a, b) => a - b),
      };
    });
  } catch (err) {
    // Restore failed; release the reservation so the runner can retry within
    // the remaining TTL instead of being told the undo window has expired.
    await releaseResetSnapshot(parsed.data.undoToken, snapshot);
    throw err;
  }
  req.log.info(
    { daysRestored: result.daysRestored, weeksAffected: result.weeksAffected },
    "plan reset undone",
  );
  res.json(result);
});

export default router;
