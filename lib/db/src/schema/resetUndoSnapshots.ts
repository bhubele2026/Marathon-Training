import { pgTable, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";

// Persistent store of plan-reset snapshots. The runner can hit "Undo" within a
// short TTL after a reset to put their customizations back; persisting the
// snapshot here (instead of in process memory) means an API restart, deploy,
// or crash between the reset and the undo doesn't silently swallow the
// snapshot, and lets multiple API replicas share a single source of truth.
//
// Rows are atomically removed by token on consume (DELETE ... RETURNING) so a
// concurrent double-click or a race between two replicas can never restore
// the same snapshot twice. A periodic sweep prunes anything past expires_at
// even when nobody calls /undo.
export const resetUndoSnapshotsTable = pgTable(
  "reset_undo_snapshots",
  {
    token: text("token").primaryKey(),
    // Full snapshot payload (PlanDaySnapshot[]). Stored as jsonb so we don't
    // have to declare a column per plan_days field and so adding new mutable
    // fields later doesn't require a migration of this table.
    snapshot: jsonb("snapshot").notNull(),
    // Weeks the original reset touched. Recorded for parity with the
    // in-memory shape; the actual recompute targets are derived from the
    // restored rows' current `week` value at undo time.
    weeksAffected: jsonb("weeks_affected").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    expiresAtIdx: index("reset_undo_snapshots_expires_at_idx").on(t.expiresAt),
  }),
);

export type ResetUndoSnapshotRow = typeof resetUndoSnapshotsTable.$inferSelect;
