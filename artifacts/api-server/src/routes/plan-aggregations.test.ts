import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import {
  GetPlanOverviewResponse,
  ListPlanWeeksResponse,
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
  T_BIKE,
  T_REST,
  T_RUN,
  T_STRENGTH,
  TEST_TAG,
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
    expectMatchesSchema(GetPlanOverviewResponse, res.body);

    expect(res.body).toEqual(
      expect.objectContaining({
        currentWeek: week,
        currentPhase: phase,
        raceDate: "2027-05-02",
        startDate: "2026-05-04",
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
    expectMatchesSchema(ListPlanWeeksResponse, res.body);

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

  it("surfaces the dominant cardio machine for bike-only / row-only weeks (task #107)", async () => {
    // Bike-only week: 0 planned miles, plannedCardio reflects the cardio
    // bucket time, and every non-rest day uses the same Peloton-Bike-style
    // equipment. The summary card needs a `dominantCardioEquipment` so it
    // can render "X min cardio · Peloton Bike" instead of a misleading
    // "0 mi" headline.
    const bikeWeek = 8301;
    const E_BIKE = `${TEST_TAG}peloton_bike`;
    await insertWeek(bikeWeek, {
      startDate: "2099-11-02",
      endDate: "2099-11-08",
      phase: "Bike Block",
      plannedMiles: 0,
      plannedCardio: 180,
    });
    await insertPlanDay(bikeWeek, "Bike Block", {
      date: "2099-11-02", day: "Mon", sessionType: T_REST,
      equipment: E_BIKE, isRest: true,
    });
    await insertPlanDay(bikeWeek, "Bike Block", {
      date: "2099-11-03", day: "Tue", sessionType: T_BIKE,
      equipment: E_BIKE, cardioMin: 60,
    });
    await insertPlanDay(bikeWeek, "Bike Block", {
      date: "2099-11-04", day: "Wed", sessionType: T_BIKE,
      equipment: E_BIKE, cardioMin: 75,
    });
    await insertPlanDay(bikeWeek, "Bike Block", {
      // Strength touch-up day with a small cardio cooldown on the gym
      // equipment — the bike still wins by total cardio_min so it must
      // be the dominant chip.
      date: "2099-11-05", day: "Thu", sessionType: T_STRENGTH,
      equipment: E_GYM, cardioMin: 10, strengthLoad: 100,
    });
    await insertPlanDay(bikeWeek, "Bike Block", {
      date: "2099-11-06", day: "Fri", sessionType: T_BIKE,
      equipment: E_BIKE, cardioMin: 45,
    });

    // Run-based week: should keep `dominantCardioEquipment` as null so the
    // UI keeps leading with mileage.
    const runWeek = 8302;
    await insertWeek(runWeek, {
      startDate: "2099-11-09",
      endDate: "2099-11-15",
      phase: "Run Block",
      plannedMiles: 20,
    });
    await insertPlanDay(runWeek, "Run Block", {
      date: "2099-11-09", day: "Mon", sessionType: T_RUN,
      equipment: E_OUTDOOR, distanceMi: 5,
    });

    const res = await request(app).get("/api/plan/weeks");
    expect(res.status).toBe(200);
    expectMatchesSchema(ListPlanWeeksResponse, res.body);
    const rows = res.body as Array<{
      week: number;
      dominantCardioEquipment: string | null;
    }>;
    const bike = rows.find((r) => r.week === bikeWeek);
    const run = rows.find((r) => r.week === runWeek);
    expect(bike?.dominantCardioEquipment).toBe(E_BIKE);
    expect(run?.dominantCardioEquipment).toBeNull();

    // The single-week endpoint mirrors the same value so /plan/:n stays
    // in sync with the list view.
    const detail = await request(app).get(`/api/plan/weeks/${bikeWeek}`);
    expect(detail.status).toBe(200);
    expect(detail.body.dominantCardioEquipment).toBe(E_BIKE);

    // Row-only week: parallel coverage so a Concept2 / Peloton Row
    // prescription gets the same cardio-first headline + chip as the
    // bike block above. Uses a different week id and a row-style
    // equipment so the dominant-equipment computation has to actually
    // pick row over the gym cooldown.
    const rowWeek = 8303;
    const E_ROW = `${TEST_TAG}peloton_row`;
    await insertWeek(rowWeek, {
      startDate: "2099-11-16",
      endDate: "2099-11-22",
      phase: "Row Block",
      plannedMiles: 0,
      plannedCardio: 150,
    });
    await insertPlanDay(rowWeek, "Row Block", {
      date: "2099-11-17", day: "Tue", sessionType: T_BIKE,
      equipment: E_ROW, cardioMin: 70,
    });
    await insertPlanDay(rowWeek, "Row Block", {
      date: "2099-11-19", day: "Thu", sessionType: T_BIKE,
      equipment: E_ROW, cardioMin: 70,
    });
    await insertPlanDay(rowWeek, "Row Block", {
      date: "2099-11-20", day: "Fri", sessionType: T_STRENGTH,
      equipment: E_GYM, cardioMin: 10, strengthLoad: 100,
    });

    const rowList = await request(app).get("/api/plan/weeks");
    const rowRow = (rowList.body as Array<{
      week: number;
      dominantCardioEquipment: string | null;
    }>).find((r) => r.week === rowWeek);
    expect(rowRow?.dominantCardioEquipment).toBe(E_ROW);
    const rowDetail = await request(app).get(`/api/plan/weeks/${rowWeek}`);
    expect(rowDetail.body.dominantCardioEquipment).toBe(E_ROW);
  });

  it("aggregates actualCardio from workouts.cardio_min for bike-only weeks (task #109)", async () => {
    // Bike-only week with planned cardio time. We log three cardio
    // workouts inside the range and one outside; a Skipped session that
    // happens to carry cardio_min must be excluded so the headline matches
    // what the runner actually completed.
    const week = 8901;
    const E_BIKE = `${TEST_TAG}peloton_bike_109`;
    await insertWeek(week, {
      startDate: "2099-12-07",
      endDate: "2099-12-13",
      phase: "Bike Block",
      plannedMiles: 0,
      plannedCardio: 180,
    });
    await insertPlanDay(week, "Bike Block", {
      date: "2099-12-08", day: "Tue", sessionType: T_BIKE,
      equipment: E_BIKE, cardioMin: 60,
    });
    await insertPlanDay(week, "Bike Block", {
      date: "2099-12-10", day: "Thu", sessionType: T_BIKE,
      equipment: E_BIKE, cardioMin: 60,
    });
    await insertPlanDay(week, "Bike Block", {
      date: "2099-12-12", day: "Sat", sessionType: T_BIKE,
      equipment: E_BIKE, cardioMin: 60,
    });

    await insertWorkout({
      date: "2099-12-08", sessionType: T_BIKE, equipment: E_BIKE, cardioMin: 55,
    });
    await insertWorkout({
      date: "2099-12-10", sessionType: T_BIKE, equipment: E_BIKE, cardioMin: 65,
    });
    // Outside the range — must not contribute.
    await insertWorkout({
      date: "2099-12-20", sessionType: T_BIKE, equipment: E_BIKE, cardioMin: 40,
    });
    // Skipped session with cardio_min — must not contribute.
    await insertWorkout({
      date: "2099-12-12", sessionType: "Skipped", equipment: E_BIKE, cardioMin: 30,
    });

    const list = await request(app).get("/api/plan/weeks");
    expect(list.status).toBe(200);
    const row = (list.body as Array<{ week: number; actualCardio: number; plannedCardio: number }>)
      .find((r) => r.week === week);
    expect(row?.actualCardio).toBe(120);
    expect(row?.plannedCardio).toBe(180);

    const detail = await request(app).get(`/api/plan/weeks/${week}`);
    expect(detail.status).toBe(200);
    expect(detail.body.actualCardio).toBe(120);
    expect(detail.body.plannedCardio).toBe(180);
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
    expectMatchesSchema(ListPlanWeeksResponse, res.body);
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
