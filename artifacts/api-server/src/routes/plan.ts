import { Router, type IRouter } from "express";
import { db, planDaysTable, planWeeksTable, workoutsTable } from "@workspace/db";
import { eq, asc, sql, and, gte, lte } from "drizzle-orm";
import { toPlanDay, toPlanWeek, toWorkout } from "../lib/transforms";

const router: IRouter = Router();

const RACE_DATE = "2027-05-01";
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
  const weeks = await db.select().from(planWeeksTable).orderBy(asc(planWeeksTable.week));
  // Aggregate actuals per week
  const actuals = await db.execute<{ week: number; actual_miles: number; completed_sessions: number; total_sessions: number }>(
    sql`
      SELECT pw.week,
        COALESCE(SUM(w.distance_mi), 0)::float AS actual_miles,
        COUNT(DISTINCT w.id)::int AS completed_sessions,
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
    sql`SELECT COALESCE(SUM(distance_mi), 0)::float AS actual_miles, COUNT(*)::int AS completed FROM workouts WHERE date BETWEEN ${weekRow.startDate} AND ${weekRow.endDate}`,
  );
  const totalSessions = days.filter((d) => !d.isRest).length;
  res.json({
    ...toPlanWeek(weekRow, {
      actualMiles: actuals.rows[0]?.actual_miles ?? 0,
      completedSessions: actuals.rows[0]?.completed ?? 0,
      totalSessions,
    }),
    days: days.map(toPlanDay),
  });
});

router.get("/plan/today", async (_req, res) => {
  const today = todayISO();
  const planRow = (await db.select().from(planDaysTable).where(eq(planDaysTable.date, today)).limit(1))[0];
  const loggedRow = (await db.select().from(workoutsTable).where(eq(workoutsTable.date, today)).orderBy(sql`${workoutsTable.createdAt} DESC`).limit(1))[0];
  res.json({
    date: today,
    hasPlan: !!planRow,
    plan: planRow ? toPlanDay(planRow) : null,
    loggedWorkout: loggedRow ? toWorkout(loggedRow) : null,
  });
});

export default router;
