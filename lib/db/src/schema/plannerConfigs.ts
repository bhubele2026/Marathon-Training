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
// Structural copy of @workspace/plan-knowledge's AiPlan, inlined so this
// package stays dependency-free (db depends only on drizzle/pg/zod). Kept in
// sync with lib/plan-knowledge/src/types.ts.
type StrengthBlockJson = {
  movement: string;
  pattern: string;
  sets: number;
  reps: string;
  loadType: string;
  loadValue?: number | null;
  tempo?: string | null;
  restSec?: number | null;
  equipment?: string | null;
  tonalMode?: string | null;
  cue?: string | null;
};
type AiPlanJson = {
  summary: string;
  name: string;
  goalKind?: string | null;
  raceKind?: "marathon" | "half" | "10k" | "5k" | "none" | null;
  tonalProgram?: string | null;
  startDate: string;
  weeks: Array<{
    week: number;
    phase: string;
    days: Array<{
      day: string;
      isRest: boolean;
      sessionType: string;
      strengthMin: number;
      cardioMin: number;
      runMin: number;
      strengthBlocks?: StrengthBlockJson[] | null;
      distanceMi?: number | null;
      pace?: string | null;
      equipmentList: string[];
      description: string;
    }>;
  }>;
};

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
  // Marathon-Specific block. Task #379: nullable for date-optional /
  // workout-planner mode — when null, the campaign has no pinned race
  // day and totalWeeks is derived from sum(entries.weeks) or sum(blocks.weeks)
  // by the validator/generator.
  marathonDate: date("marathon_date"),
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
  // Task #373. Optional goal ending easy pace (sec/mi) — the pace the
  // runner wants to be at by the campaign's final non-taper week. When
  // BOTH starting and goal are set, the generator linearly interpolates
  // the easy pace from start → goal across the campaign instead of using
  // the fixed RAMP_SEC_PER_WEEK slope. NULL keeps the legacy fixed-rate
  // ramp behavior.
  goalEndingPaceSec: integer("goal_ending_pace_sec"),
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
  // Task #373. Apply-time snapshot of goal_ending_pace_sec.
  appliedGoalEndingPaceSec: integer("applied_goal_ending_pace_sec"),
  // Task #338 + cadence overhaul. Optional per-runner override of the
  // fixed-cadence daily time-budget contract. Canonical fields:
  // shortDayMin/shortDayMax (Tue-Thu, default 30/50) and
  // longDayMin/longDayMax (Fri-Sun, default 60/90). The legacy
  // weekdayMin/weekdayMax/weekendMin fields are kept OPTIONAL so
  // pre-overhaul stored rows still read; the generator/briefing/guardrails
  // fold them into the new buckets via normalizeDailyBudget / resolveBudget.
  // NULL on the column means the runner has not overridden any field.
  dailyBudget: jsonb("daily_budget").$type<{
    shortDayMin?: number | null;
    shortDayMax?: number | null;
    longDayMin?: number | null;
    longDayMax?: number | null;
    weekdayMin?: number | null;
    weekdayMax?: number | null;
    weekendMin?: number | null;
  } | null>(),
  // Apply-time snapshot of daily_budget (mirrors applied_*).
  appliedDailyBudget: jsonb("applied_daily_budget").$type<{
    shortDayMin?: number | null;
    shortDayMax?: number | null;
    longDayMin?: number | null;
    longDayMax?: number | null;
    weekdayMin?: number | null;
    weekdayMax?: number | null;
    weekendMin?: number | null;
  } | null>(),
  // Plan authoring source. "engine" = the deterministic recipe generator
  // expands blocks/entries (legacy default). "ai" = Claude authored the plan
  // directly and it lives in ai_plan; Apply materializes ai_plan straight into
  // plan_weeks/plan_days instead of running the generator. Defaulted so every
  // pre-existing row reads as "engine".
  source: text("source").notNull().default("engine"),
  // The full Claude-authored plan (AiPlan). NULL for engine-sourced configs.
  aiPlan: jsonb("ai_plan").$type<AiPlanJson | null>(),
  // Apply-time snapshot of ai_plan (mirrors the applied_* convention) so Full
  // Reset / re-apply can re-materialize the exact plan that was applied.
  appliedAiPlan: jsonb("applied_ai_plan").$type<AiPlanJson | null>(),
});

export type PlannerConfigRow = typeof plannerConfigsTable.$inferSelect;
