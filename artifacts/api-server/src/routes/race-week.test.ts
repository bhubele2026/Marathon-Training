import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { sql } from "drizzle-orm";
import {
  GetRaceWeekResponse,
  SetRaceWeekChecklistItemResponse,
  CreateRaceWeekChecklistItemResponse,
  DeleteRaceWeekChecklistItemResponse,
} from "@workspace/api-zod";
import { db, planDaysTable, plannerConfigsTable } from "@workspace/db";
import { RACE_DAY_SPECS } from "@workspace/plan-generator";
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

    // Pull the race-day prescription from the same `RACE_DAY_SPECS["half"]`
    // table the canonical 52-week generator, the entries-mode pipeline, and
    // the hybrid pipeline all read from (Task #217). The fixture would
    // otherwise drift the moment the spec changes — exactly the kind of
    // hand-rolled "looks like real data" literal centralization was meant
    // to eliminate.
    const halfSpec = RACE_DAY_SPECS.half;
    await db.insert(planDaysTable).values({
      week: 52,
      phase: "Taper & Race",
      date: RACE_DATE,
      day: "Sun",
      strengthLoad: 0,
      equipment: "Outdoor",
      description: halfSpec.description,
      cardioMin: Math.round(halfSpec.distanceMi * halfSpec.runMinPerMi),
      distanceMi: halfSpec.distanceMi,
      pace: "12:00",
      sessionType: "Race",
      isRest: false,
      totalLoad: halfSpec.totalLoad,
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
      name: "Race-week test config",
      isActive: true,
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
      // Pull the marathon race-day prose from the canonical
      // `RACE_DAY_SPECS.marathon.description` table — hand-rolling the
      // literal here would silently drift the moment the marathon copy
      // changes (Task #231; mirrors the half-marathon drift-proofing
      // already applied earlier in this file at line ~61).
      description: RACE_DAY_SPECS.marathon.description,
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

describe("POST /api/race-week/checklist (custom items)", () => {
  it("creates a custom item that surfaces on subsequent GETs with isCustom=true", async () => {
    const create = await request(app)
      .post("/api/race-week/checklist")
      .send({ label: "Pick up bib at expo" });
    expect(create.status).toBe(200);
    const created = expectMatchesSchema(CreateRaceWeekChecklistItemResponse, create.body);
    expect(created.label).toBe("Pick up bib at expo");
    expect(created.isCustom).toBe(true);
    expect(created.checked).toBe(false);
    expect(created.itemId).toMatch(/^custom-/);

    const get = await request(app).get("/api/race-week");
    const body = expectMatchesSchema(GetRaceWeekResponse, get.body);
    const found = body.checklist.find((c) => c.itemId === created.itemId);
    expect(found?.label).toBe("Pick up bib at expo");
    expect(found?.isCustom).toBe(true);

    // Default items must remain present and flagged isCustom=false.
    const defaults = body.checklist.filter((c) => !c.isCustom);
    expect(defaults.length).toBeGreaterThanOrEqual(9);
  });

  it("can toggle a custom item checked state via the existing PUT endpoint", async () => {
    const create = await request(app)
      .post("/api/race-week/checklist")
      .send({ label: "Test race-day breakfast" });
    const created = expectMatchesSchema(CreateRaceWeekChecklistItemResponse, create.body);

    const put = await request(app)
      .put(`/api/race-week/checklist/${created.itemId}`)
      .send({ checked: true });
    expect(put.status).toBe(200);
    const putBody = expectMatchesSchema(SetRaceWeekChecklistItemResponse, put.body);
    expect(putBody.checked).toBe(true);
    expect(putBody.isCustom).toBe(true);
    expect(putBody.label).toBe("Test race-day breakfast");
  });

  it("preserves creation order of custom items even after toggling", async () => {
    const a = await request(app)
      .post("/api/race-week/checklist")
      .send({ label: "Item A" });
    const b = await request(app)
      .post("/api/race-week/checklist")
      .send({ label: "Item B" });
    const c = await request(app)
      .post("/api/race-week/checklist")
      .send({ label: "Item C" });
    const aId = a.body.itemId as string;
    const bId = b.body.itemId as string;
    const cId = c.body.itemId as string;

    // Toggle the middle (and oldest) items so updated_at would change
    // their relative order if ordering wasn't anchored on created_at.
    await request(app).put(`/api/race-week/checklist/${bId}`).send({ checked: true });
    await request(app).put(`/api/race-week/checklist/${aId}`).send({ checked: true });

    const get = await request(app).get("/api/race-week");
    const body = expectMatchesSchema(GetRaceWeekResponse, get.body);
    const customIds = body.checklist.filter((c) => c.isCustom).map((c) => c.itemId);
    expect(customIds).toEqual([aId, bId, cId]);
  });

  it("rejects empty / whitespace labels with 400", async () => {
    const res = await request(app)
      .post("/api/race-week/checklist")
      .send({ label: "   " });
    expect(res.status).toBe(400);
  });

  it("rejects a missing label with 400", async () => {
    const res = await request(app).post("/api/race-week/checklist").send({});
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/race-week/checklist/:itemId", () => {
  it("deletes a custom item and removes it from subsequent GETs", async () => {
    const create = await request(app)
      .post("/api/race-week/checklist")
      .send({ label: "Charge headphones" });
    const created = expectMatchesSchema(CreateRaceWeekChecklistItemResponse, create.body);

    const del = await request(app).delete(`/api/race-week/checklist/${created.itemId}`);
    expect(del.status).toBe(200);
    const delBody = expectMatchesSchema(DeleteRaceWeekChecklistItemResponse, del.body);
    expect(delBody.deleted).toBe(true);
    expect(delBody.itemId).toBe(created.itemId);

    const get = await request(app).get("/api/race-week");
    const body = expectMatchesSchema(GetRaceWeekResponse, get.body);
    expect(body.checklist.find((c) => c.itemId === created.itemId)).toBeUndefined();
  });

  it("refuses to delete a default item with 400", async () => {
    const res = await request(app).delete("/api/race-week/checklist/hydrate");
    expect(res.status).toBe(400);
    // Default item must remain in the checklist.
    const get = await request(app).get("/api/race-week");
    const body = expectMatchesSchema(GetRaceWeekResponse, get.body);
    expect(body.checklist.find((c) => c.itemId === "hydrate")).toBeDefined();
  });

  it("returns 404 for an unknown item id", async () => {
    const res = await request(app).delete("/api/race-week/checklist/custom-does-not-exist");
    expect(res.status).toBe(404);
  });
});
