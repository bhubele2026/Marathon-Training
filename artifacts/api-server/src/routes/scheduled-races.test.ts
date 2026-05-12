import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { sql } from "drizzle-orm";
import {
  ListScheduledRacesResponse,
  CreateScheduledRaceResponse,
  UpdateScheduledRaceResponse,
  GetPlanOverviewResponse,
  ListPlanWeeksResponse,
  GetPlanWeekResponse,
  GetTodayPlanResponse,
} from "@workspace/api-zod";
import { db, planWeeksTable, planDaysTable, plannerConfigsTable } from "@workspace/db";
import app from "../app";
import { expectMatchesSchema } from "../test-helpers";

async function clearScheduledRaces(): Promise<void> {
  await db.execute(
    sql`DELETE FROM scheduled_races WHERE race_date >= '2099-01-01' AND race_date < '2100-01-01'`,
  );
}

async function clearAllPlanArtifacts(): Promise<void> {
  await db.execute(sql`DELETE FROM plan_days WHERE date >= '2099-01-01' AND date < '2100-01-01'`);
  await db.execute(sql`DELETE FROM plan_weeks WHERE week >= 8000 AND week <= 8999`);
  await db.delete(plannerConfigsTable);
}

beforeEach(async () => {
  await clearScheduledRaces();
});

afterEach(async () => {
  await clearScheduledRaces();
  await clearAllPlanArtifacts();
});

describe("scheduled-races CRUD", () => {
  it("creates a scheduled race and lists it", async () => {
    const create = await request(app)
      .post("/api/scheduled-races")
      .send({ raceDate: "2099-06-15", raceKind: "5k", name: "Local fun run" });
    expect(create.status).toBe(200);
    const created = expectMatchesSchema(CreateScheduledRaceResponse, create.body);
    expect(created.raceDate).toBe("2099-06-15");
    expect(created.raceKind).toBe("5k");
    expect(created.hasResult).toBe(false);

    const list = await request(app).get("/api/scheduled-races");
    expect(list.status).toBe(200);
    const rows = expectMatchesSchema(ListScheduledRacesResponse, list.body);
    expect(rows.find((r) => r.raceDate === "2099-06-15")).toBeTruthy();
  });

  it("rejects duplicate dates with 409", async () => {
    await request(app)
      .post("/api/scheduled-races")
      .send({ raceDate: "2099-07-01", raceKind: "10k" });
    const dup = await request(app)
      .post("/api/scheduled-races")
      .send({ raceDate: "2099-07-01", raceKind: "5k" });
    expect(dup.status).toBe(409);
  });

  it("rejects malformed raceDate and invalid raceKind", async () => {
    const badDate = await request(app)
      .post("/api/scheduled-races")
      .send({ raceDate: "06/15/2099", raceKind: "5k" });
    expect(badDate.status).toBe(400);
    const badKind = await request(app)
      .post("/api/scheduled-races")
      .send({ raceDate: "2099-08-01", raceKind: "ultra" });
    expect(badKind.status).toBe(400);
  });

  it("patches name + kind and deletes a scheduled race", async () => {
    await request(app)
      .post("/api/scheduled-races")
      .send({ raceDate: "2099-09-12", raceKind: "5k", name: "old" });
    const patch = await request(app)
      .patch("/api/scheduled-races/2099-09-12")
      .send({ raceKind: "10k", name: "new" });
    expect(patch.status).toBe(200);
    const upd = expectMatchesSchema(UpdateScheduledRaceResponse, patch.body);
    expect(upd.raceKind).toBe("10k");
    expect(upd.name).toBe("new");

    const del = await request(app).delete("/api/scheduled-races/2099-09-12");
    expect(del.status).toBe(204);
    const list = await request(app).get("/api/scheduled-races");
    const body3 = list.body as Array<{ raceDate: string }>;
    expect(body3.find((r) => r.raceDate === "2099-09-12")).toBeFalsy();
  });
});

describe("scheduled races embedded on plan endpoints", () => {
  beforeEach(async () => {
    await clearAllPlanArtifacts();
    await db.insert(planWeeksTable).values({
      week: 8001,
      phase: "Foundation Build",
      startDate: "2099-06-01",
      endDate: "2099-06-07",
      plannedStrength: 0,
      plannedCardio: 0,
      plannedTotalLoad: 0,
      plannedMiles: 0,
      longRunMi: 0,
    });
    await db.insert(planDaysTable).values({
      week: 8001,
      phase: "Foundation Build",
      date: "2099-06-07",
      day: "Sun",
      strengthLoad: 0,
      equipment: "Outdoor",
      description: "Long run",
      cardioMin: 60,
      distanceMi: 6,
      pace: "12:00",
      sessionType: "Long Run",
      isRest: false,
      totalLoad: 60,
    });
    await request(app)
      .post("/api/scheduled-races")
      .send({ raceDate: "2099-06-05", raceKind: "5k", name: "Tune-up 5K" });
  });

  it("embeds nextScheduledRace on /plan/overview", async () => {
    const res = await request(app).get("/api/plan/overview");
    expect(res.status).toBe(200);
    const body = expectMatchesSchema(GetPlanOverviewResponse, res.body);
    expect(body.nextScheduledRace?.raceDate).toBe("2099-06-05");
    expect(body.nextScheduledRace?.raceKind).toBe("5k");
    // Task #345 review fix: server-computed `daysUntil` is required so
    // the chip text doesn't drift across timezones. Race is well in
    // the future, so this should be a positive integer.
    expect(typeof body.nextScheduledRace?.daysUntil).toBe("number");
    expect(body.nextScheduledRace?.daysUntil).toBeGreaterThan(0);
  });

  it("embeds scheduledRaces[] per week on /plan/weeks", async () => {
    const res = await request(app).get("/api/plan/weeks");
    expect(res.status).toBe(200);
    const body = expectMatchesSchema(ListPlanWeeksResponse, res.body);
    const w = body.find((x) => x.week === 8001);
    expect(w?.scheduledRaces?.[0]?.raceDate).toBe("2099-06-05");
  });

  it("embeds scheduledRaces[] on /plan/weeks/:week", async () => {
    const res = await request(app).get("/api/plan/weeks/8001");
    expect(res.status).toBe(200);
    const body = expectMatchesSchema(GetPlanWeekResponse, res.body);
    expect(body.scheduledRaces?.[0]?.raceDate).toBe("2099-06-05");
  });

  it("embeds nextScheduledRace on /plan/today", async () => {
    const res = await request(app).get("/api/plan/today");
    expect(res.status).toBe(200);
    const body = expectMatchesSchema(GetTodayPlanResponse, res.body);
    expect(body.nextScheduledRace?.raceKind).toBe("5k");
    expect(typeof body.nextScheduledRace?.daysUntil).toBe("number");
    expect(body.nextScheduledRace?.daysUntil).toBeGreaterThan(0);
  });
});

