import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, resetUndoSnapshotsTable } from "@workspace/db";
import { sql } from "drizzle-orm";

import {
  _clearResetSnapshotsForTesting,
  _expireResetSnapshotForTesting,
  _runResetSnapshotSweepForTesting,
  consumeResetSnapshot,
  type PlanDaySnapshot,
  releaseResetSnapshot,
  storeResetSnapshot,
} from "./reset-undo";

const sampleDay: PlanDaySnapshot = {
  id: 1,
  week: 1,
  sessionType: "Run",
  equipment: "Outdoor",
  equipmentList: ["Outdoor"],
  description: "easy",
  distanceMi: 5,
  strengthMin: 0,
  cardioMin: 0,
  runMin: 50,
  pace: null,
  strengthLoad: null,
  totalLoad: 50,
  isRest: false,
  seedSessionType: "Run",
  seedEquipment: "Outdoor",
  seedEquipmentList: ["Outdoor"],
  seedDescription: "easy",
  seedDistanceMi: 5,
  seedStrengthMin: 0,
  seedCardioMin: 0,
  seedRunMin: 50,
  seedPace: null,
  seedStrengthLoad: null,
  seedTotalLoad: 50,
  seedIsRest: false,
};

beforeAll(async () => {
  await _clearResetSnapshotsForTesting();
});

beforeEach(async () => {
  await _clearResetSnapshotsForTesting();
});

afterEach(async () => {
  await _clearResetSnapshotsForTesting();
});

describe("reset-undo persistence", () => {
  it("returns the snapshot inside the window and rejects it after expiration", async () => {
    const { token, expiresInSeconds } = await storeResetSnapshot(
      [sampleDay],
      [sampleDay.week],
    );
    expect(expiresInSeconds).toBe(30);
    const got = await consumeResetSnapshot(token);
    expect(got).not.toBeNull();
    expect(got!.kind).toBe("days");
    if (got!.kind !== "days") throw new Error("expected days variant");
    expect(got!.days).toEqual([sampleDay]);
    expect(got!.weeksAffected).toEqual([sampleDay.week]);

    const { token: token2 } = await storeResetSnapshot(
      [sampleDay],
      [sampleDay.week],
    );
    await _expireResetSnapshotForTesting(token2);
    expect(await consumeResetSnapshot(token2)).toBeNull();
  });

  it("treats unknown tokens as expired/missing", async () => {
    expect(await consumeResetSnapshot("never-issued")).toBeNull();
  });

  it("only allows a single successful consume per token", async () => {
    const { token } = await storeResetSnapshot([sampleDay], [sampleDay.week]);
    expect(await consumeResetSnapshot(token)).not.toBeNull();
    expect(await consumeResetSnapshot(token)).toBeNull();
  });

  it("survives a simulated process restart by reading the snapshot back from the database", async () => {
    // The module no longer keeps any in-memory state -- the snapshot lives
    // entirely in the `reset_undo_snapshots` table, which is exactly the
    // shared resource a freshly-restarted API process (or a second replica)
    // also has access to. We assert the row is physically present in the DB
    // after store, then consume it through the public API to prove the
    // restored snapshot is byte-for-byte the one we stored.
    const { token } = await storeResetSnapshot([sampleDay], [sampleDay.week]);
    const persisted = await db
      .select()
      .from(resetUndoSnapshotsTable)
      .where(sql`${resetUndoSnapshotsTable.token} = ${token}`);
    expect(persisted).toHaveLength(1);
    const got = await consumeResetSnapshot(token);
    expect(got).not.toBeNull();
    expect(got!.kind).toBe("days");
    if (got!.kind !== "days") throw new Error("expected days variant");
    expect(got!.days).toEqual([sampleDay]);
    expect(got!.weeksAffected).toEqual([sampleDay.week]);
  });

  it("releases the reservation back to the store so the runner can retry", async () => {
    const { token } = await storeResetSnapshot([sampleDay], [sampleDay.week]);
    const reserved = await consumeResetSnapshot(token);
    expect(reserved).not.toBeNull();
    // Restore failed -> put it back; a follow-up consume must succeed.
    await releaseResetSnapshot(token, reserved!);
    expect(await consumeResetSnapshot(token)).not.toBeNull();
  });

  it("does not release a snapshot whose TTL has already elapsed", async () => {
    const { token } = await storeResetSnapshot([sampleDay], [sampleDay.week]);
    const reserved = await consumeResetSnapshot(token);
    expect(reserved).not.toBeNull();
    // Pretend the TTL has elapsed by the time the catch handler runs.
    const expired = { ...reserved!, expiresAt: Date.now() - 1 };
    await releaseResetSnapshot(token, expired);
    expect(await consumeResetSnapshot(token)).toBeNull();
  });

  it("prunes expired rows on the periodic sweep", async () => {
    const { token } = await storeResetSnapshot([sampleDay], [sampleDay.week]);
    await _expireResetSnapshotForTesting(token);
    // Row is still physically present until the sweep runs.
    const before = await db.execute<{ count: number }>(
      sql`SELECT COUNT(*)::int AS count FROM reset_undo_snapshots WHERE token = ${token}`,
    );
    expect(before.rows[0]?.count).toBe(1);

    await _runResetSnapshotSweepForTesting();

    const after = await db.execute<{ count: number }>(
      sql`SELECT COUNT(*)::int AS count FROM reset_undo_snapshots WHERE token = ${token}`,
    );
    expect(after.rows[0]?.count).toBe(0);
  });

  it("only one of two concurrent consumes succeeds (multi-replica safety)", async () => {
    const { token } = await storeResetSnapshot([sampleDay], [sampleDay.week]);
    const [a, b] = await Promise.all([
      consumeResetSnapshot(token),
      consumeResetSnapshot(token),
    ]);
    const winners = [a, b].filter((x) => x !== null);
    expect(winners).toHaveLength(1);
    // And the row is gone from the DB.
    const remaining = await db
      .select()
      .from(resetUndoSnapshotsTable)
      .where(sql`${resetUndoSnapshotsTable.token} = ${token}`);
    expect(remaining).toHaveLength(0);
  });
});
