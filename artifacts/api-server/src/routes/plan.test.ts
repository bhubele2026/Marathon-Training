import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { GetPlanWeekResponse, GetTodayPlanResponse } from "@workspace/api-zod";
import app from "../app";
import {
  TEST_WEEK_MAX,
  T_RUN,
  T_BIKE,
  T_STRENGTH,
  T_REST,
  E_OUTDOOR,
  E_TREADMILL,
  E_SPIN,
  E_GYM,
  E_NONE,
  cleanTestData,
  expectMatchesSchema,
  insertWeek,
  insertPlanDay,
  insertWorkout,
} from "../test-helpers";

beforeEach(async () => {
  await cleanTestData();
});

afterEach(async () => {
  await cleanTestData();
  vi.useRealTimers();
});

describe("GET /api/plan/weeks/:week", () => {
  it("returns 404 when the week does not exist", async () => {
    const res = await request(app).get(`/api/plan/weeks/${TEST_WEEK_MAX}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "week not found" });
  });

  it("returns suggestions with sampleSize 0 when there is no historical data", async () => {
    const week = 8001;
    const phase = "Empty History";
    await insertWeek(week, {
      startDate: "2099-01-05",
      endDate: "2099-01-11",
      phase,
    });
    // Day with planned pace, no history -> paceSource = "plan".
    await insertPlanDay(week, phase, {
      date: "2099-01-05",
      day: "Mon",
      sessionType: T_RUN,
      equipment: E_OUTDOOR,
      pace: "9:00",
    });
    // Day without planned pace, no history -> paceSource = null.
    await insertPlanDay(week, phase, {
      date: "2099-01-06",
      day: "Tue",
      sessionType: T_STRENGTH,
      equipment: E_GYM,
    });
    // Rest day -> suggestions = null.
    await insertPlanDay(week, phase, {
      date: "2099-01-07",
      day: "Wed",
      sessionType: T_REST,
      equipment: E_NONE,
      isRest: true,
    });

    const res = await request(app).get(`/api/plan/weeks/${week}`);
    expect(res.status).toBe(200);
    expectMatchesSchema(GetPlanWeekResponse, res.body);
    expect(res.body.week).toBe(week);
    expect(res.body.totalSessions).toBe(2);

    const days = res.body.days as Array<{
      date: string;
      isRest: boolean;
      suggestions:
        | null
        | { rpe: number | null; avgHr: number | null; pace: string | null; paceSource: "plan" | "history" | null; sampleSize: number };
    }>;
    expect(days).toHaveLength(3);

    const mon = days.find((d) => d.date === "2099-01-05")!;
    expect(mon.suggestions).toEqual({
      rpe: null,
      avgHr: null,
      pace: "9:00",
      paceSource: "plan",
      sampleSize: 0,
    });

    const tue = days.find((d) => d.date === "2099-01-06")!;
    expect(tue.suggestions).toEqual({
      rpe: null,
      avgHr: null,
      pace: null,
      paceSource: null,
      sampleSize: 0,
    });

    const wed = days.find((d) => d.date === "2099-01-07")!;
    expect(wed.isRest).toBe(true);
    expect(wed.suggestions).toBeNull();
  });

  it("averages prior comparable workouts when fewer than 5 exist, and prefers planned pace over history", async () => {
    // Mock "today" to a date inside the planned week so the historical
    // workouts inserted below (which are dated in 2099) are eligible to be
    // matched by the suggestions query (which filters w.date < today).
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2099-02-15T12:00:00.000Z"));

    const week = 8002;
    const phase = "Partial History";
    await insertWeek(week, {
      startDate: "2099-02-15",
      endDate: "2099-02-21",
      phase,
    });

    // 3 prior (run, outdoor) workouts.
    await insertWorkout({ date: "2099-02-01", sessionType: T_RUN, equipment: E_OUTDOOR, rpe: 6, avgHr: 140, pace: "10:00" });
    await insertWorkout({ date: "2099-02-02", sessionType: T_RUN, equipment: E_OUTDOOR, rpe: 7, avgHr: 150, pace: "9:30" });
    await insertWorkout({ date: "2099-02-03", sessionType: T_RUN, equipment: E_OUTDOOR, rpe: 8, avgHr: 160, pace: "9:00" });

    // Day 1: run/outdoor with no planned pace -> paceSource = "history".
    await insertPlanDay(week, phase, {
      date: "2099-02-15",
      day: "Mon",
      sessionType: T_RUN,
      equipment: E_OUTDOOR,
    });
    // Day 2: run/outdoor with planned pace -> paceSource = "plan" but rpe/hr still derived from history.
    await insertPlanDay(week, phase, {
      date: "2099-02-16",
      day: "Tue",
      sessionType: T_RUN,
      equipment: E_OUTDOOR,
      pace: "8:30",
    });
    // Day 3: bike/spin with planned pace, no history -> sampleSize 0, plan pace.
    await insertPlanDay(week, phase, {
      date: "2099-02-17",
      day: "Wed",
      sessionType: T_BIKE,
      equipment: E_SPIN,
      pace: "2:00",
    });

    const res = await request(app).get(`/api/plan/weeks/${week}`);
    expect(res.status).toBe(200);
    expectMatchesSchema(GetPlanWeekResponse, res.body);

    const days = res.body.days as Array<{ date: string; suggestions: { rpe: number | null; avgHr: number | null; pace: string | null; paceSource: string | null; sampleSize: number } | null }>;

    const mon = days.find((d) => d.date === "2099-02-15")!;
    expect(mon.suggestions).toEqual({
      rpe: 7, // (6+7+8)/3
      avgHr: 150, // (140+150+160)/3
      pace: "9:30", // (600+570+540)/3 = 570s
      paceSource: "history",
      sampleSize: 3,
    });

    const tue = days.find((d) => d.date === "2099-02-16")!;
    expect(tue.suggestions).toEqual({
      rpe: 7,
      avgHr: 150,
      pace: "8:30", // planned wins over the historical 9:30
      paceSource: "plan",
      sampleSize: 3,
    });

    const wed = days.find((d) => d.date === "2099-02-17")!;
    expect(wed.suggestions).toEqual({
      rpe: null,
      avgHr: null,
      pace: "2:00",
      paceSource: "plan",
      sampleSize: 0,
    });
  });

  it("caps history at the 5 most-recent workouts and shares the lookup across days with the same pair", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2099-03-01T12:00:00.000Z"));

    const week = 8003;
    const phase = "Shared Pair";
    await insertWeek(week, {
      startDate: "2099-03-01",
      endDate: "2099-03-07",
      phase,
    });

    // 7 prior (run, treadmill) workouts; only the most recent 5 should count.
    const seed: Array<[string, number, number, string]> = [
      ["2099-01-01", 3, 120, "9:00"], // dropped (oldest)
      ["2099-01-02", 4, 130, "9:05"], // dropped (oldest)
      ["2099-01-03", 5, 140, "9:10"],
      ["2099-01-04", 6, 150, "9:15"],
      ["2099-01-05", 7, 160, "9:20"],
      ["2099-01-06", 8, 170, "9:25"],
      ["2099-01-07", 9, 180, "9:30"],
    ];
    for (const [date, rpe, hr, pace] of seed) {
      await insertWorkout({ date, sessionType: T_RUN, equipment: E_TREADMILL, rpe, avgHr: hr, pace });
    }

    // Two non-rest days that share (run, treadmill) plus a different pair.
    await insertPlanDay(week, phase, {
      date: "2099-03-01",
      day: "Mon",
      sessionType: T_RUN,
      equipment: E_TREADMILL,
    });
    await insertPlanDay(week, phase, {
      date: "2099-03-02",
      day: "Tue",
      sessionType: T_RUN,
      equipment: E_TREADMILL,
    });
    await insertPlanDay(week, phase, {
      date: "2099-03-03",
      day: "Wed",
      sessionType: T_STRENGTH,
      equipment: E_GYM,
    });

    const res = await request(app).get(`/api/plan/weeks/${week}`);
    expect(res.status).toBe(200);
    expectMatchesSchema(GetPlanWeekResponse, res.body);

    const days = res.body.days as Array<{ date: string; suggestions: { rpe: number | null; avgHr: number | null; pace: string | null; paceSource: string | null; sampleSize: number } }>;

    // top-5 rpe = (5+6+7+8+9)/5 = 7
    // top-5 hr  = (140+150+160+170+180)/5 = 160
    // top-5 pace seconds = (550+555+560+565+570)/5 = 560 -> "9:20"
    const expectedSharedPair = {
      rpe: 7,
      avgHr: 160,
      pace: "9:20",
      paceSource: "history",
      sampleSize: 5,
    };

    const mon = days.find((d) => d.date === "2099-03-01")!;
    const tue = days.find((d) => d.date === "2099-03-02")!;
    expect(mon.suggestions).toEqual(expectedSharedPair);
    expect(tue.suggestions).toEqual(expectedSharedPair);

    const wed = days.find((d) => d.date === "2099-03-03")!;
    expect(wed.suggestions).toEqual({
      rpe: null,
      avgHr: null,
      pace: null,
      paceSource: null,
      sampleSize: 0,
    });
  });
});

describe("GET /api/plan/today", () => {
  it("returns null suggestions on a rest day", async () => {
    const today = "2099-06-01";
    vi.useFakeTimers();
    vi.setSystemTime(new Date(`${today}T12:00:00.000Z`));

    const week = 8010;
    const phase = "Today Rest";
    await insertWeek(week, { startDate: today, endDate: today, phase });
    await insertPlanDay(week, phase, {
      date: today,
      day: "Sun",
      sessionType: T_REST,
      equipment: E_NONE,
      isRest: true,
    });

    const res = await request(app).get("/api/plan/today");
    expect(res.status).toBe(200);
    expectMatchesSchema(GetTodayPlanResponse, res.body);
    expect(res.body.date).toBe(today);
    expect(res.body.hasPlan).toBe(true);
    expect(res.body.plan).not.toBeNull();
    expect(res.body.plan.isRest).toBe(true);
    expect(res.body.suggestions).toBeNull();
  });

  it("returns suggestions derived from prior comparable workouts on a non-rest day", async () => {
    const today = "2099-06-02";
    vi.useFakeTimers();
    vi.setSystemTime(new Date(`${today}T12:00:00.000Z`));

    const week = 8011;
    const phase = "Today Active";
    await insertWeek(week, { startDate: today, endDate: today, phase });
    await insertPlanDay(week, phase, {
      date: today,
      day: "Mon",
      sessionType: T_RUN,
      equipment: E_OUTDOOR,
    });

    await insertWorkout({ date: "2099-05-30", sessionType: T_RUN, equipment: E_OUTDOOR, rpe: 6, avgHr: 140, pace: "10:00" });
    await insertWorkout({ date: "2099-05-31", sessionType: T_RUN, equipment: E_OUTDOOR, rpe: 8, avgHr: 160, pace: "9:00" });

    const res = await request(app).get("/api/plan/today");
    expect(res.status).toBe(200);
    expectMatchesSchema(GetTodayPlanResponse, res.body);
    expect(res.body.date).toBe(today);
    expect(res.body.hasPlan).toBe(true);
    expect(res.body.plan.isRest).toBe(false);
    expect(res.body.suggestions).toEqual({
      rpe: 7,
      avgHr: 150,
      pace: "9:30", // (600+540)/2 = 570s
      paceSource: "history",
      sampleSize: 2,
    });
    expect(res.body.loggedWorkout).toBeNull();
  });
});