describe("scheduled-races ordering and result upsert", () => {
  it("lists scheduled races newest first", async () => {
    await request(app)
      .post("/api/scheduled-races")
      .send({ raceDate: "2099-03-01", raceKind: "5k" });
    await request(app)
      .post("/api/scheduled-races")
      .send({ raceDate: "2099-11-01", raceKind: "10k" });
    await request(app)
      .post("/api/scheduled-races")
      .send({ raceDate: "2099-07-01", raceKind: "half" });
    const list = await request(app).get("/api/scheduled-races");
    expect(list.status).toBe(200);
    const rows = list.body as Array<{ raceDate: string }>;
    const ourDates = rows
      .map((r) => r.raceDate)
      .filter((d) => d.startsWith("2099-"));
    expect(ourDates).toEqual(["2099-11-01", "2099-07-01", "2099-03-01"]);
  });

  it("upserts a race result via PUT and captures raceKind from the scheduled row", async () => {
    await request(app)
      .post("/api/scheduled-races")
      .send({ raceDate: "2099-05-15", raceKind: "10k", name: "Tune-up 10K" });
    const put = await request(app)
      .put("/api/race-results/2099-05-15")
      .send({
        finishTime: "0:48:21",
        placementOverall: 12,
        placementTotal: 220,
        feltRating: 4,
        notes: "felt strong",
      });
    expect(put.status).toBe(200);
    expect(put.body.raceKind).toBe("10k");
    expect(put.body.finishTime).toBe("0:48:21");

    // Second PUT updates the same row in place.
    const put2 = await request(app)
      .put("/api/race-results/2099-05-15")
      .send({
        finishTime: "0:47:30",
        placementOverall: null,
        placementTotal: null,
        feltRating: null,
        notes: null,
      });
    expect(put2.status).toBe(200);
    expect(put2.body.finishTime).toBe("0:47:30");

    const list = await request(app).get("/api/race-results");
    const rows = list.body as Array<{ raceDate: string; finishTime: string | null }>;
    const ours = rows.filter((r) => r.raceDate === "2099-05-15");
    expect(ours).toHaveLength(1);
    expect(ours[0]!.finishTime).toBe("0:47:30");

    // The scheduled row now reports hasResult: true.
    const sched = await request(app).get("/api/scheduled-races");
    const schedRow = (sched.body as Array<{ raceDate: string; hasResult: boolean }>).find(
      (r) => r.raceDate === "2099-05-15",
    );
    expect(schedRow?.hasResult).toBe(true);

    // Cleanup the race_results row so other tests aren't polluted.
    await request(app).delete("/api/race-results/2099-05-15");
  });

  it("rejects invalid raceDate or non-integer placement on PUT", async () => {
    const badDate = await request(app)
      .put("/api/race-results/05-15-2099")
      .send({});
    expect(badDate.status).toBe(400);
    const badPlace = await request(app)
      .put("/api/race-results/2099-05-16")
      .send({ placementOverall: 1.5 });
    expect(badPlace.status).toBe(400);
  });
});

describe("scheduled races survive plan resets", () => {
  beforeEach(async () => {
    await request(app)
      .post("/api/scheduled-races")
      .send({ raceDate: "2099-10-10", raceKind: "half", name: "Autumn half" });
  });

  it("survives /api/plan/reset", async () => {
    const reset = await request(app)
      .post("/api/plan/reset")
      .send({ confirm: "RESET PLAN" });
    expect([200, 204]).toContain(reset.status);
    const list = await request(app).get("/api/scheduled-races");
    const body1 = list.body as Array<{ raceDate: string }>;
    expect(body1.some((r) => r.raceDate === "2099-10-10")).toBe(true);
  });

  it("survives /api/plan/full-reset", async () => {
    const reset = await request(app)
      .post("/api/plan/full-reset")
      .send({ confirm: "WIPE EVERYTHING" });
    expect([200, 204]).toContain(reset.status);
    const list = await request(app).get("/api/scheduled-races");
    const body2 = list.body as Array<{ raceDate: string }>;
    expect(body2.some((r) => r.raceDate === "2099-10-10")).toBe(true);
  });
});
