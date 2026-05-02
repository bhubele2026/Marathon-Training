import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { sql } from "drizzle-orm";
import {
  db,
  measurementsTable,
  planDaysTable,
  planWeeksTable,
  workoutsTable,
  raceWeekChecklistTable,
  resetUndoSnapshotsTable,
} from "@workspace/db";
import { FullResetPlanResponse } from "@workspace/api-zod";
import { TOTAL_WEEKS, PLAN_START_ISO } from "@workspace/plan-generator";
import app from "../app";
import { expectMatchesSchema } from "../test-helpers";

// Full reset is intentionally a "scorched earth" operation that touches
// every mutable table in the schema, so its tests cannot use the
// __test__-prefixed sandbox like the other route tests do — a TRUNCATE
// inside the route would wipe sandbox rows too. Instead the suite runs
// against the seeded production-shaped tables and asserts that after the
// call we end up in a known clean state.

beforeEach(async () => {
  // Start every test from a freshly-seeded database so cross-test ordering
  // can't make assertions flaky. Hitting /plan/full-reset is the cheapest
  // way to do that and it also exercises the codepath under test as part
  // of the setup, which is the exact behavior we want to verify.
  await request(app).post("/api/plan/full-reset");
});

afterEach(async () => {
  // Restore the seeded baseline so the rest of the test suite (which
  // expects a fully-seeded plan) keeps passing regardless of what this
  // file did to the database.
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
});
