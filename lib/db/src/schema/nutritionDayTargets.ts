import { pgTable, date, integer, doublePrecision, text, timestamp } from "drizzle-orm/pg-core";

// Reactive Nutrition Engine (R5). One row per calendar day caching that day's
// computed nutrition target: the fixed baseline (snapshot of user_preferences
// targets at compute time) PLUS the training-reactive adjustment. Keyed by
// `date` (YYYY-MM-DD), mirroring nutrition_days.
//
// The adjusted target = baseline ± an AI-decided (or deterministic-fallback)
// delta driven by that day's training:
//   - BEFORE the day is logged: reacts to the plan day's planned_load.
//   - AFTER a workout is logged/edited/skipped for the date: recomputed from
//     the ACTUAL logged session.
// `sourceState` is the cache key on the actual-workout state: it stores
// "planned" before any workout exists for the date, otherwise a fingerprint of
// the logged workout(s) (load + skip), so GET /nutrition/day/:date can detect a
// stale cache and recompute lazily once a workout lands or changes.
export const nutritionDayTargetsTable = pgTable("nutrition_day_targets", {
  date: date("date").primaryKey(),

  // Baseline snapshot (the four targets from user_preferences at compute time).
  baselineCalories: integer("baseline_calories").notNull(),
  baselineProteinG: integer("baseline_protein_g").notNull(),
  baselineCarbsG: integer("baseline_carbs_g").notNull(),
  baselineFatG: integer("baseline_fat_g").notNull(),

  // Adjusted (reactive) target actually shown for the day.
  adjustedCalories: integer("adjusted_calories").notNull(),
  adjustedProteinG: integer("adjusted_protein_g").notNull(),
  adjustedCarbsG: integer("adjusted_carbs_g").notNull(),
  adjustedFatG: integer("adjusted_fat_g").notNull(),

  // The training load the adjustment reacted to (planned load, or the actual
  // logged session's load). Lets the UI / debugging see the input.
  trainingLoad: doublePrecision("training_load"),
  // "planned" when computed from the plan day pre-log; "actual" once a workout
  // for the date exists.
  source: text("source").notNull().default("planned"),
  // Cache key on the actual-workout state for this date — "planned" before any
  // workout, otherwise a fingerprint string of the logged workout(s). When this
  // no longer matches the current state the cached row is recomputed lazily.
  sourceState: text("source_state").notNull().default("planned"),

  // One-sentence rationale (AI or fallback) explaining the delta.
  rationale: text("rationale"),

  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type NutritionDayTargetRow = typeof nutritionDayTargetsTable.$inferSelect;
