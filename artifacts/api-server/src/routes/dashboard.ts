import { Router, type IRouter } from "express";
import { db, planWeeksTable, planDaysTable, workoutsTable, measurementsTable } from "@workspace/db";
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { toWorkout } from "../lib/transforms";
import { readActiveRaceDate } from "./planner";

const router: IRouter = Router();
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
    sql`SELECT COALESCE(SUM(distance_mi), 0)::float AS miles, COALESCE(SUM(total_load), 0)::float AS load, COUNT(*)::int AS sessions FROM workouts WHERE date BETWEEN ${startDate} AND ${endDate} AND equipment <> 'Lifestyle'`,
  );
  const weekLifestyle = await db.execute<{ minutes: number }>(
    sql`SELECT COALESCE(SUM(duration_min), 0)::float AS minutes FROM workouts WHERE date BETWEEN ${startDate} AND ${endDate} AND equipment = 'Lifestyle'`,
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

  // Anchor on the runner's chosen marathon date when they've applied a
  // custom Planner config; otherwise fall back to the canonical race date.
  const activeRaceDate = await readActiveRaceDate();
  const daysToRace = Math.max(0, Math.ceil((new Date(activeRaceDate).getTime() - Date.now()) / (24 * 3600 * 1000)));

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
    weeklyLifestyleMinutes: weekLifestyle.rows[0]?.minutes ?? 0,
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
  // Mileage and cardio-minutes per plan_week. Bike-only / row-only weeks
  // have plannedMiles == 0, so the chart also surfaces planned/actual
  // cross-train cardio minutes (and the dominant cardio machine for the
  // tooltip label) so those weeks no longer render as zero-height bars.
  const rows = await db.execute<{
    week: number;
    start_date: string;
    phase: string;
    planned_miles: number;
    actual_miles: number;
    planned_cardio_min: number;
    actual_cardio_min: number;
  }>(
    sql`
      SELECT pw.week, TO_CHAR(pw.start_date, 'YYYY-MM-DD') AS start_date, pw.phase,
        pw.planned_miles::float AS planned_miles,
        COALESCE(pw.planned_cardio, 0)::float AS planned_cardio_min,
        COALESCE(SUM(w.distance_mi), 0)::float AS actual_miles,
        COALESCE(SUM(w.cardio_min), 0)::float AS actual_cardio_min
      FROM plan_weeks pw
      LEFT JOIN workouts w ON w.date BETWEEN pw.start_date AND pw.end_date
      GROUP BY pw.week, pw.start_date, pw.phase, pw.planned_miles, pw.planned_cardio
      ORDER BY pw.week ASC
    `,
  );
  // Per-week dominant cardio machine: the equipment with the highest total
  // planned cardio_min across non-rest plan days. Mirrors the logic in
  // /api/plan/weeks so the chart tooltip can label bike-only / row-only
  // weeks (e.g. "60 min · Peloton Bike"). Ties broken by equipment name.
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
  const dominantByWeek = new Map(cardioEq.rows.map((r) => [r.week, r.equipment]));
  res.json(rows.rows.map((r) => ({
    week: r.week,
    startDate: r.start_date,
    phase: r.phase,
    plannedMiles: r.planned_miles,
    actualMiles: r.actual_miles,
    plannedCardioMin: r.planned_cardio_min,
    actualCardioMin: r.actual_cardio_min,
    dominantCardioEquipment: dominantByWeek.get(r.week) ?? null,
  })));
});

const ARSENAL = ["Tonal", "Peloton Tread", "Peloton Bike", "Peloton Row"] as const;

interface EquipmentRow extends Record<string, unknown> {
  equipment: string;
  sessions: number;
  total_minutes: number;
  total_load: number;
  total_distance: number;
  planned_sessions: number;
  planned_minutes: number;
  planned_load: number;
  planned_distance: number;
  planned_to_date_sessions: number;
  planned_to_date_minutes: number;
  planned_to_date_load: number;
  planned_to_date_distance: number;
}

