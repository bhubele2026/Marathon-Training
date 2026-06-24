import { Router, type IRouter } from "express";
import {
  db,
  planDaysTable,
  planWeeksTable,
  plannerConfigsTable,
  workoutsTable,
  type PlanDayRow,
  type WorkoutRow,
} from "@workspace/db";
import { eq, asc, desc, sql, and, gte, lte, inArray } from "drizzle-orm";
import {
  UpdatePlanDayBody,
  SwapPlanDayBody,
  UndoPlanResetBody,
} from "@workspace/api-zod";
import {
  detectRaceKind,
  PLAN_SCIENCE_VERSION,
  type PlannerConfig,
  type TemplateEntry,
} from "@workspace/plan-generator";
import {
  readActiveBodyTargets,
  readActiveConfigName,
  readLastAppliedPlannerConfig,
} from "./planner";
import {
  toPlanDay,
  toPlanWeek,
  toWorkout,
  type PlanWeekProgramSummary,
} from "../lib/transforms";
import {
  consumeResetSnapshot,
  releaseResetSnapshot,
  snapshotPlanDay,
  snapshotPlanDayFull,
  snapshotPlanWeek,
  storeEntirePlanWipeSnapshotInTx,
  storeResetSnapshot,
  RESET_UNDO_TTL_MS,
  type AppliedPlannerConfigSnapshot,
  type DetachedWorkoutSnapshot,
  type EntirePlanWipeSnapshotPayload,
  type PlanDaySnapshot,
} from "../lib/reset-undo";
import {
  DEFAULT_LOOKBACK_WEEKS,
  isPersonalizableLongRunPlanDay,
  isPersonalizableQualityPlanDay,
  personalizeLongRunPace,
  personalizeQualityPace,
  personalizeRacePace,
  type PersonalizableRaceKind,
  type PersonalizedLongRunPace,
  type PersonalizedQualityPace,
  type PersonalizedRacePace,
} from "../lib/personalized-race-pace";

const router: IRouter = Router();

// Task #144 / #162: Canonical fallback label for synthetic / legacy
// plan_day rows where source_entry_label is NULL. Mirrors the
// dashboard's identical constant so /plan and /dashboard agree on what
// to call a single-program campaign's lone "program".
const FALLBACK_PROGRAM_LABEL = "Marathon Plan";

// Task #330. Earliest non-null measurement weight, used as the
// `startWeight` fallback when no applied planner config carries a
// snapshotted target. Returns null when no measurements exist (fresh
// install) so the dashboard / plan header can render an em-dash
// sentinel instead of the legacy hardcoded 281.6 constant.
async function readEarliestMeasurementWeight(): Promise<number | null> {
  const rows = await db.execute<{ weight: number }>(
    sql`SELECT weight FROM measurements WHERE weight IS NOT NULL ORDER BY date ASC LIMIT 1`,
  );
  return rows.rows[0]?.weight ?? null;
}

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

