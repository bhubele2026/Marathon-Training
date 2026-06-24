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

// Task #326: /plan/full-reset is now scorched-earth: it always wipes
// every mutable table AND demotes any applied planner config back to
// draft (clears applied_* + last_applied_at) so plan_weeks/plan_days
// stay EMPTY until the runner re-applies a config from /planner. That
// means every test in this file should land in the empty-plan state,
// regardless of whether an applied config existed beforehand.
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
  // Start every test from a clean wiped database. Apply a canonical
  // config first so we can assert that Full Reset wipes its plan rows
  // AND demotes the config back to draft, then call Full Reset.
  await installAppliedCanonicalConfig();
  await request(app).post("/api/plan/full-reset");
});

afterEach(async () => {
  // Re-apply the canonical config and immediately Full Reset so the
  // database is left in a known empty state for downstream suites.
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
  it("returns zero seeded counts and matches the OpenAPI schema (Task #326)", async () => {
    const res = await request(app).post("/api/plan/full-reset");
    expect(res.status).toBe(200);
    expectMatchesSchema(FullResetPlanResponse, res.body);

    // Task #326: Full Reset never reseeds. The runner has to re-apply
    // a config from /planner before plan rows come back.
    expect(res.body.weeksSeeded).toBe(0);
    expect(res.body.daysSeeded).toBe(0);
    expect(res.body.measurementsSeeded).toBe(0);

    // The beforeEach already wiped the database, so this second reset
    // sees nothing to wipe and reports zero counts.
    expect(res.body.workoutsWiped).toBe(0);
    expect(res.body.measurementsWiped).toBe(0);
    expect(res.body.undoSnapshotsWiped).toBe(0);
  });

  it("wipes logged workouts, measurements, and pending undo snapshots and reports the pre-wipe counts", async () => {
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
      snapshots: await tableCount("reset_undo_snapshots"),
    };
    expect(before.workouts).toBeGreaterThanOrEqual(2);
    expect(before.measurements).toBeGreaterThanOrEqual(1);
    expect(before.snapshots).toBeGreaterThanOrEqual(1);

    const res = await request(app).post("/api/plan/full-reset");
    expect(res.status).toBe(200);
    expectMatchesSchema(FullResetPlanResponse, res.body);
    expect(res.body.workoutsWiped).toBe(before.workouts);
    expect(res.body.measurementsWiped).toBe(before.measurements);
    expect(res.body.undoSnapshotsWiped).toBe(before.snapshots);

    // Task #326: every user-mutable table is empty after the reset.
    // No baseline measurement is reinserted — the runner has to apply
    // a planner config to repopulate the campaign.
    expect(await tableCount("workouts")).toBe(0);
    expect(await tableCount("measurements")).toBe(0);
    expect(await tableCount("reset_undo_snapshots")).toBe(0);
  });

  // Task #326: Full Reset wipes plan_weeks/plan_days even when an
  // applied planner config exists, AND demotes that config back to
  // draft state so subsequent reads see "no applied config".
  it("wipes plan_weeks/plan_days and demotes the applied planner config back to draft", async () => {
    // Re-install + apply the canonical config so this test starts from
    // a populated plan that Full Reset must wipe.
    await installAppliedCanonicalConfig();

    // Sanity: plan_days is populated and the applied config has its
    // applied_* snapshot + last_applied_at set.
    expect(await tableCount("plan_weeks")).toBe(TOTAL_WEEKS);
    expect(await tableCount("plan_days")).toBe(TOTAL_WEEKS * 7);
    const beforeCfgs = await db.select().from(plannerConfigsTable);
    expect(beforeCfgs).toHaveLength(1);
    expect(beforeCfgs[0]!.lastAppliedAt).not.toBeNull();
    expect(beforeCfgs[0]!.appliedStartDate).not.toBeNull();
    expect(beforeCfgs[0]!.appliedBlocks).not.toBeNull();

    const res = await request(app).post("/api/plan/full-reset");
    expect(res.status).toBe(200);
    expect(res.body.weeksSeeded).toBe(0);
    expect(res.body.daysSeeded).toBe(0);
    expect(res.body.measurementsSeeded).toBe(0);

    // Plan tables empty.
    expect(await tableCount("plan_weeks")).toBe(0);
    expect(await tableCount("plan_days")).toBe(0);

    // Config row preserved (name + blocks intact) but demoted to draft.
    const afterCfgs = await db.select().from(plannerConfigsTable);
    expect(afterCfgs).toHaveLength(1);
    const demoted = afterCfgs[0]!;
    expect(demoted.name).toBe("Canonical 52w");
    expect(demoted.blocks).not.toBeNull();
    expect(demoted.lastAppliedAt).toBeNull();
    expect(demoted.appliedStartDate).toBeNull();
    expect(demoted.appliedMarathonDate).toBeNull();
    expect(demoted.appliedBlocks).toBeNull();
    expect(demoted.appliedEntries).toBeNull();

    // /plan/overview reflects the empty + generic-fallback state.
    const overview = await request(app).get("/api/plan/overview");
    expect(overview.status).toBe(200);
    expect(overview.body.hasPlan).toBe(false);
    expect(overview.body.activeConfigName).toBe("Workout Plan");

    // Re-applying the (still-active) demoted config repopulates the
    // plan rows, proving Full Reset doesn't lose the saved config.
    const apply = await request(app).post("/api/planner/apply");
    expect(apply.status).toBe(200);
    expect(await tableCount("plan_weeks")).toBe(TOTAL_WEEKS);
    expect(await tableCount("plan_days")).toBe(TOTAL_WEEKS * 7);
  });

  it("restarts the workouts serial id back to 1 via TRUNCATE ... RESTART IDENTITY", async () => {
    await db.insert(workoutsTable).values({
      date: PLAN_START_ISO,
      equipment: "Outdoor",
      sessionType: "Run",
    });

    const res = await request(app).post("/api/plan/full-reset");
    expect(res.status).toBe(200);

    // Re-insert one workout post-reset; its id should start back at 1
    // since the workouts sequence was restarted by the TRUNCATE.
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

  it("leaves plan tables empty when no planner config has been applied", async () => {
    // Drop every planner_configs row so this test exercises the
    // "no applied config existed in the first place" path.
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

  // Saved drafts (no last_applied_at, applied_* already null) must be
  // left untouched in shape so the runner can still apply them.
  it("preserves saved planner drafts across Full Reset", async () => {
    // Wipe any applied configs so only the draft remains.
    await db.delete(plannerConfigsTable);

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
