import { Router, type IRouter } from "express";
import { db, planWeeksTable, planDaysTable, workoutsTable, measurementsTable } from "@workspace/db";
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { toWorkout } from "../lib/transforms";

const router: IRouter = Router();

const RACE_DATE = "2027-05-01";
const START_WEIGHT = 281.6;
const GOAL_WEIGHT = 210;

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

router.get("/dashboard/summary", async (_req, res) => {
  const today = todayISO();
  const weekRow = (await db.select().from(planWeeksTable)
    .where(and(lte(planWeeksTable.startDate, today), gte(planWeeksTable.endDate, today))).limit(1))[0]
    || (await db.select().from(planWeeksTable).orderBy(asc(planWeeksTable.week)).limit(1))[0];

  const startDate = weekRow?.startDate ?? today;
  const endDate = weekRow?.endDate ?? today;

  const weekActuals = await db.execute<{ miles: number; load: number; sessions: number }>(
    sql`SELECT COALESCE(SUM(distance_mi), 0)::float AS miles, COALESCE(SUM(total_load), 0)::float AS load, COUNT(*)::int AS sessions FROM workouts WHERE date BETWEEN ${startDate} AND ${endDate}`,
  );
  const weekPlanned = await db.execute<{ planned_sessions: number }>(
    sql`SELECT COUNT(*)::int AS planned_sessions FROM plan_days WHERE week = ${weekRow?.week ?? 0} AND is_rest = false`,
  );
  const weekProgressPct = (() => {
    if (!weekRow) return 0;
    const start = new Date(weekRow.startDate).getTime();
    const end = new Date(weekRow.endDate).getTime() + 24 * 3600 * 1000;
    const now = Date.now();
    return Math.max(0, Math.min(1, (now - start) / (end - start))) * 100;
  })();

  const allTime = await db.execute<{ total_miles: number }>(
    sql`SELECT COALESCE(SUM(distance_mi), 0)::float AS total_miles FROM workouts`,
  );
  const longestRunActual = await db.execute<{ longest: number }>(
    sql`SELECT COALESCE(MAX(distance_mi), 0)::float AS longest FROM workouts WHERE session_type IN ('Long Run', 'Race')`,
  );

  const lastMeas = await db.execute<{ weight: number | null }>(
    sql`SELECT weight FROM measurements WHERE weight IS NOT NULL ORDER BY date DESC LIMIT 1`,
  );
  const currentWeight = lastMeas.rows[0]?.weight ?? null;

  // Adherence: planned non-rest dates that have at least one logged workout / total planned non-rest dates up to today
  const adherence = await db.execute<{ planned: number; completed: number }>(
    sql`SELECT
      (SELECT COUNT(*)::int FROM plan_days WHERE date <= ${today} AND is_rest = false) AS planned,
      (SELECT COUNT(DISTINCT pd.date)::int FROM plan_days pd
        WHERE pd.date <= ${today} AND pd.is_rest = false
          AND EXISTS (
            SELECT 1 FROM workouts w
            WHERE w.date = pd.date AND w.session_type <> 'Skipped'
          )
      ) AS completed`,
  );
  const planned = adherence.rows[0]?.planned ?? 0;
  const completed = adherence.rows[0]?.completed ?? 0;
  const adherencePct = planned > 0 ? Math.min(100, (completed / planned) * 100) : 0;

  const daysToRace = Math.max(0, Math.ceil((new Date(RACE_DATE).getTime() - Date.now()) / (24 * 3600 * 1000)));

  res.json({
    currentWeek: weekRow?.week ?? 1,
    currentPhase: weekRow?.phase ?? "Foundation Build",
    weekProgressPct,
    weeklyMilesActual: weekActuals.rows[0]?.miles ?? 0,
    weeklyMilesPlanned: weekRow?.plannedMiles ?? 0,
    weeklyLoadActual: weekActuals.rows[0]?.load ?? 0,
    weeklyLoadPlanned: weekRow?.plannedTotalLoad ?? 0,
    weeklySessionsCompleted: weekActuals.rows[0]?.sessions ?? 0,
    weeklySessionsPlanned: weekPlanned.rows[0]?.planned_sessions ?? 0,
    totalMilesAllTime: allTime.rows[0]?.total_miles ?? 0,
    longestRunMi: longestRunActual.rows[0]?.longest ?? 0,
    weightStart: START_WEIGHT,
    weightCurrent: currentWeight,
    weightGoal: GOAL_WEIGHT,
    weightLost: currentWeight !== null ? Math.max(0, START_WEIGHT - currentWeight) : 0,
    weightToGoal: currentWeight !== null ? Math.max(0, currentWeight - GOAL_WEIGHT) : START_WEIGHT - GOAL_WEIGHT,
    adherencePct,
    daysToRace,
  });
});

