import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import {
  GetDashboardSummaryResponse,
  GetEquipmentPhaseSummaryResponse,
  GetEquipmentUsageResponse,
  GetLongRunProgressionResponse,
  GetRecentActivityResponse,
  GetWeeklyMileageResponse,
  GetWeightTrendResponse,
} from "@workspace/api-zod";
import { db, plannerConfigsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import app from "../app";
import {
  cleanTestData,
  expectMatchesSchema,
  insertMeasurement,
  insertPlanDay,
  insertWeek,
  insertWorkout,
  E_GYM,
  E_OUTDOOR,
  E_TREADMILL,
  T_REST,
  T_RUN,
  T_STRENGTH,
} from "../test-helpers";

const ARSENAL = ["Tonal", "Peloton Tread", "Peloton Bike", "Peloton Row"] as const;

beforeEach(async () => {
  await cleanTestData();
});

afterEach(async () => {
  await cleanTestData();
  vi.useRealTimers();
});

describe("GET /api/dashboard/summary", () => {
  it("rolls up week-scoped actuals, plan targets, and race-day countdown", async () => {
    // Pin today inside the test week so the active-week lookup resolves to our
    // synthetic plan_week instead of a real one.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2099-06-04T12:00:00.000Z"));

    const week = 8301;
    const phase = "Dashboard Phase";
    await insertWeek(week, {
      startDate: "2099-06-01",
      endDate: "2099-06-07",
      phase,
      plannedMiles: 30,
      longRunMi: 12,
      plannedTotalLoad: 2000,
    });
    // 2 non-rest plan days + 1 rest day -> weeklySessionsPlanned = 2.
    await insertPlanDay(week, phase, {
      date: "2099-06-01",
      day: "Mon",
      sessionType: T_RUN,
      equipment: E_OUTDOOR,
    });
    await insertPlanDay(week, phase, {
      date: "2099-06-02",
      day: "Tue",
      sessionType: T_STRENGTH,
      equipment: E_GYM,
    });
    await insertPlanDay(week, phase, {
      date: "2099-06-03",
      day: "Wed",
      sessionType: T_REST,
      equipment: E_OUTDOOR,
      isRest: true,
    });
    // Workouts in-range contribute to weekly actuals.
    await insertWorkout({ date: "2099-06-01", sessionType: T_RUN, equipment: E_OUTDOOR, distanceMi: 5, totalLoad: 300 });
    await insertWorkout({ date: "2099-06-02", sessionType: T_STRENGTH, equipment: E_GYM, distanceMi: null, totalLoad: 500 });
    // In-range Lifestyle entries must NOT pollute training mileage / load /
    // sessions, but their durations should sum into weeklyLifestyleMinutes.
    await insertWorkout({ date: "2099-06-03", sessionType: "Dog Walk", equipment: "Lifestyle", distanceMi: 1.2, durationMin: 25, totalLoad: 50 });
    await insertWorkout({ date: "2099-06-05", sessionType: "Yard Work", equipment: "Lifestyle", distanceMi: null, durationMin: 45, totalLoad: 80 });
    // Out-of-range workout must not count toward weekly actuals.
    await insertWorkout({ date: "2099-06-30", sessionType: T_RUN, equipment: E_OUTDOOR, distanceMi: 7, totalLoad: 400 });
    // Out-of-range Lifestyle entry must not count toward weeklyLifestyleMinutes.
    await insertWorkout({ date: "2099-06-30", sessionType: "Hike", equipment: "Lifestyle", durationMin: 90 });
    // Latest weight comes from our 2099 measurement (newer than any real row).
    await insertMeasurement({ date: "2099-05-30", weight: 232.5 });

    const res = await request(app).get("/api/dashboard/summary");
    expect(res.status).toBe(200);
    expectMatchesSchema(GetDashboardSummaryResponse, res.body);

    expect(res.body).toEqual(
      expect.objectContaining({
        currentWeek: week,
        currentPhase: phase,
        weeklyMilesActual: 5, // only the in-range run; Lifestyle 1.2mi excluded
        weeklyMilesPlanned: 30,
        weeklyLoadActual: 800, // 300 + 500; Lifestyle loads (50, 80) excluded
        weeklyLoadPlanned: 2000,
        weeklySessionsCompleted: 2, // 2 in-range training workouts; 2 Lifestyle excluded
        weeklySessionsPlanned: 2, // 2 non-rest plan days
        weeklyLifestyleMinutes: 70, // 25 + 45; out-of-range 90 excluded
        weightStart: 281.6,
        weightGoal: 210,
        weightCurrent: 232.5,
        weightLost: expect.closeTo(281.6 - 232.5, 5),
        weightToGoal: expect.closeTo(232.5 - 210, 5),
        // Race date (2027-05-02) is well in the past relative to today (2099),
        // so the countdown clamps to zero.
        daysToRace: 0,
      }),
    );

    // Week progress: today is 3.5 days into a 7-day window -> 50%.
    expect(res.body.weekProgressPct).toBeCloseTo(50, 5);

    // These reach over the entire DB; we only assert shape and that our
    // contribution shows up in the totals.
    expect(typeof res.body.totalMilesAllTime).toBe("number");
    expect(res.body.totalMilesAllTime).toBeGreaterThanOrEqual(5 + 7);
    expect(typeof res.body.longestRunMi).toBe("number");
    expect(typeof res.body.adherencePct).toBe("number");
    expect(res.body.adherencePct).toBeGreaterThanOrEqual(0);
    expect(res.body.adherencePct).toBeLessThanOrEqual(100);
  });
});

describe("GET /api/dashboard/summary programs breakdown (Task #144)", () => {
  it("attributes per-program planned and actual training load when 2+ programs overlap", async () => {
    // Pin today inside the test week so the active-week lookup resolves.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2099-06-04T12:00:00.000Z"));

    const week = 8311;
    const phase = "Multi-Program Phase";
    await insertWeek(week, {
      startDate: "2099-06-01",
      endDate: "2099-06-07",
      phase,
      plannedMiles: 18,
      plannedTotalLoad: 700,
    });
    // Program 0 ("Tonal Lift") — strength only, ends mid-campaign on 2099-06-15.
    const tonalDay = await insertPlanDay(week, phase, {
      date: "2099-06-02",
      day: "Tue",
      sessionType: T_STRENGTH,
      equipment: E_GYM,
      distanceMi: 0,
      totalLoad: 200,
      sourceEntryIndex: 0,
      sourceEntryLabel: "Tonal Lift",
    });
    // A LATER plan_day for the same program so endDate is past this week.
    await insertPlanDay(week + 1, phase, {
      date: "2099-06-15",
      day: "Mon",
      sessionType: T_STRENGTH,
      equipment: E_GYM,
      distanceMi: 0,
      totalLoad: 200,
      sourceEntryIndex: 0,
      sourceEntryLabel: "Tonal Lift",
    });
    // Program 1 ("5K Improver") — running, also active this week.
    const improverDay = await insertPlanDay(week, phase, {
      date: "2099-06-03",
      day: "Wed",
      sessionType: T_RUN,
      equipment: E_OUTDOOR,
      distanceMi: 6,
      totalLoad: 300,
      sourceEntryIndex: 1,
      sourceEntryLabel: "5K Improver",
    });
    // Same date, different program so we exercise overlapping plan_days.
    await insertPlanDay(week, phase, {
      date: "2099-06-04",
      day: "Thu",
      sessionType: T_RUN,
      equipment: E_OUTDOOR,
      distanceMi: 4,
      totalLoad: 200,
      sourceEntryIndex: 1,
      sourceEntryLabel: "5K Improver",
    });

    // Workouts linked to a plan_day get attributed to that program.
    await insertWorkout({
      date: "2099-06-02",
      sessionType: T_STRENGTH,
      equipment: E_GYM,
      distanceMi: 0,
      totalLoad: 250,
      planDayId: tonalDay.id,
    });
    await insertWorkout({
      date: "2099-06-03",
      sessionType: T_RUN,
      equipment: E_OUTDOOR,
      distanceMi: 5,
      totalLoad: 280,
      planDayId: improverDay.id,
    });
    // Untagged workout — only contributes to combined headline numbers,
    // not to any per-program actual.
    await insertWorkout({
      date: "2099-06-05",
      sessionType: T_RUN,
      equipment: E_OUTDOOR,
      distanceMi: 2,
      totalLoad: 100,
    });

    const res = await request(app).get("/api/dashboard/summary");
    expect(res.status).toBe(200);
    expectMatchesSchema(GetDashboardSummaryResponse, res.body);

    const body = res.body as {
      programs: Array<{
        sourceEntryIndex: number;
        label: string;
        endDate: string;
        weeklyMilesPlanned: number;
        weeklyMilesActual: number;
        weeklyLoadPlanned: number;
        weeklyLoadActual: number;
        weeklySessionsPlanned: number;
        weeklySessionsCompleted: number;
        adherencePlanned: number;
        adherenceCompleted: number;
        adherencePct: number;
      }>;
    };

    expect(body.programs).toHaveLength(2);
    const tonal = body.programs.find((p) => p.sourceEntryIndex === 0);
    const improver = body.programs.find((p) => p.sourceEntryIndex === 1);

    // Task #162: per-program adherence is campaign-wide, so the global
    // seeded plan_days dilute it. Assert weekly fields exactly and
    // sanity-check the per-program adherence shape (must include the
    // workout we attributed via plan_day_id).
    expect(tonal).toMatchObject({
      sourceEntryIndex: 0,
      label: "Tonal Lift",
      endDate: "2099-06-15",
      weeklyMilesPlanned: 0,
      weeklyMilesActual: 0,
      weeklyLoadPlanned: 200,
      weeklyLoadActual: 250,
      weeklySessionsPlanned: 1,
      weeklySessionsCompleted: 1,
    });
    expect(typeof tonal!.adherencePlanned).toBe("number");
    expect(tonal!.adherenceCompleted).toBeGreaterThanOrEqual(1);
    expect(tonal!.adherencePct).toBeGreaterThanOrEqual(0);
    expect(tonal!.adherencePct).toBeLessThanOrEqual(100);
    expect(improver).toMatchObject({
      sourceEntryIndex: 1,
      label: "5K Improver",
      endDate: "2099-06-04",
      weeklyMilesPlanned: 10,
      weeklyMilesActual: 5,
      weeklyLoadPlanned: 500,
      weeklyLoadActual: 280,
      weeklySessionsPlanned: 2,
      weeklySessionsCompleted: 1,
    });
    expect(typeof improver!.adherencePlanned).toBe("number");
    expect(improver!.adherenceCompleted).toBeGreaterThanOrEqual(1);
  });

  it("orders programs by endDate ascending (closest race date first) when 3+ overlap (Task #159)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2099-09-04T12:00:00.000Z"));

    const week = 8350;
    const phase = "Triple Stack";
    await insertWeek(week, {
      startDate: "2099-09-01",
      endDate: "2099-09-07",
      phase,
      plannedMiles: 30,
    });
    // Insert programs in arbitrary sourceEntryIndex order with end dates
    // that intentionally do NOT line up with sourceEntryIndex order so we
    // can prove the sort is by endDate, not by index.
    // Program 0 — ends FAR future (2099-12-15).
    await insertPlanDay(week, phase, {
      date: "2099-09-02", day: "Tue", sessionType: T_STRENGTH, equipment: E_GYM,
      sourceEntryIndex: 0, sourceEntryLabel: "Marathon Block",
    });
    await insertPlanDay(week + 14, phase, {
      date: "2099-12-15", day: "Mon", sessionType: T_STRENGTH, equipment: E_GYM,
      sourceEntryIndex: 0, sourceEntryLabel: "Marathon Block",
    });
    // Program 1 — ends MIDDLE (2099-10-20).
    await insertPlanDay(week, phase, {
      date: "2099-09-03", day: "Wed", sessionType: T_RUN, equipment: E_OUTDOOR, distanceMi: 5,
      sourceEntryIndex: 1, sourceEntryLabel: "10K Improver",
    });
    await insertPlanDay(week + 6, phase, {
      date: "2099-10-20", day: "Tue", sessionType: T_RUN, equipment: E_OUTDOOR, distanceMi: 6,
      sourceEntryIndex: 1, sourceEntryLabel: "10K Improver",
    });
    // Program 2 — ends SOONEST (2099-09-21).
    await insertPlanDay(week, phase, {
      date: "2099-09-04", day: "Thu", sessionType: T_RUN, equipment: E_OUTDOOR, distanceMi: 3,
      sourceEntryIndex: 2, sourceEntryLabel: "5K Sprint",
    });
    await insertPlanDay(week + 2, phase, {
      date: "2099-09-21", day: "Mon", sessionType: T_RUN, equipment: E_OUTDOOR, distanceMi: 3.1,
      sourceEntryIndex: 2, sourceEntryLabel: "5K Sprint",
    });

    const summaryRes = await request(app).get("/api/dashboard/summary");
    expect(summaryRes.status).toBe(200);
    expectMatchesSchema(GetDashboardSummaryResponse, summaryRes.body);
    const summary = summaryRes.body as {
      programs: Array<{ sourceEntryIndex: number; label: string; endDate: string }>;
    };
    // Closest endDate must come first regardless of sourceEntryIndex.
    expect(summary.programs.map((p) => p.label)).toEqual([
      "5K Sprint",
      "10K Improver",
      "Marathon Block",
    ]);
    expect(summary.programs.map((p) => p.endDate)).toEqual([
      "2099-09-21",
      "2099-10-20",
      "2099-12-15",
    ]);

    // /weekly-mileage must use the same closest-race-first ordering on
    // each week's per-program breakdown.
    const wmRes = await request(app).get("/api/dashboard/weekly-mileage");
    expect(wmRes.status).toBe(200);
    expectMatchesSchema(GetWeeklyMileageResponse, wmRes.body);
    const wmRows = wmRes.body as Array<{
      week: number;
      programs: Array<{ sourceEntryIndex: number; label: string }>;
    }>;
    const ours = wmRows.find((r) => r.week === week);
    expect(ours).toBeDefined();
    expect(ours!.programs.map((p) => p.label)).toEqual([
      "5K Sprint",
      "10K Improver",
      "Marathon Block",
    ]);
  });

  it("returns a single fallback program for legacy single-program campaigns", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2099-06-04T12:00:00.000Z"));

    const week = 8312;
    const phase = "Legacy Single Program";
    await insertWeek(week, {
      startDate: "2099-06-01",
      endDate: "2099-06-07",
      phase,
    });
    // Single plan_day with default sourceEntryIndex=0 and NULL label.
    await insertPlanDay(week, phase, {
      date: "2099-06-02",
      day: "Tue",
      sessionType: T_RUN,
      equipment: E_OUTDOOR,
      distanceMi: 5,
      totalLoad: 150,
    });

    const res = await request(app).get("/api/dashboard/summary");
    expect(res.status).toBe(200);
    expectMatchesSchema(GetDashboardSummaryResponse, res.body);

    const body = res.body as {
      programs: Array<{ sourceEntryIndex: number; label: string }>;
    };
    expect(body.programs).toHaveLength(1);
    expect(body.programs[0]?.sourceEntryIndex).toBe(0);
    // Synthetic / legacy rows fall back to the canonical "Marathon Plan" label.
    expect(body.programs[0]?.label).toBe("Marathon Plan");
  });
});

