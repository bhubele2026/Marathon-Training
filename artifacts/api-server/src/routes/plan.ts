import { Router, type IRouter } from "express";
import { db, planDaysTable, planWeeksTable, workoutsTable, type PlanDayRow, type WorkoutRow } from "@workspace/db";
import { eq, asc, sql, and, gte, lte } from "drizzle-orm";
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
  const weeks = await db.select().from(planWeeksTable).orderBy(asc(planWeeksTable.week));
  // Aggregate actuals per week
  const actuals = await db.execute<{ week: number; actual_miles: number; completed_sessions: number; total_sessions: number }>(
    sql`
      SELECT pw.week,
        COALESCE(SUM(w.distance_mi) FILTER (WHERE w.session_type <> 'Skipped'), 0)::float AS actual_miles,
        COUNT(DISTINCT w.id) FILTER (WHERE w.session_type <> 'Skipped')::int AS completed_sessions,
        (SELECT COUNT(*) FROM plan_days pd WHERE pd.week = pw.week AND pd.is_rest = false)::int AS total_sessions
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
           distance_mi, pace, avg_hr, rpe, strength_load, total_load, notes, created_at
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
  const loggedRow = (await db.select().from(workoutsTable).where(eq(workoutsTable.date, today)).orderBy(sql`${workoutsTable.createdAt} DESC`).limit(1))[0];
  const suggestions = planRow && !planRow.isRest ? await suggestionsForPlan(planRow, today) : null;
  res.json({
    date: today,
    hasPlan: !!planRow,
    plan: planRow ? toPlanDay(planRow) : null,
    loggedWorkout: loggedRow ? toWorkout(loggedRow) : null,
    suggestions,
  });
});

export default router;