router.get("/dashboard/weight-trend", async (_req, res) => {
  const rows = await db.execute<{ date: string; weight: number }>(
    sql`SELECT TO_CHAR(date, 'YYYY-MM-DD') AS date, weight FROM measurements WHERE weight IS NOT NULL ORDER BY date ASC`,
  );
  res.json(rows.rows);
});

router.get("/dashboard/weekly-mileage", async (_req, res) => {
  const rows = await db.execute<{ week: number; start_date: string; phase: string; planned_miles: number; actual_miles: number }>(
    sql`
      SELECT pw.week, TO_CHAR(pw.start_date, 'YYYY-MM-DD') AS start_date, pw.phase,
        pw.planned_miles::float AS planned_miles,
        COALESCE(SUM(w.distance_mi), 0)::float AS actual_miles
      FROM plan_weeks pw
      LEFT JOIN workouts w ON w.date BETWEEN pw.start_date AND pw.end_date
      GROUP BY pw.week, pw.start_date, pw.phase, pw.planned_miles
      ORDER BY pw.week ASC
    `,
  );
  res.json(rows.rows.map((r) => ({
    week: r.week,
    startDate: r.start_date,
    phase: r.phase,
    plannedMiles: r.planned_miles,
    actualMiles: r.actual_miles,
  })));
});

const ARSENAL = ["Tonal", "Peloton Tread", "Peloton Bike", "Peloton Row"] as const;

router.get("/dashboard/equipment-usage", async (_req, res) => {
  const rows = await db.execute<{ equipment: string; sessions: number; total_minutes: number; total_load: number; total_distance: number }>(
    sql`SELECT equipment,
      COUNT(*)::int AS sessions,
      COALESCE(SUM(duration_min), 0)::float AS total_minutes,
      COALESCE(SUM(total_load), 0)::float AS total_load,
      COALESCE(SUM(distance_mi), 0)::float AS total_distance
      FROM workouts
      WHERE equipment NOT IN ('Off / Rest', 'Off / Mobility', 'None', 'Rest')
      GROUP BY equipment`,
  );
  const byName = new Map(rows.rows.map((r) => [r.equipment, r]));
  const arsenal = ARSENAL.map((name) => {
    const r = byName.get(name);
    byName.delete(name);
    return {
      equipment: name,
      sessions: r?.sessions ?? 0,
      totalMinutes: r?.total_minutes ?? 0,
      totalLoad: r?.total_load ?? 0,
      totalDistance: r?.total_distance ?? 0,
    };
  });
  const extras = Array.from(byName.values())
    .map((r) => ({
      equipment: r.equipment,
      sessions: r.sessions,
      totalMinutes: r.total_minutes,
      totalLoad: r.total_load,
      totalDistance: r.total_distance,
    }))
    .sort((a, b) => b.sessions - a.sessions);
  res.json([...arsenal, ...extras]);
});

router.get("/dashboard/long-run-progression", async (_req, res) => {
  const rows = await db.execute<{ week: number; date: string; planned_mi: number; actual_mi: number }>(
    sql`
      SELECT pd.week,
        TO_CHAR(pd.date, 'YYYY-MM-DD') AS date,
        pd.distance_mi::float AS planned_mi,
        COALESCE((SELECT MAX(distance_mi) FROM workouts w
          WHERE w.date = pd.date AND w.session_type IN ('Long Run', 'Race')), 0)::float AS actual_mi
      FROM plan_days pd
      WHERE pd.session_type IN ('Long Run', 'Race')
      ORDER BY pd.date ASC
    `,
  );
  res.json(rows.rows.map((r) => ({
    week: r.week,
    date: r.date,
    plannedMi: r.planned_mi,
    actualMi: r.actual_mi,
  })));
});

router.get("/dashboard/recent-activity", async (_req, res) => {
  const rows = await db.select().from(workoutsTable).orderBy(desc(workoutsTable.date), desc(workoutsTable.createdAt)).limit(10);
  res.json(rows.map(toWorkout));
});

export default router;