describe("GET /api/dashboard/summary adherence per program (task #143)", () => {
  it("attributes adherence per concurrent program plan_day, not per calendar date", async () => {
    // The /dashboard/summary adherence query is global (all plan_days
    // in the DB up to today), so the seeded production plan_days
    // dilute any percentage we'd assert. Instead, snapshot the
    // baseline numerator/denominator with our 4 test plan_days but no
    // workouts, then add the 2 attributed workouts and assert the
    // delta: planned must NOT change (still 4 added rows) and
    // completed must increase by exactly 2 (one per program). The
    // pre-Task #143 date-only SQL would have credited the OTHER
    // program on the same date as well, surfacing a delta of 4.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2099-07-10T12:00:00.000Z"));

    const week = 8401;
    const phase = "Adherence Phase";
    await insertWeek(week, {
      startDate: "2099-07-06",
      endDate: "2099-07-12",
      phase,
      plannedMiles: 10,
    });
    // Program A (sourceEntryIndex=0): two non-rest days.
    const aMon = await insertPlanDay(week, phase, {
      date: "2099-07-06", day: "Mon", sessionType: T_RUN, equipment: E_OUTDOOR, distanceMi: 5,
    });
    await insertPlanDay(week, phase, {
      date: "2099-07-07", day: "Tue", sessionType: T_RUN, equipment: E_OUTDOOR, distanceMi: 5,
    });
    // Program B (sourceEntryIndex=1): same two dates, distinct plan_days.
    await insertPlanDay(week, phase, {
      date: "2099-07-06", day: "Mon", sessionType: T_STRENGTH, equipment: E_GYM,
      sourceEntryIndex: 1, sourceEntryLabel: "Tonal Lift",
    });
    const bTue = await insertPlanDay(week, phase, {
      date: "2099-07-07", day: "Tue", sessionType: T_STRENGTH, equipment: E_GYM,
      sourceEntryIndex: 1, sourceEntryLabel: "Tonal Lift",
    });

    // Pull raw planned/completed counts directly so the assertion
    // doesn't depend on the dashboard's denominator-driven percentage.
    const today = "2099-07-10";
    type Row = { planned: number; completed: number };
    const fetchCounts = async (): Promise<Row> => {
      const r = await db.execute<Row>(
        sql`SELECT
          (SELECT COUNT(*)::int FROM plan_days WHERE date <= ${today} AND is_rest = false) AS planned,
          (SELECT COUNT(*)::int FROM plan_days pd
            WHERE pd.date <= ${today} AND pd.is_rest = false
              AND EXISTS (
                SELECT 1 FROM workouts w
                WHERE w.session_type <> 'Skipped'
                  AND w.plan_day_id = pd.id
              )
          ) AS completed`,
      );
      return r.rows[0]!;
    };
    const baseline = await fetchCounts();

    // Add the 2 attributed workouts. Each links to its own plan_day_id
    // so the OTHER program on the same date stays uncompleted.
    await insertWorkout({
      date: "2099-07-06", sessionType: T_RUN, equipment: E_OUTDOOR, distanceMi: 5, planDayId: aMon.id,
    });
    await insertWorkout({
      date: "2099-07-07", sessionType: T_STRENGTH, equipment: E_GYM, totalLoad: 100, planDayId: bTue.id,
    });

    const after = await fetchCounts();
    expect(after.planned).toBe(baseline.planned);
    expect(after.completed - baseline.completed).toBe(2);

    // The dashboard endpoint must surface those same numbers via
    // adherencePct. Re-derive the expected percentage from the raw
    // counts so the assertion is precise even when seed data dominates.
    const res = await request(app).get("/api/dashboard/summary");
    expect(res.status).toBe(200);
    expectMatchesSchema(GetDashboardSummaryResponse, res.body);
    const expectedPct = Math.min(100, (after.completed / after.planned) * 100);
    expect(res.body.adherencePct).toBeCloseTo(expectedPct, 5);
  });
});

