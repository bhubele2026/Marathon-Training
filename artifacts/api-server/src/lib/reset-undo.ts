import { randomBytes } from "node:crypto";
import { and, gt, lte, sql } from "drizzle-orm";
import {
  db,
  resetUndoSnapshotsTable,
  type PlanDayRow,
} from "@workspace/db";

// Short window the runner has to hit "Undo" on a reset success toast before
// the snapshot is dropped. Kept as a const so the route handler and the
// response payload can share the same number, and tests can override it.
export const RESET_UNDO_TTL_MS = 30_000;

// Snapshot of every column we restore on undo. Includes both the mutable
// prescription (sessionType .. isRest) and the seed_* columns so the row's
// "edited" marker also returns to its pre-reset value.
export interface PlanDaySnapshot {
  id: number;
  week: number;
  sessionType: string;
  equipment: string;
  description: string;
  distanceMi: number | null;
  cardioMin: number | null;
  pace: string | null;
  strengthLoad: number | null;
  totalLoad: number;
  isRest: boolean;
  seedSessionType: string | null;
  seedEquipment: string | null;
  seedDescription: string | null;
  seedDistanceMi: number | null;
  seedCardioMin: number | null;
  seedPace: string | null;
  seedStrengthLoad: number | null;
  seedTotalLoad: number | null;
  seedIsRest: boolean | null;
}

export interface ResetSnapshot {
  days: PlanDaySnapshot[];
  weeksAffected: number[];
  expiresAt: number;
}

export function snapshotPlanDay(row: PlanDayRow): PlanDaySnapshot {
  return {
    id: row.id,
    week: row.week,
    sessionType: row.sessionType,
    equipment: row.equipment,
    description: row.description,
    distanceMi: row.distanceMi,
    cardioMin: row.cardioMin,
    pace: row.pace,
    strengthLoad: row.strengthLoad,
    totalLoad: row.totalLoad,
    isRest: row.isRest,
    seedSessionType: row.seedSessionType,
    seedEquipment: row.seedEquipment,
    seedDescription: row.seedDescription,
    seedDistanceMi: row.seedDistanceMi,
    seedCardioMin: row.seedCardioMin,
    seedPace: row.seedPace,
    seedStrengthLoad: row.seedStrengthLoad,
    seedTotalLoad: row.seedTotalLoad,
    seedIsRest: row.seedIsRest,
  };
}

// Persistent snapshot store. Keeping the snapshot in the database (rather
// than process memory) means an in-flight Undo survives:
//   * a dev workflow restart between the reset and the undo click,
//   * a production deploy/crash mid-window,
//   * a load balancer routing the Undo request to a different replica.
//
// Each row is keyed by an opaque token returned in the reset response and
// lives for at most RESET_UNDO_TTL_MS. A periodic sweep drops expired rows
// even when nobody calls /undo, and `consumeResetSnapshot` uses a single
// `DELETE ... RETURNING` so a concurrent double-click (even from two
// different replicas) can never run the restore twice.

async function purgeExpired(now: Date): Promise<void> {
  await db
    .delete(resetUndoSnapshotsTable)
    .where(lte(resetUndoSnapshotsTable.expiresAt, now));
}

// Proactive sweep so expired snapshots don't linger between resets when
// nobody calls /undo. Runs every TTL window. Unref'd so it never keeps the
// process alive on its own. Skipped under Vitest where setInterval pins the
// worker open and tests drive expiration explicitly.
const sweepIntervalMs = RESET_UNDO_TTL_MS;
if (process.env.VITEST !== "true" && process.env.NODE_ENV !== "test") {
  const timer = setInterval(() => {
    purgeExpired(new Date()).catch(() => {
      // Swallow sweep errors; the next tick will retry. We deliberately do
      // not crash the process for a transient DB hiccup in the background
      // sweep -- the same row will be picked up on the next pass or on the
      // next consume/store call.
    });
  }, sweepIntervalMs);
  if (typeof timer.unref === "function") timer.unref();
}

export async function storeResetSnapshot(
  days: PlanDaySnapshot[],
  weeksAffected: number[],
  ttlMs: number = RESET_UNDO_TTL_MS,
): Promise<{ token: string; expiresInSeconds: number }> {
  const now = new Date();
  await purgeExpired(now);
  const token = randomBytes(18).toString("base64url");
  const expiresAt = new Date(now.getTime() + ttlMs);
  await db.insert(resetUndoSnapshotsTable).values({
    token,
    snapshot: days,
    weeksAffected: [...weeksAffected],
    expiresAt,
  });
  return { token, expiresInSeconds: Math.round(ttlMs / 1000) };
}

// Atomically reserve the snapshot for a single in-flight undo via a
// `DELETE ... WHERE expires_at > now() RETURNING ...`. Postgres guarantees
// only one concurrent caller (across all replicas) wins the row; everyone
// else sees an empty result and gets 404. On a successful restore the
// caller does nothing else; on failure the caller MUST put the snapshot
// back via `releaseResetSnapshot` so the user can retry within the
// remaining TTL.
export async function consumeResetSnapshot(
  token: string,
): Promise<ResetSnapshot | null> {
  const now = new Date();
  const deleted = await db
    .delete(resetUndoSnapshotsTable)
    .where(
      and(
        sql`${resetUndoSnapshotsTable.token} = ${token}`,
        gt(resetUndoSnapshotsTable.expiresAt, now),
      ),
    )
    .returning();
  const row = deleted[0];
  if (!row) return null;
  return {
    days: row.snapshot as PlanDaySnapshot[],
    weeksAffected: row.weeksAffected as number[],
    expiresAt: row.expiresAt.getTime(),
  };
}

// Put a previously consumed snapshot back into the store -- used to roll back
// a reservation when the restore transaction failed. Skipped silently if the
// original TTL has already elapsed. Uses ON CONFLICT DO NOTHING so a racing
// store of the same token (vanishingly unlikely with 144 random bits) can't
// crash the request.
export async function releaseResetSnapshot(
  token: string,
  snap: ResetSnapshot,
): Promise<void> {
  if (snap.expiresAt <= Date.now()) return;
  await db
    .insert(resetUndoSnapshotsTable)
    .values({
      token,
      snapshot: snap.days,
      weeksAffected: snap.weeksAffected,
      expiresAt: new Date(snap.expiresAt),
    })
    .onConflictDoNothing({ target: resetUndoSnapshotsTable.token });
}

// Test helper: drop everything in the store. Lets test suites start each
// case with a clean undo registry.
export async function _clearResetSnapshotsForTesting(): Promise<void> {
  await db.delete(resetUndoSnapshotsTable);
}

// Test helper: force-expire a token by backdating its expires_at. Lets
// tests exercise the TTL boundary without depending on real wall-clock
// time, and works regardless of replica-vs-DB clock skew.
export async function _expireResetSnapshotForTesting(
  token: string,
): Promise<void> {
  await db
    .update(resetUndoSnapshotsTable)
    .set({ expiresAt: new Date(0) })
    .where(sql`${resetUndoSnapshotsTable.token} = ${token}`);
}

// Test helper: run the periodic sweep on demand so tests can verify that
// expired rows actually get pruned (and not just rejected on consume).
export async function _runResetSnapshotSweepForTesting(): Promise<void> {
  await purgeExpired(new Date());
}
