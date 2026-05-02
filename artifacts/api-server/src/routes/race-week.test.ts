import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { sql } from "drizzle-orm";
import {
  GetRaceWeekResponse,
  SetRaceWeekChecklistItemResponse,
} from "@workspace/api-zod";
import { db, planDaysTable, plannerConfigsTable } from "@workspace/db";
import app from "../app";
import { expectMatchesSchema } from "../test-helpers";

const RACE_DATE = "2027-05-02";

async function clearChecklistAndRaceDayPlan() {
  await db.execute(sql`DELETE FROM race_week_checklist`);
  // Race-day plan_day is real seed data; remove just the row for our window so
  // the GET endpoint behaves deterministically when we add our own.
  await db.execute(sql`DELETE FROM plan_days WHERE date = ${RACE_DATE}`);
  // Make sure no leaked planner config from another test re-points the
  // canonical race-date anchor for the suites below.
  await db.delete(plannerConfigsTable);
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

  it("anchors raceDate, daysToRace, and racePlan lookup on the APPLIED Planner marathon date", async () => {
    vi.useFakeTimers();
    // 2099-05-10 is a Sunday; pin "today" 7 days before so we land in-window.
    const customRace = "2099-05-10";
    vi.setSystemTime(new Date("2099-05-03T12:00:00.000Z"));

    await db.insert(plannerConfigsTable).values({
      id: 1,
      startDate: "2099-04-27",
      marathonDate: customRace,
      blocks: [{ focusType: "Base", weeks: 2 }],
      lastAppliedAt: new Date(),
      appliedStartDate: "2099-04-27",
      appliedMarathonDate: customRace,
      appliedBlocks: [{ focusType: "Base", weeks: 2 }],
    });

    // Insert the race-day plan_day at the CUSTOM date so the lookup hits.
    await db.insert(planDaysTable).values({
      week: 99,
      phase: "Taper & Race",
      date: customRace,
      day: "Sun",
      strengthLoad: 0,
      equipment: "Outdoor",
      description: "RACE DAY — Marathon (26.2 mi). Fuel every 4 mi.",
      cardioMin: 240,
      distanceMi: 26.2,
      pace: "10:00",
      sessionType: "Race",
      isRest: false,
      totalLoad: 400,
    });

    const res = await request(app).get("/api/race-week");
    expect(res.status).toBe(200);
    const body = expectMatchesSchema(GetRaceWeekResponse, res.body);
    expect(body.raceDate).toBe(customRace);
    expect(body.daysToRace).toBe(7);
    expect(body.inWindow).toBe(true);
    expect(body.racePlan?.distanceMi).toBe(26.2);

    await db.execute(sql`DELETE FROM plan_days WHERE date = ${customRace}`);
    await db.delete(plannerConfigsTable);
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
