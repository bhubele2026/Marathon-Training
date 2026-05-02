import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import {
  ErrorResponse,
  GetPlanWeekResponse,
  GetTodayPlanResponse,
} from "@workspace/api-zod";
import app from "../app";
import {
  TEST_WEEK_MAX,
  T_RUN,
  T_BIKE,
  T_STRENGTH,
  T_REST,
  T_LONG_RUN,
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
    expectMatchesSchema(ErrorResponse, res.body);
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
    expect(res.body.loggedWorkouts).toEqual([]);
  });

  it("returns every workout logged for today, ordered by createdAt ascending", async () => {
    const today = "2099-06-03";
    vi.useFakeTimers();
    vi.setSystemTime(new Date(`${today}T12:00:00.000Z`));

    const week = 8012;
    const phase = "Today Double";
    await insertWeek(week, { startDate: today, endDate: today, phase });
    await insertPlanDay(week, phase, {
      date: today,
      day: "Tue",
      sessionType: T_RUN,
      equipment: E_OUTDOOR,
    });

    const first = await insertWorkout({
      date: today,
      sessionType: T_STRENGTH,
      equipment: E_GYM,
      durationMin: 30,
      notes: "AM strength",
    });
    const second = await insertWorkout({
      date: today,
      sessionType: T_RUN,
      equipment: E_OUTDOOR,
      durationMin: 45,
      distanceMi: 5,
      notes: "PM run",
    });

    const res = await request(app).get("/api/plan/today");
    expect(res.status).toBe(200);
    expectMatchesSchema(GetTodayPlanResponse, res.body);
    expect(res.body.loggedWorkouts).toHaveLength(2);
    // Postgres NOW() is independent of vi.useFakeTimers, and two sequential
    // awaited inserts produce monotonically increasing created_at values.
    const ids = res.body.loggedWorkouts.map((w: { id: number }) => w.id);
    expect(ids).toEqual([first.id, second.id]);
  });
});

describe("PATCH /api/plan/days/:id", () => {
  it("returns 404 when the plan day does not exist", async () => {
    const res = await request(app)
      .patch("/api/plan/days/999999999")
      .send({ sessionType: T_RUN, equipment: E_OUTDOOR, description: "x", totalLoad: 10, isRest: false });
    expect(res.status).toBe(404);
  });

  it("returns 400 when the body is invalid", async () => {
    const week = 8100;
    const phase = "Edit Validation";
    await insertWeek(week, { startDate: "2099-04-01", endDate: "2099-04-07", phase });
    const { id } = await insertPlanDay(week, phase, {
      date: "2099-04-01", day: "Mon", sessionType: T_RUN, equipment: E_OUTDOOR, distanceMi: 5, totalLoad: 50,
    });
    const res = await request(app).patch(`/api/plan/days/${id}`).send({ totalLoad: "not-a-number" });
    expect(res.status).toBe(400);
  });

  it("updates fields and recomputes the week's planned aggregates", async () => {
    const week = 8101;
    const phase = "Edit Recompute";
    await insertWeek(week, { startDate: "2099-04-08", endDate: "2099-04-14", phase, plannedMiles: 8, longRunMi: 5, plannedTotalLoad: 80 });
    const { id: monId } = await insertPlanDay(week, phase, {
      date: "2099-04-08", day: "Mon", sessionType: T_RUN, equipment: E_OUTDOOR, distanceMi: 3, cardioMin: 30, totalLoad: 30, strengthLoad: 0,
    });
    await insertPlanDay(week, phase, {
      date: "2099-04-09", day: "Tue", sessionType: T_RUN, equipment: E_OUTDOOR, distanceMi: 5, cardioMin: 50, totalLoad: 50, strengthLoad: 0,
    });

    const res = await request(app)
      .patch(`/api/plan/days/${monId}`)
      .send({
        sessionType: T_RUN, equipment: E_OUTDOOR, description: "harder",
        distanceMi: 7, cardioMin: 70, pace: "8:00", strengthLoad: 0, totalLoad: 70, isRest: false,
      });
    expect(res.status).toBe(200);
    expect(res.body.distanceMi).toBe(7);
    expect(res.body.totalLoad).toBe(70);
    expect(res.body.description).toBe("harder");

    const weekRes = await request(app).get(`/api/plan/weeks/${week}`);
    expect(weekRes.status).toBe(200);
    expect(weekRes.body.plannedMiles).toBe(12);     // 7 + 5
    expect(weekRes.body.plannedTotalLoad).toBe(120); // 70 + 50
    expect(weekRes.body.longRunMi).toBe(7);          // max(7, 5)
    expect(weekRes.body.plannedCardio).toBe(120);    // 70 + 50
  });

  it("snapshots the seeded prescription on first edit so reset can restore it", async () => {
    const week = 8102;
    const phase = "Snapshot On Edit";
    await insertWeek(week, { startDate: "2099-04-15", endDate: "2099-04-21", phase });
    const { id } = await insertPlanDay(week, phase, {
      date: "2099-04-15", day: "Mon", sessionType: T_RUN, equipment: E_OUTDOOR, description: "original", distanceMi: 4, totalLoad: 40,
    });

    // Edit the day twice, the snapshot must come from the *original* values.
    await request(app).patch(`/api/plan/days/${id}`).send({
      sessionType: T_BIKE, equipment: E_SPIN, description: "first edit", distanceMi: 0, cardioMin: 30, totalLoad: 25, isRest: false,
    });
    await request(app).patch(`/api/plan/days/${id}`).send({
      sessionType: T_STRENGTH, equipment: E_GYM, description: "second edit", distanceMi: null, cardioMin: null, strengthLoad: 100, totalLoad: 100, isRest: false,
    });

    const reset = await request(app).post(`/api/plan/days/${id}/reset`).send({});
    expect(reset.status).toBe(200);
    expect(reset.body.sessionType).toBe(T_RUN);
    expect(reset.body.equipment).toBe(E_OUTDOOR);
    expect(reset.body.description).toBe("original");
    expect(reset.body.distanceMi).toBe(4);
    expect(reset.body.totalLoad).toBe(40);
  });
});

