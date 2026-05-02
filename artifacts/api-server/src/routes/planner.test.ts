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
  GetPlannerConfigResponse,
  PutPlannerConfigResponse,
  ApplyPlannerConfigResponse,
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

describe("GET /api/planner/config", () => {
  it("returns null config when no planner config has been saved", async () => {
    const res = await request(app).get("/api/planner/config");
    expect(res.status).toBe(200);
    expectMatchesSchema(GetPlannerConfigResponse, res.body);
    expect(res.body.config).toBeNull();
  });

  it("returns the saved planner config after a PUT", async () => {
    const blocks = canonicalBlocks();
    await request(app)
      .put("/api/planner/config")
      .send({
        startDate: PLAN_START_ISO,
        marathonDate: RACE_DATE_ISO,
        blocks,
      })
      .expect(200);

    const res = await request(app).get("/api/planner/config");
    expect(res.status).toBe(200);
    expectMatchesSchema(GetPlannerConfigResponse, res.body);
    expect(res.body.config).not.toBeNull();
    expect(res.body.config.startDate).toBe(PLAN_START_ISO);
    expect(res.body.config.marathonDate).toBe(RACE_DATE_ISO);
    expect(res.body.config.blocks).toHaveLength(blocks.length);
    expect(res.body.config.blocks[0].focusType).toBe("Base");
  });
});

describe("PUT /api/planner/config", () => {
  it("upserts and returns the saved config matching the OpenAPI schema", async () => {
    const res = await request(app)
      .put("/api/planner/config")
      .send({
        startDate: PLAN_START_ISO,
        marathonDate: RACE_DATE_ISO,
        blocks: canonicalBlocks(),
        notes: "first config",
      });
    expect(res.status).toBe(200);
    expectMatchesSchema(PutPlannerConfigResponse, res.body);
    expect(res.body.notes).toBe("first config");

    // Second PUT updates in place (single-row table, no duplicate insert).
    const res2 = await request(app)
      .put("/api/planner/config")
      .send({
        startDate: PLAN_START_ISO,
        marathonDate: RACE_DATE_ISO,
        blocks: canonicalBlocks(),
        notes: "updated",
      });
    expect(res2.status).toBe(200);
    expect(res2.body.notes).toBe("updated");

    const rows = await db.select().from(plannerConfigsTable);
    expect(rows).toHaveLength(1);
  });

  it("rejects when block weeks do not sum to (totalWeeks - 16)", async () => {
    const res = await request(app)
      .put("/api/planner/config")
      .send({
        startDate: PLAN_START_ISO,
        marathonDate: RACE_DATE_ISO,
        // Sums to 1, far short of the required (TOTAL_WEEKS - 16).
        blocks: [{ focusType: "Base", weeks: 1 }],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it("rejects when startDate is not a Monday", async () => {
    // 2026-05-05 is a Tuesday.
    const res = await request(app)
      .put("/api/planner/config")
      .send({
        startDate: "2026-05-05",
        marathonDate: RACE_DATE_ISO,
        blocks: canonicalBlocks(),
      });
    expect(res.status).toBe(400);
  });

  it("rejects when marathonDate is in the past", async () => {
    // 2020-05-03 is a Sunday but already in the past — server-side todayISO
    // check should reject so the runner can't seed a backwards plan.
    const res = await request(app)
      .put("/api/planner/config")
      .send({
        startDate: "2020-04-27",
        marathonDate: "2020-05-03",
        blocks: canonicalBlocks(),
      });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/future|past/i);
  });

  it("rejects when marathonDate is not a Sunday", async () => {
    // 2027-05-03 is a Monday, not a Sunday.
    const res = await request(app)
      .put("/api/planner/config")
      .send({
        startDate: PLAN_START_ISO,
        marathonDate: "2027-05-03",
        blocks: canonicalBlocks(),
      });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/planner/apply", () => {
  it("400s when no planner config has been saved", async () => {
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

    await request(app)
      .put("/api/planner/config")
      .send({
        startDate: PLAN_START_ISO,
        marathonDate: RACE_DATE_ISO,
        blocks: canonicalBlocks(),
      })
      .expect(200);

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

  it("treats a draft saved AFTER apply (without re-apply) as not the active applied config", async () => {
    // Apply config A first.
    await request(app)
      .put("/api/planner/config")
      .send({
        startDate: PLAN_START_ISO,
        marathonDate: RACE_DATE_ISO,
        blocks: canonicalBlocks(),
      })
      .expect(200);
    await request(app).post("/api/planner/apply").expect(200);

    // Now SAVE a different draft B without applying. Pick another valid
    // Mon→Sun window of the same length so PUT validation passes.
    const altStart = "2026-05-11"; // Monday
    const altRace = "2027-05-09"; // Sunday, also 52 weeks out
    await request(app)
      .put("/api/planner/config")
      .send({
        startDate: altStart,
        marathonDate: altRace,
        blocks: canonicalBlocks(),
      })
      .expect(200);

    // /api/race-week.raceDate must STILL anchor on config A (the applied
    // marathon date), proving the draft did not silently re-anchor.
    const rw = await request(app).get("/api/race-week");
    expect(rw.status).toBe(200);
    expect(rw.body.raceDate).toBe(RACE_DATE_ISO);
  });
});