describe("GET /api/dashboard/summary raceKind per-kind framing (task #209)", () => {
  // Mirrors the trailing-Sunday detection /plan/overview uses (task
  // #204) so the dashboard header / race-week banner read the same
  // per-kind label as /plan instead of always defaulting to "Race
  // Campaign". One non-marathon kind is enough to pin the wiring; the
  // shared `detectRaceKind` helper is exhaustively covered in
  // plan-aggregations.test.ts.
  it.each([
    {
      kind: "5k",
      distanceMi: 3.1,
      description:
        "RACE DAY — 5K (3.1 mi). Execute race plan at VO2 effort, go hard from the gun, finish strong.",
    },
    {
      kind: "half",
      distanceMi: 13.1,
      description:
        "RACE DAY — Half (13.1 mi). Execute race plan, fuel every 4 mi, finish strong.",
    },
  ])(
    "reports raceKind=$kind when the trailing plan_day is the matching race row",
    async ({ kind, distanceMi, description }) => {
      const week = 8501;
      const phase = "Dashboard Race Tail";
      await insertWeek(week, {
        startDate: "2099-10-04",
        endDate: "2099-10-10",
        phase,
      });
      // Lead-in Saturday + race-day Sunday; the trailing-day query
      // orders by date DESC so Sunday wins regardless of insertion.
      await insertPlanDay(week, phase, {
        date: "2099-10-09",
        day: "Sat",
        sessionType: T_RUN,
        equipment: E_OUTDOOR,
        distanceMi: 2,
      });
      await insertPlanDay(week, phase, {
        date: "2099-10-10",
        day: "Sun",
        sessionType: "Race",
        equipment: E_OUTDOOR,
        distanceMi,
        description,
      });

      const res = await request(app).get("/api/dashboard/summary");
      expect(res.status).toBe(200);
      expectMatchesSchema(GetDashboardSummaryResponse, res.body);
      expect(res.body.raceKind).toBe(kind);
    },
  );

  it("returns raceKind=null when the trailing plan_day is a non-race row at a canonical race distance", async () => {
    // A 13.1 mi long-run Sunday must NOT be classified as a half
    // marathon race day from distance alone — without the explicit
    // race signal the dashboard header collapses to its generic copy
    // instead of presupposing a race kind.
    const week = 8511;
    const phase = "Dashboard Long Run Tail";
    await insertWeek(week, {
      startDate: "2099-11-01",
      endDate: "2099-11-07",
      phase,
    });
    await insertPlanDay(week, phase, {
      date: "2099-11-07",
      day: "Sun",
      sessionType: T_RUN,
      equipment: E_OUTDOOR,
      distanceMi: 13.1,
      description: "Long run, easy effort.",
    });
    const res = await request(app).get("/api/dashboard/summary");
    expect(res.status).toBe(200);
    expectMatchesSchema(GetDashboardSummaryResponse, res.body);
    expect(res.body.raceKind).toBeNull();
  });
});

describe("GET /api/dashboard/summary daysToRace anchored on applied Planner config", () => {
  it("counts down to the runner's APPLIED marathon date, not the canonical 2027 date", async () => {
    vi.useFakeTimers();
    // Sit "today" at 2099-04-26 (a Sunday) so the canonical 2027-05-02
    // race date is in the past — without the planner override, the route
    // would clamp daysToRace to 0. Our applied config marathon date is
    // exactly 14 days later (Sun 2099-05-10).
    vi.setSystemTime(new Date("2099-04-26T12:00:00.000Z"));

    // Save + apply a planner config whose marathon date is 2099-05-10.
    // 2099-04-27 is a Mon and 2099-05-10 is a Sun (verified manually);
    // 2 weeks total = 16 user weeks short of MARATHON_TAIL_WEEKS, so the
    // validator would reject. Skip apply and instead write the config row
    // directly with last_applied_at set so we exercise the dashboard
    // anchor without exercising the full apply pipeline.
    // Some prior suites (e.g. full-reset.test.ts) leave applied
    // planner_configs rows behind, so wipe before inserting our
    // hardcoded id=1 fixture and exercising the dashboard anchor in
    // isolation.
    await db.delete(plannerConfigsTable);
    await db.insert(plannerConfigsTable).values({
      id: 1,
      name: "Dashboard test config",
      isActive: true,
      startDate: "2099-04-27",
      marathonDate: "2099-05-10",
      blocks: [{ focusType: "Base", weeks: 2 }],
      lastAppliedAt: new Date(),
      appliedStartDate: "2099-04-27",
      appliedMarathonDate: "2099-05-10",
      appliedBlocks: [{ focusType: "Base", weeks: 2 }],
    });

    const res = await request(app).get("/api/dashboard/summary");
    expect(res.status).toBe(200);
    expect(res.body.daysToRace).toBe(14);

    await db.delete(plannerConfigsTable);
  });
});

