import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { sql } from "drizzle-orm";
import {
  GetRaceWeekResponse,
  SetRaceWeekChecklistItemResponse,
} from "@workspace/api-zod";
import { db, planDaysTable } from "@workspace/db";
import app from "../app";
import { expectMatchesSchema } from "../test-helpers";

const RACE_DATE = "2027-05-02";

async function clearChecklistAndRaceDayPlan() {
  await db.execute(sql`DELETE FROM race_week_checklist`);
  // Race-day plan_day is real seed data; remove just the row for our window so
  // the GET endpoint behaves deterministically when we add our own.
  await db.execute(sql`DELETE FROM plan_days WHERE date = ${RACE_DATE}`);
}

beforeEach(async () => {
  await clearChecklistAndRaceDayPlan();
});

afterEach(async () => {
  await clearChecklistAndRaceDayPlan();
  vi.useRealTimers();
});

describe("GET /api/race-week", () => {
  it("returns inWindow=false and full default checklist outside the 21-day window", async () => {
    vi.useFakeTimers();
    // 60 days before race -> well outside the window.
    vi.setSystemTime(new Date("2027-03-02T12:00:00.000Z"));

    const res = await request(app).get("/api/race-week");
    expect(res.status).toBe(200);
    const body = expectMatchesSchema(GetRaceWeekResponse, res.body);
    expect(body.inWindow).toBe(false);
    expect(body.isRaceDay).toBe(false);
    expect(body.racePlan).toBeNull();
    expect(body.daysToRace).toBe(61);
    expect(body.checklist.length).toBeGreaterThanOrEqual(9);
    expect(body.checklist.every((c) => c.checked === false)).toBe(true);
  });

  it("flags inWindow=true and exposes racePlan summary inside the 21-day window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2027-04-25T12:00:00.000Z"));

    await db.insert(planDaysTable).values({
      week: 52,
      phase: "Taper & Race",
      date: RACE_DATE,
      day: "Sun",
      strengthLoad: 0,
      equipment: "Outdoor",
      description:
        "RACE DAY — Half Marathon (13.1 mi). Execute race plan, fuel every 4 mi, finish strong.",
      cardioMin: 157,
      distanceMi: 13.1,
      pace: "12:00",
      sessionType: "Race",
      isRest: false,
      totalLoad: 260,
    });

    const res = await request(app).get("/api/race-week");
    expect(res.status).toBe(200);
    const body = expectMatchesSchema(GetRaceWeekResponse, res.body);
    expect(body.inWindow).toBe(true);
    expect(body.isRaceDay).toBe(false);
    expect(body.daysToRace).toBe(7);
    expect(body.racePlan?.distanceMi).toBe(13.1);
    expect(body.racePlan?.targetPace).toBe("12:00");
    expect(body.racePlan?.fuelingNote).toMatch(/every 4 mi/i);
  });

  it("flips to isRaceDay=true on race-day itself", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(`${RACE_DATE}T08:00:00.000Z`));

    const res = await request(app).get("/api/race-week");
    expect(res.status).toBe(200);
    const body = expectMatchesSchema(GetRaceWeekResponse, res.body);
    expect(body.isRaceDay).toBe(true);
    expect(body.inWindow).toBe(true);
    expect(body.daysToRace).toBe(0);
  });
});

describe("PUT /api/race-week/checklist/:itemId", () => {
  it("persists a checklist toggle and surfaces it on the next GET", async () => {
    const put = await request(app)
      .put("/api/race-week/checklist/hydrate")
      .send({ checked: true });
    expect(put.status).toBe(200);
    const putBody = expectMatchesSchema(SetRaceWeekChecklistItemResponse, put.body);
    expect(putBody.itemId).toBe("hydrate");
    expect(putBody.checked).toBe(true);
    expect(putBody.checkedAt).toBeTruthy();

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2027-04-25T12:00:00.000Z"));
    const get = await request(app).get("/api/race-week");
    expect(get.status).toBe(200);
    const getBody = expectMatchesSchema(GetRaceWeekResponse, get.body);
    const hydrate = getBody.checklist.find((c) => c.itemId === "hydrate");
    expect(hydrate?.checked).toBe(true);
  });

  it("can flip a checked item back to unchecked", async () => {
    await request(app)
      .put("/api/race-week/checklist/pin-bib")
      .send({ checked: true });
    const off = await request(app)
      .put("/api/race-week/checklist/pin-bib")
      .send({ checked: false });
    expect(off.status).toBe(200);
    const body = expectMatchesSchema(SetRaceWeekChecklistItemResponse, off.body);
    expect(body.checked).toBe(false);
    expect(body.checkedAt).toBeNull();
  });

  it("rejects an unknown item id with 404", async () => {
    const res = await request(app)
      .put("/api/race-week/checklist/not-a-real-item")
      .send({ checked: true });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "checklist item not found" });
  });

  it("rejects a body that fails Zod validation with 400", async () => {
    const res = await request(app)
      .put("/api/race-week/checklist/hydrate")
      .send({ checked: "yes" });
    expect(res.status).toBe(400);
    expect(res.body.error.fieldErrors.checked).toBeTruthy();
  });
});
