import { pgTable, integer, text, date, jsonb, timestamp } from "drizzle-orm/pg-core";

// Single-row table that stores the runner's most recently saved Planner
// configuration (Task #80). The frontend uses this to repopulate the Phase
// Planner tab on load; the API uses it as the source of truth for both
// /api/planner/apply (regenerate plan_weeks/plan_days from this config) and
// /api/plan/full-reset (so a "Wipe Everything" call reseeds from the runner's
// own config instead of the hard-coded canonical 52-week half-marathon).
//
// We use a fixed `id = 1` row keyed by primary key so there's only ever one
// active config; PUT /api/planner/config is an UPSERT on that id. Older
// configs aren't versioned because the planner is meant to be edited
// in-place — running Apply replaces the existing plan rows in a single
// transaction, so historical configs would have nothing to point at.
export const plannerConfigsTable = pgTable("planner_configs", {
  id: integer("id").primaryKey(),
  // ISO yyyy-mm-dd; week 1 begins on this date (must be a Monday).
  startDate: date("start_date").notNull(),
  // ISO yyyy-mm-dd; race day, the final Sunday of the auto-pinned 16-week
  // Marathon-Specific block.
  marathonDate: date("marathon_date").notNull(),
  // Ordered list of user-defined PhaseBlock objects (focusType, weeks,
  // optional customName, optional customNotes). The 16-week
  // Marathon-Specific tail is auto-appended at generation time so it does
  // NOT appear in this array. Stored as jsonb because the structure is
  // small, immutable in shape, and only ever read/written as a whole; a
  // dedicated planner_blocks table would add joins for no benefit.
  blocks: jsonb("blocks").notNull().$type<
    Array<{
      focusType: string;
      weeks: number;
      customName?: string | null;
      customNotes?: string | null;
    }>
  >(),
  // Optional notes the runner wants to attach to the whole plan
  // (e.g. "First marathon — be conservative").
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  // Set by POST /api/planner/apply when the runner regenerates plan_weeks /
  // plan_days from this config. NULL while the config is just a saved draft.
  lastAppliedAt: timestamp("last_applied_at", { withTimezone: true }),
  // Immutable snapshot of the config that was most recently APPLIED. These
  // columns intentionally diverge from startDate/marathonDate/blocks so a
  // saved-but-not-yet-applied draft cannot silently re-anchor the rest of
  // the app (Full Reset, dashboard countdown, race-week lookup). Mirrors
  // the active plan_weeks/plan_days that Apply just wrote.
  appliedStartDate: date("applied_start_date"),
  appliedMarathonDate: date("applied_marathon_date"),
  appliedBlocks: jsonb("applied_blocks").$type<
    Array<{
      focusType: string;
      weeks: number;
      customName?: string | null;
      customNotes?: string | null;
    }>
  >(),
});

export type PlannerConfigRow = typeof plannerConfigsTable.$inferSelect;