describe("GET /api/dashboard/summary prevFourWeekAvgLifestyleMinutes (task #34)", () => {
  it("returns null when fewer than 4 prior plan_weeks exist", async () => {
    // Active week is the very first plan_week — there are no plan_weeks at
    // week-4..week-1, so the rolling baseline must stay null and the
    // dashboard hides the trend indicator.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2099-08-04T12:00:00.000Z"));

    const week = 8601;
    const phase = "Lifestyle Baseline Phase";
    await insertWeek(week, {
      startDate: "2099-08-03",
      endDate: "2099-08-09",
      phase,
    });
    await insertPlanDay(week, phase, {
      date: "2099-08-04",
      day: "Tue",
      sessionType: T_STRENGTH,
      equipment: E_GYM,
    });
    // In-range Lifestyle minutes for the ACTIVE week show up under
    // weeklyLifestyleMinutes but must NOT seed the prior-4 baseline.
    await insertWorkout({
      date: "2099-08-04",
      sessionType: "Dog Walk",
      equipment: "Lifestyle",
      durationMin: 30,
    });

    const res = await request(app).get("/api/dashboard/summary");
    expect(res.status).toBe(200);
    expectMatchesSchema(GetDashboardSummaryResponse, res.body);
    expect(res.body.currentWeek).toBe(week);
    expect(res.body.weeklyLifestyleMinutes).toBe(30);
    expect(res.body.prevFourWeekAvgLifestyleMinutes).toBeNull();
  });

  it("returns null when only 3 prior plan_weeks exist", async () => {
    // Boundary case: 3 prior plan_weeks is still under the threshold so the
    // rolling baseline must stay null until a 4th prior week is in place.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2099-08-25T12:00:00.000Z"));

    const phase = "Lifestyle Baseline Short Phase";
    await insertWeek(8611, { startDate: "2099-08-03", endDate: "2099-08-09", phase });
    await insertWeek(8612, { startDate: "2099-08-10", endDate: "2099-08-16", phase });
    await insertWeek(8613, { startDate: "2099-08-17", endDate: "2099-08-23", phase });
    await insertWeek(8614, { startDate: "2099-08-24", endDate: "2099-08-30", phase });
    await insertWorkout({ date: "2099-08-05", sessionType: "Walk", equipment: "Lifestyle", durationMin: 40 });
    await insertWorkout({ date: "2099-08-12", sessionType: "Walk", equipment: "Lifestyle", durationMin: 50 });
    await insertWorkout({ date: "2099-08-19", sessionType: "Walk", equipment: "Lifestyle", durationMin: 60 });

    const res = await request(app).get("/api/dashboard/summary");
    expect(res.status).toBe(200);
    expectMatchesSchema(GetDashboardSummaryResponse, res.body);
    expect(res.body.currentWeek).toBe(8614);
    expect(res.body.prevFourWeekAvgLifestyleMinutes).toBeNull();
  });

  it("averages lifestyle minutes across the 4 immediately-preceding plan_weeks", async () => {
    // Active week sits one step past four prior plan_weeks, each holding a
    // mix of Lifestyle and non-Lifestyle workouts. Only the Lifestyle rows
    // dated within each prior plan_week's date range contribute, and the
    // returned baseline is the simple mean across all 4 weeks (including
    // the zero-Lifestyle week).
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2099-09-02T12:00:00.000Z"));

    const phase = "Lifestyle Baseline Avg Phase";
    await insertWeek(8621, { startDate: "2099-08-03", endDate: "2099-08-09", phase });
    await insertWeek(8622, { startDate: "2099-08-10", endDate: "2099-08-16", phase });
    await insertWeek(8623, { startDate: "2099-08-17", endDate: "2099-08-23", phase });
    await insertWeek(8624, { startDate: "2099-08-24", endDate: "2099-08-30", phase });
    await insertWeek(8625, { startDate: "2099-08-31", endDate: "2099-09-06", phase });
    await insertPlanDay(8625, phase, {
      date: "2099-09-02",
      day: "Wed",
      sessionType: T_STRENGTH,
      equipment: E_GYM,
    });

    // Prior week 8621: 30 + 60 = 90 lifestyle minutes.
    await insertWorkout({ date: "2099-08-04", sessionType: "Dog Walk", equipment: "Lifestyle", durationMin: 30 });
    await insertWorkout({ date: "2099-08-07", sessionType: "Yard Work", equipment: "Lifestyle", durationMin: 60 });
    // Non-Lifestyle workouts in the same week — must NOT affect the baseline.
    await insertWorkout({
      date: "2099-08-05",
      sessionType: T_RUN,
      equipment: E_OUTDOOR,
      distanceMi: 4,
      durationMin: 45,
    });

    // Prior week 8622: zero lifestyle minutes; only a Strength workout.
    await insertWorkout({
      date: "2099-08-12",
      sessionType: T_STRENGTH,
      equipment: E_GYM,
      durationMin: 30,
      totalLoad: 200,
    });

    // Prior week 8623: 45 lifestyle minutes.
    await insertWorkout({ date: "2099-08-19", sessionType: "Hike", equipment: "Lifestyle", durationMin: 45 });

    // Prior week 8624: 20 lifestyle minutes.
    await insertWorkout({ date: "2099-08-28", sessionType: "Walk", equipment: "Lifestyle", durationMin: 20 });

    // Active-week Lifestyle row — bumps weeklyLifestyleMinutes but is
    // excluded from the prior-4 baseline.
    await insertWorkout({ date: "2099-09-02", sessionType: "Walk", equipment: "Lifestyle", durationMin: 15 });

    const res = await request(app).get("/api/dashboard/summary");
    expect(res.status).toBe(200);
    expectMatchesSchema(GetDashboardSummaryResponse, res.body);
    expect(res.body.currentWeek).toBe(8625);
    expect(res.body.weeklyLifestyleMinutes).toBe(15);
    // (90 + 0 + 45 + 20) / 4 = 38.75
    expect(res.body.prevFourWeekAvgLifestyleMinutes).toBeCloseTo(38.75, 5);
  });

  it("excludes out-of-range and non-Lifestyle workouts from the baseline", async () => {
    // Only Lifestyle workouts dated inside one of the four prior plan_week
    // ranges should contribute. Lifestyle workouts dated BEFORE the
    // earliest prior week, AFTER the active week, or in the GAP between
    // prior weeks where no plan_week covers the date are all excluded —
    // as are non-Lifestyle workouts even when their dates land squarely
    // inside a prior plan_week.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2099-10-07T12:00:00.000Z"));

    const phase = "Lifestyle Baseline Exclusions Phase";
    // Prior weeks intentionally NOT contiguous — there's a one-week gap
    // (2099-09-21..2099-09-27) with no plan_week so any Lifestyle row
    // there must fall through.
    await insertWeek(8631, { startDate: "2099-09-07", endDate: "2099-09-13", phase });
    await insertWeek(8632, { startDate: "2099-09-14", endDate: "2099-09-20", phase });
    await insertWeek(8633, { startDate: "2099-09-28", endDate: "2099-10-04", phase });
    await insertWeek(8634, { startDate: "2099-10-05", endDate: "2099-10-11", phase });
    await insertWeek(8635, { startDate: "2099-10-12", endDate: "2099-10-18", phase });
    await insertPlanDay(8635, phase, {
      date: "2099-10-14",
      day: "Wed",
      sessionType: T_STRENGTH,
      equipment: E_GYM,
    });
    // The route looks up the active week by date BETWEEN start AND end,
    // and the LEFT JOIN walks pw.week BETWEEN active.week-4 AND
    // active.week-1, so we need today inside week 8635.
    vi.setSystemTime(new Date("2099-10-14T12:00:00.000Z"));

    // Each prior week has exactly one in-range Lifestyle row.
    await insertWorkout({ date: "2099-09-09", sessionType: "Walk", equipment: "Lifestyle", durationMin: 20 });
    await insertWorkout({ date: "2099-09-15", sessionType: "Walk", equipment: "Lifestyle", durationMin: 40 });
    await insertWorkout({ date: "2099-10-01", sessionType: "Walk", equipment: "Lifestyle", durationMin: 60 });
    await insertWorkout({ date: "2099-10-07", sessionType: "Walk", equipment: "Lifestyle", durationMin: 80 });

    // Lifestyle BEFORE the earliest prior week — must be excluded.
    await insertWorkout({ date: "2099-08-15", sessionType: "Walk", equipment: "Lifestyle", durationMin: 999 });
    // Lifestyle in the calendar GAP between prior weeks (no plan_week
    // covers 2099-09-23) — must be excluded.
    await insertWorkout({ date: "2099-09-23", sessionType: "Walk", equipment: "Lifestyle", durationMin: 999 });
    // Lifestyle AFTER the active week — must be excluded.
    await insertWorkout({ date: "2099-11-01", sessionType: "Walk", equipment: "Lifestyle", durationMin: 999 });
    // Non-Lifestyle workouts in the prior weeks — must be excluded.
    await insertWorkout({
      date: "2099-09-10",
      sessionType: T_RUN,
      equipment: E_OUTDOOR,
      distanceMi: 6,
      durationMin: 60,
    });
    await insertWorkout({
      date: "2099-10-02",
      sessionType: T_STRENGTH,
      equipment: E_GYM,
      durationMin: 45,
      totalLoad: 250,
    });

    const res = await request(app).get("/api/dashboard/summary");
    expect(res.status).toBe(200);
    expectMatchesSchema(GetDashboardSummaryResponse, res.body);
    expect(res.body.currentWeek).toBe(8635);
    // (20 + 40 + 60 + 80) / 4 = 50; the 999s and the run/strength rows
    // would all bump this if they leaked into the aggregation.
    expect(res.body.prevFourWeekAvgLifestyleMinutes).toBeCloseTo(50, 5);
  });
});

describe("GET /api/dashboard/weight-trend", () => {
  it("returns weight measurements in date ascending order", async () => {
    await insertMeasurement({ date: "2099-02-15", weight: 245 });
    await insertMeasurement({ date: "2099-02-10", weight: 247 });
    await insertMeasurement({ date: "2099-02-12", weight: 246 });
    // Null-weight rows must be filtered out by the SQL.
    await insertMeasurement({ date: "2099-02-13", weight: null });

    const res = await request(app).get("/api/dashboard/weight-trend");
    expect(res.status).toBe(200);
    expectMatchesSchema(GetWeightTrendResponse, res.body);

    const rows = res.body as Array<{ date: string; weight: number }>;
    const ours = rows.filter((r) => r.date.startsWith("2099-02-"));
    expect(ours).toEqual([
      { date: "2099-02-10", weight: 247 },
      { date: "2099-02-12", weight: 246 },
      { date: "2099-02-15", weight: 245 },
    ]);
  });
});