export async function computePlanOverview() {
  const { week, phase } = await currentWeek();
  const allWeeks = await db.select().from(planWeeksTable).orderBy(asc(planWeeksTable.week));
  const totalWeeks = allWeeks.length;
  const weekRow = allWeeks.find((w) => w.week === week);
  const lastMeasurement = await db.execute<{ weight: number | null }>(
    sql`SELECT weight FROM measurements WHERE weight IS NOT NULL ORDER BY date DESC LIMIT 1`,
  );
  const currentWeight = lastMeasurement.rows[0]?.weight ?? null;

  // Task #204: detect the campaign's race kind from the trailing
  // plan_day so the /plan header can switch to "Race Campaign" /
  // per-kind framing for half / 10K / 5K plans, not just marathons.
  // The marathon-only heuristic in the client (presence of the
  // "Marathon-Specific" phase) misses entries-mode half / 10K / 5K
  // plans that end on a real race-day Sunday but never produce that
  // phase. Using the LAST plan_day (max date) keeps this in sync with
  // whichever program ends the campaign — including multi-program
  // configs (Task #135) where a Tonal lift block runs alongside a 5K
  // race block. Resolution mirrors the client `raceDayLabel` helper:
  //   * gate on an explicit race signal (sessionType === "Race" OR
  //     description starts with "RACE DAY — ") so a stray 13.1 mi
  //     long run / 3.1 mi shakeout / 26.2 mi anything cannot be
  //     mis-classified from distance alone.
  //   * resolve kind from the description prefix first (survives a
  //     runner editing the distance), fall back to `distance_mi` for
  //     hand-edited rows that lost the prefix.
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

  // Task #135: surface every program (TemplateEntry) currently
  // contributing rows to plan_days so the /plan overview can render a
  // "Programs" panel as parallel tracks. Aggregated directly from
  // plan_days rather than from the planner config so the panel always
  // reflects what was actually applied (and so legacy single-program
  // campaigns naturally show as a single "Marathon Plan" track even
  // when the config was authored in blocks-mode with no entry label).
  const programRows = await db.execute<{
    source_entry_index: number;
    source_entry_label: string | null;
    start_date: string;
    end_date: string;
    week_count: number;
  }>(
    sql`SELECT source_entry_index,
               MAX(source_entry_label) AS source_entry_label,
               MIN(date) AS start_date,
               MAX(date) AS end_date,
               COUNT(DISTINCT week)::int AS week_count
        FROM plan_days
        GROUP BY source_entry_index
        ORDER BY source_entry_index`,
  );
  const programs = programRows.rows.map((r) => ({
    sourceEntryIndex: r.source_entry_index,
    label: r.source_entry_label ?? "Marathon Plan",
    startDate: r.start_date,
    endDate: r.end_date,
    weeks: r.week_count,
  }));

  // Task #33: earliest past non-rest plan_day with no workout
  // attributed to it via workouts.plan_day_id. Used by the /plan
  // header to render a "Next Missed" shortcut that jumps the runner
  // straight to the day they need to back-fill. Mirrors the missed-day
  // predicate used in /plan/weeks so the badge counts and this
  // shortcut never disagree on which dates count as missed. The legacy
  // date-only fallback (`plan_day_id IS NULL AND w.date = pd.date`)
  // was retired in Task #295 once every workout carries a real
  // `plan_day_id` (backfilled by `backfill-workout-plan-day`, with a
  // post-merge orphan check guarding against regressions).
  const today = todayISO();
  const nextMissedRows = await db.execute<{ id: number; date: string; week: number }>(
    sql`SELECT pd.id, pd.date, pd.week
        FROM plan_days pd
        WHERE pd.is_rest = false
          AND pd.date < ${today}
          AND NOT EXISTS (
            SELECT 1 FROM workouts w
            WHERE w.plan_day_id = pd.id
          )
        ORDER BY pd.date ASC, pd.source_entry_index ASC
        LIMIT 1`,
  );
  const nextMissed = nextMissedRows.rows[0];

  const activeConfigName = await readActiveConfigName();

  // Behavior rehaul R1. The single authoritative "this plan includes running"
  // flag the whole frontend reads instead of re-deriving "is there running"
  // from raceKind / miles in five places. Running is OPT-IN; the default plan
  // is strength + body-recomposition (lift + low-impact conditioning) with
  // ZERO miles. A plan includes running when EITHER of these explicit opt-in
  // signals holds:
  //   - the campaign is anchored on a run race — race intent now comes from
  //     the active plan's goal (raceKind detected on the trailing plan_day),
  //     not a separate scheduled-races tracking table, OR
  //   - the applied plan_days actually program running (any distance_mi > 0
  //     or run_min > 0) — covers entries-mode run templates whose trailing
  //     day might not classify as a race (e.g. a couch-to-5K graduating run).
  const runRows = await db.execute<{ has_running: boolean }>(
    sql`SELECT EXISTS (
          SELECT 1 FROM plan_days
          WHERE COALESCE(distance_mi, 0) > 0 OR COALESCE(run_min, 0) > 0
        ) AS has_running`,
  );
  const planHasRunningDays = runRows.rows[0]?.has_running === true;
  const includesRunning = raceKind !== null || planHasRunningDays;

  // Task #329: derive plan-window dates from the most-recently-applied
  // planner config so the /plan header reflects whatever the runner
  // configured, instead of the legacy half-marathon defaults. Fall
  // back to the first/last plan_weeks row when the config snapshot is
  // unavailable (e.g. legacy installs that lost the applied_* columns
  // before Task #244 landed), and to null only when plan_weeks itself
  // is empty (fresh install / Full Reset, where the EmptyPlanState CTA
  // is what renders).
  const appliedConfig = await readLastAppliedPlannerConfig();
  let startDate: string | null = null;
  let raceDate: string | null = null;
  if (appliedConfig) {
    startDate = appliedConfig.startDate;
    raceDate = appliedConfig.marathonDate;
  } else if (allWeeks.length > 0) {
    startDate = allWeeks[0]!.startDate;
    raceDate = allWeeks[allWeeks.length - 1]!.endDate;
  }

  // Task #354. Coach-upgrade nudge. Pull the lastAppliedAt timestamp +
  // id of the most-recently-applied config so the /plan banner can
  // detect that the runner's plan was generated against an older
  // version of the training science. The banner re-applies that same
  // config (activate -> apply) to refresh this week's targets.
  const lastAppliedRows = await db
    .select({
      id: plannerConfigsTable.id,
      lastAppliedAt: plannerConfigsTable.lastAppliedAt,
    })
    .from(plannerConfigsTable)
    .where(sql`${plannerConfigsTable.lastAppliedAt} IS NOT NULL`)
    .orderBy(desc(plannerConfigsTable.lastAppliedAt))
    .limit(1);
  const lastAppliedRow = lastAppliedRows[0];
  const lastAppliedAt = lastAppliedRow?.lastAppliedAt
    ? lastAppliedRow.lastAppliedAt.toISOString()
    : null;
  const lastAppliedConfigId = lastAppliedRow?.id ?? null;
  // Stamp comparison is lexicographic on ISO strings: any timestamp
  // before midnight UTC on the science-version date counts as stale.
  // (PLAN_SCIENCE_VERSION is a yyyy-mm-dd string, which sorts <= the
  // shortest ISO timestamp on that day.)
  const coachUpgradeAvailable =
    lastAppliedAt !== null && lastAppliedAt < PLAN_SCIENCE_VERSION;

  // Task #330. Body-mass targets — applied snapshot wins, then
  // earliest measurement (start only), then null sentinels.
  const bodyTargets = await readActiveBodyTargets();
  const startWeight =
    bodyTargets.startWeight ?? (await readEarliestMeasurementWeight());
  const goalWeight = bodyTargets.goalWeight;

  return {
    hasPlan: allWeeks.length > 0,
    currentWeek: week,
    currentPhase: phase,
    totalWeeks,
    weeksRemaining: Math.max(0, totalWeeks - week),
    raceDate,
    startDate,
    startWeight,
    currentWeight,
    goalWeight,
    weeklyMilesTarget: weekRow?.plannedMiles ?? 0,
    longRunTarget: weekRow?.longRunMi ?? 0,
    programs,
    raceKind,
    includesRunning,
    nextMissedDate: nextMissed?.date ?? null,
    nextMissedWeek: nextMissed?.week ?? null,
    nextMissedPlanDayId: nextMissed?.id ?? null,
    activeConfigName,
    scienceVersion: PLAN_SCIENCE_VERSION,
    lastAppliedAt,
    lastAppliedConfigId,
    coachUpgradeAvailable,
    startingPaceSec: appliedConfig?.startingPaceSec ?? null,
    // Task #373. Currently-applied goal ending easy pace surfaced for
    // the /plan header "Update Starting Pace" dialog so the form can
    // pre-fill BOTH the start and the goal in one round-trip. Null when
    // no config has been applied OR the runner hasn't set a goal anchor
    // (the generator then keeps the legacy fixed-rate ramp).
    goalEndingPaceSec: appliedConfig?.goalEndingPaceSec ?? null,
  };
}

router.get("/plan/overview", async (_req, res) => {
  res.json(await computePlanOverview());
});

// Task #204 / #210: server-side race-kind detection for /plan/overview
// is implemented by the shared `detectRaceKind` helper in
// `@workspace/plan-generator`, imported above. The client `raceDayLabel`
// helper consumes the same module so the two surfaces can never drift
// on which trailing Sundays count as a race day.