describe("POST /api/plan/days/:id/swap", () => {
  it("returns 400 when swapping a day with itself", async () => {
    const week = 8200;
    const phase = "Swap Self";
    await insertWeek(week, { startDate: "2099-05-01", endDate: "2099-05-07", phase });
    const { id } = await insertPlanDay(week, phase, {
      date: "2099-05-01", day: "Mon", sessionType: T_RUN, equipment: E_OUTDOOR, distanceMi: 3, totalLoad: 30,
    });
    const res = await request(app).post(`/api/plan/days/${id}/swap`).send({ withDayId: id });
    expect(res.status).toBe(400);
  });

  it("trades sessions across weeks while preserving date / day / week / phase", async () => {
    const phase = "Swap Cross Week";
    await insertWeek(8201, { startDate: "2099-05-08", endDate: "2099-05-14", phase });
    await insertWeek(8202, { startDate: "2099-05-15", endDate: "2099-05-21", phase });
    const a = await insertPlanDay(8201, phase, {
      date: "2099-05-08", day: "Mon", sessionType: T_RUN, equipment: E_OUTDOOR, description: "wk1 mon run", distanceMi: 3, cardioMin: 30, totalLoad: 30,
    });
    const b = await insertPlanDay(8202, phase, {
      date: "2099-05-15", day: "Mon", sessionType: T_STRENGTH, equipment: E_GYM, description: "wk2 mon lift", strengthLoad: 100, totalLoad: 100,
    });
    const res = await request(app).post(`/api/plan/days/${a.id}/swap`).send({ withDayId: b.id });
    expect(res.status).toBe(200);

    // Calendar slots and week assignments stay put; only the prescription
    // content trades places.
    expect(res.body.from.date).toBe("2099-05-08");
    expect(res.body.from.week).toBe(8201);
    expect(res.body.from.sessionType).toBe(T_STRENGTH);
    expect(res.body.from.description).toBe("wk2 mon lift");
    expect(res.body.to.date).toBe("2099-05-15");
    expect(res.body.to.week).toBe(8202);
    expect(res.body.to.sessionType).toBe(T_RUN);
    expect(res.body.to.description).toBe("wk1 mon run");

    expect(res.body.weeksAffected).toEqual(expect.arrayContaining([8201, 8202]));
    expect(res.body.weeksAffected).toHaveLength(2);
    expect(res.body.phaseChanged).toBe(false);
  });

  it("recomputes plannedMiles / plannedTotalLoad / longRunMi for both weeks atomically", async () => {
    const phase = "Swap Cross Totals";
    await insertWeek(8210, { startDate: "2099-06-05", endDate: "2099-06-11", phase });
    await insertWeek(8211, { startDate: "2099-06-12", endDate: "2099-06-18", phase });
    // Week 8210 has a single 4-mile easy run.
    const a = await insertPlanDay(8210, phase, {
      date: "2099-06-05", day: "Mon", sessionType: T_RUN, equipment: E_OUTDOOR, distanceMi: 4, cardioMin: 40, totalLoad: 40,
    });
    // Week 8211 has a single 12-mile long run.
    const b = await insertPlanDay(8211, phase, {
      date: "2099-06-12", day: "Mon", sessionType: T_LONG_RUN, equipment: E_OUTDOOR, distanceMi: 12, cardioMin: 120, totalLoad: 120,
    });

    // Prime each week's aggregates via no-op edits so the "before" snapshot
    // reflects the actual day rows rather than the zero values insertWeek
    // wrote without running through the recomputation path.
    await request(app).patch(`/api/plan/days/${a.id}`).send({
      sessionType: T_RUN, equipment: E_OUTDOOR, description: "",
      distanceMi: 4, cardioMin: 40, pace: null, strengthLoad: 0, totalLoad: 40, isRest: false,
    });
    await request(app).patch(`/api/plan/days/${b.id}`).send({
      sessionType: T_LONG_RUN, equipment: E_OUTDOOR, description: "",
      distanceMi: 12, cardioMin: 120, pace: null, strengthLoad: 0, totalLoad: 120, isRest: false,
    });

    const before10 = await request(app).get(`/api/plan/weeks/8210`);
    const before11 = await request(app).get(`/api/plan/weeks/8211`);
    expect(before10.body.plannedMiles).toBe(4);
    expect(before10.body.longRunMi).toBe(4);
    expect(before10.body.plannedTotalLoad).toBe(40);
    expect(before11.body.plannedMiles).toBe(12);
    expect(before11.body.longRunMi).toBe(12);
    expect(before11.body.plannedTotalLoad).toBe(120);

    const swap = await request(app).post(`/api/plan/days/${a.id}/swap`).send({ withDayId: b.id });
    expect(swap.status).toBe(200);

    // After the swap, the long run lives in week 8210 and the easy run lives
    // in week 8211 -- both weeks' aggregates should have been recomputed.
    const after10 = await request(app).get(`/api/plan/weeks/8210`);
    const after11 = await request(app).get(`/api/plan/weeks/8211`);
    expect(after10.body.plannedMiles).toBe(12);
    expect(after10.body.longRunMi).toBe(12);
    expect(after10.body.plannedTotalLoad).toBe(120);
    expect(after11.body.plannedMiles).toBe(4);
    expect(after11.body.longRunMi).toBe(4);
    expect(after11.body.plannedTotalLoad).toBe(40);
  });

  it("flags phaseChanged when the partner day is in a different phase", async () => {
    await insertWeek(8220, { startDate: "2099-07-03", endDate: "2099-07-09", phase: "Foundation Build" });
    await insertWeek(8221, { startDate: "2099-07-10", endDate: "2099-07-16", phase: "Race-Specific" });
    const a = await insertPlanDay(8220, "Foundation Build", {
      date: "2099-07-03", day: "Fri", sessionType: T_RUN, equipment: E_OUTDOOR, distanceMi: 3, totalLoad: 30,
    });
    const b = await insertPlanDay(8221, "Race-Specific", {
      date: "2099-07-10", day: "Fri", sessionType: T_RUN, equipment: E_OUTDOOR, distanceMi: 8, totalLoad: 80,
    });
    const res = await request(app).post(`/api/plan/days/${a.id}/swap`).send({ withDayId: b.id });
    expect(res.status).toBe(200);
    expect(res.body.phaseChanged).toBe(true);
    // The phase column itself is anchored to the calendar slot, not the
    // prescription, so the phase metadata stays put even though the work
    // moved.
    expect(res.body.from.phase).toBe("Foundation Build");
    expect(res.body.to.phase).toBe("Race-Specific");
  });

  it("trades session content while preserving date / day / week / phase", async () => {
    const week = 8203;
    const phase = "Swap Trade";
    await insertWeek(week, { startDate: "2099-05-22", endDate: "2099-05-28", phase });
    const a = await insertPlanDay(week, phase, {
      date: "2099-05-22", day: "Mon", sessionType: T_RUN, equipment: E_OUTDOOR, description: "monday run", distanceMi: 3, cardioMin: 30, totalLoad: 30,
    });
    const b = await insertPlanDay(week, phase, {
      date: "2099-05-24", day: "Wed", sessionType: T_STRENGTH, equipment: E_GYM, description: "wednesday lift", strengthLoad: 100, totalLoad: 100,
    });

    const res = await request(app).post(`/api/plan/days/${a.id}/swap`).send({ withDayId: b.id });
    expect(res.status).toBe(200);

    // a now hosts the strength session, b now hosts the run; calendar slots stay put.
    expect(res.body.from.date).toBe("2099-05-22");
    expect(res.body.from.day).toBe("Mon");
    expect(res.body.from.sessionType).toBe(T_STRENGTH);
    expect(res.body.from.equipment).toBe(E_GYM);
    expect(res.body.from.description).toBe("wednesday lift");

    expect(res.body.to.date).toBe("2099-05-24");
    expect(res.body.to.day).toBe("Wed");
    expect(res.body.to.sessionType).toBe(T_RUN);
    expect(res.body.to.equipment).toBe(E_OUTDOOR);
    expect(res.body.to.description).toBe("monday run");
  });

  it("keeps the week's planned totals stable when swapping within the same week", async () => {
    const week = 8204;
    const phase = "Swap Totals";
    await insertWeek(week, { startDate: "2099-05-29", endDate: "2099-06-04", phase });
    const a = await insertPlanDay(week, phase, {
      date: "2099-05-29", day: "Mon", sessionType: T_RUN, equipment: E_OUTDOOR, distanceMi: 4, cardioMin: 40, totalLoad: 40,
    });
    const b = await insertPlanDay(week, phase, {
      date: "2099-05-31", day: "Wed", sessionType: T_STRENGTH, equipment: E_GYM, strengthLoad: 80, totalLoad: 80,
    });

    // Force an initial recompute via a no-op edit so the "before" snapshot
    // reflects the actual day rows rather than the zero values insertWeek
    // wrote without running through the recomputation path.
    await request(app).patch(`/api/plan/days/${a.id}`).send({
      sessionType: T_RUN, equipment: E_OUTDOOR, description: "",
      distanceMi: 4, cardioMin: 40, pace: null, strengthLoad: 0, totalLoad: 40, isRest: false,
    });

    const before = await request(app).get(`/api/plan/weeks/${week}`);
    expect(before.status).toBe(200);
    expect(before.body.plannedMiles).toBe(4);
    expect(before.body.plannedTotalLoad).toBe(120);
    expect(before.body.longRunMi).toBe(4);

    const swap = await request(app).post(`/api/plan/days/${a.id}/swap`).send({ withDayId: b.id });
    expect(swap.status).toBe(200);

    const after = await request(app).get(`/api/plan/weeks/${week}`);
    expect(after.status).toBe(200);
    expect(after.body.plannedMiles).toBe(before.body.plannedMiles);
    expect(after.body.plannedTotalLoad).toBe(before.body.plannedTotalLoad);
    expect(after.body.longRunMi).toBe(before.body.longRunMi);
  });
});