describe("GET /api/dashboard/weekly-mileage", () => {
  it("aggregates actual mileage per plan_week", async () => {
    const week = 8401;
    const phase = "Weekly Mileage";
    await insertWeek(week, {
      startDate: "2099-07-06",
      endDate: "2099-07-12",
      phase,
      plannedMiles: 25,
      longRunMi: 10,
    });
    await insertWorkout({ date: "2099-07-06", sessionType: T_RUN, equipment: E_OUTDOOR, distanceMi: 6 });
    await insertWorkout({ date: "2099-07-08", sessionType: T_RUN, equipment: E_TREADMILL, distanceMi: 4 });
    // Workout outside the week range -> excluded from this week's actual_miles.
    await insertWorkout({ date: "2099-07-20", sessionType: T_RUN, equipment: E_OUTDOOR, distanceMi: 5 });

    const res = await request(app).get("/api/dashboard/weekly-mileage");
    expect(res.status).toBe(200);
    expectMatchesSchema(GetWeeklyMileageResponse, res.body);

    const rows = res.body as Array<{
      week: number;
      startDate: string;
      phase: string;
      plannedMiles: number;
      actualMiles: number;
      plannedCardioMin: number;
      actualCardioMin: number;
      dominantCardioEquipment: string | null;
    }>;
    const ours = rows.find((r) => r.week === week);
    expect(ours).toEqual({
      week,
      startDate: "2099-07-06",
      phase,
      plannedMiles: 25,
      actualMiles: 10,
      plannedCardioMin: 0,
      actualCardioMin: 0,
      dominantCardioEquipment: null,
      // No plan_days inserted in this fixture, so the per-program planned
      // breakdown (Task #144) is empty for this week. The headline
      // plannedMiles still comes from plan_weeks, which is correct.
      programs: [],
      // Task #183: no Wed plan day in this fixture, so wedSteady is null.
      wedSteady: null,
    });
  });

  it("flags wedSteady weeks from plan_days.session_type (Task #183)", async () => {
    // Two weeks: one with a Steady Run + Accessory Wed, one with a plain
    // Run + Accessory Wed. The dashboard mileage chart consumes this flag
    // to overlay the amber Z3 marker, mirroring what /plan/weeks already
    // exposes.
    const steadyWeek = 8421;
    const easyWeek = 8422;
    const phase = "Marathon-Specific";
    await insertWeek(steadyWeek, {
      startDate: "2099-08-03",
      endDate: "2099-08-09",
      phase,
      plannedMiles: 30,
    });
    await insertWeek(easyWeek, {
      startDate: "2099-08-10",
      endDate: "2099-08-16",
      phase,
      plannedMiles: 22,
    });
    await insertPlanDay(steadyWeek, phase, {
      date: "2099-08-05",
      day: "Wed",
      sessionType: "Steady Run + Accessory",
      equipment: "Tonal",
      distanceMi: 6,
    });
    await insertPlanDay(easyWeek, phase, {
      date: "2099-08-12",
      day: "Wed",
      sessionType: "Run + Accessory",
      equipment: "Tonal",
      distanceMi: 5,
    });

    const res = await request(app).get("/api/dashboard/weekly-mileage");
    expect(res.status).toBe(200);
    expectMatchesSchema(GetWeeklyMileageResponse, res.body);
    const rows = res.body as Array<{ week: number; wedSteady: boolean | null }>;
    expect(rows.find((r) => r.week === steadyWeek)?.wedSteady).toBe(true);
    expect(rows.find((r) => r.week === easyWeek)?.wedSteady).toBe(false);
  });

  it("surfaces cardio minutes and dominant equipment for bike/row weeks", async () => {
    // Bike-only week: plannedMiles is 0 but plannedCardio is high. Without
    // the cardio fields the chart bar would be zero-height; the chart now
    // plots planned/actual cardio minutes on a secondary axis and labels
    // the tooltip with the dominant cardio machine.
    const week = 8402;
    const phase = "Cross Train";
    await insertWeek(week, {
      startDate: "2099-07-13",
      endDate: "2099-07-19",
      phase,
      plannedMiles: 0,
      plannedCardio: 120,
    });
    await insertPlanDay(week, phase, {
      date: "2099-07-13",
      day: "Mon",
      sessionType: "Bike",
      equipment: "Peloton Bike",
      cardioMin: 60,
    });
    await insertPlanDay(week, phase, {
      date: "2099-07-15",
      day: "Wed",
      sessionType: "Bike",
      equipment: "Peloton Bike",
      cardioMin: 60,
    });
    await insertPlanDay(week, phase, {
      date: "2099-07-17",
      day: "Fri",
      sessionType: "Row",
      equipment: "Peloton Row",
      cardioMin: 30,
    });
    await insertWorkout({
      date: "2099-07-13",
      sessionType: "Bike",
      equipment: "Peloton Bike",
      cardioMin: 45,
    });
    await insertWorkout({
      date: "2099-07-15",
      sessionType: "Bike",
      equipment: "Peloton Bike",
      cardioMin: 50,
    });

    const res = await request(app).get("/api/dashboard/weekly-mileage");
    expect(res.status).toBe(200);
    expectMatchesSchema(GetWeeklyMileageResponse, res.body);

    const rows = res.body as Array<{
      week: number;
      plannedMiles: number;
      actualMiles: number;
      plannedCardioMin: number;
      actualCardioMin: number;
      dominantCardioEquipment: string | null;
    }>;
    const ours = rows.find((r) => r.week === week);
    expect(ours).toMatchObject({
      week,
      plannedMiles: 0,
      actualMiles: 0,
      plannedCardioMin: 120,
      actualCardioMin: 95,
      dominantCardioEquipment: "Peloton Bike",
    });
  });
});

describe("GET /api/dashboard/weekly-mileage programs breakdown (Task #144)", () => {
  it("returns per-program planned miles and cardio minutes per week", async () => {
    const week = 8411;
    const phase = "Multi-Program Mileage";
    await insertWeek(week, {
      startDate: "2099-07-06",
      endDate: "2099-07-12",
      phase,
      plannedMiles: 18,
      plannedCardio: 60,
    });
    // Program 0: 5K Improver — 12 mi running.
    await insertPlanDay(week, phase, {
      date: "2099-07-06",
      day: "Mon",
      sessionType: T_RUN,
      equipment: E_OUTDOOR,
      distanceMi: 8,
      sourceEntryIndex: 0,
      sourceEntryLabel: "5K Improver",
    });
    await insertPlanDay(week, phase, {
      date: "2099-07-08",
      day: "Wed",
      sessionType: T_RUN,
      equipment: E_OUTDOOR,
      distanceMi: 4,
      sourceEntryIndex: 0,
      sourceEntryLabel: "5K Improver",
    });
    // Program 1: Tonal Lift — 6 mi treadmill warmup + 60 min cross-train.
    await insertPlanDay(week, phase, {
      date: "2099-07-07",
      day: "Tue",
      sessionType: "Bike",
      equipment: "Peloton Bike",
      distanceMi: 6,
      cardioMin: 60,
      sourceEntryIndex: 1,
      sourceEntryLabel: "Tonal Lift",
    });

    const res = await request(app).get("/api/dashboard/weekly-mileage");
    expect(res.status).toBe(200);
    expectMatchesSchema(GetWeeklyMileageResponse, res.body);

    const rows = res.body as Array<{
      week: number;
      programs: Array<{
        sourceEntryIndex: number;
        label: string;
        plannedMiles: number;
        plannedCardioMin: number;
      }>;
    }>;
    const ours = rows.find((r) => r.week === week);
    expect(ours).toBeDefined();
    expect(ours!.programs).toHaveLength(2);
    const improver = ours!.programs.find((p) => p.sourceEntryIndex === 0);
    const tonal = ours!.programs.find((p) => p.sourceEntryIndex === 1);
    expect(improver).toEqual({
      sourceEntryIndex: 0,
      label: "5K Improver",
      plannedMiles: 12,
      plannedCardioMin: 0,
    });
    expect(tonal).toEqual({
      sourceEntryIndex: 1,
      label: "Tonal Lift",
      plannedMiles: 6,
      plannedCardioMin: 60,
    });
  });
});

