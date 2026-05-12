import { randomBytes } from "node:crypto";
import { and, sql } from "drizzle-orm";
import {
  db,
  resetUndoSnapshotsTable,
  type PlanDayRow,
  type PlanWeekRow,
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
  // Multi-machine chip rail (task #77). Nullable so snapshots taken from
  // rows that predate the backfill round-trip cleanly through undo.
  equipmentList: string[] | null;
  description: string;
  distanceMi: number | null;
  strengthMin: number | null;
  cardioMin: number | null;
  runMin: number | null;
  pace: string | null;
  strengthLoad: number | null;
  totalLoad: number;
  isRest: boolean;
  seedSessionType: string | null;
  seedEquipment: string | null;
  seedEquipmentList: string[] | null;
  seedDescription: string | null;
  seedDistanceMi: number | null;
  seedStrengthMin: number | null;
  seedCardioMin: number | null;
  seedRunMin: number | null;
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

// Snapshot taken before the "Reset Entire Plan" empty-wipe so the action
// stays undoable for the same ~30s window as week- and day-level resets.
// Captures every plan_weeks row, every plan_days row (verbatim, including
// id and seed_* columns), every applied planner_configs row's
// applied_*/last_applied_at columns, and the (workoutId → planDayId)
// pairs that the wipe detached so the FK linkage can be restored on undo.
export interface PlanWeekSnapshot {
  week: number;
  phase: string;
  startDate: string;
  endDate: string;
  plannedStrength: number | null;
  plannedCardio: number | null;
  plannedTotalLoad: number;
  plannedMiles: number;
  longRunMi: number;
}

export interface PlanDayFullSnapshot {
  id: number;
  week: number;
  phase: string;
  date: string;
  day: string;
  sourceEntryIndex: number;
  sourceEntryLabel: string | null;
  strengthLoad: number | null;
  equipment: string;
  equipmentList: string[] | null;
  description: string;
  strengthMin: number | null;
  cardioMin: number | null;
  runMin: number | null;
  distanceMi: number | null;
  pace: string | null;
  sessionType: string;
  isRest: boolean;
  totalLoad: number;
  seedSessionType: string | null;
  seedEquipment: string | null;
  seedEquipmentList: string[] | null;
  seedDescription: string | null;
  seedDistanceMi: number | null;
  seedStrengthMin: number | null;
  seedCardioMin: number | null;
  seedRunMin: number | null;
  seedPace: string | null;
  seedStrengthLoad: number | null;
  seedTotalLoad: number | null;
  seedIsRest: boolean | null;
}

export interface AppliedPlannerConfigSnapshot {
  id: number;
  // ISO string for JSON portability; restored via NOW()-style cast on undo.
  lastAppliedAt: string;
  appliedStartDate: string | null;
  appliedMarathonDate: string | null;
  // Drizzle stores these as jsonb, opaque to the snapshot layer.
  appliedBlocks: unknown;
  appliedEntries: unknown;
  appliedStartWeight: number | null;
  appliedGoalWeight: number | null;
  // Task #335. Captured starting easy pace (sec/mi) so undo restores
  // the exact campaign ramp anchor that was in effect before reset.
  appliedStartingPaceSec: number | null;
}

export interface DetachedWorkoutSnapshot {
  workoutId: number;
  planDayId: number;
}

export interface EntirePlanWipeSnapshotPayload {
  planWeeks: PlanWeekSnapshot[];
  planDays: PlanDayFullSnapshot[];
  appliedConfigs: AppliedPlannerConfigSnapshot[];
  detachedWorkouts: DetachedWorkoutSnapshot[];
}

// Discriminated envelope persisted in `reset_undo_snapshots.snapshot` for
// entire-plan wipes. Week- and day-level resets keep their legacy raw
// `PlanDaySnapshot[]` shape (no envelope) for back-compat with snapshots
// that may already be in the DB at deploy time. `consumeResetSnapshot`
// dispatches by `Array.isArray(...)`.
interface EntirePlanWipeEnvelope {
  kind: "entire-plan-wipe";
  payload: EntirePlanWipeSnapshotPayload;
}

export interface EntirePlanWipeResetSnapshot {
  kind: "entire-plan-wipe";
  payload: EntirePlanWipeSnapshotPayload;
  weeksAffected: number[];
  expiresAt: number;
}

export type AnyResetSnapshot =
  | ({ kind: "days" } & ResetSnapshot)
  | EntirePlanWipeResetSnapshot;

export function snapshotPlanDay(row: PlanDayRow): PlanDaySnapshot {
  return {
    id: row.id,
    week: row.week,
    sessionType: row.sessionType,
    equipment: row.equipment,
    equipmentList: row.equipmentList,
    description: row.description,
    distanceMi: row.distanceMi,
    strengthMin: row.strengthMin,
    cardioMin: row.cardioMin,
    runMin: row.runMin,
    pace: row.pace,
    strengthLoad: row.strengthLoad,
    totalLoad: row.totalLoad,
    isRest: row.isRest,
    seedSessionType: row.seedSessionType,
    seedEquipment: row.seedEquipment,
    seedEquipmentList: row.seedEquipmentList,
    seedDescription: row.seedDescription,
    seedDistanceMi: row.seedDistanceMi,
    seedStrengthMin: row.seedStrengthMin,
    seedCardioMin: row.seedCardioMin,
    seedRunMin: row.seedRunMin,
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

async function purgeExpired(): Promise<void> {
  // Compare against the database's clock so a fast-skewed replica can't
  // delete still-valid snapshots and effectively shorten the undo window
  // for everyone.
  await db
    .delete(resetUndoSnapshotsTable)
    .where(sql`${resetUndoSnapshotsTable.expiresAt} <= NOW()`);
}

// Proactive sweep so expired snapshots don't linger between resets when
// nobody calls /undo. Runs every TTL window. Unref'd so it never keeps the
// process alive on its own. Skipped under Vitest where setInterval pins the
// worker open and tests drive expiration explicitly.
const sweepIntervalMs = RESET_UNDO_TTL_MS;
if (process.env.VITEST !== "true" && process.env.NODE_ENV !== "test") {
  const timer = setInterval(() => {
    purgeExpired().catch(() => {
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
  await purgeExpired();
  const token = randomBytes(18).toString("base64url");
  // Compute the expiration timestamp on the database (`NOW() + interval`)
  // rather than in JS so a clock skew between API replicas can't shorten
  // (or stretch) the undo window. Every replica then reads the same
  // canonical wall-clock value back through `expires_at`.
  const ttlSeconds = Math.round(ttlMs / 1000);
  await db.insert(resetUndoSnapshotsTable).values({
    token,
    snapshot: days,
    weeksAffected: [...weeksAffected],
    expiresAt: sql`NOW() + (${ttlSeconds} || ' seconds')::interval`,
  });
  return { token, expiresInSeconds: ttlSeconds };
}

// Snapshot an entire-plan wipe under the same TTL as week/day resets.
// Stored as a discriminated envelope under the same `snapshot` JSONB
// column so /plan/reset/undo can fan out by shape.
export async function storeEntirePlanWipeSnapshot(
  payload: EntirePlanWipeSnapshotPayload,
  ttlMs: number = RESET_UNDO_TTL_MS,
): Promise<{ token: string; expiresInSeconds: number }> {
  await purgeExpired();
  const token = randomBytes(18).toString("base64url");
  const ttlSeconds = Math.round(ttlMs / 1000);
  const envelope: EntirePlanWipeEnvelope = {
    kind: "entire-plan-wipe",
    payload,
  };
  // weeksAffected mirrors the week numbers we just wiped so the response
  // and any operator audit query can see the breadth without parsing
  // the full envelope.
  const weeksAffected = payload.planWeeks
    .map((w) => w.week)
    .sort((a, b) => a - b);
  await db.insert(resetUndoSnapshotsTable).values({
    token,
    snapshot: envelope,
    weeksAffected,
    expiresAt: sql`NOW() + (${ttlSeconds} || ' seconds')::interval`,
  });
  return { token, expiresInSeconds: ttlSeconds };
}

// Same as `storeEntirePlanWipeSnapshot` but inserts via the supplied
// transaction so the snapshot row is committed atomically with the
// destructive plan_weeks/plan_days/planner_configs/workouts mutations
// in `/plan/reset`. Callers that wrap the wipe in a transaction MUST
// use this variant — calling the post-commit `db`-bound helper would
// open a window where the tables are wiped but the undo snapshot
// failed to persist (DB hiccup, serialization error, replica
// disconnect), silently revoking the runner's promised undo.
export async function storeEntirePlanWipeSnapshotInTx(
  tx: Pick<typeof db, "insert">,
  payload: EntirePlanWipeSnapshotPayload,
  ttlMs: number = RESET_UNDO_TTL_MS,
): Promise<{ token: string; expiresInSeconds: number }> {
  const token = randomBytes(18).toString("base64url");
  const ttlSeconds = Math.round(ttlMs / 1000);
  const envelope: EntirePlanWipeEnvelope = {
    kind: "entire-plan-wipe",
    payload,
  };
  const weeksAffected = payload.planWeeks
    .map((w) => w.week)
    .sort((a, b) => a - b);
  await tx.insert(resetUndoSnapshotsTable).values({
    token,
    snapshot: envelope,
    weeksAffected,
    expiresAt: sql`NOW() + (${ttlSeconds} || ' seconds')::interval`,
  });
  return { token, expiresInSeconds: ttlSeconds };
}

// Build a PlanWeekSnapshot from a PlanWeekRow.
export function snapshotPlanWeek(row: PlanWeekRow): PlanWeekSnapshot {
  return {
    week: row.week,
    phase: row.phase,
    startDate: row.startDate,
    endDate: row.endDate,
    plannedStrength: row.plannedStrength,
    plannedCardio: row.plannedCardio,
    plannedTotalLoad: row.plannedTotalLoad,
    plannedMiles: row.plannedMiles,
    longRunMi: row.longRunMi,
  };
}

// Verbatim snapshot of every column on a plan_days row, including its
// integer id (so undo can re-insert it back at the same id and any
// detached workout FK can re-link). Distinct from `snapshotPlanDay`,
// which targets the per-day-edit rollback flow and only stores the
// fields that flow controls.
export function snapshotPlanDayFull(row: PlanDayRow): PlanDayFullSnapshot {
  return {
    id: row.id,
    week: row.week,
    phase: row.phase,
    date: row.date,
    day: row.day,
    sourceEntryIndex: row.sourceEntryIndex,
    sourceEntryLabel: row.sourceEntryLabel,
    strengthLoad: row.strengthLoad,
    equipment: row.equipment,
    equipmentList: row.equipmentList,
    description: row.description,
    strengthMin: row.strengthMin,
    cardioMin: row.cardioMin,
    runMin: row.runMin,
    distanceMi: row.distanceMi,
    pace: row.pace,
    sessionType: row.sessionType,
    isRest: row.isRest,
    totalLoad: row.totalLoad,
    seedSessionType: row.seedSessionType,
    seedEquipment: row.seedEquipment,
    seedEquipmentList: row.seedEquipmentList,
    seedDescription: row.seedDescription,
    seedDistanceMi: row.seedDistanceMi,
    seedStrengthMin: row.seedStrengthMin,
    seedCardioMin: row.seedCardioMin,
    seedRunMin: row.seedRunMin,
    seedPace: row.seedPace,
    seedStrengthLoad: row.seedStrengthLoad,
    seedTotalLoad: row.seedTotalLoad,
    seedIsRest: row.seedIsRest,
  };
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
): Promise<AnyResetSnapshot | null> {
  const deleted = await db
    .delete(resetUndoSnapshotsTable)
    .where(
      and(
        sql`${resetUndoSnapshotsTable.token} = ${token}`,
        sql`${resetUndoSnapshotsTable.expiresAt} > NOW()`,
      ),
    )
    .returning();
  const row = deleted[0];
  if (!row) return null;
  // Discriminate by JSONB shape:
  //   - legacy week/day reset snapshots stored the bare PlanDaySnapshot[]
  //   - entire-plan wipe snapshots store an envelope { kind, payload }
  // Array.isArray() distinguishes them without needing a schema migration.
  const snap = row.snapshot;
  if (Array.isArray(snap)) {
    return {
      kind: "days",
      days: snap as PlanDaySnapshot[],
      weeksAffected: row.weeksAffected as number[],
      expiresAt: row.expiresAt.getTime(),
    };
  }
  const env = snap as EntirePlanWipeEnvelope;
  return {
    kind: "entire-plan-wipe",
    payload: env.payload,
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
  snap: AnyResetSnapshot,
): Promise<void> {
  // Gate the re-insert on the database's clock rather than the local
  // process clock so a replica with a skewed wall clock can neither
  // resurrect an already-expired snapshot nor drop a still-valid one.
  // The original `expires_at` (set with NOW() + interval at store time)
  // remains the canonical deadline.
  const expiresAt = new Date(snap.expiresAt);
  // Re-marshal the snapshot back into the same on-disk JSONB shape
  // we read it from so a subsequent consume sees the original variant.
  const snapshotJson =
    snap.kind === "days"
      ? JSON.stringify(snap.days)
      : JSON.stringify({
          kind: "entire-plan-wipe",
          payload: snap.payload,
        } satisfies EntirePlanWipeEnvelope);
  await db.execute(sql`
    INSERT INTO ${resetUndoSnapshotsTable}
      (token, snapshot, weeks_affected, expires_at)
    SELECT
      ${token},
      ${snapshotJson}::jsonb,
      ${JSON.stringify(snap.weeksAffected)}::jsonb,
      ${expiresAt}
    WHERE ${expiresAt} > NOW()
    ON CONFLICT (token) DO NOTHING
  `);
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
  await purgeExpired();
}
