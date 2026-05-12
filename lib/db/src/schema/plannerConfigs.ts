import {
  pgTable,
  integer,
  text,
  date,
  jsonb,
  timestamp,
  boolean,
  doublePrecision,
} from "drizzle-orm/pg-core";

// Saved Planner configurations (Task #82). Originally a single-row table
// (Task #80) keyed at id=1; widened so a runner can keep multiple named
// configs (e.g. an A/B race calendar, two different phase orderings) and
// flip between them with a dropdown without overwriting the previous one.
//
// Activation model:
//  - Exactly one row should have `is_active = true`. The /planner/apply
//    endpoint always operates on whichever row is currently active. We
//    enforce single-active in app code (transactional flip in the
//    activate endpoint) rather than via a partial unique index, since
//    drizzle-kit push handling of partial indexes is fiddly.
//  - "Last applied" is tracked per-row in last_applied_at + applied_*
//    snapshot columns. Full Reset / dashboard countdown / race-week
//    lookup pivot off the row with the most recent last_applied_at, so
//    activating-but-not-applying a different draft can NOT silently
//    re-anchor those consumers.
export const plannerConfigsTable = pgTable("planner_configs", {
  // Manually assigned by the API (POST endpoint computes MAX(id)+1) so
  // we don't have to migrate the existing single-row id=1 to a serial /
  // identity column on push.
  id: integer("id").primaryKey(),
  // Human-friendly label shown in the config dropdown. Defaulted on
  // schema push so the pre-Task-#82 single row gets a sensible label.
  name: text("name").notNull().default("Default"),
  // Marks the config currently selected by the runner. /planner/apply
  // operates on this row; /planner/configs/:id/activate flips it.
  isActive: boolean("is_active").notNull().default(false),
  // ISO yyyy-mm-dd; week 1 begins on this date (must be a Monday).
  startDate: date("start_date").notNull(),
  // ISO yyyy-mm-dd; race day, the final Sunday of the auto-pinned 16-week
  // Marathon-Specific block.
  marathonDate: date("marathon_date").notNull(),
  // Ordered list of user-defined PhaseBlock objects (focusType, weeks,
  // optional customName, optional customNotes). In LEGACY mode (entries
  // is null) the 16-week Marathon-Specific tail is auto-appended at
  // generation time so it does NOT appear in this array. In ENTRIES
  // mode, `blocks` is the projection of `entries` computed
  // by the server at write time and stored alongside entries — read
  // consumers (Apply, Full Reset, dashboard) keep using `blocks` as
  // before, while edits flow through `entries`.
  blocks: jsonb("blocks").notNull().$type<
    Array<{
      focusType: string;
      weeks: number;
      customName?: string | null;
      customNotes?: string | null;
    }>
  >(),
  // ENTRIES mode. Ordered list of TemplateEntry objects. NULL
  // for legacy blocks-only configs (where the auto-pinned 16-week
  // Marathon-Specific tail is appended at generation time). When
  // non-null, entries are the source of truth for the editor; the
  // server projects entries → blocks on every write so downstream
  // generator paths can stay blocks-based.
  entries: jsonb("entries").$type<
    Array<{
      templateId: string;
      weeks: number;
      customName?: string | null;
      customNotes?: string | null;
      // Optional explicit Monday this entry begins on. When omitted/null
      // the entry stacks back-to-back with the previous one. When set
      // and later than the running cursor, a Recovery filler is inserted
      // before this entry to bridge the chosen gap.
      startDate?: string | null;
    }> | null
  >(),
  // Optional notes the runner wants to attach to this whole config
  // (e.g. "First marathon — be conservative").
  notes: text("notes"),
  // Task #330. Optional body-mass targets the runner wants tracked
  // alongside this campaign. NULL on legacy configs (and on configs
  // where the runner doesn't want to track weight). When NULL, the
  // /plan and dashboard "Body Mass" tile fall back to the runner's
  // earliest measurement (start) and a null sentinel (goal) instead of
  // the legacy hardcoded 281.6 / 210 constants.
  startWeight: doublePrecision("start_weight"),
  goalWeight: doublePrecision("goal_weight"),
  // Optional starting easy pace (sec/mi). Generator ramps from here
  // across the campaign; NULL falls back to DEFAULT_STARTING_PACE_SEC.
  startingPaceSec: integer("starting_pace_sec"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  // Set by POST /api/planner/apply when the runner regenerates plan_weeks /
  // plan_days from this config. NULL while the config is just a saved draft
  // (or has never been applied).
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
  // Immutable snapshot of the entries array that was most recently APPLIED
  // (NULL for legacy blocks-mode applies). Required so /plan/full-reset can
  // re-run the generator in entries-mode — without this, an applied
  // entries-mode plan would be re-validated as legacy and rejected (e.g.
  // sum(blocks)=totalWeeks instead of totalWeeks - MARATHON_TAIL_WEEKS).
  appliedEntries: jsonb("applied_entries").$type<
    Array<{
      templateId: string;
      weeks: number;
      customName?: string | null;
      customNotes?: string | null;
      startDate?: string | null;
    }> | null
  >(),
  // Task #330. Immutable snapshots of the body-mass targets that were
  // active at apply time. Mirrors the rest of the applied_* convention
  // so a saved-but-not-yet-applied draft cannot silently re-anchor the
  // /plan header / dashboard Body Mass tile.
  appliedStartWeight: doublePrecision("applied_start_weight"),
  appliedGoalWeight: doublePrecision("applied_goal_weight"),
  // Apply-time snapshot of starting_pace_sec (mirrors applied_*).
  appliedStartingPaceSec: integer("applied_starting_pace_sec"),
});

export type PlannerConfigRow = typeof plannerConfigsTable.$inferSelect;