describe("GET /api/dashboard/equipment-usage", () => {
  it("returns the canonical arsenal first with planned + actual aggregates per equipment", async () => {
    // Actuals from logged workouts.
    await insertWorkout({
      date: "2099-08-01",
      sessionType: T_RUN,
      equipment: E_OUTDOOR,
      distanceMi: 6,
      durationMin: 50,
      totalLoad: 200,
    });
    await insertWorkout({
      date: "2099-08-02",
      sessionType: T_RUN,
      equipment: E_OUTDOOR,
      distanceMi: 4,
      durationMin: 40,
      totalLoad: 150,
    });
    await insertWorkout({
      date: "2099-08-03",
      sessionType: T_STRENGTH,
      equipment: E_GYM,
      distanceMi: null,
      durationMin: 30,
      totalLoad: 400,
    });

    // Planned sessions from plan_days. E_OUTDOOR has both planned and actual;
    // E_TREADMILL has planned-only (no logged workout) so it should still
    // surface with non-zero plannedSessions and zero actuals.
    const week = 8601;
    const phase = "Equipment Phase";
    await insertWeek(week, {
      startDate: "2099-08-01",
      endDate: "2099-08-07",
      phase,
    });
    await insertPlanDay(week, phase, {
      date: "2099-08-01",
      day: "Mon",
      sessionType: T_RUN,
      equipment: E_OUTDOOR,
      cardioMin: 45,
      distanceMi: 5,
      totalLoad: 250,
    });
    await insertPlanDay(week, phase, {
      date: "2099-08-02",
      day: "Tue",
      sessionType: T_RUN,
      equipment: E_OUTDOOR,
      cardioMin: 35,
      distanceMi: 4,
      totalLoad: 200,
    });
    await insertPlanDay(week, phase, {
      date: "2099-08-04",
      day: "Thu",
      sessionType: T_RUN,
      equipment: E_TREADMILL,
      cardioMin: 30,
      distanceMi: 3,
      totalLoad: 180,
    });
    // Rest plan day must be excluded from planned aggregates.
    await insertPlanDay(week, phase, {
      date: "2099-08-05",
      day: "Fri",
      sessionType: T_REST,
      equipment: E_OUTDOOR,
      isRest: true,
    });

    const res = await request(app).get("/api/dashboard/equipment-usage");
    expect(res.status).toBe(200);
    expectMatchesSchema(GetEquipmentUsageResponse, res.body);

    const rows = res.body as Array<{
      equipment: string;
      sessions: number;
      totalMinutes: number;
      totalLoad: number;
      totalDistance: number;
      plannedSessions: number;
      plannedMinutes: number;
      plannedLoad: number;
      plannedDistance: number;
      plannedToDateSessions: number;
      plannedToDateMinutes: number;
      plannedToDateLoad: number;
      plannedToDateDistance: number;
    }>;

    // First four rows must always be the canonical arsenal in order, even
    // though none of them have any test fixtures. Planned/actual values
    // come from real seeded data, so we only assert the row exists and has
    // numeric fields.
    expect(rows.slice(0, 4).map((r) => r.equipment)).toEqual([...ARSENAL]);
    for (const r of rows.slice(0, 4)) {
      expect(typeof r.plannedSessions).toBe("number");
      expect(typeof r.sessions).toBe("number");
      expect(typeof r.plannedToDateSessions).toBe("number");
    }

    const outdoor = rows.find((r) => r.equipment === E_OUTDOOR);
    // The fixture plan dates are in 2099, so nothing in this test's plan
    // is "due so far" relative to today — plannedToDate* must be zero
    // even though plannedSessions/etc. are non-zero. This is the whole
    // point of the new field: early-campaign machines aren't flagged.
    // Task #144: byProgram surfaces the single fallback "Marathon Plan"
    // entry because these plan_days were inserted with the default
    // sourceEntryIndex=0 / NULL label.
    expect(outdoor).toEqual({
      equipment: E_OUTDOOR,
      sessions: 2,
      totalMinutes: 90,
      totalLoad: 350,
      totalDistance: 10,
      plannedSessions: 2,
      plannedMinutes: 80,
      plannedLoad: 450,
      plannedDistance: 9,
      plannedToDateSessions: 0,
      plannedToDateMinutes: 0,
      plannedToDateLoad: 0,
      plannedToDateDistance: 0,
      byProgram: [
        {
          sourceEntryIndex: 0,
          label: "Marathon Plan",
          plannedSessions: 2,
          plannedMinutes: 80,
          plannedLoad: 450,
          plannedDistance: 9,
        },
      ],
    });

    // Planned-only equipment surfaces with zero actuals.
    const treadmill = rows.find((r) => r.equipment === E_TREADMILL);
    expect(treadmill).toEqual({
      equipment: E_TREADMILL,
      sessions: 0,
      totalMinutes: 0,
      totalLoad: 0,
      totalDistance: 0,
      plannedSessions: 1,
      plannedMinutes: 30,
      plannedLoad: 180,
      plannedDistance: 3,
      plannedToDateSessions: 0,
      plannedToDateMinutes: 0,
      plannedToDateLoad: 0,
      plannedToDateDistance: 0,
      byProgram: [
        {
          sourceEntryIndex: 0,
          label: "Marathon Plan",
          plannedSessions: 1,
          plannedMinutes: 30,
          plannedLoad: 180,
          plannedDistance: 3,
        },
      ],
    });

    // Actual-only equipment surfaces with zero planned and an empty
    // byProgram array (no plan_days for this machine to attribute).
    const gym = rows.find((r) => r.equipment === E_GYM);
    expect(gym).toEqual({
      equipment: E_GYM,
      sessions: 1,
      totalMinutes: 30,
      totalLoad: 400,
      totalDistance: 0,
      plannedSessions: 0,
      plannedMinutes: 0,
      plannedLoad: 0,
      plannedDistance: 0,
      plannedToDateSessions: 0,
      plannedToDateMinutes: 0,
      plannedToDateLoad: 0,
      plannedToDateDistance: 0,
      byProgram: [],
    });
  });

  it("counts planned work whose date is on or before today as planned-to-date, and excludes future-dated plan", async () => {
    // Use a clearly past date so we can lock the assertion regardless of
    // when the test runs. The route reads `today` from the system clock,
    // and 2000-01-01 is unambiguously <= today.
    const pastWeek = 8901;
    const futureWeek = 8902;
    const phase = "Planned-to-date Phase";
    await insertWeek(pastWeek, {
      startDate: "2000-01-03",
      endDate: "2000-01-09",
      phase,
    });
    await insertWeek(futureWeek, {
      startDate: "2099-09-06",
      endDate: "2099-09-12",
      phase,
    });
    // Past-dated plan day (counts toward planned-to-date).
    await insertPlanDay(pastWeek, phase, {
      date: "2000-01-03",
      day: "Mon",
      sessionType: T_RUN,
      equipment: E_TREADMILL,
      cardioMin: 20,
      distanceMi: 2,
      totalLoad: 100,
    });
    // Future-dated plan day (planned only, not yet due).
    await insertPlanDay(futureWeek, phase, {
      date: "2099-09-06",
      day: "Mon",
      sessionType: T_RUN,
      equipment: E_TREADMILL,
      cardioMin: 40,
      distanceMi: 5,
      totalLoad: 250,
    });

    const res = await request(app).get("/api/dashboard/equipment-usage");
    expect(res.status).toBe(200);
    const rows = res.body as Array<{
      equipment: string;
      plannedSessions: number;
      plannedMinutes: number;
      plannedLoad: number;
      plannedDistance: number;
      plannedToDateSessions: number;
      plannedToDateMinutes: number;
      plannedToDateLoad: number;
      plannedToDateDistance: number;
    }>;
    const tread = rows.find((r) => r.equipment === E_TREADMILL);
    expect(tread).toBeDefined();
    // Full-campaign aggregates include both plan days.
    expect(tread!.plannedSessions).toBe(2);
    expect(tread!.plannedMinutes).toBe(60);
    expect(tread!.plannedDistance).toBe(7);
    expect(tread!.plannedLoad).toBe(350);
    // Planned-to-date only counts the past-dated plan day.
    expect(tread!.plannedToDateSessions).toBe(1);
    expect(tread!.plannedToDateMinutes).toBe(20);
    expect(tread!.plannedToDateDistance).toBe(2);
    expect(tread!.plannedToDateLoad).toBe(100);
  });
});

