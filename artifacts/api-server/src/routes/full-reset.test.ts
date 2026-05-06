import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { sql } from "drizzle-orm";
import {
  db,
  measurementsTable,
  planDaysTable,
  planWeeksTable,
  plannerConfigsTable,
  workoutsTable,
  raceWeekChecklistTable,
  resetUndoSnapshotsTable,
} from "@workspace/db";
import { FullResetPlanResponse } from "@workspace/api-zod";
import {
  MARATHON_TAIL_WEEKS,
  TOTAL_WEEKS,
  PLAN_START_ISO,
  RACE_DATE_ISO,
} from "@workspace/plan-generator";
import app from "../app";
import { expectMatchesSchema } from "../test-helpers";

// Full reset is intentionally a "scorched earth" operation that touches
// every mutable table in the schema, so its tests cannot use the
// __test__-prefixed sandbox like the other route tests do — a TRUNCATE
// inside the route would wipe sandbox rows too. Instead the suite runs
// against the seeded production-shaped tables and asserts that after the
// call we end up in a known clean state.

// Task #307: /plan/full-reset leaves plan_weeks/plan_days EMPTY when no
// applied planner config exists. The canonical 52-week assertions in
// this suite depend on PLAN_START_ISO / 281.6 lb baseline / 52 weeks of
// phase ladders, so each test installs + applies a canonical 52-week
// planner config in beforeEach. The empty-fallback path is covered by a
// dedicated test below.
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

async function installAppliedCanonicalConfig() {
  await db.delete(plannerConfigsTable);
  await request(app)
    .post("/api/planner/configs")
    .send({
      name: "Canonical 52w",
      startDate: PLAN_START_ISO,
      marathonDate: RACE_DATE_ISO,
      blocks: canonicalBlocks(),
    });
  await request(app).post("/api/planner/apply").expect(200);
}

beforeEach(async () => {
  // Start every test from a freshly-seeded database so cross-test ordering
  // can't make assertions flaky. Hitting /plan/full-reset is the cheapest
  // way to do that and it also exercises the codepath under test as part
  // of the setup, which is the exact behavior we want to verify.
  await installAppliedCanonicalConfig();
  await request(app).post("/api/plan/full-reset");
});

afterEach(async () => {
  // Restore the seeded baseline so the rest of the test suite (which
  // expects a fully-seeded plan) keeps passing regardless of what this
  // file did to the database.
  await installAppliedCanonicalConfig();
  await request(app).post("/api/plan/full-reset");
});

async function tableCount(table: string): Promise<number> {
  const rows = await db.execute<{ count: number }>(
    sql.raw(`SELECT COUNT(*)::int AS count FROM ${table}`),
  );
  return rows.rows[0]?.count ?? 0;
}

