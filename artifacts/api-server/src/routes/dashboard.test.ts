import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import app from "../app";
import {
  cleanTestData,
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
    // Out-of-range workout must not count toward weekly actuals.
    await insertWorkout({ date: "2099-06-30", sessionType: T_RUN, equipment: E_OUTDOOR, distanceMi: 7, totalLoad: 400 });
    // Latest weight comes from our 2099 measurement (newer than any real row).
    await insertMeasurement({ date: "2099-05-30", weight: 232.5 });

    const res = await request(app).get("/api/dashboard/summary");
    expect(res.status).toBe(200);

    expect(res.body).toEqual(
      expect.objectContaining({
        currentWeek: week,
        currentPhase: phase,
        weeklyMilesActual: 5, // only the in-range run contributes a distance
        weeklyMilesPlanned: 30,
        weeklyLoadActual: 800, // 300 + 500
        weeklyLoadPlanned: 2000,
        weeklySessionsCompleted: 2, // 2 in-range workouts
        weeklySessionsPlanned: 2, // 2 non-rest plan days
        weightStart: 281.6,
        weightGoal: 210,
        weightCurrent: 232.5,
        weightLost: expect.closeTo(281.6 - 232.5, 5),
        weightToGoal: expect.closeTo(232.5 - 210, 5),
        // Race date (2027-05-01) is well in the past relative to today (2099),
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
  it("returns the canonical arsenal first, then groups extras by equipment", async () => {
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

    const res = await request(app).get("/api/dashboard/equipment-usage");
    expect(res.status).toBe(200);

    const rows = res.body as Array<{
      equipment: string;
      sessions: number;
      totalMinutes: number;
      totalLoad: number;
      totalDistance: number;
    }>;

    // First four rows must always be the canonical arsenal in order.
    expect(rows.slice(0, 4).map((r) => r.equipment)).toEqual([...ARSENAL]);

    const outdoor = rows.find((r) => r.equipment === E_OUTDOOR);
    expect(outdoor).toEqual({
      equipment: E_OUTDOOR,
      sessions: 2,
      totalMinutes: 90,
      totalLoad: 350,
      totalDistance: 10,
    });

    const gym = rows.find((r) => r.equipment === E_GYM);
    expect(gym).toEqual({
      equipment: E_GYM,
      sessions: 1,
      totalMinutes: 30,
      totalLoad: 400,
      totalDistance: 0,
    });
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

    const rows = res.body as Array<{
      week: number;
      date: string;
      plannedMi: number;
      actualMi: number;
    }>;
    const ours = rows.find((r) => r.week === week);
    expect(ours).toEqual({ week, date: "2099-09-26", plannedMi: 12, actualMi: 11.5 });
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