router.get("/plan/weeks", async (_req, res) => {
  const today = todayISO();
  const weeks = await db.select().from(planWeeksTable).orderBy(asc(planWeeksTable.week));
  // Aggregate actuals per week
  // Task #143: completedSessions and missedSessions are now per
  // plan_day, not per workout/date. With concurrent overlapping programs
  // (Task #135) two plan_days can share a calendar date — each program
  // earns its own completion credit when a workout is logged against
  // its plan_day_id, and is missed independently when no such workout
  // exists. Task #295 retired the legacy `plan_day_id IS NULL AND
  // w.date = pd.date` date-only fallback once every workout carried a
  // real `plan_day_id` (backfilled by `backfill-workout-plan-day` and
  // guarded by a post-merge orphan check).
  const actuals = await db.execute<{
    week: number;
    actual_miles: number;
    actual_cardio: number;
    completed_sessions: number;
    total_sessions: number;
    missed_sessions: number;
  }>(
    sql`
      SELECT pw.week,
        COALESCE(SUM(w.distance_mi) FILTER (WHERE w.session_type <> 'Skipped'), 0)::float AS actual_miles,
        COALESCE(SUM(w.cardio_min) FILTER (WHERE w.session_type <> 'Skipped'), 0)::float AS actual_cardio,
        (
          SELECT COUNT(*)
          FROM plan_days pd
          WHERE pd.week = pw.week
            AND pd.is_rest = false
            AND EXISTS (
              SELECT 1 FROM workouts w2
              WHERE w2.session_type <> 'Skipped'
                AND w2.plan_day_id = pd.id
            )
        )::int AS completed_sessions,
        (SELECT COUNT(*) FROM plan_days pd WHERE pd.week = pw.week AND pd.is_rest = false)::int AS total_sessions,
        (
          SELECT COUNT(*)
          FROM plan_days pd
          WHERE pd.week = pw.week
            AND pd.is_rest = false
            AND pd.date < ${today}
            AND NOT EXISTS (
              SELECT 1 FROM workouts w2
              WHERE w2.plan_day_id = pd.id
            )
        )::int AS missed_sessions
      FROM plan_weeks pw
      LEFT JOIN workouts w ON w.date BETWEEN pw.start_date AND pw.end_date
      GROUP BY pw.week
    `,
  );
  const byWeek = new Map(actuals.rows.map((r) => [r.week, r]));
  const customizedCounts = await db.execute<{ week: number; customized: number }>(
    sql`SELECT week, COUNT(*) FILTER (WHERE seed_session_type IS NOT NULL)::int AS customized
        FROM plan_days
        GROUP BY week`,
  );
  const customizedByWeek = new Map(customizedCounts.rows.map((r) => [r.week, r.customized]));
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
  // Task #175: per-week flag indicating whether the Wednesday plan_day
  // is a Steady (Z3) Run + Accessory session. Sourced directly from
  // plan_days.session_type so any user customization that swaps Wed away
  // from steady is reflected immediately on the calendar chip — no need
  // to re-derive the generator's wedKind / cutback gating client-side.
  // Concurrent overlapping programs (Task #135) can put more than one
  // row on the same Wed; BOOL_OR returns true if any of them is steady,
  // which matches the UX intent ("this week earns the Z3 stimulus").
  const wedSteadyRows = await db.execute<{ week: number; wed_steady: boolean }>(
    sql`SELECT week, BOOL_OR(session_type = 'Steady Run + Accessory') AS wed_steady
        FROM plan_days
        WHERE day = 'Wed'
        GROUP BY week`,
  );
  const wedSteadyByWeek = new Map(
    wedSteadyRows.rows.map((r) => [r.week, r.wed_steady]),
  );
  // Task #162: per-program completion breakdown for each week. Mirrors
  // the combined `completed_sessions` / `total_sessions` / `missed_sessions`
  // SQL above but groups by `source_entry_index` so weekly summary cards
  // can render "Tonal Lift 3/4 · 5K Improver 2/4" alongside the combined
  // ratio. Same plan_day-level attribution rules apply: a logged workout
  // counts toward a program when its `plan_day_id` links back to that
  // program's row. The legacy `plan_day_id IS NULL` date fallback was
  // retired in Task #295 once every workout carried a real
  // `plan_day_id` (backfill + post-merge orphan check).
  const programWeekRows = await db.execute<{
    week: number;
    source_entry_index: number;
    label: string | null;
    total_sessions: number;
    completed_sessions: number;
    missed_sessions: number;
  }>(
    sql`
      SELECT pd.week,
        pd.source_entry_index,
        MAX(pd.source_entry_label) AS label,
        COUNT(*) FILTER (WHERE pd.is_rest = false)::int AS total_sessions,
        COUNT(*) FILTER (
          WHERE pd.is_rest = false
            AND EXISTS (
              SELECT 1 FROM workouts w
              WHERE w.session_type <> 'Skipped'
                AND w.plan_day_id = pd.id
            )
        )::int AS completed_sessions,
        COUNT(*) FILTER (
          WHERE pd.is_rest = false
            AND pd.date < ${today}
            AND NOT EXISTS (
              SELECT 1 FROM workouts w
              WHERE w.plan_day_id = pd.id
            )
        )::int AS missed_sessions
      FROM plan_days pd
      GROUP BY pd.week, pd.source_entry_index
      ORDER BY pd.week ASC, pd.source_entry_index ASC
    `,
  );
  const programsByWeek = new Map<number, PlanWeekProgramSummary[]>();
  for (const r of programWeekRows.rows) {
    const list = programsByWeek.get(r.week) ?? [];
    list.push({
      sourceEntryIndex: r.source_entry_index,
      label: r.label ?? FALLBACK_PROGRAM_LABEL,
      completedSessions: r.completed_sessions,
      totalSessions: r.total_sessions,
      missedSessions: r.missed_sessions,
    });
    programsByWeek.set(r.week, list);
  }
  res.json(
    weeks.map((w) => {
      const a = byWeek.get(w.week);
      return toPlanWeek(w, {
        actualMiles: a?.actual_miles ?? 0,
        actualCardio: a?.actual_cardio ?? 0,
        completedSessions: a?.completed_sessions ?? 0,
        totalSessions: a?.total_sessions ?? 0,
        missedSessions: a?.missed_sessions ?? 0,
        customizedDays: customizedByWeek.get(w.week) ?? 0,
        dominantCardioEquipment: dominantByWeek.get(w.week) ?? null,
        wedSteady: wedSteadyByWeek.get(w.week) ?? null,
        programs: programsByWeek.get(w.week) ?? null,
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
  // Task #242: campaign-level race kind detected from the trailing
  // plan_day Sunday — same query / resolution as /plan/overview so
  // the per-week eyebrow on the week-detail page can switch to the
  // per-kind framing (5K / 10K / Half / Marathon) without forcing the
  // page to also fetch /plan/overview. Null on tonal-first / non-race
  // plans where the trailing Sun isn't a recognised race day.
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
  // Order by date ascending and then by source_entry_index ascending so
  // concurrent overlapping programs (Task #135) on the same calendar
  // date are returned in a stable program order. The week-detail UI
  // groups by date and renders the lowest-index row as the primary card
  // so logged workouts are attributed once instead of duplicated across
  // every concurrent program card on that date.
  const days = await db
    .select()
    .from(planDaysTable)
    .where(eq(planDaysTable.week, week))
    .orderBy(asc(planDaysTable.date), asc(planDaysTable.sourceEntryIndex));
  const actuals = await db.execute<{
    actual_miles: number;
    actual_cardio: number;
  }>(
    sql`SELECT
          COALESCE(SUM(distance_mi) FILTER (WHERE session_type <> 'Skipped'), 0)::float AS actual_miles,
          COALESCE(SUM(cardio_min) FILTER (WHERE session_type <> 'Skipped'), 0)::float AS actual_cardio
        FROM workouts WHERE date BETWEEN ${weekRow.startDate} AND ${weekRow.endDate}`,
  );
  // Task #143: completedSessions is per plan_day, not per workout, so
  // concurrent overlapping programs (Task #135) each get their own
  // completion credit when a workout links back to that program's
  // plan_day_id. Task #295 retired the legacy `plan_day_id IS NULL`
  // date-only fallback once every workout carried a real plan_day_id
  // (backfill + post-merge orphan check).
  const completedRow = await db.execute<{ completed: number }>(
    sql`SELECT COUNT(*)::int AS completed
        FROM plan_days pd
        WHERE pd.week = ${week}
          AND pd.is_rest = false
          AND EXISTS (
            SELECT 1 FROM workouts w2
            WHERE w2.session_type <> 'Skipped'
              AND w2.plan_day_id = pd.id
          )`,
  );
  const totalSessions = days.filter((d) => !d.isRest).length;
  const today = todayISO();
  // Task #162: per-program completion breakdown for THIS week. Same
  // attribution rules as the combined `completedRow` above but grouped
  // by `source_entry_index` so the Week Detail page can render
  // "Tonal Lift 3/4 · 5K Improver 2/4" alongside the combined ratio.
  const programWeekRows = await db.execute<{
    source_entry_index: number;
    label: string | null;
    total_sessions: number;
    completed_sessions: number;
    missed_sessions: number;
  }>(
    sql`
      SELECT pd.source_entry_index,
        MAX(pd.source_entry_label) AS label,
        COUNT(*) FILTER (WHERE pd.is_rest = false)::int AS total_sessions,
        COUNT(*) FILTER (
          WHERE pd.is_rest = false
            AND EXISTS (
              SELECT 1 FROM workouts w
              WHERE w.session_type <> 'Skipped'
                AND w.plan_day_id = pd.id
            )
        )::int AS completed_sessions,
        COUNT(*) FILTER (
          WHERE pd.is_rest = false
            AND pd.date < ${today}
            AND NOT EXISTS (
              SELECT 1 FROM workouts w
              WHERE w.plan_day_id = pd.id
            )
        )::int AS missed_sessions
      FROM plan_days pd
      WHERE pd.week = ${week}
      GROUP BY pd.source_entry_index
      ORDER BY pd.source_entry_index ASC
    `,
  );
  const programs: PlanWeekProgramSummary[] = programWeekRows.rows.map((r) => ({
    sourceEntryIndex: r.source_entry_index,
    label: r.label ?? FALLBACK_PROGRAM_LABEL,
    completedSessions: r.completed_sessions,
    totalSessions: r.total_sessions,
    missedSessions: r.missed_sessions,
  }));
  const nonRestDays = days.filter((d) => !d.isRest);
  const recentByPair = await fetchRecentWorkoutsByPair(nonRestDays, today);
  // Task #228 + Task #236: pace-personalization overlays derived from
  // the runner's recent quality workouts. `raceByDayId` covers any
  // race-day Sun in this week; `qualityByDayId` covers Wed steady (Z3)
  // and Fri tempo / threshold / race-pace rows. Both maps share a
  // single SQL fetch; if neither overlay applies to this week no SQL
  // is issued — see `fetchPersonalizationOverlays`.
  const { raceByDayId, qualityByDayId, longRunByDayId } =
    await fetchPersonalizationOverlays(days, today);
  const daysWithSuggestions = days.map((d) => {
    const base = toPlanDay(d, {
      personalizedRacePace: raceByDayId.get(d.id) ?? null,
      personalizedPace: qualityByDayId.get(d.id) ?? null,
      personalizedLongRunPace: longRunByDayId.get(d.id) ?? null,
    });
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
  // Task #175: surface wedSteady on the single-week endpoint too so the
  // Week Detail header / drilldown stays in sync with the list view's
  // amber Z3 chip. Computed off the same `session_type` signal as the
  // /plan/weeks aggregation so a runner who swaps Wed off Steady Run
  // sees the chip drop here as soon as the page refetches.
  const wedSteady = days.some(
    (d) => d.day === "Wed" && d.sessionType === "Steady Run + Accessory",
  )
    ? true
    : days.some((d) => d.day === "Wed")
      ? false
      : null;
  res.json({
    ...toPlanWeek(weekRow, {
      actualMiles: actuals.rows[0]?.actual_miles ?? 0,
      actualCardio: actuals.rows[0]?.actual_cardio ?? 0,
      completedSessions: completedRow.rows[0]?.completed ?? 0,
      totalSessions,
      dominantCardioEquipment,
      wedSteady,
      programs,
      raceKind,
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
      // Phase 1: real strength movements — not selected for this
      // suggestion/plan-vs-actual sample, so leave it null.
      strengthBlocks: null,
      notes: r.notes,
      timeOfDay: r.time_of_day,
      modality: r.modality,
      // Apple Health import idempotency key — not selected for this
      // suggestion/plan-vs-actual sample, so leave it null.
      sourceKey: null,
      // Task #270: the suggestions/plan-vs-actual sample doesn't need
      // the workout's "Edited" snapshot, so we leave the seed_* mirrors
      // null here. Filling them out would require selecting every
      // mirror column and isn't useful — the consumers (suggestion
      // generator, recent-row pool) only read the live values.
      seedSessionType: null,
      seedEquipment: null,
      seedEquipmentList: null,
      seedDurationMin: null,
      seedStrengthMin: null,
      seedCardioMin: null,
      seedRunMin: null,
      seedDistanceMi: null,
      seedPace: null,
      seedAvgHr: null,
      seedRpe: null,
      seedStrengthLoad: null,
      seedTotalLoad: null,
      seedNotes: null,
      seedTimeOfDay: null,
      seedModality: null,
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

// Task #228: pull every parseable pace string from the runner's recent
// quality (tempo / threshold / interval / sharpener / VO2 / race) runs
// inside the personalization lookback window. Used by the race-day Sun
// pace-personalization path on /plan/weeks/:week and /plan/today. We
// filter by sessionType in SQL using a single regex so the round-trip
// stays a single statement regardless of how many quality variants the
// runner has logged. Easy aerobic work is intentionally excluded — see
// `isQualityRunSession` for the matching wire-format contract.
async function fetchRecentQualityRunPaces(
  today: string,
  lookbackDays: number,
): Promise<string[]> {
  // ISO date math via Date.UTC keeps the cutoff TZ-independent so a
  // server in any region computes the same window the runner sees on
  // their calendar.
  const todayMs = Date.parse(`${today}T00:00:00.000Z`);
  const cutoffMs = todayMs - lookbackDays * 24 * 60 * 60 * 1000;
  const cutoff = new Date(cutoffMs).toISOString().slice(0, 10);
  // Match the same set of session types `isQualityRunSession` recognises
  // so the SQL filter and the in-process filter agree exactly.
  const QUALITY_RE =
    "tempo|threshold|sharpener|interval|speed|vo2|race-pace|race pace|^race$";
  const rows = await db.execute<{ pace: string | null }>(sql`
    SELECT pace
    FROM workouts
    WHERE date < ${today}
      AND date >= ${cutoff}
      AND pace IS NOT NULL
      AND session_type ~* ${QUALITY_RE}
    ORDER BY date DESC, created_at DESC
  `);
  return rows.rows
    .map((r) => r.pace)
    .filter((p): p is string => typeof p === "string" && p.length > 0);
}

// Task #239: easy aerobic counterpart to `fetchRecentQualityRunPaces`.
// Pulls every parseable pace string from the runner's recent Long Run /
// Aerobic Base / Recovery sessions inside the personalization lookback
// window. Used by the Sun long-run pace-personalization path on
// /plan/weeks/:week and /plan/today. Match set mirrors
// `isLongRunSession` so the SQL filter and the in-process matcher
// agree exactly. Quality work (tempo / threshold / interval / VO2 /
// race-pace / race) is intentionally excluded — it sits at a much
// faster rung and would drag the prescribed long-run pace too fast.
async function fetchRecentLongRunPaces(
  today: string,
  lookbackDays: number,
): Promise<string[]> {
  const todayMs = Date.parse(`${today}T00:00:00.000Z`);
  const cutoffMs = todayMs - lookbackDays * 24 * 60 * 60 * 1000;
  const cutoff = new Date(cutoffMs).toISOString().slice(0, 10);
  const LONG_RUN_RE = "long run|aerobic base|recovery";
  const rows = await db.execute<{ pace: string | null }>(sql`
    SELECT pace
    FROM workouts
    WHERE date < ${today}
      AND date >= ${cutoff}
      AND pace IS NOT NULL
      AND session_type ~* ${LONG_RUN_RE}
    ORDER BY date DESC, created_at DESC
  `);
  return rows.rows
    .map((r) => r.pace)
    .filter((p): p is string => typeof p === "string" && p.length > 0);
}

// Task #228 + Task #236: compute personalized pace overlays for the
// plan_days in `days`. Two parallel maps are returned, both keyed by
// plan_day id:
//
//   * raceByDayId — race-day Sun pace targets, only populated for rows
//     that `detectRaceKind` recognises as a real race.
//   * qualityByDayId — Wed steady (Z3) and Fri tempo / threshold /
//     race-pace pace targets, only populated for rows that
//     `isPersonalizableQualityPlanDay` matches AND that carry a
//     non-null catalog `pace` to fall back to.
//
// Both overlays draw from the same recent-quality pace history, so a
// single SQL round-trip covers them. Empty maps short-circuit the
// fetch entirely when `days` contains neither a race-day row nor a
// personalizable Wed/Fri quality row.
async function fetchPersonalizationOverlays(
  days: readonly PlanDayRow[],
  today: string,
): Promise<{
  raceByDayId: Map<number, PersonalizedRacePace>;
  qualityByDayId: Map<number, PersonalizedQualityPace>;
  longRunByDayId: Map<number, PersonalizedLongRunPace>;
}> {
  const raceByDayId = new Map<number, PersonalizedRacePace>();
  const qualityByDayId = new Map<number, PersonalizedQualityPace>();
  const longRunByDayId = new Map<number, PersonalizedLongRunPace>();

  const raceRows = days
    .map((d) => ({
      row: d,
      kind: detectRaceKind(d.distanceMi, d.description, d.sessionType),
    }))
    .filter(
      (r): r is { row: PlanDayRow; kind: PersonalizableRaceKind } =>
        r.kind !== null,
    );
  // For the Wed/Fri overlay we additionally require `pace != null` —
  // the catalog fallback for these rows is the row's own seeded pace,
  // so a row without one (legacy rest day mis-tagged as quality, or a
  // hand-edited row that nuked the pace string) has nothing to fall
  // back to and we skip it instead of rendering an empty chip.
  const qualityRows = days.filter(
    (d) =>
      !d.isRest &&
      d.pace != null &&
      isPersonalizableQualityPlanDay({
        day: d.day,
        sessionType: d.sessionType,
      }),
  );
  // Task #239: same `pace != null` guard as the quality overlay above —
  // the long-run catalog fallback is the row's own seeded `pace` string,
  // so a Sun "Long Run" row that's somehow lost its pace can't render a
  // useful chip and is skipped. Race-day Sun rows are NEVER picked up
  // here because `isPersonalizableLongRunPlanDay` only matches
  // sessionType "Long Run" — the race-day chip from Task #228 owns those
  // rows exclusively.
  const longRunRows = days.filter(
    (d) =>
      !d.isRest &&
      d.pace != null &&
      isPersonalizableLongRunPlanDay({
        day: d.day,
        sessionType: d.sessionType,
      }),
  );
  if (
    raceRows.length === 0 &&
    qualityRows.length === 0 &&
    longRunRows.length === 0
  ) {
    return { raceByDayId, qualityByDayId, longRunByDayId };
  }

  const lookbackWeeks = DEFAULT_LOOKBACK_WEEKS;
  const lookbackDays = lookbackWeeks * 7;
  const qualityPaces =
    raceRows.length === 0 && qualityRows.length === 0
      ? []
      : await fetchRecentQualityRunPaces(today, lookbackDays);
  // Task #239: easy aerobic pool (Long Run / Aerobic Base / Recovery)
  // for the Sun long-run overlay. Fetched independently from the
  // quality pool above so quality work doesn't drag the long-run pace
  // chip toward tempo speed. Only round-trips to the DB when at least
  // one Sun long-run row in this fetch needs it.
  const longRunPaces =
    longRunRows.length === 0
      ? []
      : await fetchRecentLongRunPaces(today, lookbackDays);
  for (const { row, kind } of raceRows) {
    raceByDayId.set(
      row.id,
      personalizeRacePace({
        raceKind: kind,
        qualityPaces,
        lookbackWeeks,
      }),
    );
  }
  for (const row of qualityRows) {
    qualityByDayId.set(
      row.id,
      personalizeQualityPace({
        qualityPaces,
        // Guarded by the `d.pace != null` filter above so the
        // non-null assertion is safe.
        catalogPace: row.pace!,
        lookbackWeeks,
      }),
    );
  }
  for (const row of longRunRows) {
    longRunByDayId.set(
      row.id,
      personalizeLongRunPace({
        longRunPaces,
        // Same `pace != null` filter guards this assertion.
        catalogPace: row.pace!,
        lookbackWeeks,
      }),
    );
  }
  return { raceByDayId, qualityByDayId, longRunByDayId };
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

export async function computeTodayPlan() {
  const today = todayISO();
  // Task #306: campaign-level race kind detected from the trailing
  // plan_day Sunday — same query / resolution as /plan/overview
  // (Task #204) and /plan/weeks/:week (Task #242) so the Today page
  // eyebrow can switch to the per-kind framing (5K / 10K / Half /
  // Marathon) without forcing the page to also fetch /plan/overview.
  // Null on tonal-first / non-race plans where the trailing Sun isn't
  // a recognised race day.
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
  // Task #135: load ALL plan_days for today (concurrent overlapping
  // programs each contribute one row keyed by sourceEntryIndex). The
  // legacy `plan` field returns the lowest-index row for back-compat;
  // the new `plans[]` array exposes every concurrent session so the UI
  // can render program-attributed cards side-by-side.
  const planRows = await db
    .select()
    .from(planDaysTable)
    .where(eq(planDaysTable.date, today))
    .orderBy(asc(planDaysTable.sourceEntryIndex));
  const planRow = planRows[0];
  // Order same-day sessions by their time-of-day tag (AM, PM, Other, then
  // untagged) and then by createdAt ascending so tagged AM workouts logged
  // late in the evening still surface above PM ones.
  // Left join the matched plan day so each Workout row carries the
  // prescribed run-target snapshot (Task #140 / #148). Mirrors the
  // join shape used by GET /api/workouts so /plan/today's
  // loggedWorkouts agree with /workouts on `prescribedRunTarget`.
  const loggedRows = await db
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
    .where(eq(workoutsTable.date, today))
    .orderBy(asc(timeOfDayOrderExpr), asc(workoutsTable.createdAt));
  const suggestions = planRow && !planRow.isRest ? await suggestionsForPlan(planRow, today) : null;

  // Pre-launch countdown: when today is before the first scheduled (non-rest)
  // session, surface the gap so the UI can render a friendly countdown card
  // instead of the generic "no plan for today" empty state. We key off the
  // first non-rest day rather than the very first plan_day so a Mon rest day
  // at the start of week 1 still shows the countdown.
  let daysUntilStart: number | null = null;
  const firstSessionRow = await fetchFirstSessionDay();
  const showFirstSession = !!(firstSessionRow && today < firstSessionRow.date);
  if (firstSessionRow && showFirstSession) {
    daysUntilStart = daysBetweenISO(today, firstSessionRow.date);
  }

  // Task #228 + Task #236: personalized pace overlays for both the
  // race-day Sun chip and the Wed steady (Z3) / Fri tempo / threshold
  // chips. Includes the pre-launch first-session preview row so a
  // runner staring at "campaign starts in N days" still sees the
  // personalized chip on whichever quality slot opens the campaign.
  const { raceByDayId, qualityByDayId, longRunByDayId } =
    await fetchPersonalizationOverlays(
      [
        ...planRows,
        ...(firstSessionRow && showFirstSession ? [firstSessionRow] : []),
      ],
      today,
    );
  const todayPlanDay = (r: PlanDayRow) =>
    toPlanDay(r, {
      personalizedRacePace: raceByDayId.get(r.id) ?? null,
      personalizedPace: qualityByDayId.get(r.id) ?? null,
      personalizedLongRunPace: longRunByDayId.get(r.id) ?? null,
    });

  return {
    date: today,
    hasPlan: planRows.length > 0,
    plan: planRow ? todayPlanDay(planRow) : null,
    plans: planRows.map(todayPlanDay),
    loggedWorkouts: loggedRows.map((r) =>
      toWorkout(
        r.workout,
        r.planDay && r.planDay.sessionType != null ? r.planDay : null,
      ),
    ),
    suggestions,
    daysUntilStart,
    firstSession:
      firstSessionRow && showFirstSession ? todayPlanDay(firstSessionRow) : null,
    raceKind,
  };
}

router.get("/plan/today", async (_req, res) => {
  res.json(await computeTodayPlan());
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
    const preSwapSnapshots: PlanDaySnapshot[] = [
      snapshotPlanDay(a),
      snapshotPlanDay(b),
    ];
    const aFields = pickMutableFields(a);
    const bFields = pickMutableFields(b);
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
    const weeksAffected = a.week === b.week ? [a.week] : [a.week, b.week];
    for (const w of weeksAffected) {
      await recomputeWeekTotals(tx, w);
    }
    return {
      kind: "ok" as const,
      a: updatedA[0]!,
      b: updatedB[0]!,
      preSwapSnapshots,
      weeksAffected,
      phaseChanged: a.phase !== b.phase,
    };
  });
  if (result.kind === "not-found") {
    res.status(404).json({ error: "plan day not found" });
    return;
  }
  const swapSnapshots = result.preSwapSnapshots;
  const { token: undoToken, expiresInSeconds: undoExpiresInSeconds } =
    await storeResetSnapshot(swapSnapshots, result.weeksAffected);
  req.log.info(
    {
      fromId: id,
      toId: withDayId,
      weeksAffected: result.weeksAffected,
      phaseChanged: result.phaseChanged,
      undoToken,
    },
    "plan days swapped",
  );
  res.json({
    from: toPlanDay(result.a),
    to: toPlanDay(result.b),
    weeksAffected: result.weeksAffected,
    phaseChanged: result.phaseChanged,
    undoToken,
    undoExpiresInSeconds,
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

// "Reset Entire Plan" — wipes plan_weeks / plan_days back to empty and
// demotes every applied planner_configs row to draft state, so the /plan,
// /today, and dashboard surfaces fall back to the EmptyPlanState CTA
// (Task #307) until the runner re-applies a config from /planner. Logged
// workouts, body measurements, race results, and the race-week checklist
// are intentionally NOT touched — that scorched-earth path is /plan/full-reset.
//
// Stays undoable for the same RESET_UNDO_TTL_MS window as week- and
// day-level resets: every plan_weeks row, every plan_days row (verbatim,
// including id and seed_* columns), every applied planner_configs row's
// applied_*/last_applied_at columns, and every workout (id, plan_day_id)
// pair we detached are captured in a single snapshot envelope keyed by
// the returned undoToken. /plan/reset/undo restores all four classes
// inside one transaction so the runner can recover from a misclick.
router.post("/plan/reset", async (req, res): Promise<void> => {
  const snapshotResult = await db.transaction(async (tx) => {
    // Lock every table we'll mutate (plan_*, planner_configs) plus
    // workouts (whose plan_day_id FKs we have to detach before TRUNCATE
    // CASCADEs into them). Matches the lock TRUNCATE itself takes.
    await tx.execute(
      sql`LOCK TABLE planner_configs, plan_days, plan_weeks, workouts IN ACCESS EXCLUSIVE MODE`,
    );

    // Snapshot first — we need every plan_weeks row, every plan_days
    // row (verbatim, including id and seed_* columns), every applied
    // planner_configs row's applied_*/last_applied_at columns, and
    // every workout (id, plan_day_id) pair we are about to detach so
    // /plan/reset/undo can restore all four classes inside one tx.
    const planWeekRows = await tx
      .select()
      .from(planWeeksTable)
      .orderBy(asc(planWeeksTable.week));
    const planDayRows = await tx
      .select()
      .from(planDaysTable)
      .orderBy(asc(planDaysTable.id));
    const appliedConfigRows = await tx
      .select()
      .from(plannerConfigsTable)
      .where(sql`${plannerConfigsTable.lastAppliedAt} IS NOT NULL`);
    const detachedWorkoutRows = await tx
      .select({ id: workoutsTable.id, planDayId: workoutsTable.planDayId })
      .from(workoutsTable)
      .where(sql`${workoutsTable.planDayId} IS NOT NULL`);

    const weeksReset = planWeekRows.length;
    const daysReset = planDayRows.length;

    if (weeksReset === 0 && daysReset === 0) {
      // Already empty — still demote any applied config rows so a
      // partial / interrupted prior reset can't leave applied state
      // pointing at plan tables that no longer exist. No snapshot
      // needed (and no undo offered) since there's nothing to put back.
      await tx.execute(
        sql`UPDATE planner_configs SET last_applied_at = NULL, applied_start_date = NULL, applied_marathon_date = NULL, applied_blocks = NULL, applied_entries = NULL, applied_start_weight = NULL, applied_goal_weight = NULL, applied_starting_pace_sec = NULL, applied_goal_ending_pace_sec = NULL WHERE last_applied_at IS NOT NULL`,
      );
      return {
        weeksReset: 0,
        daysReset: 0,
        daysTotal: 0,
        undoToken: null as string | null,
        undoExpiresInSeconds: null as number | null,
      };
    }

    // Detach workout FKs first so callers can't observe a window where
    // a workout's plan_day_id points at a row that has just been
    // deleted by the TRUNCATE below. Workouts on dates covered by a
    // future re-applied plan get re-bound to the new plan_days by the
    // post-merge backfill-workout-plan-day script.
    await tx.execute(
      sql`UPDATE workouts SET plan_day_id = NULL WHERE plan_day_id IS NOT NULL`,
    );

    await tx.execute(
      sql`TRUNCATE TABLE plan_days, plan_weeks RESTART IDENTITY CASCADE`,
    );

    // Demote every applied planner_configs row back to draft (clears
    // last_applied_at + applied_* snapshot columns). Saved rows
    // themselves — name, blocks, entries, isActive — are preserved
    // so re-applying from /planner is a one-click trip.
    await tx.execute(
      sql`UPDATE planner_configs SET last_applied_at = NULL, applied_start_date = NULL, applied_marathon_date = NULL, applied_blocks = NULL, applied_entries = NULL, applied_start_weight = NULL, applied_goal_weight = NULL, applied_starting_pace_sec = NULL, applied_goal_ending_pace_sec = NULL`,
    );

    const appliedConfigs: AppliedPlannerConfigSnapshot[] = appliedConfigRows
      .filter((row) => row.lastAppliedAt != null)
      .map((row) => ({
        id: row.id,
        // Drizzle returns Date for timestamp columns; serialize to ISO so
        // the JSONB envelope round-trips through Postgres without losing
        // sub-second precision.
        lastAppliedAt: (row.lastAppliedAt as Date).toISOString(),
        appliedStartDate: row.appliedStartDate,
        appliedMarathonDate: row.appliedMarathonDate,
        appliedBlocks: row.appliedBlocks,
        appliedEntries: row.appliedEntries,
        appliedStartWeight: row.appliedStartWeight,
        appliedGoalWeight: row.appliedGoalWeight,
        appliedStartingPaceSec: row.appliedStartingPaceSec,
        appliedGoalEndingPaceSec: row.appliedGoalEndingPaceSec,
      }));
    const detachedWorkouts: DetachedWorkoutSnapshot[] = detachedWorkoutRows
      .filter((row): row is { id: number; planDayId: number } => row.planDayId != null)
      .map((row) => ({ workoutId: row.id, planDayId: row.planDayId }));

    const snapshotPayload: EntirePlanWipeSnapshotPayload = {
      planWeeks: planWeekRows.map(snapshotPlanWeek),
      planDays: planDayRows.map(snapshotPlanDayFull),
      appliedConfigs,
      detachedWorkouts,
    };

    // Persist the undo snapshot row INSIDE this same transaction so the
    // wipe + the snapshot commit (or roll back) atomically. Stashing it
    // post-commit would open a window where the runner believed they had
    // ~30 seconds to undo but a transient DB hiccup on the snapshot
    // INSERT had silently revoked it.
    const stored = await storeEntirePlanWipeSnapshotInTx(tx, snapshotPayload);

    return {
      weeksReset,
      daysReset,
      daysTotal: daysReset,
      undoToken: stored.token,
      undoExpiresInSeconds: stored.expiresInSeconds,
    };
  });

  const undoToken: string | null = snapshotResult.undoToken ?? null;
  const undoExpiresInSeconds: number | null =
    snapshotResult.undoExpiresInSeconds ?? null;

  req.log.warn(
    {
      weeksReset: snapshotResult.weeksReset,
      daysReset: snapshotResult.daysReset,
      daysTotal: snapshotResult.daysTotal,
      undoToken,
    },
    "entire plan reset — plan tables wiped to empty, applied planner config demoted to draft",
  );
  res.json({
    weeksReset: snapshotResult.weeksReset,
    daysReset: snapshotResult.daysReset,
    daysTotal: snapshotResult.daysTotal,
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
  // Task #326: Full Reset is now truly scorched-earth. Even when a
  // planner config has been applied previously, we no longer reseed
  // plan_weeks / plan_days from it — the runner has to re-apply a
  // config from /planner before any plan rows come back. We achieve
  // this by clearing the applied_* state (lastAppliedAt + applied
  // snapshot columns) on every planner_configs row inside the same
  // transaction, which demotes them to drafts. Saved drafts (already
  // had lastAppliedAt = null) stay untouched in shape; their name,
  // blocks, and entries remain so the runner can apply them. The
  // existing Task #307 empty-fallback branch then takes over and the
  // route returns weeksSeeded: 0.
  const result = await db.transaction(async (tx) => {
    // Take ACCESS EXCLUSIVE locks on every table we're about to wipe BEFORE
    // counting, so a concurrent insert cannot commit between our COUNT(*)
    // and the TRUNCATE that follows. Without this lock, a row inserted +
    // committed in another transaction during the count→truncate window
    // would get wiped by the TRUNCATE but be missing from the response
    // counts. ACCESS EXCLUSIVE matches the lock TRUNCATE itself takes, so
    // this just hoists that lock acquisition earlier in the transaction.
    await tx.execute(
      sql`LOCK TABLE workouts, plan_days, plan_weeks, measurements, reset_undo_snapshots IN ACCESS EXCLUSIVE MODE`,
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
      sql`TRUNCATE TABLE workouts, plan_days, plan_weeks, measurements, reset_undo_snapshots RESTART IDENTITY CASCADE`,
    );

    // Task #326: demote every planner_configs row to draft state by
    // clearing the applied_* snapshot and lastAppliedAt timestamp. This
    // makes readLastAppliedPlannerConfig() return null going forward
    // (so seed scripts and any other consumers also see "no applied
    // config") while preserving the row, name, blocks, and entries so
    // the runner can still apply them from /planner. Drafts that were
    // already in draft state (lastAppliedAt = null, applied_* = null)
    // are unaffected by the writes.
    await tx.execute(
      sql`UPDATE planner_configs SET last_applied_at = NULL, applied_start_date = NULL, applied_marathon_date = NULL, applied_blocks = NULL, applied_entries = NULL, applied_start_weight = NULL, applied_goal_weight = NULL, applied_starting_pace_sec = NULL, applied_goal_ending_pace_sec = NULL`,
    );

    // Plan tables stay EMPTY. The UI surfaces an "Open Phase Planner"
    // empty state in that mode (Task #307); re-applying a config from
    // /planner repopulates plan_weeks / plan_days as usual.
    return {
      weeksSeeded: 0,
      daysSeeded: 0,
      workoutsWiped: workoutsBefore,
      measurementsWiped: measurementsBefore,
      measurementsSeeded: 0,
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
      undoSnapshotsWiped: result.undoSnapshotsWiped,
    },
    "full plan reset (no undo) — plan tables wiped, applied planner config demoted to draft",
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
    if (snapshot.kind === "entire-plan-wipe") {
      result = await db.transaction(async (tx) => {
        // Lock everything we're about to overwrite so a concurrent
        // /plan/full-reset, /planner/apply, or another /plan/reset
        // can't slip in between our wipe and our re-insert. Same locks
        // we took on the original /plan/reset call.
        await tx.execute(
          sql`LOCK TABLE planner_configs, plan_days, plan_weeks, workouts IN ACCESS EXCLUSIVE MODE`,
        );
        // Wipe whatever's currently in plan_weeks/plan_days so a re-applied
        // config in the undo window can't collide on (week) or (id) primary
        // keys when we re-insert the snapshot rows. Detach workouts first
        // for the same reason as the original reset.
        await tx.execute(
          sql`UPDATE workouts SET plan_day_id = NULL WHERE plan_day_id IS NOT NULL`,
        );
        await tx.execute(
          sql`TRUNCATE TABLE plan_days, plan_weeks RESTART IDENTITY CASCADE`,
        );

        // Re-insert plan_weeks first (plan_days.week references it
        // logically even without a FK constraint).
        for (const w of snapshot.payload.planWeeks) {
          await tx.insert(planWeeksTable).values({
            week: w.week,
            phase: w.phase,
            startDate: w.startDate,
            endDate: w.endDate,
            plannedStrength: w.plannedStrength,
            plannedCardio: w.plannedCardio,
            plannedTotalLoad: w.plannedTotalLoad,
            plannedMiles: w.plannedMiles,
            longRunMi: w.longRunMi,
          });
        }

        // Re-insert plan_days with their original integer ids so any
        // workout snapshot pair can re-link verbatim.
        for (const d of snapshot.payload.planDays) {
          await tx.insert(planDaysTable).values({
            id: d.id,
            week: d.week,
            phase: d.phase,
            date: d.date,
            day: d.day,
            sourceEntryIndex: d.sourceEntryIndex,
            sourceEntryLabel: d.sourceEntryLabel,
            strengthLoad: d.strengthLoad,
            equipment: d.equipment,
            equipmentList: d.equipmentList,
            description: d.description,
            strengthMin: d.strengthMin,
            cardioMin: d.cardioMin,
            runMin: d.runMin,
            distanceMi: d.distanceMi,
            pace: d.pace,
            sessionType: d.sessionType,
            isRest: d.isRest,
            totalLoad: d.totalLoad,
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
          });
        }

        // We just re-inserted rows with explicit ids past the sequence's
        // RESTART IDENTITY value (which dropped to 1 on the TRUNCATE
        // above). Bump the sequence to MAX(id) so the next natural
        // INSERT doesn't collide with a restored id.
        if (snapshot.payload.planDays.length > 0) {
          await tx.execute(
            sql`SELECT setval(pg_get_serial_sequence('plan_days', 'id'), GREATEST((SELECT MAX(id) FROM plan_days), 1))`,
          );
        }

        // Restore applied_*/last_applied_at on every previously-applied
        // planner_configs row. Drafts that were never applied stay as-is.
        for (const c of snapshot.payload.appliedConfigs) {
          await tx
            .update(plannerConfigsTable)
            .set({
              lastAppliedAt: new Date(c.lastAppliedAt),
              appliedStartDate: c.appliedStartDate,
              appliedMarathonDate: c.appliedMarathonDate,
              appliedBlocks: c.appliedBlocks as never,
              appliedEntries: c.appliedEntries as never,
              appliedStartWeight: c.appliedStartWeight,
              appliedGoalWeight: c.appliedGoalWeight,
              appliedStartingPaceSec: c.appliedStartingPaceSec,
              appliedGoalEndingPaceSec: c.appliedGoalEndingPaceSec,
            })
            .where(eq(plannerConfigsTable.id, c.id));
        }

        // Re-link the workouts whose plan_day_id we detached. Skip rows
        // whose target plan_day no longer exists (workout deleted in the
        // window) or whose workout was deleted in the window — both safe
        // best-effort cases since the snapshot is single-use anyway.
        for (const w of snapshot.payload.detachedWorkouts) {
          await tx
            .update(workoutsTable)
            .set({ planDayId: w.planDayId })
            .where(eq(workoutsTable.id, w.workoutId));
        }

        return {
          daysRestored: snapshot.payload.planDays.length,
          weeksAffected: snapshot.payload.planWeeks
            .map((w) => w.week)
            .sort((a, b) => a - b),
        };
      });
    } else {
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
    }
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
