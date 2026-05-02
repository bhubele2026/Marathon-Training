import { randomBytes } from "node:crypto";
import type { PlanDayRow } from "@workspace/db";

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

// In-memory store of pre-reset snapshots, keyed by an opaque undo token. The
// snapshot lives only for RESET_UNDO_TTL_MS. After that the entry is dropped
// and any later POST /plan/reset/undo for the same token returns 404.
//
// In-memory is fine here: the undo window is short, the snapshot is only
// useful to the same browser session, and losing the entry on server restart
// just means the runner has to re-edit by hand -- the same fallback they
// have today. No DB migration needed.
const snapshots = new Map<string, ResetSnapshot>();

function purgeExpired(now: number): void {
  for (const [token, snap] of snapshots) {
    if (snap.expiresAt <= now) snapshots.delete(token);
  }
}

// Proactive sweep so expired snapshots don't linger in memory between resets
// when nobody calls /undo. Runs every TTL window. Unref'd so it never keeps
// the process alive on its own. Skipped under Vitest where setInterval pins
// the worker open and `_clearResetSnapshotsForTesting` is the source of truth.
const sweepIntervalMs = RESET_UNDO_TTL_MS;
if (process.env.VITEST !== "true" && process.env.NODE_ENV !== "test") {
  const timer = setInterval(() => purgeExpired(Date.now()), sweepIntervalMs);
  if (typeof timer.unref === "function") timer.unref();
}

export function storeResetSnapshot(
  days: PlanDaySnapshot[],
  weeksAffected: number[],
  ttlMs: number = RESET_UNDO_TTL_MS,
): { token: string; expiresInSeconds: number } {
  const now = Date.now();
  purgeExpired(now);
  const token = randomBytes(18).toString("base64url");
  snapshots.set(token, {
    days,
    weeksAffected: [...weeksAffected],
    expiresAt: now + ttlMs,
  });
  return { token, expiresInSeconds: Math.round(ttlMs / 1000) };
}

// Atomically reserve the snapshot for a single in-flight undo. The entry is
// removed from the store immediately, so a concurrent second request gets
// 404. On a successful restore the caller does nothing else; on failure the
// caller MUST put the snapshot back via `releaseResetSnapshot` so the user
// can retry within the remaining TTL.
export function consumeResetSnapshot(token: string): ResetSnapshot | null {
  const now = Date.now();
  purgeExpired(now);
  const snap = snapshots.get(token);
  if (!snap) return null;
  snapshots.delete(token);
  if (snap.expiresAt <= now) return null;
  return snap;
}

// Put a previously consumed snapshot back into the store -- used to roll back
// a reservation when the restore transaction failed. Skipped silently if the
// original TTL has already elapsed.
export function releaseResetSnapshot(token: string, snap: ResetSnapshot): void {
  if (snap.expiresAt <= Date.now()) return;
  snapshots.set(token, snap);
}

// Test helper: drop everything in the store. Lets test suites start each
// case with a clean undo registry.
export function _clearResetSnapshotsForTesting(): void {
  snapshots.clear();
}