describe("GET /api/dashboard/equipment-usage programs breakdown (Task #144)", () => {
  it("attributes per-equipment planned sessions across overlapping programs", async () => {
    const week = 8612;
    const phase = "Equipment Programs";
    await insertWeek(week, {
      startDate: "2099-08-01",
      endDate: "2099-08-07",
      phase,
    });
    // Treadmill: shared by both programs (3× from 5K Improver, 1× from
    // Tonal Lift cross-train), with overlapping dates allowed because each
    // plan_day carries its own sourceEntryIndex.
    await insertPlanDay(week, phase, {
      date: "2099-08-01",
      day: "Mon",
      sessionType: T_RUN,
      equipment: E_TREADMILL,
      cardioMin: 30,
      distanceMi: 3,
      totalLoad: 150,
      sourceEntryIndex: 0,
      sourceEntryLabel: "5K Improver",
    });
    await insertPlanDay(week, phase, {
      date: "2099-08-02",
      day: "Tue",
      sessionType: T_RUN,
      equipment: E_TREADMILL,
      cardioMin: 30,
      distanceMi: 3,
      totalLoad: 150,
      sourceEntryIndex: 0,
      sourceEntryLabel: "5K Improver",
    });
    await insertPlanDay(week, phase, {
      date: "2099-08-03",
      day: "Wed",
      sessionType: T_RUN,
      equipment: E_TREADMILL,
      cardioMin: 30,
      distanceMi: 3,
      totalLoad: 150,
      sourceEntryIndex: 0,
      sourceEntryLabel: "5K Improver",
    });
    await insertPlanDay(week, phase, {
      date: "2099-08-04",
      day: "Thu",
      sessionType: T_RUN,
      equipment: E_TREADMILL,
      cardioMin: 20,
      distanceMi: 2,
      totalLoad: 100,
      sourceEntryIndex: 1,
      sourceEntryLabel: "Tonal Lift",
    });
    // Outdoor: only used by 5K Improver, so it should NOT show as shared.
    await insertPlanDay(week, phase, {
      date: "2099-08-05",
      day: "Fri",
      sessionType: T_RUN,
      equipment: E_OUTDOOR,
      cardioMin: 0,
      distanceMi: 8,
      totalLoad: 400,
      sourceEntryIndex: 0,
      sourceEntryLabel: "5K Improver",
    });

    const res = await request(app).get("/api/dashboard/equipment-usage");
    expect(res.status).toBe(200);
    expectMatchesSchema(GetEquipmentUsageResponse, res.body);

    const rows = res.body as Array<{
      equipment: string;
      plannedSessions: number;
      byProgram: Array<{
        sourceEntryIndex: number;
        label: string;
        plannedSessions: number;
        plannedMinutes: number;
        plannedLoad: number;
        plannedDistance: number;
      }>;
    }>;

    const tread = rows.find((r) => r.equipment === E_TREADMILL);
    expect(tread).toBeDefined();
    expect(tread!.plannedSessions).toBe(4);
    expect(tread!.byProgram).toHaveLength(2);
    const improver = tread!.byProgram.find((p) => p.sourceEntryIndex === 0);
    const tonal = tread!.byProgram.find((p) => p.sourceEntryIndex === 1);
    expect(improver).toEqual({
      sourceEntryIndex: 0,
      label: "5K Improver",
      plannedSessions: 3,
      plannedMinutes: 90,
      plannedLoad: 450,
      plannedDistance: 9,
    });
    expect(tonal).toEqual({
      sourceEntryIndex: 1,
      label: "Tonal Lift",
      plannedSessions: 1,
      plannedMinutes: 20,
      plannedLoad: 100,
      plannedDistance: 2,
    });
    // Per-program totals must sum to the headline planned* values for the
    // machine — this is the contract the front-end attribution UI relies on.
    expect(
      tread!.byProgram.reduce((s, p) => s + p.plannedSessions, 0),
    ).toBe(tread!.plannedSessions);

    const outdoor = rows.find((r) => r.equipment === E_OUTDOOR);
    expect(outdoor).toBeDefined();
    // Single-program machine: the byProgram array still surfaces a single
    // entry so callers always have a stable shape, but only one program
    // owns the planned work.
    expect(outdoor!.byProgram).toHaveLength(1);
    expect(outdoor!.byProgram[0]).toEqual({
      sourceEntryIndex: 0,
      label: "5K Improver",
      plannedSessions: 1,
      plannedMinutes: 0,
      plannedLoad: 400,
      plannedDistance: 8,
    });
  });
});

describe("GET /api/dashboard/equipment-phase-summary", () => {
  it("returns phase-by-phase planned session counts per equipment, with the canonical arsenal always present", async () => {
    const phaseA = "__test__Phase A";
    const phaseB = "__test__Phase B";
    await insertWeek(8701, {
      startDate: "2099-10-05",
      endDate: "2099-10-11",
      phase: phaseA,
    });
    await insertWeek(8702, {
      startDate: "2099-10-12",
      endDate: "2099-10-18",
      phase: phaseB,
    });

    // 2 outdoor + 1 treadmill in phase A.
    await insertPlanDay(8701, phaseA, { date: "2099-10-05", day: "Mon", sessionType: T_RUN, equipment: E_OUTDOOR });
    await insertPlanDay(8701, phaseA, { date: "2099-10-06", day: "Tue", sessionType: T_RUN, equipment: E_OUTDOOR });
    await insertPlanDay(8701, phaseA, { date: "2099-10-07", day: "Wed", sessionType: T_RUN, equipment: E_TREADMILL });
    // Rest day is excluded.
    await insertPlanDay(8701, phaseA, { date: "2099-10-08", day: "Thu", sessionType: T_REST, equipment: E_OUTDOOR, isRest: true });
    // 1 treadmill in phase B.
    await insertPlanDay(8702, phaseB, { date: "2099-10-12", day: "Mon", sessionType: T_RUN, equipment: E_TREADMILL });

    // Logged workouts: phase A → 1 outdoor + 1 treadmill, phase B → 2 treadmill (over-execution).
    await insertWorkout({ date: "2099-10-05", sessionType: T_RUN, equipment: E_OUTDOOR });
    await insertWorkout({ date: "2099-10-07", sessionType: T_RUN, equipment: E_TREADMILL });
    await insertWorkout({ date: "2099-10-12", sessionType: T_RUN, equipment: E_TREADMILL });
    await insertWorkout({ date: "2099-10-13", sessionType: T_RUN, equipment: E_TREADMILL });
    // Lifestyle entries inside the phase window must NOT pollute actual counts.
    await insertWorkout({ date: "2099-10-06", sessionType: "Dog Walk", equipment: "Lifestyle", durationMin: 25 });
    // Skipped sessions must NOT count as actual execution.
    await insertWorkout({ date: "2099-10-06", sessionType: "Skipped", equipment: E_OUTDOOR });
    // A workout that falls outside any planned week must not be tagged to a phase.
    await insertWorkout({ date: "2099-10-25", sessionType: T_RUN, equipment: E_OUTDOOR });

    const res = await request(app).get("/api/dashboard/equipment-phase-summary");
    expect(res.status).toBe(200);
    expectMatchesSchema(GetEquipmentPhaseSummaryResponse, res.body);

    const body = res.body as {
      phases: string[];
      rows: Array<{
        equipment: string;
        counts: number[];
        actualCounts: number[];
        plannedToDateCounts: number[];
        total: number;
        actualTotal: number;
      }>;
    };

    // Phases include the test phases (and any real phases). We only assert
    // ordering for our two synthetic ones.
    const idxA = body.phases.indexOf(phaseA);
    const idxB = body.phases.indexOf(phaseB);
    expect(idxA).toBeGreaterThanOrEqual(0);
    expect(idxB).toBeGreaterThan(idxA);

    // Canonical arsenal must always come first, regardless of fixtures.
    expect(body.rows.slice(0, 4).map((r) => r.equipment)).toEqual([...ARSENAL]);
    for (const r of body.rows) {
      expect(r.counts).toHaveLength(body.phases.length);
      expect(r.actualCounts).toHaveLength(body.phases.length);
      expect(r.plannedToDateCounts).toHaveLength(body.phases.length);
      expect(r.total).toBe(r.counts.reduce((s, n) => s + n, 0));
      expect(r.actualTotal).toBe(r.actualCounts.reduce((s, n) => s + n, 0));
    }

    const outdoor = body.rows.find((r) => r.equipment === E_OUTDOOR);
    expect(outdoor).toBeDefined();
    expect(outdoor!.counts[idxA]).toBe(2);
    expect(outdoor!.counts[idxB]).toBe(0);
    expect(outdoor!.total).toBe(2);
    expect(outdoor!.actualCounts[idxA]).toBe(1);
    expect(outdoor!.actualCounts[idxB]).toBe(0);
    expect(outdoor!.actualTotal).toBe(1);
    // Plan dates are all in 2099 -> nothing is "due so far" yet, so the
    // behind-detection signal must be zero across both phases.
    expect(outdoor!.plannedToDateCounts[idxA]).toBe(0);
    expect(outdoor!.plannedToDateCounts[idxB]).toBe(0);

    const treadmill = body.rows.find((r) => r.equipment === E_TREADMILL);
    expect(treadmill).toBeDefined();
    expect(treadmill!.counts[idxA]).toBe(1);
    expect(treadmill!.counts[idxB]).toBe(1);
    expect(treadmill!.total).toBe(2);
    // Phase B is over-executed: 2 actual vs 1 planned.
    expect(treadmill!.actualCounts[idxA]).toBe(1);
    expect(treadmill!.actualCounts[idxB]).toBe(2);
    expect(treadmill!.actualTotal).toBe(3);
    expect(treadmill!.plannedToDateCounts[idxA]).toBe(0);
    expect(treadmill!.plannedToDateCounts[idxB]).toBe(0);
  });

  it("flags planned-to-date counts only for phases whose plan dates have already passed", async () => {
    // Past phase: every planned day is on or before today, so plannedToDate
    // should equal counts. Future phase: nothing is due yet, so
    // plannedToDate must stay at zero (front-end uses this to skip flagging
    // future phases as "behind").
    const pastPhase = "__test__Phase Past";
    const futurePhase = "__test__Phase Future";
    await insertWeek(8801, {
      startDate: "2000-01-03",
      endDate: "2000-01-09",
      phase: pastPhase,
    });
    await insertWeek(8802, {
      startDate: "2099-12-07",
      endDate: "2099-12-13",
      phase: futurePhase,
    });
    // Past phase: 3 planned outdoor sessions, all dated in the year 2000.
    await insertPlanDay(8801, pastPhase, { date: "2000-01-03", day: "Mon", sessionType: T_RUN, equipment: E_OUTDOOR });
    await insertPlanDay(8801, pastPhase, { date: "2000-01-04", day: "Tue", sessionType: T_RUN, equipment: E_OUTDOOR });
    await insertPlanDay(8801, pastPhase, { date: "2000-01-05", day: "Wed", sessionType: T_RUN, equipment: E_OUTDOOR });
    // Only one was actually executed -> the chart should flag this phase.
    await insertWorkout({ date: "2000-01-03", sessionType: T_RUN, equipment: E_OUTDOOR });
    // Future phase: planned but nothing due yet.
    await insertPlanDay(8802, futurePhase, { date: "2099-12-07", day: "Mon", sessionType: T_RUN, equipment: E_OUTDOOR });
    await insertPlanDay(8802, futurePhase, { date: "2099-12-08", day: "Tue", sessionType: T_RUN, equipment: E_OUTDOOR });

    const res = await request(app).get("/api/dashboard/equipment-phase-summary");
    expect(res.status).toBe(200);
    expectMatchesSchema(GetEquipmentPhaseSummaryResponse, res.body);

    const body = res.body as {
      phases: string[];
      rows: Array<{
        equipment: string;
        counts: number[];
        actualCounts: number[];
        plannedToDateCounts: number[];
      }>;
    };
    const idxPast = body.phases.indexOf(pastPhase);
    const idxFuture = body.phases.indexOf(futurePhase);
    expect(idxPast).toBeGreaterThanOrEqual(0);
    expect(idxFuture).toBeGreaterThanOrEqual(0);

    const outdoor = body.rows.find((r) => r.equipment === E_OUTDOOR);
    expect(outdoor).toBeDefined();
    // Past phase: all 3 planned sessions are due, only 1 actual.
    expect(outdoor!.counts[idxPast]).toBe(3);
    expect(outdoor!.plannedToDateCounts[idxPast]).toBe(3);
    expect(outdoor!.actualCounts[idxPast]).toBe(1);
    // Future phase: planned but not yet due.
    expect(outdoor!.counts[idxFuture]).toBe(2);
    expect(outdoor!.plannedToDateCounts[idxFuture]).toBe(0);
    expect(outdoor!.actualCounts[idxFuture]).toBe(0);
  });
});

