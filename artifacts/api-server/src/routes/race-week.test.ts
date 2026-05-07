import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { sql } from "drizzle-orm";
import {
  GetRaceWeekResponse,
  SetRaceWeekChecklistItemResponse,
  CreateRaceWeekChecklistItemResponse,
  DeleteRaceWeekChecklistItemResponse,
} from "@workspace/api-zod";
import { db, planDaysTable, plannerConfigsTable, raceResultsTable } from "@workspace/db";
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

describe("PUT /api/race-week/result (Task #40)", () => {
  beforeEach(async () => {
    await db.execute(sql`DELETE FROM race_results`);
  });
  afterEach(async () => {
    await db.execute(sql`DELETE FROM race_results`);
  });

  it("upserts a race result and surfaces it on /race-week once race has passed", async () => {
    const put = await request(app)
      .put("/api/race-week/result")
      .send({
        finishTime: "2:14:08",
        placementOverall: 312,
        placementTotal: 1804,
        feltRating: 4,
        notes: "Negative split. Fueling held.",
      });
    expect(put.status).toBe(200);
    expect(put.body.raceDate).toBe(RACE_DATE);
    expect(put.body.finishTime).toBe("2:14:08");
    expect(put.body.placementOverall).toBe(312);
    expect(put.body.feltRating).toBe(4);

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2027-05-05T12:00:00.000Z"));
    const get = await request(app).get("/api/race-week");
    expect(get.status).toBe(200);
    const body = expectMatchesSchema(GetRaceWeekResponse, get.body);
    expect(body.racePassed).toBe(true);
    expect(body.raceResult?.finishTime).toBe("2:14:08");
    expect(body.raceResult?.placementOverall).toBe(312);
    expect(body.raceResult?.placementTotal).toBe(1804);
    expect(body.raceResult?.feltRating).toBe(4);
    expect(body.raceResult?.notes).toMatch(/Negative split/);
  });

  it("does not surface a stored result before the race has passed", async () => {
    await request(app)
      .put("/api/race-week/result")
      .send({ finishTime: "2:14:08" });
    vi.useFakeTimers();
    // Pre-race window: 7 days out.
    vi.setSystemTime(new Date("2027-04-25T12:00:00.000Z"));
    const get = await request(app).get("/api/race-week");
    expect(get.status).toBe(200);
    expect(get.body.racePassed).toBe(false);
    expect(get.body.raceResult).toBeNull();
  });

  it("treats a second PUT as an edit (preserves recordedAt, advances updatedAt)", async () => {
    const first = await request(app)
      .put("/api/race-week/result")
      .send({ finishTime: "2:14:08", feltRating: 3 });
    expect(first.status).toBe(200);
    const recordedAt = first.body.recordedAt;
    // Force a clock tick so updatedAt definitely moves forward.
    await new Promise((r) => setTimeout(r, 10));
    const second = await request(app)
      .put("/api/race-week/result")
      .send({ finishTime: "2:13:55", feltRating: 5, notes: "Crushed it" });
    expect(second.status).toBe(200);
    expect(second.body.finishTime).toBe("2:13:55");
    expect(second.body.feltRating).toBe(5);
    expect(second.body.notes).toBe("Crushed it");
    expect(second.body.recordedAt).toBe(recordedAt);
    expect(new Date(second.body.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(recordedAt).getTime(),
    );
  });

  it("accepts an empty body (defensive partial save) and stores all-null fields", async () => {
    const res = await request(app).put("/api/race-week/result").send({});
    expect(res.status).toBe(200);
    expect(res.body.finishTime).toBeNull();
    expect(res.body.placementOverall).toBeNull();
    expect(res.body.feltRating).toBeNull();
    expect(res.body.notes).toBeNull();
  });

  it("rejects an out-of-range feltRating with 400", async () => {
    const res = await request(app)
      .put("/api/race-week/result")
      .send({ feltRating: 7 });
    expect(res.status).toBe(400);
  });

  it("rejects a non-integer placement with 400", async () => {
    const res = await request(app)
      .put("/api/race-week/result")
      .send({ placementOverall: 312.5 });
    expect(res.status).toBe(400);
  });

  it("rejects a zero/negative placement with 400", async () => {
    const res = await request(app)
      .put("/api/race-week/result")
      .send({ placementOverall: 0 });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/race-results (Task #266)", () => {
  beforeEach(async () => {
    await db.execute(sql`DELETE FROM race_results`);
  });
  afterEach(async () => {
    await db.execute(sql`DELETE FROM race_results`);
  });

  it("lists every stored race result newest first with raceKind from plan_days", async () => {
    // Two prior campaigns + the active half-marathon (default RACE_DATE).
    await db.execute(sql`DELETE FROM plan_days WHERE date = ${RACE_DATE}`);
    const halfSpec = RACE_DAY_SPECS.half;
    const fiveSpec = RACE_DAY_SPECS["5k"];
    await db.insert(planDaysTable).values([
      {
        week: 52,
        phase: "Taper & Race",
        date: RACE_DATE,
        day: "Sun",
        strengthLoad: 0,
        equipment: "Outdoor",
        description: halfSpec.description,
        cardioMin: 100,
        distanceMi: halfSpec.distanceMi,
        pace: "12:00",
        sessionType: "Race",
        isRest: false,
        totalLoad: halfSpec.totalLoad,
      },
      {
        week: 1,
        phase: "Taper & Race",
        date: "2025-06-15",
        day: "Sun",
        strengthLoad: 0,
        equipment: "Outdoor",
        description: fiveSpec.description,
        cardioMin: 30,
        distanceMi: fiveSpec.distanceMi,
        pace: "9:00",
        sessionType: "Race",
        isRest: false,
        totalLoad: fiveSpec.totalLoad,
      },
    ]);
    await db.insert(raceResultsTable).values([
      { raceDate: RACE_DATE, finishTime: "2:14:08", placementOverall: 312, placementTotal: 1804, feltRating: 4, notes: null },
      { raceDate: "2025-06-15", finishTime: "27:43", feltRating: 5, notes: null },
      // Orphan — no plan_day on this date.
      { raceDate: "2024-04-01", finishTime: "55:12", feltRating: 3, notes: null },
    ]);

    const res = await request(app).get("/api/race-results");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(3);
    // Newest first.
    expect(res.body[0].raceDate).toBe(RACE_DATE);
    expect(res.body[1].raceDate).toBe("2025-06-15");
    expect(res.body[2].raceDate).toBe("2024-04-01");
    // raceKind derived from plan_days.
    expect(res.body[0].raceKind).toBe("half");
    expect(res.body[1].raceKind).toBe("5k");
    expect(res.body[2].raceKind).toBeNull();

    await db.execute(sql`DELETE FROM plan_days WHERE date IN (${RACE_DATE}, '2025-06-15')`);
  });

  it("returns an empty array when no results exist", async () => {
    const res = await request(app).get("/api/race-results");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe("PATCH /api/race-results/:raceDate (Task #266)", () => {
  beforeEach(async () => {
    await db.execute(sql`DELETE FROM race_results`);
  });
  afterEach(async () => {
    await db.execute(sql`DELETE FROM race_results`);
  });

  it("updates a stored race result by date", async () => {
    await db.insert(raceResultsTable).values({
      raceDate: "2025-06-15",
      finishTime: "27:43",
      feltRating: 5,
    });
    const res = await request(app)
      .patch("/api/race-results/2025-06-15")
      .send({ finishTime: "27:30", feltRating: 4, notes: "Closed hard" });
    expect(res.status).toBe(200);
    expect(res.body.finishTime).toBe("27:30");
    expect(res.body.feltRating).toBe(4);
    expect(res.body.notes).toBe("Closed hard");
  });

  it("returns 404 for an unknown raceDate", async () => {
    const res = await request(app)
      .patch("/api/race-results/2099-01-01")
      .send({ finishTime: "1:00:00" });
    expect(res.status).toBe(404);
  });

  it("rejects an invalid raceDate format with 400", async () => {
    const res = await request(app)
      .patch("/api/race-results/not-a-date")
      .send({ finishTime: "1:00:00" });
    expect(res.status).toBe(400);
  });

  it("rejects an out-of-range feltRating with 400", async () => {
    await db.insert(raceResultsTable).values({ raceDate: "2025-06-15" });
    const res = await request(app)
      .patch("/api/race-results/2025-06-15")
      .send({ feltRating: 9 });
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/race-results/:raceDate (Task #266)", () => {
  beforeEach(async () => {
    await db.execute(sql`DELETE FROM race_results`);
  });
  afterEach(async () => {
    await db.execute(sql`DELETE FROM race_results`);
  });

  it("deletes a stored race result", async () => {
    await db.insert(raceResultsTable).values({ raceDate: "2025-06-15", finishTime: "27:43" });
    const del = await request(app).delete("/api/race-results/2025-06-15");
    expect(del.status).toBe(204);
    const list = await request(app).get("/api/race-results");
    expect(list.body).toEqual([]);
  });

  it("rejects an invalid raceDate format with 400", async () => {
    const res = await request(app).delete("/api/race-results/garbage");
    expect(res.status).toBe(400);
  });
});

describe("Race result PR badge / previous-best comparison (Task #265)", () => {
  beforeEach(async () => {
    await db.execute(sql`DELETE FROM race_results`);
    await db.execute(sql`DELETE FROM plan_days WHERE date = ${RACE_DATE}`);
  });
  afterEach(async () => {
    await db.execute(sql`DELETE FROM race_results`);
    await db.execute(sql`DELETE FROM plan_days WHERE date = ${RACE_DATE}`);
  });

  // Seed an active race_day plan_day at the canonical RACE_DATE so the
  // PUT handler's `detectRaceKindForDate` lookup classifies the row
  // (otherwise raceKind would silently fall back to null, which would
  // skip the PR comparison entirely).
  async function seedHalfRaceDay() {
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
  }

  it("captures raceKind on PUT from the active plan_day", async () => {
    await seedHalfRaceDay();
    const put = await request(app)
      .put("/api/race-week/result")
      .send({ finishTime: "2:14:08" });
    expect(put.status).toBe(200);
    expect(put.body.raceKind).toBe("half");
  });

  it("flags isPersonalRecord=true when this finish beats every prior result of the same kind", async () => {
    await seedHalfRaceDay();
    // Prior half from a previous campaign — slower than the current one.
    await db.insert(raceResultsTable).values({
      raceDate: "2026-05-03",
      finishTime: "2:15:51",
      raceKind: "half",
    });
    // Prior 5K — different kind, must not influence the half PR check.
    await db.insert(raceResultsTable).values({
      raceDate: "2025-09-01",
      finishTime: "0:22:30",
      raceKind: "5k",
    });

    const put = await request(app)
      .put("/api/race-week/result")
      .send({ finishTime: "2:14:08" });
    expect(put.status).toBe(200);
    expect(put.body.isPersonalRecord).toBe(true);
    expect(put.body.previousBest).toEqual({
      raceDate: "2026-05-03",
      finishTime: "2:15:51",
      // 2:14:08 - 2:15:51 = -103 sec
      deltaSeconds: -103,
    });

    // GET must surface the same comparison once the race has passed.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2027-05-05T12:00:00.000Z"));
    const get = await request(app).get("/api/race-week");
    expect(get.body.raceResult.isPersonalRecord).toBe(true);
    expect(get.body.raceResult.previousBest.deltaSeconds).toBe(-103);
    expect(get.body.raceResult.previousBest.finishTime).toBe("2:15:51");
  });

  it("returns isPersonalRecord=false but still surfaces previousBest when slower than prior best", async () => {
    await seedHalfRaceDay();
    await db.insert(raceResultsTable).values({
      raceDate: "2026-05-03",
      finishTime: "2:10:00",
      raceKind: "half",
    });
    const put = await request(app)
      .put("/api/race-week/result")
      .send({ finishTime: "2:14:08" });
    expect(put.body.isPersonalRecord).toBe(false);
    expect(put.body.previousBest.deltaSeconds).toBe(248); // 8 min 8 sec slower
    expect(put.body.previousBest.finishTime).toBe("2:10:00");
  });

  it("ties do not count as a PR (must be strictly faster)", async () => {
    await seedHalfRaceDay();
    await db.insert(raceResultsTable).values({
      raceDate: "2026-05-03",
      finishTime: "2:14:08",
      raceKind: "half",
    });
    const put = await request(app)
      .put("/api/race-week/result")
      .send({ finishTime: "2:14:08" });
    expect(put.body.isPersonalRecord).toBe(false);
    expect(put.body.previousBest.deltaSeconds).toBe(0);
  });

  it("ignores prior results of a different raceKind when picking previous best", async () => {
    await seedHalfRaceDay();
    // A faster MARATHON has nothing to do with the half PR.
    await db.insert(raceResultsTable).values({
      raceDate: "2026-05-03",
      finishTime: "1:50:00",
      raceKind: "marathon",
    });
    const put = await request(app)
      .put("/api/race-week/result")
      .send({ finishTime: "2:14:08" });
    expect(put.body.previousBest).toBeNull();
    expect(put.body.isPersonalRecord).toBe(false);
  });

  it("first-of-kind result has no previousBest and is NOT flagged as PR", async () => {
    await seedHalfRaceDay();
    const put = await request(app)
      .put("/api/race-week/result")
      .send({ finishTime: "2:14:08" });
    expect(put.body.previousBest).toBeNull();
    expect(put.body.isPersonalRecord).toBe(false);
  });

  it("falls back gracefully when finishTime can't be parsed", async () => {
    await seedHalfRaceDay();
    await db.insert(raceResultsTable).values({
      raceDate: "2026-05-03",
      finishTime: "2:15:51",
      raceKind: "half",
    });
    const put = await request(app)
      .put("/api/race-week/result")
      .send({ finishTime: "did not finish" });
    expect(put.body.previousBest).toBeNull();
    expect(put.body.isPersonalRecord).toBe(false);
  });

  it("skips the comparison when the active plan_day can't be classified (raceKind=null)", async () => {
    // No plan_day at RACE_DATE → detectRaceKindForDate returns null.
    await db.insert(raceResultsTable).values({
      raceDate: "2026-05-03",
      finishTime: "2:15:51",
      raceKind: "half",
    });
    const put = await request(app)
      .put("/api/race-week/result")
      .send({ finishTime: "2:14:08" });
    expect(put.body.raceKind).toBeNull();
    expect(put.body.previousBest).toBeNull();
    expect(put.body.isPersonalRecord).toBe(false);
  });

  it("picks the fastest of multiple priors as the previous best", async () => {
    await seedHalfRaceDay();
    await db.insert(raceResultsTable).values([
      { raceDate: "2024-05-05", finishTime: "2:30:00", raceKind: "half" },
      { raceDate: "2025-05-04", finishTime: "2:15:51", raceKind: "half" },
      { raceDate: "2026-05-03", finishTime: "2:20:00", raceKind: "half" },
    ]);
    const put = await request(app)
      .put("/api/race-week/result")
      .send({ finishTime: "2:14:08" });
    expect(put.body.previousBest.raceDate).toBe("2025-05-04");
    expect(put.body.previousBest.finishTime).toBe("2:15:51");
    expect(put.body.isPersonalRecord).toBe(true);
  });
});
