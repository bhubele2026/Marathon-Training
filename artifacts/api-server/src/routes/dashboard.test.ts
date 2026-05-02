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
    }>;
    const ours = rows.find((r) => r.week === week);
    expect(ours).toEqual({
      week,
      startDate: "2099-07-06",
      phase,
      plannedMiles: 25,
      actualMiles: 10,
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
    });

    // Actual-only equipment surfaces with zero planned.
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
    expect(ours).toEqual({ week, date: "2099-09-26", phase, plannedMi: 12, actualMi: 11.5 });
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
});