router.get("/dashboard/equipment-usage", async (_req, res) => {
  const today = todayISO();
  // Join planned aggregates from plan_days (excluding rest) with the existing
  // actual aggregates from workouts. FULL OUTER JOIN so machines that only
  // appear on one side still show up. The canonical arsenal is then forced
  // to render first, even when neither side has data yet.
  //
  // `planned_to_date_*` is the same plan aggregation but bounded by `date <=
  // today` so the UI can compare actuals against the share of the plan that
  // should have happened by now, not the full 52-week target.
  const rows = await db.execute<EquipmentRow>(
    sql`
      WITH actuals AS (
        SELECT equipment,
          COUNT(*)::int AS sessions,
          COALESCE(SUM(duration_min), 0)::float AS total_minutes,
          COALESCE(SUM(total_load), 0)::float AS total_load,
          COALESCE(SUM(distance_mi), 0)::float AS total_distance
        FROM workouts
        WHERE equipment NOT IN ('Off / Rest', 'Off / Mobility', 'None', 'Rest')
        GROUP BY equipment
      ),
      planned AS (
        SELECT equipment,
          COUNT(*)::int AS planned_sessions,
          COALESCE(SUM(cardio_min), 0)::float AS planned_minutes,
          COALESCE(SUM(total_load), 0)::float AS planned_load,
          COALESCE(SUM(distance_mi), 0)::float AS planned_distance,
          COUNT(*) FILTER (WHERE date <= ${today})::int AS planned_to_date_sessions,
          COALESCE(SUM(cardio_min) FILTER (WHERE date <= ${today}), 0)::float AS planned_to_date_minutes,
          COALESCE(SUM(total_load) FILTER (WHERE date <= ${today}), 0)::float AS planned_to_date_load,
          COALESCE(SUM(distance_mi) FILTER (WHERE date <= ${today}), 0)::float AS planned_to_date_distance
        FROM plan_days
        WHERE is_rest = false
          AND equipment NOT IN ('Off / Rest', 'Off / Mobility', 'None', 'Rest')
        GROUP BY equipment
      )
      SELECT
        COALESCE(a.equipment, p.equipment) AS equipment,
        COALESCE(a.sessions, 0)::int AS sessions,
        COALESCE(a.total_minutes, 0)::float AS total_minutes,
        COALESCE(a.total_load, 0)::float AS total_load,
        COALESCE(a.total_distance, 0)::float AS total_distance,
        COALESCE(p.planned_sessions, 0)::int AS planned_sessions,
        COALESCE(p.planned_minutes, 0)::float AS planned_minutes,
        COALESCE(p.planned_load, 0)::float AS planned_load,
        COALESCE(p.planned_distance, 0)::float AS planned_distance,
        COALESCE(p.planned_to_date_sessions, 0)::int AS planned_to_date_sessions,
        COALESCE(p.planned_to_date_minutes, 0)::float AS planned_to_date_minutes,
        COALESCE(p.planned_to_date_load, 0)::float AS planned_to_date_load,
        COALESCE(p.planned_to_date_distance, 0)::float AS planned_to_date_distance
      FROM actuals a
      FULL OUTER JOIN planned p ON a.equipment = p.equipment
    `,
  );
  const byName = new Map(rows.rows.map((r) => [r.equipment, r]));
  const toItem = (name: string, r?: EquipmentRow) => ({
    equipment: name,
    sessions: r?.sessions ?? 0,
    totalMinutes: r?.total_minutes ?? 0,
    totalLoad: r?.total_load ?? 0,
    totalDistance: r?.total_distance ?? 0,
    plannedSessions: r?.planned_sessions ?? 0,
    plannedMinutes: r?.planned_minutes ?? 0,
    plannedLoad: r?.planned_load ?? 0,
    plannedDistance: r?.planned_distance ?? 0,
    plannedToDateSessions: r?.planned_to_date_sessions ?? 0,
    plannedToDateMinutes: r?.planned_to_date_minutes ?? 0,
    plannedToDateLoad: r?.planned_to_date_load ?? 0,
    plannedToDateDistance: r?.planned_to_date_distance ?? 0,
  });
  const arsenal = ARSENAL.map((name) => {
    const r = byName.get(name);
    byName.delete(name);
    return toItem(name, r);
  });
  const extras = Array.from(byName.values())
    .map((r) => toItem(r.equipment, r))
    .sort((a, b) => (b.sessions + b.plannedSessions) - (a.sessions + a.plannedSessions));
  res.json([...arsenal, ...extras]);
});

