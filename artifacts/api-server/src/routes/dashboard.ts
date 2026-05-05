import { Router, type IRouter } from "express";
import { db, planWeeksTable, planDaysTable, workoutsTable, measurementsTable } from "@workspace/db";
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { LIFESTYLE_EQUIPMENT, detectRaceKind } from "@workspace/plan-generator";
import { toWorkout } from "../lib/transforms";
import { readActiveConfigName, readActiveRaceDate } from "./planner";

const router: IRouter = Router();
const START_WEIGHT = 281.6;
const GOAL_WEIGHT = 210;

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

// Task #144: Canonical fallback label for synthetic / legacy plan_day rows
// where source_entry_label is NULL. Mirrors what /plan/overview shows so the
// runner sees the same program name everywhere.
const FALLBACK_PROGRAM_LABEL = "Marathon Plan";

router.get("/dashboard/summary", async (_req, res) => {
  const today = todayISO();
  const weekRow = (await db.select().from(planWeeksTable)
    .where(and(lte(planWeeksTable.startDate, today), gte(planWeeksTable.endDate, today))).limit(1))[0]
    || (await db.select().from(planWeeksTable).orderBy(asc(planWeeksTable.week)).limit(1))[0];

  const startDate = weekRow?.startDate ?? today;
  const endDate = weekRow?.endDate ?? today;

  const weekActuals = await db.execute<{ miles: number; load: number; sessions: number }>(
    sql`SELECT COALESCE(SUM(distance_mi), 0)::float AS miles, COALESCE(SUM(total_load), 0)::float AS load, COUNT(*)::int AS sessions FROM workouts WHERE date BETWEEN ${startDate} AND ${endDate} AND equipment <> ${LIFESTYLE_EQUIPMENT}`,
  );
  const weekLifestyle = await db.execute<{ minutes: number }>(
    sql`SELECT COALESCE(SUM(duration_min), 0)::float AS minutes FROM workouts WHERE date BETWEEN ${startDate} AND ${endDate} AND equipment = ${LIFESTYLE_EQUIPMENT}`,
  );
  const prevWeekRow = weekRow
    ? (await db.select().from(planWeeksTable).where(eq(planWeeksTable.week, weekRow.week - 1)).limit(1))[0]
    : null;
  const prevWeekLifestyle = prevWeekRow
    ? await db.execute<{ minutes: number }>(
        sql`SELECT COALESCE(SUM(duration_min), 0)::float AS minutes FROM workouts WHERE date BETWEEN ${prevWeekRow.startDate} AND ${prevWeekRow.endDate} AND equipment = ${LIFESTYLE_EQUIPMENT}`,
      )
    : null;
  const weekPlanned = await db.execute<{ planned_sessions: number }>(
    sql`SELECT COUNT(*)::int AS planned_sessions FROM plan_days WHERE week = ${weekRow?.week ?? 0} AND is_rest = false`,
  );

  // Task #144: per-program breakdown of THIS week's planned and actual
  // training load. We aggregate planned values from plan_days grouped by
  // source_entry_index, and actuals from workouts joined back to their
  // linked plan_day so each session is attributed to a single program.
  // Workouts that were never matched to a plan_day (unplanned cross-train,
  // logged-before-apply rows) only contribute to the combined headline
  // numbers. `endDate` is the LAST calendar date this program contributes
  // any plan_day on (across the WHOLE campaign, not just this week) so the
  // dashboard can surface programs that finish before the campaign
  // marathonDate.
  interface ProgramAggRow extends Record<string, unknown> {
    source_entry_index: number;
    label: string | null;
    program_end_date: string;
    planned_miles: number;
    planned_load: number;
    planned_sessions: number;
    actual_miles: number;
    actual_load: number;
    actual_sessions: number;
  }
  const programRowsRaw = weekRow
    ? (
        await db.execute<ProgramAggRow>(
          sql`
            WITH program_planned AS (
              SELECT pd.source_entry_index,
                MAX(pd.source_entry_label) AS label,
                COALESCE(SUM(pd.distance_mi) FILTER (WHERE pd.week = ${weekRow.week}), 0)::float AS planned_miles,
                COALESCE(SUM(pd.total_load) FILTER (WHERE pd.week = ${weekRow.week}), 0)::float AS planned_load,
                COUNT(*) FILTER (WHERE pd.week = ${weekRow.week} AND pd.is_rest = false)::int AS planned_sessions,
                TO_CHAR(MAX(pd.date), 'YYYY-MM-DD') AS program_end_date
              FROM plan_days pd
              GROUP BY pd.source_entry_index
            ),
            program_actuals AS (
              SELECT pd.source_entry_index,
                COALESCE(SUM(w.distance_mi), 0)::float AS actual_miles,
                COALESCE(SUM(w.total_load), 0)::float AS actual_load,
                COUNT(*)::int AS actual_sessions
              FROM workouts w
              JOIN plan_days pd ON pd.id = w.plan_day_id
              WHERE w.date BETWEEN ${startDate} AND ${endDate}
                AND w.equipment <> ${LIFESTYLE_EQUIPMENT}
              GROUP BY pd.source_entry_index
            )
            SELECT
              pp.source_entry_index,
              pp.label,
              pp.program_end_date,
              pp.planned_miles,
              pp.planned_load,
              pp.planned_sessions,
              COALESCE(pa.actual_miles, 0)::float AS actual_miles,
              COALESCE(pa.actual_load, 0)::float AS actual_load,
              COALESCE(pa.actual_sessions, 0)::int AS actual_sessions
            FROM program_planned pp
            LEFT JOIN program_actuals pa
              ON pa.source_entry_index = pp.source_entry_index
            ORDER BY pp.program_end_date ASC, pp.source_entry_index ASC
          `,
        )
      ).rows
    : [];

  // Always return at least one program so single-program campaigns still
  // get a stable shape; fall back to the campaign-level totals when the
  // plan tables are empty (pre-launch).
  const programs = programRowsRaw.length > 0
    ? programRowsRaw.map((r) => ({
        sourceEntryIndex: r.source_entry_index,
        label: r.label ?? FALLBACK_PROGRAM_LABEL,
        endDate: r.program_end_date,
        weeklyMilesPlanned: r.planned_miles,
        weeklyMilesActual: r.actual_miles,
        weeklyLoadPlanned: r.planned_load,
        weeklyLoadActual: r.actual_load,
        weeklySessionsPlanned: r.planned_sessions,
        weeklySessionsCompleted: r.actual_sessions,
      }))
    : [
        {
          sourceEntryIndex: 0,
          label: FALLBACK_PROGRAM_LABEL,
          endDate: weekRow?.endDate ?? today,
          weeklyMilesPlanned: 0,
          weeklyMilesActual: 0,
          weeklyLoadPlanned: 0,
          weeklyLoadActual: 0,
          weeklySessionsPlanned: 0,
          weeklySessionsCompleted: 0,
        },
      ];

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

  // Adherence: per plan_day completion / total planned non-rest plan_days
  // up to today (Task #143). Each concurrent overlapping program (Task
  // #135) contributes its own plan_day to the denominator and is credited
  // toward the numerator only when a workout was logged against ITS
  // plan_day_id. Legacy workouts (planDayId IS NULL) fall back to date
  // matching so single-program history still counts toward completion.
  const adherence = await db.execute<{ planned: number; completed: number }>(
    sql`SELECT
      (SELECT COUNT(*)::int FROM plan_days WHERE date <= ${today} AND is_rest = false) AS planned,
      (SELECT COUNT(*)::int FROM plan_days pd
        WHERE pd.date <= ${today} AND pd.is_rest = false
          AND EXISTS (
            SELECT 1 FROM workouts w
            WHERE w.session_type <> 'Skipped'
              AND (
                w.plan_day_id = pd.id
                OR (w.plan_day_id IS NULL AND w.date = pd.date)
              )
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

  // Task #209: per-kind race-campaign framing for the dashboard header
  // and race-week banner. Mirrors the trailing-Sunday detection used by
  // /plan/overview (Task #204 / #210) — same shared `detectRaceKind`
  // helper from `@workspace/plan-generator` — so the dashboard reads
  // "5K Campaign" / "10K Campaign" / "Half Marathon Campaign" / "Race
  // Campaign" in lock-step with /plan instead of always defaulting to
  // marathon framing. Tonal-first / ad-hoc Custom blocks produce no
  // recognised race row, so this stays null and the dashboard keeps
  // its generic header copy.
  const lastDayRows = await db.execute<{
    distance_mi: number | null;
    description: string | null;
    session_type: string | null;
  }>(
    sql`SELECT distance_mi, description, session_type
        FROM plan_days
        ORDER BY date DESC, source_entry_index ASC
        LIMIT 1`,
  );
  const lastDay = lastDayRows.rows[0];
  const raceKind = lastDay
    ? detectRaceKind(lastDay.distance_mi, lastDay.description, lastDay.session_type)
    : null;

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
    prevWeeklyLifestyleMinutes: prevWeekLifestyle ? (prevWeekLifestyle.rows[0]?.minutes ?? 0) : null,
    totalMilesAllTime: allTime.rows[0]?.total_miles ?? 0,
    longestRunMi: longestRunActual.rows[0]?.longest ?? 0,
    weightStart: START_WEIGHT,
    weightCurrent: currentWeight,
    weightGoal: GOAL_WEIGHT,
    weightLost: currentWeight !== null ? Math.max(0, START_WEIGHT - currentWeight) : 0,
    weightToGoal: currentWeight !== null ? Math.max(0, currentWeight - GOAL_WEIGHT) : START_WEIGHT - GOAL_WEIGHT,
    adherencePct,
    daysToRace,
    programs,
    raceKind,
    activeConfigName: await readActiveConfigName(),
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

  // Task #144: per-program planned breakdown per week. The headline
  // plannedMiles / plannedCardioMin above are the COMBINED totals across
  // overlapping programs (the existing aggregated plan_weeks row); this
  // breakdown lets the chart tooltip show the per-program contribution
  // (e.g. "Tonal Lift: 0 mi · 5K Improver: 18 mi"). We aggregate from
  // plan_days so synthetic recovery-gap rows (source_entry_label NULL)
  // get folded under the canonical fallback label.
  interface WeekProgramRow extends Record<string, unknown> {
    week: number;
    source_entry_index: number;
    label: string | null;
    planned_miles: number;
    planned_cardio_min: number;
  }
  const programByWeek = await db.execute<WeekProgramRow>(
    sql`
      SELECT week,
        source_entry_index,
        MAX(source_entry_label) AS label,
        COALESCE(SUM(distance_mi), 0)::float AS planned_miles,
        COALESCE(SUM(cardio_min), 0)::float AS planned_cardio_min
      FROM plan_days
      WHERE is_rest = false
      GROUP BY week, source_entry_index
      ORDER BY week ASC, source_entry_index ASC
    `,
  );
  // Task #159: per-program end date (latest plan_day across the WHOLE
  // campaign) so the per-week breakdown can be sorted by closest race
  // date ascending — same ordering /dashboard/summary uses, so the
  // chart tooltip lists the most-imminent program first.
  const programEndDates = await db.execute<{ source_entry_index: number; end_date: string }>(
    sql`
      SELECT source_entry_index, TO_CHAR(MAX(date), 'YYYY-MM-DD') AS end_date
      FROM plan_days
      GROUP BY source_entry_index
    `,
  );
  const endDateByIndex = new Map(
    programEndDates.rows.map((r) => [r.source_entry_index, r.end_date]),
  );
  const programsByWeek = new Map<number, Array<{
    sourceEntryIndex: number;
    label: string;
    plannedMiles: number;
    plannedCardioMin: number;
  }>>();
  for (const r of programByWeek.rows) {
    const list = programsByWeek.get(r.week) ?? [];
    list.push({
      sourceEntryIndex: r.source_entry_index,
      label: r.label ?? FALLBACK_PROGRAM_LABEL,
      plannedMiles: r.planned_miles,
      plannedCardioMin: r.planned_cardio_min,
    });
    programsByWeek.set(r.week, list);
  }
  for (const list of programsByWeek.values()) {
    list.sort((a, b) => {
      const ae = endDateByIndex.get(a.sourceEntryIndex) ?? "9999-12-31";
      const be = endDateByIndex.get(b.sourceEntryIndex) ?? "9999-12-31";
      if (ae !== be) return ae < be ? -1 : 1;
      return a.sourceEntryIndex - b.sourceEntryIndex;
    });
  }

  // Task #183: per-week flag indicating whether the Wednesday plan day is
  // a Steady (Z3) Run + Accessory session. Mirrors the same SQL the
  // /plan/weeks aggregation uses (Task #175), so a runner who customizes
  // Wed off Steady sees the dashboard amber marker drop on the next
  // refetch. BOOL_OR handles concurrent overlapping programs (Task #135)
  // that may put multiple rows on the same Wed.
  const wedSteadyRows = await db.execute<{ week: number; wed_steady: boolean }>(
    sql`SELECT week, BOOL_OR(session_type = 'Steady Run + Accessory') AS wed_steady
        FROM plan_days
        WHERE day = 'Wed'
        GROUP BY week`,
  );
  const wedSteadyByWeek = new Map(
    wedSteadyRows.rows.map((r) => [r.week, r.wed_steady]),
  );

  res.json(rows.rows.map((r) => ({
    week: r.week,
    startDate: r.start_date,
    phase: r.phase,
    plannedMiles: r.planned_miles,
    actualMiles: r.actual_miles,
    plannedCardioMin: r.planned_cardio_min,
    actualCardioMin: r.actual_cardio_min,
    dominantCardioEquipment: dominantByWeek.get(r.week) ?? null,
    programs: programsByWeek.get(r.week) ?? [],
    wedSteady: wedSteadyByWeek.get(r.week) ?? null,
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

  // Task #144: per-program planned attribution per machine. Lets the
  // /equipment page (and the dashboard Arsenal tile) split a machine's
  // planned workload between concurrent programs — e.g. Tonal might be
  // 80% Tonal Lift program and 20% 5K Improver cross-train. We aggregate
  // from plan_days grouped by (equipment, source_entry_index) so the
  // numbers sum to the headline planned* totals above.
  interface EquipmentProgramRow extends Record<string, unknown> {
    equipment: string;
    source_entry_index: number;
    label: string | null;
    planned_sessions: number;
    planned_minutes: number;
    planned_load: number;
    planned_distance: number;
  }
  const programsRows = await db.execute<EquipmentProgramRow>(
    sql`
      SELECT equipment,
        source_entry_index,
        MAX(source_entry_label) AS label,
        COUNT(*)::int AS planned_sessions,
        COALESCE(SUM(cardio_min), 0)::float AS planned_minutes,
        COALESCE(SUM(total_load), 0)::float AS planned_load,
        COALESCE(SUM(distance_mi), 0)::float AS planned_distance
      FROM plan_days
      WHERE is_rest = false
        AND equipment NOT IN ('Off / Rest', 'Off / Mobility', 'None', 'Rest')
      GROUP BY equipment, source_entry_index
      ORDER BY equipment ASC, source_entry_index ASC
    `,
  );
  const byProgramByEq = new Map<string, Array<{
    sourceEntryIndex: number;
    label: string;
    plannedSessions: number;
    plannedMinutes: number;
    plannedLoad: number;
    plannedDistance: number;
  }>>();
  for (const r of programsRows.rows) {
    const list = byProgramByEq.get(r.equipment) ?? [];
    list.push({
      sourceEntryIndex: r.source_entry_index,
      label: r.label ?? FALLBACK_PROGRAM_LABEL,
      plannedSessions: r.planned_sessions,
      plannedMinutes: r.planned_minutes,
      plannedLoad: r.planned_load,
      plannedDistance: r.planned_distance,
    });
    byProgramByEq.set(r.equipment, list);
  }

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
    byProgram: byProgramByEq.get(name) ?? [],
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
        WHERE w.equipment NOT IN ('Off / Rest', 'Off / Mobility', 'None', 'Rest', ${LIFESTYLE_EQUIPMENT})
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
  // Task #113: aggregate per plan_week so weeks with no Long Run / Race
  // (cross-train-only weeks, taper weeks, lift-priority blocks) still
  // appear on the chart — previously they were skipped entirely because
  // the row source was `plan_days WHERE session_type IN ('Long Run',
  // 'Race')`. Per-week planned/actual long run miles fall back to 0
  // when the week has no long run, and `plannedCardioMin` /
  // `actualCardioMin` surface the cross-train load so the secondary
  // axis bar renders something for those weeks.
  const rows = await db.execute<{
    week: number;
    start_date: string;
    long_run_date: string | null;
    phase: string;
    planned_mi: number;
    actual_mi: number;
    planned_cardio_min: number;
    actual_cardio_min: number;
  }>(
    sql`
      SELECT pw.week,
        TO_CHAR(pw.start_date, 'YYYY-MM-DD') AS start_date,
        pw.phase AS phase,
        (SELECT TO_CHAR(MAX(pd.date), 'YYYY-MM-DD') FROM plan_days pd
          WHERE pd.week = pw.week AND pd.session_type IN ('Long Run', 'Race')) AS long_run_date,
        COALESCE((SELECT MAX(pd.distance_mi) FROM plan_days pd
          WHERE pd.week = pw.week AND pd.session_type IN ('Long Run', 'Race')), 0)::float AS planned_mi,
        COALESCE((SELECT MAX(w.distance_mi) FROM workouts w
          WHERE w.date BETWEEN pw.start_date AND pw.end_date
            AND w.session_type IN ('Long Run', 'Race')), 0)::float AS actual_mi,
        COALESCE((SELECT SUM(pd.cardio_min) FROM plan_days pd
          WHERE pd.week = pw.week AND pd.cardio_min > 0), 0)::float AS planned_cardio_min,
        COALESCE((SELECT SUM(w.cardio_min) FROM workouts w
          WHERE w.date BETWEEN pw.start_date AND pw.end_date
            AND w.cardio_min > 0), 0)::float AS actual_cardio_min
      FROM plan_weeks pw
      ORDER BY pw.week ASC
    `,
  );
  res.json(rows.rows.map((r) => ({
    week: r.week,
    date: r.long_run_date ?? r.start_date,
    phase: r.phase,
    plannedMi: r.planned_mi,
    actualMi: r.actual_mi,
    cardioMin: r.actual_cardio_min > 0 ? r.actual_cardio_min : null,
    plannedCardioMin: r.planned_cardio_min,
    actualCardioMin: r.actual_cardio_min,
  })));
});

router.get("/dashboard/recent-activity", async (_req, res) => {
  // Left join the matched plan day so each Workout row carries the
  // prescribed run-target snapshot (Task #140 / #148). Mirrors the
  // join shape used by GET /api/workouts.
  const rows = await db
    .select({
      workout: workoutsTable,
      planDay: {
        sessionType: planDaysTable.sessionType,
        week: planDaysTable.week,
        runMin: planDaysTable.runMin,
        distanceMi: planDaysTable.distanceMi,
        pace: planDaysTable.pace,
      },
    })
    .from(workoutsTable)
    .leftJoin(planDaysTable, eq(workoutsTable.planDayId, planDaysTable.id))
    .orderBy(desc(workoutsTable.date), desc(workoutsTable.createdAt))
    .limit(10);
  res.json(
    rows.map((r) =>
      toWorkout(
        r.workout,
        r.planDay && r.planDay.sessionType != null ? r.planDay : null,
      ),
    ),
  );
});

// Task #42: Distinct lifestyle session types ordered by recency. Drives
// the quick-log preset ordering on the Dashboard card and the mobile
// FAB so the runner's most-recently-logged activity sorts to the front.
// Sourced from persisted workout history (NOT a localStorage click
// counter) so the order reflects what the runner actually did, and it
// updates automatically after every successful workout save via the
// React Query invalidation that already runs in WorkoutForm.
router.get("/dashboard/recent-lifestyle-activities", async (_req, res) => {
  const rows = await db.execute<{ session_type: string; last_logged_at: string }>(
    sql`SELECT session_type,
           TO_CHAR(MAX(date), 'YYYY-MM-DD') AS last_logged_at
        FROM workouts
        WHERE equipment = ${LIFESTYLE_EQUIPMENT}
          AND session_type IS NOT NULL
          AND session_type <> ''
          AND session_type <> 'Skipped'
        GROUP BY session_type
        ORDER BY MAX(date) DESC, MAX(created_at) DESC
        LIMIT 10`,
  );
  res.json(rows.rows.map((r) => ({
    sessionType: r.session_type,
    lastLoggedAt: r.last_logged_at,
  })));
});

export default router;