describe("PlanDay.isCustomized indicator", () => {
  it("is false on a freshly seeded day with no edits or swaps", async () => {
    const week = 8400;
    const phase = "Customized Fresh";
    await insertWeek(week, { startDate: "2099-08-01", endDate: "2099-08-07", phase });
    await insertPlanDay(week, phase, {
      date: "2099-08-01", day: "Mon", sessionType: T_RUN, equipment: E_OUTDOOR, distanceMi: 5, totalLoad: 50,
    });

    const res = await request(app).get(`/api/plan/weeks/${week}`);
    expect(res.status).toBe(200);
    expectMatchesSchema(GetPlanWeekResponse, res.body);
    const day = res.body.days[0];
    expect(day.isCustomized).toBe(false);
    expect(day.customizedFields).toEqual([]);
  });

  it("flips to true with the changed field names after an edit, and resets back", async () => {
    const week = 8401;
    const phase = "Customized Edit";
    await insertWeek(week, { startDate: "2099-08-08", endDate: "2099-08-14", phase });
    const { id } = await insertPlanDay(week, phase, {
      date: "2099-08-08", day: "Mon", sessionType: T_RUN, equipment: E_OUTDOOR, description: "easy", distanceMi: 4, totalLoad: 40,
    });

    const edit = await request(app).patch(`/api/plan/days/${id}`).send({
      sessionType: T_RUN, equipment: E_OUTDOOR, description: "harder",
      distanceMi: 7, cardioMin: null, pace: null, strengthLoad: null, totalLoad: 70, isRest: false,
    });
    expect(edit.status).toBe(200);
    expect(edit.body.isCustomized).toBe(true);
    expect(new Set(edit.body.customizedFields)).toEqual(
      new Set(["description", "distanceMi", "totalLoad"]),
    );

    const reset = await request(app).post(`/api/plan/days/${id}/reset`).send({});
    expect(reset.status).toBe(200);
    expect(reset.body.isCustomized).toBe(false);
    expect(reset.body.customizedFields).toEqual([]);
  });

  it("marks both partners as customized after a swap", async () => {
    const week = 8402;
    const phase = "Customized Swap";
    await insertWeek(week, { startDate: "2099-08-15", endDate: "2099-08-21", phase });
    const a = await insertPlanDay(week, phase, {
      date: "2099-08-15", day: "Mon", sessionType: T_RUN, equipment: E_OUTDOOR, description: "monday run", distanceMi: 3, cardioMin: 30, totalLoad: 30,
    });
    const b = await insertPlanDay(week, phase, {
      date: "2099-08-17", day: "Wed", sessionType: T_STRENGTH, equipment: E_GYM, description: "wednesday lift", strengthLoad: 100, totalLoad: 100,
    });

    const swap = await request(app).post(`/api/plan/days/${a.id}/swap`).send({ withDayId: b.id });
    expect(swap.status).toBe(200);
    expect(swap.body.from.isCustomized).toBe(true);
    expect(swap.body.to.isCustomized).toBe(true);
    expect(swap.body.from.customizedFields.length).toBeGreaterThan(0);
    expect(swap.body.to.customizedFields.length).toBeGreaterThan(0);
  });
});