describe("GET /api/dashboard/long-run-progression", () => {
  it("returns plan-day long runs paired with the matching workout's distance", async () => {
    const week = 8501;
    const phase = "Long Run Phase";
    await insertWeek(week, {
      startDate: "2099-09-21",
      endDate: "2099-09-27",
      phase,
      plannedMiles: 30,
      longRunMi: 12,
    });
    // The endpoint matches session_type literally on "Long Run", so the plan
    // day must use the canonical name. The week id and date band still keep
    // it inside the test-data namespace for cleanup.
    await insertPlanDay(week, phase, {
      date: "2099-09-26",
      day: "Sat",
      sessionType: "Long Run",
      equipment: E_OUTDOOR,
      distanceMi: 12,
    });
    await insertWorkout({
      date: "2099-09-26",
      sessionType: "Long Run",
      equipment: E_OUTDOOR,
      distanceMi: 11.5,
    });

    const res = await request(app).get("/api/dashboard/long-run-progression");
    expect(res.status).toBe(200);
    expectMatchesSchema(GetLongRunProgressionResponse, res.body);

    const rows = res.body as Array<{
      week: number;
      date: string;
      phase: string;
      plannedMi: number;
      actualMi: number;
    }>;
    const ours = rows.find((r) => r.week === week);
    expect(ours).toEqual({
      week,
      date: "2099-09-26",
      phase,
      plannedMi: 12,
      actualMi: 11.5,
      cardioMin: null,
      plannedCardioMin: 0,
      actualCardioMin: 0,
    });
  });

  it("returns cross-train weeks with no long run, surfacing planned cardio minutes", async () => {
    // Task #113: per-week aggregation so a week with bike/row sessions
    // but no Long Run / Race still shows up on the chart with its
    // planned cardio minutes (drives the secondary-axis bar).
    const week = 8502;
    const phase = "Cross Train Phase";
    await insertWeek(week, {
      startDate: "2099-10-05",
      endDate: "2099-10-11",
      phase,
      plannedMiles: 0,
      longRunMi: 0,
    });
    await insertPlanDay(week, phase, {
      date: "2099-10-07",
      day: "Wed",
      sessionType: "Cardio",
      equipment: "Peloton Bike",
      cardioMin: 45,
    });
    await insertPlanDay(week, phase, {
      date: "2099-10-09",
      day: "Fri",
      sessionType: "Cardio",
      equipment: "Peloton Row",
      cardioMin: 30,
    });

    const res = await request(app).get("/api/dashboard/long-run-progression");
    expect(res.status).toBe(200);
    expectMatchesSchema(GetLongRunProgressionResponse, res.body);

    const rows = res.body as Array<{
      week: number;
      date: string;
      phase: string;
      plannedMi: number;
      actualMi: number;
      cardioMin: number | null;
      plannedCardioMin: number;
      actualCardioMin: number;
    }>;
    const ours = rows.find((r) => r.week === week);
    expect(ours).toBeDefined();
    expect(ours).toEqual({
      week,
      date: "2099-10-05",
      phase,
      plannedMi: 0,
      actualMi: 0,
      cardioMin: null,
      plannedCardioMin: 75,
      actualCardioMin: 0,
    });
  });
});

describe("GET /api/dashboard/recent-activity", () => {
  it("returns the 10 most recent workouts in date desc order", async () => {
    // Insert 12 workouts in 2099, all newer than any real workout. The
    // endpoint caps the response at 10.
    for (let i = 1; i <= 12; i += 1) {
      const day = String(i).padStart(2, "0");
      await insertWorkout({
        date: `2099-11-${day}`,
        sessionType: T_RUN,
        equipment: E_OUTDOOR,
        distanceMi: i,
      });
    }

    const res = await request(app).get("/api/dashboard/recent-activity");
    expect(res.status).toBe(200);
    expectMatchesSchema(GetRecentActivityResponse, res.body);
    const rows = res.body as Array<{ date: string; equipment: string; distanceMi: number | null }>;
    expect(rows).toHaveLength(10);
    // Top of the list should be our newest 2099 inserts in date-desc order.
    expect(rows.map((r) => r.date)).toEqual([
      "2099-11-12",
      "2099-11-11",
      "2099-11-10",
      "2099-11-09",
      "2099-11-08",
      "2099-11-07",
      "2099-11-06",
      "2099-11-05",
      "2099-11-04",
      "2099-11-03",
    ]);
  });

  // Task #148: the recent-activity card snapshots prescribedRunTarget
  // off the matched plan day so the UI can render the "Plan: 6 mi @
  // 10:00" line without a follow-up fetch. Mirrors the behaviour added
  // to GET /api/workouts in Task #140.
  it("populates prescribedRunTarget from the joined plan day when planDayId is set, and null otherwise", async () => {
    const week = 8148;
    const phase = "Recent Activity Phase";
    await insertWeek(week, {
      startDate: "2099-12-01",
      endDate: "2099-12-02",
      phase,
    });
    const planDay = await insertPlanDay(week, phase, {
      date: "2099-12-01",
      day: "Mon",
      sessionType: "Long Run",
      equipment: E_OUTDOOR,
      runMin: 60,
      distanceMi: 6,
      pace: "10:00",
    });
    await insertWorkout({
      date: "2099-12-01",
      sessionType: T_RUN,
      equipment: E_OUTDOOR,
      planDayId: planDay.id,
      runMin: 58,
      distanceMi: 5.9,
    });
    await insertWorkout({
      date: "2099-12-02",
      sessionType: T_RUN,
      equipment: E_OUTDOOR,
      // planDayId omitted — quick-logged off-plan row.
      distanceMi: 3,
    });

    const res = await request(app).get("/api/dashboard/recent-activity");
    expect(res.status).toBe(200);
    expectMatchesSchema(GetRecentActivityResponse, res.body);
    const rows = res.body as Array<{
      date: string;
      planDayId: number | null;
      prescribedRunTarget: unknown;
    }>;
    const bound = rows.find((r) => r.date === "2099-12-01");
    const unbound = rows.find((r) => r.date === "2099-12-02");
    expect(bound?.prescribedRunTarget).toEqual({
      sessionType: "Long Run",
      week,
      runMin: 60,
      distanceMi: 6,
      pace: "10:00",
    });
    expect(unbound?.prescribedRunTarget).toBeNull();
  });
});
