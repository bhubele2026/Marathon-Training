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
  T_REST,
  T_RUN,
  T_STRENGTH,
} from "../test-helpers";

beforeEach(async () => {
  await cleanTestData();
});

afterEach(async () => {
  await cleanTestData();
  vi.useRealTimers();
});

describe("GET /api/plan/overview", () => {
  it("returns the constants, the active week's targets, and the latest weight", async () => {
    // Pin "today" inside our synthetic test week so currentWeek() resolves to it
    // instead of a real plan_week.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2099-08-04T12:00:00.000Z"));

    const week = 8101;
    const phase = "Overview Phase";
    await insertWeek(week, {
      startDate: "2099-08-03",
      endDate: "2099-08-09",
      phase,
      plannedMiles: 24,
      longRunMi: 12,
      plannedTotalLoad: 1500,
    });
    await insertMeasurement({ date: "2099-08-01", weight: 232.5 });

    const res = await request(app).get("/api/plan/overview");
    expect(res.status).toBe(200);

    expect(res.body).toEqual(
      expect.objectContaining({
        currentWeek: week,
        currentPhase: phase,
        raceDate: "2027-05-01",
        startDate: "2026-05-01",
        startWeight: 281.6,
        goalWeight: 210,
        currentWeight: 232.5,
        weeklyMilesTarget: 24,
        longRunTarget: 12,
      }),
    );
    expect(typeof res.body.totalWeeks).toBe("number");
    // Our test week id (8101) is well above the real plan length, so the
    // weeksRemaining clamp pins the value to 0.
    expect(res.body.weeksRemaining).toBe(0);
  });
});

describe("GET /api/plan/weeks", () => {
  it("aggregates actual miles, completed sessions, and planned non-rest sessions per week", async () => {
    const week = 8201;
    const phase = "List Phase";
    await insertWeek(week, {
      startDate: "2099-09-07",
      endDate: "2099-09-13",
      phase,
      plannedMiles: 30,
      longRunMi: 14,
      plannedTotalLoad: 2000,
    });
    // 3 planned non-rest sessions + 1 rest day -> totalSessions should be 3.
    await insertPlanDay(week, phase, {
      date: "2099-09-07",
      day: "Mon",
      sessionType: T_RUN,
      equipment: E_OUTDOOR,
      distanceMi: 5,
    });
    await insertPlanDay(week, phase, {
      date: "2099-09-08",
      day: "Tue",
      sessionType: T_STRENGTH,
      equipment: E_GYM,
    });
    await insertPlanDay(week, phase, {
      date: "2099-09-09",
      day: "Wed",
      sessionType: T_RUN,
      equipment: E_OUTDOOR,
      distanceMi: 8,
    });
    await insertPlanDay(week, phase, {
      date: "2099-09-10",
      day: "Thu",
      sessionType: T_REST,
      equipment: E_OUTDOOR,
      isRest: true,
    });

    // Two workouts inside the week range plus one outside it (the latter must
    // not be counted in actualMiles or completedSessions).
    await insertWorkout({ date: "2099-09-07", sessionType: T_RUN, equipment: E_OUTDOOR, distanceMi: 5 });
    await insertWorkout({ date: "2099-09-09", sessionType: T_RUN, equipment: E_OUTDOOR, distanceMi: 8 });
    await insertWorkout({ date: "2099-09-20", sessionType: T_RUN, equipment: E_OUTDOOR, distanceMi: 4 });

    const res = await request(app).get("/api/plan/weeks");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);

    type WeekRow = {
      week: number;
      phase: string;
      startDate: string;
      endDate: string;
      plannedMiles: number;
      longRunMi: number;
      plannedTotalLoad: number;
      actualMiles: number;
      completedSessions: number;
      totalSessions: number;
    };
    const rows = res.body as WeekRow[];
    const ours = rows.find((r) => r.week === week);
    expect(ours).toBeDefined();
    expect(ours).toEqual(
      expect.objectContaining({
        week,
        phase,
        startDate: "2099-09-07",
        endDate: "2099-09-13",
        plannedMiles: 30,
        longRunMi: 14,
        plannedTotalLoad: 2000,
        actualMiles: 13,
        completedSessions: 2,
        totalSessions: 3,
      }),
    );
  });

  it("returns zero aggregates for a week with no workouts or non-rest plan days", async () => {
    const week = 8202;
    const phase = "Empty Phase";
    await insertWeek(week, {
      startDate: "2099-10-05",
      endDate: "2099-10-11",
      phase,
      plannedMiles: 0,
      longRunMi: 0,
    });

    const res = await request(app).get("/api/plan/weeks");
    expect(res.status).toBe(200);
    const rows = res.body as Array<{
      week: number;
      actualMiles: number;
      completedSessions: number;
      totalSessions: number;
    }>;
    const ours = rows.find((r) => r.week === week);
    expect(ours).toBeDefined();
    expect(ours!.actualMiles).toBe(0);
    expect(ours!.completedSessions).toBe(0);
    expect(ours!.totalSessions).toBe(0);
  });
});