router.get("/dashboard/equipment-phase-summary", async (_req, res) => {
  // Phase order = the chronological order each phase first appears in
  // plan_weeks. This keeps the response aligned with how the campaign is
  // actually structured rather than relying on hardcoded names.
  const phaseRows = await db.execute<{ phase: string; first_week: number }>(
    sql`SELECT phase, MIN(week)::int AS first_week
        FROM plan_weeks
        GROUP BY phase
        ORDER BY first_week ASC`,
  );
  const phases = phaseRows.rows.map((r) => r.phase);
  const phaseIndex = new Map(phases.map((p, i) => [p, i]));

  const today = todayISO();
  const countRows = await db.execute<{
    phase: string;
    equipment: string;
    sessions: number;
    planned_to_date: number;
  }>(
    sql`SELECT phase, equipment,
          COUNT(*)::int AS sessions,
          COUNT(*) FILTER (WHERE date <= ${today})::int AS planned_to_date
        FROM plan_days
        WHERE is_rest = false
          AND equipment NOT IN ('Off / Rest', 'Off / Mobility', 'None', 'Rest')
        GROUP BY phase, equipment`,
  );

  // Actuals: tag each workout with the phase of the plan_week whose
  // [start_date, end_date] band contains the workout's date. Workouts that
  // fall outside any planned week (e.g. cross-training before/after the
  // campaign window) are dropped so the totals always line up with the
  // campaign timeline.
  const actualRows = await db.execute<{ phase: string; equipment: string; sessions: number }>(
    sql`SELECT pw.phase, w.equipment, COUNT(*)::int AS sessions
        FROM workouts w
        JOIN plan_weeks pw
          ON w.date BETWEEN pw.start_date AND pw.end_date
        WHERE w.equipment NOT IN ('Off / Rest', 'Off / Mobility', 'None', 'Rest', 'Lifestyle')
          AND w.session_type <> 'Skipped'
        GROUP BY pw.phase, w.equipment`,
  );

  interface Row {
    counts: number[];
    actualCounts: number[];
    plannedToDateCounts: number[];
  }
  const rowsByEquipment = new Map<string, Row>();
  const emptyRow = (): Row => ({
    counts: phases.map(() => 0),
    actualCounts: phases.map(() => 0),
    plannedToDateCounts: phases.map(() => 0),
  });
  const ensure = (name: string): Row => {
    let row = rowsByEquipment.get(name);
    if (!row) {
      row = emptyRow();
      rowsByEquipment.set(name, row);
    }
    return row;
  };
  // Always surface the canonical arsenal so a fresh plan still renders the
  // expected machines.
  for (const name of ARSENAL) ensure(name);
  for (const r of countRows.rows) {
    const idx = phaseIndex.get(r.phase);
    if (idx === undefined) continue;
    const row = ensure(r.equipment);
    row.counts[idx] = r.sessions;
    row.plannedToDateCounts[idx] = r.planned_to_date;
  }
  for (const r of actualRows.rows) {
    const idx = phaseIndex.get(r.phase);
    if (idx === undefined) continue;
    ensure(r.equipment).actualCounts[idx] = r.sessions;
  }

  const buildRow = (equipment: string, row: Row) => ({
    equipment,
    counts: row.counts,
    actualCounts: row.actualCounts,
    plannedToDateCounts: row.plannedToDateCounts,
    total: row.counts.reduce((s, n) => s + n, 0),
    actualTotal: row.actualCounts.reduce((s, n) => s + n, 0),
  });

  const arsenalRows = ARSENAL.map((name) => {
    const row = rowsByEquipment.get(name) ?? emptyRow();
    rowsByEquipment.delete(name);
    return buildRow(name, row);
  });
  const extraRows = Array.from(rowsByEquipment.entries())
    .map(([equipment, row]) => buildRow(equipment, row))
    // Order non-arsenal machines by whichever signal is largest so a row
    // that's mostly unplanned actuals still surfaces above an empty row.
    .sort((a, b) => Math.max(b.total, b.actualTotal) - Math.max(a.total, a.actualTotal));

  res.json({ phases, rows: [...arsenalRows, ...extraRows] });
});

router.get("/dashboard/long-run-progression", async (_req, res) => {
  const rows = await db.execute<{ week: number; date: string; phase: string; planned_mi: number; actual_mi: number }>(
    sql`
      SELECT pd.week,
        TO_CHAR(pd.date, 'YYYY-MM-DD') AS date,
        pw.phase AS phase,
        pd.distance_mi::float AS planned_mi,
        COALESCE((SELECT MAX(distance_mi) FROM workouts w
          WHERE w.date = pd.date AND w.session_type IN ('Long Run', 'Race')), 0)::float AS actual_mi
      FROM plan_days pd
      LEFT JOIN plan_weeks pw ON pw.week = pd.week
      WHERE pd.session_type IN ('Long Run', 'Race')
      ORDER BY pd.date ASC
    `,
  );
  res.json(rows.rows.map((r) => ({
    week: r.week,
    date: r.date,
    phase: r.phase,
    plannedMi: r.planned_mi,
    actualMi: r.actual_mi,
  })));
});

router.get("/dashboard/recent-activity", async (_req, res) => {
  const rows = await db.select().from(workoutsTable).orderBy(desc(workoutsTable.date), desc(workoutsTable.createdAt)).limit(10);
  res.json(rows.map(toWorkout));
});

export default router;