describe("POST /api/plan/full-reset", () => {
  it("returns the canonical seeded counts on a clean database and matches the OpenAPI schema", async () => {
    const res = await request(app).post("/api/plan/full-reset");
    expect(res.status).toBe(200);
    expectMatchesSchema(FullResetPlanResponse, res.body);

    expect(res.body.weeksSeeded).toBe(TOTAL_WEEKS);
    expect(res.body.daysSeeded).toBe(TOTAL_WEEKS * 7);
    expect(res.body.measurementsSeeded).toBe(1);

    // The beforeEach seed already populated these tables, so calling reset
    // again should report what *was* there before this second wipe.
    expect(res.body.workoutsWiped).toBe(0);
    expect(res.body.measurementsWiped).toBe(1);
    expect(res.body.checklistItemsWiped).toBe(0);
    expect(res.body.undoSnapshotsWiped).toBe(0);
  });

  it("wipes logged workouts, measurements, checklist items, and pending undo snapshots and reports the pre-wipe counts", async () => {
    // Insert one of each "user-mutable" row so we can prove they all get
    // wiped and counted in the response.
    await db.insert(workoutsTable).values({
      date: PLAN_START_ISO,
      equipment: "Outdoor",
      sessionType: "Run",
      durationMin: 30,
      distanceMi: 3.1,
    });
    await db.insert(workoutsTable).values({
      date: PLAN_START_ISO,
      equipment: "Tonal",
      sessionType: "Strength",
      strengthLoad: 50,
    });
    await db.insert(measurementsTable).values({
      date: "2026-05-05",
      weight: 280.0,
      notes: "post-baseline check-in",
    });
    await db.insert(raceWeekChecklistTable).values({
      itemId: "test-item-full-reset",
      checked: true,
    });
    // Stash a fake undo snapshot too so the route's "drop pending undos"
    // behavior is covered. Token must be unique; expiresAt is in the past
    // because this row should be wiped regardless of TTL.
    await db.insert(resetUndoSnapshotsTable).values({
      token: `test-token-${Date.now()}`,
      snapshot: [],
      weeksAffected: [],
      expiresAt: new Date(Date.now() + 30_000),
    });

    const before = {
      workouts: await tableCount("workouts"),
      measurements: await tableCount("measurements"),
      checklist: await tableCount("race_week_checklist"),
      snapshots: await tableCount("reset_undo_snapshots"),
    };
    expect(before.workouts).toBeGreaterThanOrEqual(2);
    expect(before.measurements).toBeGreaterThanOrEqual(2);
    expect(before.checklist).toBeGreaterThanOrEqual(1);
    expect(before.snapshots).toBeGreaterThanOrEqual(1);

    const res = await request(app).post("/api/plan/full-reset");
    expect(res.status).toBe(200);
    expectMatchesSchema(FullResetPlanResponse, res.body);
    expect(res.body.workoutsWiped).toBe(before.workouts);
    expect(res.body.measurementsWiped).toBe(before.measurements);
    expect(res.body.checklistItemsWiped).toBe(before.checklist);
    expect(res.body.undoSnapshotsWiped).toBe(before.snapshots);

    // After the reset, the user-mutable tables are clean except for the
    // single seeded baseline measurement that the route reinserts.
    expect(await tableCount("workouts")).toBe(0);
    expect(await tableCount("measurements")).toBe(1);
    expect(await tableCount("race_week_checklist")).toBe(0);
    expect(await tableCount("reset_undo_snapshots")).toBe(0);
  });

  it("reseeds 52 weeks / 364 days with seed_* mirror columns populated and the baseline measurement on PLAN_START_ISO", async () => {
    // Mutate a plan day so we can prove reset wipes the customization.
    const firstDay = (
      await db.select().from(planDaysTable).limit(1)
    )[0]!;
    await db
      .update(planDaysTable)
      .set({
        sessionType: "CUSTOMIZED",
        description: "user edit that should be wiped",
        seedSessionType: firstDay.sessionType,
        seedDescription: firstDay.description,
      })
      .where(sql`${planDaysTable.id} = ${firstDay.id}`);

    const res = await request(app).post("/api/plan/full-reset");
    expect(res.status).toBe(200);

    const weeks = await db.select().from(planWeeksTable);
    const days = await db.select().from(planDaysTable);
    expect(weeks).toHaveLength(TOTAL_WEEKS);
    expect(days).toHaveLength(TOTAL_WEEKS * 7);

    // No row should retain the customized session type after the reset.
    expect(days.find((d) => d.sessionType === "CUSTOMIZED")).toBeUndefined();

    // Every reseeded day should have its seed_* mirror columns populated
    // so a per-day reset has a clean snapshot to restore from.
    for (const d of days) {
      expect(d.seedSessionType).toBe(d.sessionType);
      expect(d.seedEquipment).toBe(d.equipment);
      expect(d.seedDescription).toBe(d.description);
      expect(d.seedTotalLoad).toBe(d.totalLoad);
      expect(d.seedIsRest).toBe(d.isRest);
    }

    const measurements = await db.select().from(measurementsTable);
    expect(measurements).toHaveLength(1);
    expect(measurements[0]!.date).toBe(PLAN_START_ISO);
    expect(measurements[0]!.weight).toBe(281.6);
  });

  it("restarts plan_days serial ids back to 1 so the freshly-seeded campaign starts from id 1", async () => {
    // Insert + delete a workout to bump its id sequence; the reset should
    // restart that sequence too via TRUNCATE ... RESTART IDENTITY.
    await db.insert(workoutsTable).values({
      date: PLAN_START_ISO,
      equipment: "Outdoor",
      sessionType: "Run",
    });

    const res = await request(app).post("/api/plan/full-reset");
    expect(res.status).toBe(200);

    const minPlanDayId = (
      await db.execute<{ min: number | null }>(
        sql`SELECT MIN(id)::int AS min FROM plan_days`,
      )
    ).rows[0]!.min;
    expect(minPlanDayId).toBe(1);

    // Re-insert one workout post-reset; its id should also start back at 1
    // since the workouts sequence was just restarted by the TRUNCATE.
    const inserted = await db
      .insert(workoutsTable)
      .values({
        date: PLAN_START_ISO,
        equipment: "Outdoor",
        sessionType: "Run",
      })
      .returning({ id: workoutsTable.id });
    expect(inserted[0]!.id).toBe(1);
  });

  // Task #307. Empty-fallback path: when no planner_configs row carries
  // a last_applied_at, /plan/full-reset wipes everything and leaves
  // plan_weeks/plan_days EMPTY (no synthetic default-config insert).
  // The UI surfaces an "Open Phase Planner" empty state in that mode.
  it("leaves plan tables empty when no planner config has been applied", async () => {
    // Drop the canonical applied config installed by the suite's
    // beforeEach so this test exercises the empty-fallback path.
    await db.delete(plannerConfigsTable);

    const res = await request(app).post("/api/plan/full-reset");
    expect(res.status).toBe(200);
    expect(res.body.weeksSeeded).toBe(0);
    expect(res.body.daysSeeded).toBe(0);
    expect(res.body.measurementsSeeded).toBe(0);

    // No synthetic config is inserted — planner_configs stays empty.
    const cfgs = await db.select().from(plannerConfigsTable);
    expect(cfgs).toHaveLength(0);

    // Plan tables are empty.
    const weeks = await db.select().from(planWeeksTable);
    const days = await db.select().from(planDaysTable);
    expect(weeks).toHaveLength(0);
    expect(days).toHaveLength(0);

    // /plan/overview returns hasPlan: false and the generic fallback name.
    const overview = await request(app).get("/api/plan/overview");
    expect(overview.status).toBe(200);
    expect(overview.body.hasPlan).toBe(false);
    expect(overview.body.activeConfigName).toBe("Workout Plan");

    const summary = await request(app).get("/api/dashboard/summary");
    expect(summary.status).toBe(200);
    expect(summary.body.hasPlan).toBe(false);
  });

  // Task #307 follow-up: the empty-fallback path must be NON-DESTRUCTIVE
  // toward saved planner drafts (rows with no last_applied_at). The wipe
  // must leave them untouched so the runner can still apply them.
  it("preserves saved planner drafts when the empty-fallback runs", async () => {
    // Wipe any applied configs so the empty-fallback path runs on full-reset.
    await db.delete(plannerConfigsTable);

    // Seed a saved DRAFT — no lastAppliedAt — that the fallback path
    // must leave untouched.
    const draftCreatedAt = new Date("2099-01-15T00:00:00.000Z");
    await db.insert(plannerConfigsTable).values({
      id: 42,
      name: "My saved draft",
      isActive: false,
      startDate: "2099-02-02",
      marathonDate: "2099-08-30",
      blocks: [{ focusType: "Base", weeks: 4 }],
      createdAt: draftCreatedAt,
      updatedAt: draftCreatedAt,
    });

    const res = await request(app).post("/api/plan/full-reset");
    expect(res.status).toBe(200);

    const cfgs = await db.select().from(plannerConfigsTable);
    // Only the original draft remains — no synthetic default insert.
    expect(cfgs).toHaveLength(1);
    const draft = cfgs[0]!;
    expect(draft.id).toBe(42);
    expect(draft.name).toBe("My saved draft");
    expect(draft.lastAppliedAt).toBeNull();
    expect(draft.isActive).toBe(false);
  });
});
