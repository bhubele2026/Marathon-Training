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

  it("attributes completedSessions per program for concurrent overlapping plan_days (task #143)", async () => {
    // Two concurrent programs share the same calendar dates. Each
    // program contributes its own plan_day per date, so totalSessions
    // counts both. completedSessions is now per plan_day: a workout
    // logged against program A's plan_day on day 1 must NOT credit
    // program B's plan_day on the same day. Skipped workouts and
    // out-of-window workouts are excluded.
    const week = 8950;
    const phase = "Concurrent Phase";
    await insertWeek(week, {
      startDate: "2099-12-21",
      endDate: "2099-12-27",
      phase,
      plannedMiles: 10,
    });
    // Program A (sourceEntryIndex defaults to 0): two non-rest days.
    const aMon = await insertPlanDay(week, phase, {
      date: "2099-12-21", day: "Mon", sessionType: T_RUN, equipment: E_OUTDOOR, distanceMi: 5,
    });
    const aTue = await insertPlanDay(week, phase, {
      date: "2099-12-22", day: "Tue", sessionType: T_RUN, equipment: E_OUTDOOR, distanceMi: 5,
    });
    // Program B: same two dates, different plan_day rows. Use a
    // distinct sourceEntryIndex so the unique constraint allows the
    // same-date insert.
    const bMon = await insertPlanDay(week, phase, {
      date: "2099-12-21", day: "Mon", sessionType: T_STRENGTH, equipment: E_GYM,
      sourceEntryIndex: 1, sourceEntryLabel: "Tonal Lift",
    });
    const bTue = await insertPlanDay(week, phase, {
      date: "2099-12-22", day: "Tue", sessionType: T_STRENGTH, equipment: E_GYM,
      sourceEntryIndex: 1, sourceEntryLabel: "Tonal Lift",
    });

    // Crush program A on Mon, program B on Tue. Each plan_day gets its
    // own attributed workout. completedSessions should be 2/4 (one per
    // program per day, NOT 4/4 because of date-only matching, NOT 2/2
    // because totalSessions still counts BOTH programs' plan_days).
    void aTue;
    await insertWorkout({
      date: "2099-12-21", sessionType: T_RUN, equipment: E_OUTDOOR, distanceMi: 5, planDayId: aMon.id,
    });
    await insertWorkout({
      date: "2099-12-22", sessionType: T_STRENGTH, equipment: E_GYM, totalLoad: 100, planDayId: bTue.id,
    });
    // Skipped workout against program B Mon — must NOT credit completion.
    await insertWorkout({
      date: "2099-12-21", sessionType: "Skipped", equipment: E_GYM, planDayId: bMon.id,
    });

    const list = await request(app).get("/api/plan/weeks");
    expect(list.status).toBe(200);
    const row = (list.body as Array<{
      week: number; completedSessions: number; totalSessions: number;
    }>).find((r) => r.week === week);
    expect(row).toBeDefined();
    expect(row!.totalSessions).toBe(4);   // 2 programs × 2 non-rest days
    expect(row!.completedSessions).toBe(2); // A-Mon + B-Tue, NOT both per date

    // Single-week endpoint mirrors the same per-program semantics.
    const detail = await request(app).get(`/api/plan/weeks/${week}`);
    expect(detail.status).toBe(200);
    expect(detail.body.totalSessions).toBe(4);
    expect(detail.body.completedSessions).toBe(2);
  });

  it("falls back to date-only completion for legacy workouts with planDayId IS NULL (task #143)", async () => {
    // A single-program week (no concurrent overlap) plus a workout that
    // pre-dates plan_day attribution must still earn completion credit
    // via the date-only fallback so existing history doesn't disappear
    // from the rolled-up adherence numbers.
    const week = 8951;
    const phase = "Legacy Workouts";
    await insertWeek(week, {
      startDate: "2099-12-28",
      endDate: "2100-01-03",
      phase,
      plannedMiles: 5,
    });
    await insertPlanDay(week, phase, {
      date: "2099-12-28", day: "Mon", sessionType: T_RUN, equipment: E_OUTDOOR, distanceMi: 5,
    });
    await insertWorkout({
      // planDayId omitted -> null, simulating a pre-attribution row.
      date: "2099-12-28", sessionType: T_RUN, equipment: E_OUTDOOR, distanceMi: 5,
    });

    const list = await request(app).get("/api/plan/weeks");
    const row = (list.body as Array<{
      week: number; completedSessions: number; totalSessions: number;
    }>).find((r) => r.week === week);
    expect(row).toBeDefined();
    expect(row!.totalSessions).toBe(1);
    expect(row!.completedSessions).toBe(1);

    const detail = await request(app).get(`/api/plan/weeks/${week}`);
    expect(detail.body.completedSessions).toBe(1);
  });

  it("surfaces wedSteady from plan_days.session_type so the calendar chip mirrors the generator (task #175)", async () => {
    // Three weeks: one with a Steady Wed (Marathon-Specific style), one
    // with the canonical easy "Run + Accessory" Wed (cutback / non-tail
    // weeks), and one with no Wed plan_day at all (empty / freshly
    // seeded). The /plan/weeks aggregation must surface true / false /
    // null respectively so the plan calendar chip lights up only on
    // the Steady weeks and stays dormant elsewhere — matching the
    // amber-400 Z3 swatch HR_ZONE_COLORS[3] uses for Run Target.
    const steadyWeek = 8401;
    const easyWeek = 8402;
    const emptyWeek = 8403;
    await insertWeek(steadyWeek, {
      startDate: "2099-10-12", endDate: "2099-10-18",
      phase: "Marathon-Specific", plannedMiles: 30, longRunMi: 18,
    });
    await insertPlanDay(steadyWeek, "Marathon-Specific", {
      date: "2099-10-14", day: "Wed",
      sessionType: "Steady Run + Accessory",
      equipment: "Peloton Tread", distanceMi: 5,
    });
    await insertWeek(easyWeek, {
      startDate: "2099-10-19", endDate: "2099-10-25",
      phase: "Marathon-Specific", plannedMiles: 22, longRunMi: 12,
    });
    await insertPlanDay(easyWeek, "Marathon-Specific", {
      date: "2099-10-21", day: "Wed",
      sessionType: "Run + Accessory",
      equipment: "Peloton Tread", distanceMi: 3,
    });
    await insertWeek(emptyWeek, {
      startDate: "2099-10-26", endDate: "2099-11-01",
      phase: "Marathon-Specific", plannedMiles: 0, longRunMi: 0,
    });

    const res = await request(app).get("/api/plan/weeks");
    expect(res.status).toBe(200);
    expectMatchesSchema(ListPlanWeeksResponse, res.body);
    const rows = res.body as Array<{ week: number; wedSteady: boolean | null }>;
    expect(rows.find((r) => r.week === steadyWeek)?.wedSteady).toBe(true);
    expect(rows.find((r) => r.week === easyWeek)?.wedSteady).toBe(false);
    expect(rows.find((r) => r.week === emptyWeek)?.wedSteady).toBeNull();

    // The single-week endpoint mirrors the same value so the Week
    // Detail page stays in sync with the calendar's chip — drift would
    // mean the chip shows on the strip but the drilldown disagrees.
    const detailSteady = await request(app).get(`/api/plan/weeks/${steadyWeek}`);
    expect(detailSteady.body.wedSteady).toBe(true);
    const detailEasy = await request(app).get(`/api/plan/weeks/${easyWeek}`);
    expect(detailEasy.body.wedSteady).toBe(false);
    const detailEmpty = await request(app).get(`/api/plan/weeks/${emptyWeek}`);
    expect(detailEmpty.body.wedSteady).toBeNull();
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
