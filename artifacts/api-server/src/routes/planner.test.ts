import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { sql } from "drizzle-orm";
import {
  db,
  measurementsTable,
  plannerConfigsTable,
  resetUndoSnapshotsTable,
  workoutsTable,
} from "@workspace/db";
import {
  GetPlannerConfigResponse as PlannerConfigSchema,
  ListPlannerConfigsResponse,
  ApplyPlannerConfigResponse,
  DeletePlannerConfigResponse,
} from "@workspace/api-zod";
import {
  MARATHON_TAIL_WEEKS,
  PLAN_START_ISO,
  RACE_DATE_ISO,
  TOTAL_WEEKS,
} from "@workspace/plan-generator";
import app from "../app";
import { expectMatchesSchema } from "../test-helpers";

// Re-seed the canonical baseline before and after each test so any plan
// regeneration this suite triggers can't bleed into other suites.
beforeEach(async () => {
  await db.delete(plannerConfigsTable);
  await request(app).post("/api/plan/full-reset");
});

afterEach(async () => {
  await db.delete(plannerConfigsTable);
  await request(app).post("/api/plan/full-reset");
});

// A minimal block list whose weeks sum to (TOTAL_WEEKS - 16) using the
// canonical PLAN_START_ISO / RACE_DATE_ISO so we don't have to recompute
// the dates against the calendar in every test.
function canonicalBlocks() {
  const userWeeks = TOTAL_WEEKS - MARATHON_TAIL_WEEKS;
  return [
    { focusType: "Base" as const, weeks: Math.floor(userWeeks / 2) },
    {
      focusType: "Time on Feet" as const,
      weeks: userWeeks - Math.floor(userWeeks / 2),
    },
  ];
}

async function createCanonicalConfig(name = "Primary") {
  const res = await request(app)
    .post("/api/planner/configs")
    .send({
      name,
      startDate: PLAN_START_ISO,
      marathonDate: RACE_DATE_ISO,
      blocks: canonicalBlocks(),
    });
  expect(res.status).toBe(201);
  return res.body as { id: number; name: string; isActive: boolean };
}

describe("GET /api/planner/configs", () => {
  it("returns an empty list and null activeId when none have been saved", async () => {
    const res = await request(app).get("/api/planner/configs");
    expect(res.status).toBe(200);
    expectMatchesSchema(ListPlannerConfigsResponse, res.body);
    expect(res.body.configs).toEqual([]);
    expect(res.body.activeId).toBeNull();
  });

  it("auto-activates the first created config and returns its id as activeId", async () => {
    const created = await createCanonicalConfig("First");
    expect(created.isActive).toBe(true);
    const res = await request(app).get("/api/planner/configs");
    expect(res.status).toBe(200);
    expectMatchesSchema(ListPlannerConfigsResponse, res.body);
    expect(res.body.configs).toHaveLength(1);
    expect(res.body.activeId).toBe(created.id);
  });
});

describe("POST /api/planner/configs", () => {
  it("creates a new config and the validation rejects invalid block weeks", async () => {
    await createCanonicalConfig("A");

    const bad = await request(app)
      .post("/api/planner/configs")
      .send({
        name: "Bad",
        startDate: PLAN_START_ISO,
        marathonDate: RACE_DATE_ISO,
        // Sums to 1, far short of the required (TOTAL_WEEKS - 16).
        blocks: [{ focusType: "Base", weeks: 1 }],
      });
    expect(bad.status).toBe(400);
  });

  it("does NOT auto-activate the second config (only first config is auto-active)", async () => {
    const a = await createCanonicalConfig("A");
    const b = await createCanonicalConfig("B");
    expect(b.isActive).toBe(false);
    const list = await request(app).get("/api/planner/configs");
    expect(list.body.activeId).toBe(a.id);
  });

  it("rejects when startDate is not a Monday", async () => {
    const res = await request(app)
      .post("/api/planner/configs")
      .send({
        name: "Tuesday start",
        // 2026-05-05 is a Tuesday.
        startDate: "2026-05-05",
        marathonDate: RACE_DATE_ISO,
        blocks: canonicalBlocks(),
      });
    expect(res.status).toBe(400);
  });
});