describe("POST /api/plan/days/:id/reset", () => {
  it("returns 404 when the plan day does not exist", async () => {
    const res = await request(app).post("/api/plan/days/999999999/reset").send({});
    expect(res.status).toBe(404);
  });

  it("is a no-op when the day has never been edited", async () => {
    const week = 8300;
    const phase = "Reset Untouched";
    await insertWeek(week, { startDate: "2099-07-01", endDate: "2099-07-07", phase });
    const { id } = await insertPlanDay(week, phase, {
      date: "2099-07-01", day: "Mon", sessionType: T_RUN, equipment: E_OUTDOOR, description: "fresh", distanceMi: 5, totalLoad: 50,
    });
    const res = await request(app).post(`/api/plan/days/${id}/reset`).send({});
    expect(res.status).toBe(200);
    expect(res.body.sessionType).toBe(T_RUN);
    expect(res.body.equipment).toBe(E_OUTDOOR);
    expect(res.body.distanceMi).toBe(5);
    expect(res.body.totalLoad).toBe(50);
  });

  it("restores week aggregates after edit + reset", async () => {
    const week = 8301;
    const phase = "Reset Aggregates";
    await insertWeek(week, { startDate: "2099-07-08", endDate: "2099-07-14", phase });
    const { id } = await insertPlanDay(week, phase, {
      date: "2099-07-08", day: "Mon", sessionType: T_RUN, equipment: E_OUTDOOR, distanceMi: 5, cardioMin: 50, totalLoad: 50,
    });

    await request(app).patch(`/api/plan/days/${id}`).send({
      sessionType: T_RUN, equipment: E_OUTDOOR, description: "harder",
      distanceMi: 12, cardioMin: 120, totalLoad: 200, isRest: false,
    });
    const edited = await request(app).get(`/api/plan/weeks/${week}`);
    expect(edited.body.plannedMiles).toBe(12);
    expect(edited.body.plannedTotalLoad).toBe(200);

    const reset = await request(app).post(`/api/plan/days/${id}/reset`).send({});
    expect(reset.status).toBe(200);
    expect(reset.body.distanceMi).toBe(5);
    expect(reset.body.totalLoad).toBe(50);

    const after = await request(app).get(`/api/plan/weeks/${week}`);
    expect(after.body.plannedMiles).toBe(5);
    expect(after.body.plannedTotalLoad).toBe(50);
    expect(after.body.longRunMi).toBe(5);
  });
});
