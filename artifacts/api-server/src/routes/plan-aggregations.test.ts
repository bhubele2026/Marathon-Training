import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import {
  GetPlanOverviewResponse,
  ListPlanWeeksResponse,
} from "@workspace/api-zod";
import { RACE_DAY_SPECS } from "@workspace/plan-generator";
import app from "../app";
import { sql } from "drizzle-orm";
import { db, plannerConfigsTable, planDaysTable, planWeeksTable } from "@workspace/db";
import {
  MARATHON_TAIL_WEEKS,
  PLAN_START_ISO,
  RACE_DATE_ISO,
  TOTAL_WEEKS,
} from "@workspace/plan-generator";
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
  T_LONG_RUN,
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

  // Task #204: server-side detection of the campaign's race kind from
  // the trailing plan_day Sunday so the /plan header on the client can
  // switch to "Race Campaign · Weeks to Race Day" framing for half /
  // 10K / 5K plans, not just marathons. The four cases below pin the
  // happy path for each canonical race kind plus the negative cases
  // (no plan days at all, and a non-race trailing Sunday) so the
  // header doesn't presuppose a race on a tonal-first / lift-only
  // block. Description-prefix resolution is exercised directly so a
  // runner who edits distance_mi away from the canonical value still
  // gets the right kind.
  it.each([
    {
      // Pull each race-day prose from the same `RACE_DAY_SPECS[kind]`
      // table the canonical generator emits, so a future tweak to the
      // copy can't silently desync this fixture (mirrors the
      // drift-proofing in race-week.test.ts / backfill-plan-day-equipment.test.ts).
      kind: "5k",
      distanceMi: RACE_DAY_SPECS["5k"].distanceMi,
      description: RACE_DAY_SPECS["5k"].description,
    },
    {
      kind: "10k",
      distanceMi: RACE_DAY_SPECS["10k"].distanceMi,
      description: RACE_DAY_SPECS["10k"].description,
    },
    {
      kind: "half",
      distanceMi: RACE_DAY_SPECS.half.distanceMi,
      description: RACE_DAY_SPECS.half.description,
    },
    {
      kind: "marathon",
      distanceMi: RACE_DAY_SPECS.marathon.distanceMi,
      description: RACE_DAY_SPECS.marathon.description,
    },
  ])(
    "reports raceKind=$kind when the trailing plan_day is the matching race row",
    async ({ kind, distanceMi, description }) => {
      const week = 8410;
      const phase = "Race Tail";
      await insertWeek(week, {
        startDate: "2099-10-04",
        endDate: "2099-10-10",
        phase,
      });
      // A non-race lead-in day on Saturday plus the race-day Sunday
      // sharing the week. The query orders by date DESC so the
      // Sunday wins regardless of insertion order.
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

      const res = await request(app).get("/api/plan/overview");
      expect(res.status).toBe(200);
      expectMatchesSchema(GetPlanOverviewResponse, res.body);
      expect(res.body.raceKind).toBe(kind);
    },
  );

  it("returns raceKind=null when the trailing plan_day is a non-race row at a canonical race distance", async () => {
    // A 13.1 mi long run on Sunday must NOT be classified as a half
    // marathon race day from distance alone. Without an explicit
    // race signal (sessionType === "Race" or the "RACE DAY — "
    // description prefix) the row is just a long run, and the
    // header should keep the generic "Workout Plan" framing.
    const week = 8420;
    const phase = "Long Run Tail";
    await insertWeek(week, {
      startDate: "2099-11-01",
      endDate: "2099-11-07",
      phase,
    });
    await insertPlanDay(week, phase, {
      date: "2099-11-07",
      day: "Sun",
      sessionType: T_LONG_RUN,
      equipment: E_OUTDOOR,
      distanceMi: 13.1,
      description: "Long run, easy effort.",
    });
    const res = await request(app).get("/api/plan/overview");
    expect(res.status).toBe(200);
    expectMatchesSchema(GetPlanOverviewResponse, res.body);
    expect(res.body.raceKind).toBeNull();
  });

  it("resolves raceKind from the description prefix when distance_mi was edited away from the canonical value", async () => {
    // A runner editing the Sunday distance_mi (e.g. nudging it to a
    // measured 5.05 mi 5K course) must not lose the race-campaign
    // framing — the description prefix takes precedence over the
    // distance fallback.
    const week = 8430;
    const phase = "5K Tail";
    await insertWeek(week, {
      startDate: "2099-12-06",
      endDate: "2099-12-12",
      phase,
    });
    await insertPlanDay(week, phase, {
      date: "2099-12-12",
      day: "Sun",
      sessionType: "Race",
      equipment: E_OUTDOOR,
      // Non-canonical distance after a runner edit; description
      // still carries the generator's "RACE DAY — 5K" prefix.
      distanceMi: 5.05,
      description: RACE_DAY_SPECS["5k"].description,
    });
    const res = await request(app).get("/api/plan/overview");
    expect(res.status).toBe(200);
    expectMatchesSchema(GetPlanOverviewResponse, res.body);
    expect(res.body.raceKind).toBe("5k");
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
    const monDay = await insertPlanDay(week, phase, {
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
    const wedDay = await insertPlanDay(week, phase, {
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
    // not be counted in actualMiles or completedSessions). Each in-range
    // workout carries its real plan_day_id — Task #295 retired the
    // date-only fallback, so completion credit requires attribution.
    await insertWorkout({ date: "2099-09-07", sessionType: T_RUN, equipment: E_OUTDOOR, distanceMi: 5, planDayId: monDay.id });
    await insertWorkout({ date: "2099-09-09", sessionType: T_RUN, equipment: E_OUTDOOR, distanceMi: 8, planDayId: wedDay.id });
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

  it("attributes per-program completion ratios on each weekly summary (task #162)", async () => {
    // Two overlapping programs in the same week. The combined headline
    // ratio stays the existing 2/4, but the per-program breakdown must
    // surface "Tonal Lift 1/2 · 5K Improver 1/2" so a runner can see
    // which program drags adherence down.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2099-10-08T12:00:00.000Z"));

    const week = 8260;
    const phase = "Stack Phase";
    await insertWeek(week, {
      startDate: "2099-10-05",
      endDate: "2099-10-11",
      phase,
    });
    const tonalDay = await insertPlanDay(week, phase, {
      date: "2099-10-05", day: "Mon", sessionType: T_STRENGTH, equipment: E_GYM,
      sourceEntryIndex: 0, sourceEntryLabel: "Tonal Lift",
    });
    await insertPlanDay(week, phase, {
      date: "2099-10-07", day: "Wed", sessionType: T_STRENGTH, equipment: E_GYM,
      sourceEntryIndex: 0, sourceEntryLabel: "Tonal Lift",
    });
    const improverDay = await insertPlanDay(week, phase, {
      date: "2099-10-06", day: "Tue", sessionType: T_RUN, equipment: E_OUTDOOR, distanceMi: 4,
      sourceEntryIndex: 1, sourceEntryLabel: "5K Improver",
    });
    await insertPlanDay(week, phase, {
      date: "2099-10-08", day: "Thu", sessionType: T_RUN, equipment: E_OUTDOOR, distanceMi: 5,
      sourceEntryIndex: 1, sourceEntryLabel: "5K Improver",
    });
    // One workout per program — both attributed via plan_day_id so the
    // ratio is exactly 1/2 for each program.
    await insertWorkout({
      date: "2099-10-05", sessionType: T_STRENGTH, equipment: E_GYM,
      planDayId: tonalDay.id,
    });
    await insertWorkout({
      date: "2099-10-06", sessionType: T_RUN, equipment: E_OUTDOOR, distanceMi: 4,
      planDayId: improverDay.id,
    });

    const res = await request(app).get("/api/plan/weeks");
    expect(res.status).toBe(200);
    expectMatchesSchema(ListPlanWeeksResponse, res.body);
    const rows = res.body as Array<{
      week: number;
      completedSessions: number | null;
      totalSessions: number | null;
      programs: Array<{
        sourceEntryIndex: number;
        label: string;
        completedSessions: number;
        totalSessions: number;
        missedSessions: number;
      }> | null;
    }>;
    const ours = rows.find((r) => r.week === week);
    expect(ours).toBeDefined();
    expect(ours!.completedSessions).toBe(2);
    expect(ours!.totalSessions).toBe(4);
    expect(ours!.programs).toBeDefined();
    expect(ours!.programs).toHaveLength(2);
    const tonal = ours!.programs!.find((p) => p.sourceEntryIndex === 0);
    const improver = ours!.programs!.find((p) => p.sourceEntryIndex === 1);
    expect(tonal).toMatchObject({
      label: "Tonal Lift",
      completedSessions: 1,
      totalSessions: 2,
    });
    expect(improver).toMatchObject({
      label: "5K Improver",
      completedSessions: 1,
      totalSessions: 2,
    });

    // Same per-program shape on the single-week endpoint so /plan/:week
    // can render the breakdown without a second roundtrip.
    const detail = await request(app).get(`/api/plan/weeks/${week}`);
    expect(detail.status).toBe(200);
    const detailBody = detail.body as {
      programs: Array<{
        sourceEntryIndex: number;
        label: string;
        completedSessions: number;
        totalSessions: number;
      }>;
    };
    expect(detailBody.programs).toHaveLength(2);
    expect(detailBody.programs.map((p) => p.label).sort()).toEqual([
      "5K Improver",
      "Tonal Lift",
    ]);
    expect(
      detailBody.programs.find((p) => p.sourceEntryIndex === 0)?.completedSessions,
    ).toBe(1);
    expect(
      detailBody.programs.find((p) => p.sourceEntryIndex === 1)?.completedSessions,
    ).toBe(1);
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

  it("does NOT credit completion for legacy workouts with planDayId IS NULL (task #295)", async () => {
    // Once `backfill-workout-plan-day` runs (and the post-merge orphan
    // check passes) every workout that has a matching plan_day on its
    // date carries a real plan_day_id. Any remaining NULL row is
    // genuinely off-plan (quick-logged Lifestyle, off-plan run) and
    // must not earn completion credit for the planned day on that
    // date — otherwise a casual walk would silently mark the day's
    // Tonal lift as crushed.
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
      // planDayId omitted -> null, simulating an off-plan quick log.
      date: "2099-12-28", sessionType: T_RUN, equipment: E_OUTDOOR, distanceMi: 5,
    });

    const list = await request(app).get("/api/plan/weeks");
    const row = (list.body as Array<{
      week: number; completedSessions: number; totalSessions: number;
    }>).find((r) => r.week === week);
    expect(row).toBeDefined();
    expect(row!.totalSessions).toBe(1);
    expect(row!.completedSessions).toBe(0);

    const detail = await request(app).get(`/api/plan/weeks/${week}`);
    expect(detail.body.completedSessions).toBe(0);
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

// Task #327. Fresh-install regression: when no planner_configs row has
// last_applied_at IS NOT NULL (the only path that ever populates the
// plan tables is POST /api/planner/apply), every plan-driven endpoint
// must return hasPlan:false / empty arrays — even when a draft config
// is sitting in planner_configs awaiting activation. Guards against the
// pre-Task-#307 auto-seed regression resurfacing.
describe("plan-driven endpoints on a fresh install (Task #327)", () => {
  beforeEach(async () => {
    // Wipe every mutable plan table AND every planner_configs row so
    // we're starting from the bare fresh-install state.
    await db.execute(
      sql`TRUNCATE TABLE workouts, plan_days, plan_weeks, planner_configs RESTART IDENTITY CASCADE`,
    );
  });

  afterEach(async () => {
    // The "POST /planner/apply flips hasPlan:true" test populates the
    // canonical 52-week plan at 2026-05-04+, which lives OUTSIDE the
    // TEST_YEAR_START..TEST_YEAR_END window the file-level cleanTestData
    // scopes to. Without this scoped wipe, the leftover plan_days at
    // 2026 dates contaminate downstream test files (preferences,
    // measurements, reset-undo, etc.) that insert workouts at "recent"
    // (= 2026-current) dates and expect a clean plan-table baseline.
    await db.execute(
      sql`TRUNCATE TABLE workouts, plan_days, plan_weeks, planner_configs RESTART IDENTITY CASCADE`,
    );
  });

  it("returns hasPlan:false on /api/plan/overview with zero planner_configs rows", async () => {
    const res = await request(app).get("/api/plan/overview");
    expect(res.status).toBe(200);
    expectMatchesSchema(GetPlanOverviewResponse, res.body);
    expect(res.body.hasPlan).toBe(false);
    expect(res.body.activeConfigName).toBe("Workout Plan");
  });

  it("returns an empty list on /api/plan/weeks with zero planner_configs rows", async () => {
    const res = await request(app).get("/api/plan/weeks");
    expect(res.status).toBe(200);
    expectMatchesSchema(ListPlanWeeksResponse, res.body);
    expect(res.body).toEqual([]);
  });

  it("returns hasPlan:false on /api/plan/today with zero planner_configs rows", async () => {
    const res = await request(app).get("/api/plan/today");
    expect(res.status).toBe(200);
    expect(res.body.hasPlan).toBe(false);
    expect(res.body.plans).toEqual([]);
  });

  it("POST /api/planner/configs alone never populates plan tables — only POST /api/planner/apply does", async () => {
    // Drive the full public API surface: hit POST /planner/configs to
    // create the runner's first saved config (the only documented way
    // a fresh-install user reaches a non-empty planner_configs table)
    // and assert the plan tables are still empty / hasPlan:false.
    // Then POST /planner/apply and verify the same endpoints flip to
    // populated. This locks the contract that the only write path
    // into plan_weeks/plan_days is the explicit Apply call.
    const userWeeks = TOTAL_WEEKS - MARATHON_TAIL_WEEKS;
    const create = await request(app)
      .post("/api/planner/configs")
      .send({
        name: "Fresh Install",
        startDate: PLAN_START_ISO,
        marathonDate: RACE_DATE_ISO,
        blocks: [
          { focusType: "Base", weeks: Math.floor(userWeeks / 2) },
          {
            focusType: "Time on Feet",
            weeks: userWeeks - Math.floor(userWeeks / 2),
          },
        ],
      });
    expect(create.status, JSON.stringify(create.body)).toBe(201);

    // The saved config exists but carries no applied lineage.
    const cfgs = await db.select().from(plannerConfigsTable);
    expect(cfgs).toHaveLength(1);
    expect(cfgs[0]!.lastAppliedAt).toBeNull();
    expect(cfgs[0]!.appliedStartDate).toBeNull();
    expect(cfgs[0]!.appliedBlocks).toBeNull();

    // Plan tables still empty.
    const weeksAtRest = await db.select().from(planWeeksTable);
    const daysAtRest = await db.select().from(planDaysTable);
    expect(weeksAtRest).toHaveLength(0);
    expect(daysAtRest).toHaveLength(0);

    // Endpoints honor the empty-plan contract.
    const ov = await request(app).get("/api/plan/overview");
    expect(ov.status).toBe(200);
    expectMatchesSchema(GetPlanOverviewResponse, ov.body);
    expect(ov.body.hasPlan).toBe(false);
    const weeks = await request(app).get("/api/plan/weeks");
    expect(weeks.status).toBe(200);
    expect(weeks.body).toEqual([]);

    // Now apply — plan tables populate and hasPlan flips true.
    const apply = await request(app).post("/api/planner/apply").send({});
    expect(apply.status, JSON.stringify(apply.body)).toBe(200);

    const ov2 = await request(app).get("/api/plan/overview");
    expect(ov2.status).toBe(200);
    expect(ov2.body.hasPlan).toBe(true);
    const weeks2 = await db.select().from(planWeeksTable);
    expect(weeks2.length).toBeGreaterThan(0);
  });
});