describe("PUT /api/planner/configs/:id", () => {
  it("updates an existing config in place and returns the new shape", async () => {
    const a = await createCanonicalConfig("A");
    const res = await request(app)
      .put(`/api/planner/configs/${a.id}`)
      .send({
        name: "A renamed",
        startDate: PLAN_START_ISO,
        marathonDate: RACE_DATE_ISO,
        blocks: canonicalBlocks(),
        notes: "renamed",
      });
    expect(res.status).toBe(200);
    expectMatchesSchema(PlannerConfigSchema, res.body);
    expect(res.body.name).toBe("A renamed");
    expect(res.body.notes).toBe("renamed");
  });

  it("404s on an unknown id", async () => {
    const res = await request(app)
      .put(`/api/planner/configs/9999`)
      .send({
        name: "x",
        startDate: PLAN_START_ISO,
        marathonDate: RACE_DATE_ISO,
        blocks: canonicalBlocks(),
      });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/planner/configs/:id/duplicate", () => {
  it("creates a copy with a defaulted name that is not active and not applied", async () => {
    const a = await createCanonicalConfig("Original");
    const res = await request(app)
      .post(`/api/planner/configs/${a.id}/duplicate`)
      .send({});
    expect(res.status).toBe(201);
    expectMatchesSchema(PlannerConfigSchema, res.body);
    expect(res.body.name).toBe("Original (copy)");
    expect(res.body.isActive).toBe(false);
    expect(res.body.lastAppliedAt).toBeNull();
  });

  it("honors a user-provided name", async () => {
    const a = await createCanonicalConfig("Original");
    const res = await request(app)
      .post(`/api/planner/configs/${a.id}/duplicate`)
      .send({ name: "My branch" });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("My branch");
  });
});

describe("POST /api/planner/configs/:id/activate", () => {
  it("flips the active flag and clears it on every other row", async () => {
    const a = await createCanonicalConfig("A");
    const b = await createCanonicalConfig("B");
    expect(a.isActive).toBe(true);
    expect(b.isActive).toBe(false);

    const res = await request(app).post(`/api/planner/configs/${b.id}/activate`);
    expect(res.status).toBe(200);
    expect(res.body.isActive).toBe(true);

    const list = await request(app).get("/api/planner/configs");
    expect(list.body.activeId).toBe(b.id);
    const aRow = list.body.configs.find((c: { id: number }) => c.id === a.id);
    expect(aRow.isActive).toBe(false);
  });
});

describe("DELETE /api/planner/configs/:id", () => {
  it("refuses to delete the only remaining config", async () => {
    const a = await createCanonicalConfig("Solo");
    const res = await request(app).delete(`/api/planner/configs/${a.id}`);
    expect(res.status).toBe(400);
  });

  it("deletes a non-active config without promoting anyone", async () => {
    const a = await createCanonicalConfig("A");
    const b = await createCanonicalConfig("B");
    const res = await request(app).delete(`/api/planner/configs/${b.id}`);
    expect(res.status).toBe(200);
    expectMatchesSchema(DeletePlannerConfigResponse, res.body);
    expect(res.body.deletedId).toBe(b.id);
    expect(res.body.newActiveId).toBeNull();
    const list = await request(app).get("/api/planner/configs");
    expect(list.body.activeId).toBe(a.id);
  });

  it("promotes the most-recently-updated remaining config when the active one is deleted", async () => {
    const a = await createCanonicalConfig("A"); // auto-active
    const b = await createCanonicalConfig("B");
    // Touch B so it's the most recently updated remaining row.
    await request(app)
      .put(`/api/planner/configs/${b.id}`)
      .send({
        name: "B touched",
        startDate: PLAN_START_ISO,
        marathonDate: RACE_DATE_ISO,
        blocks: canonicalBlocks(),
      });

    const res = await request(app).delete(`/api/planner/configs/${a.id}`);
    expect(res.status).toBe(200);
    expect(res.body.newActiveId).toBe(b.id);
  });
});

describe("POST /api/planner/apply", () => {
  it("400s when no active planner config exists", async () => {
    const res = await request(app).post("/api/planner/apply");
    expect(res.status).toBe(400);
  });

  it("regenerates plan_weeks/plan_days, preserves workouts + measurements, and drops undo snapshots", async () => {
    // Insert one of each "preserved across apply" row plus a snapshot
    // that should be dropped.
    await db.insert(workoutsTable).values({
      date: PLAN_START_ISO,
      equipment: "Outdoor",
      sessionType: "Run",
      durationMin: 30,
      distanceMi: 3.1,
    });
    await db.insert(measurementsTable).values({
      date: PLAN_START_ISO,
      weight: 250,
      notes: "pre-apply",
    });
    await db.insert(resetUndoSnapshotsTable).values({
      token: `planner-test-${Date.now()}`,
      snapshot: [],
      weeksAffected: [],
      expiresAt: new Date(Date.now() + 30_000),
    });

    await createCanonicalConfig("Apply target");

    const res = await request(app).post("/api/planner/apply");
    expect(res.status).toBe(200);
    expectMatchesSchema(ApplyPlannerConfigResponse, res.body);

    expect(res.body.weeksSeeded).toBe(TOTAL_WEEKS);
    expect(res.body.daysSeeded).toBe(TOTAL_WEEKS * 7);
    expect(res.body.workoutsPreserved).toBeGreaterThanOrEqual(1);
    expect(res.body.measurementsPreserved).toBeGreaterThanOrEqual(1);
    expect(res.body.undoSnapshotsWiped).toBeGreaterThanOrEqual(1);
    expect(res.body.totalWeeks).toBe(TOTAL_WEEKS);

    // Workout + measurement survive; snapshot was dropped.
    const wcount = await db.execute<{ count: number }>(
      sql`SELECT COUNT(*)::int AS count FROM workouts WHERE date = ${PLAN_START_ISO}`,
    );
    expect(wcount.rows[0]?.count ?? 0).toBeGreaterThanOrEqual(1);
    const mcount = await db.execute<{ count: number }>(
      sql`SELECT COUNT(*)::int AS count FROM measurements WHERE date = ${PLAN_START_ISO}`,
    );
    expect(mcount.rows[0]?.count ?? 0).toBeGreaterThanOrEqual(1);
    const scount = await db.execute<{ count: number }>(
      sql`SELECT COUNT(*)::int AS count FROM reset_undo_snapshots`,
    );
    expect(scount.rows[0]?.count ?? 0).toBe(0);

    // Workout was rebound to the new plan_day with the same date.
    const wrows = await db
      .select()
      .from(workoutsTable)
      .where(sql`${workoutsTable.date} = ${PLAN_START_ISO}`);
    expect(wrows[0]?.planDayId).not.toBeNull();
  });

  it("treats a saved-but-not-applied SECOND config as not the active applied config", async () => {
    // Create + apply config A.
    await createCanonicalConfig("A");
    await request(app).post("/api/planner/apply").expect(200);

    // Create config B at a DIFFERENT marathon date, but DON'T apply.
    // Pick another valid Mon→Sun window of the same length so validation
    // passes.
    const altStart = "2026-05-11"; // Monday
    const altRace = "2027-05-09"; // Sunday, also 52 weeks out
    const b = await request(app)
      .post("/api/planner/configs")
      .send({
        name: "B",
        startDate: altStart,
        marathonDate: altRace,
        blocks: canonicalBlocks(),
      });
    expect(b.status).toBe(201);
    expect(b.body.isActive).toBe(false);

    // /api/race-week.raceDate must STILL anchor on config A (the applied
    // marathon date), proving the saved-but-not-applied draft did not
    // silently re-anchor.
    const rw = await request(app).get("/api/race-week");
    expect(rw.status).toBe(200);
    expect(rw.body.raceDate).toBe(RACE_DATE_ISO);
  });

  it("activating a different config without applying does NOT shift the race anchor", async () => {
    // Apply A.
    const a = await createCanonicalConfig("A");
    await request(app).post("/api/planner/apply").expect(200);

    // Create B and ACTIVATE it (still no apply).
    const altStart = "2026-05-11";
    const altRace = "2027-05-09";
    const bRes = await request(app)
      .post("/api/planner/configs")
      .send({
        name: "B",
        startDate: altStart,
        marathonDate: altRace,
        blocks: canonicalBlocks(),
      });
    const b = bRes.body as { id: number };
    await request(app).post(`/api/planner/configs/${b.id}/activate`).expect(200);

    // Anchor still points at A's applied marathon date.
    const rw = await request(app).get("/api/race-week");
    expect(rw.status).toBe(200);
    expect(rw.body.raceDate).toBe(RACE_DATE_ISO);

    // Cleanup: re-activate A so subsequent suites have a sane state.
    await request(app).post(`/api/planner/configs/${a.id}/activate`);
  });
});
