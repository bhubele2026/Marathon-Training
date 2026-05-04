import { pgTable, integer, text, timestamp } from "drizzle-orm/pg-core";

// Single-row user preferences (Task #134). This is a single-user app so the
// table is keyed at id=1 and the API exposes singleton GET/PUT semantics
// (no list / no create endpoint). New preference columns get added here as
// new top-level prefs ship.
export const userPreferencesTable = pgTable("user_preferences", {
  id: integer("id").primaryKey(),
  // How prescribed runs are displayed across the app. Drives the
  // formatRunTarget() helper that owns every run card's target line.
  //   - effort     : "Easy conversational", "Hard but sustainable", etc.
  //   - intervals  : walk/run recipe, e.g. "5 min run / 1 min walk × 5"
  //   - hr_zones   : "Zone 2", "Zone 3", "Zone 4"
  //   - pace       : "9:30/mi" (the legacy display)
  // Default for new accounts is "effort" per the task spec.
  runTargetingMode: text("run_targeting_mode").notNull().default("effort"),
  // User's maximum heart rate in BPM (Task #141). Drives the BPM ranges
  // shown alongside HR Zone labels (e.g. "Zone 2 · 134-148 bpm") via the
  // % of max model in formatRunTarget(). Null when the user hasn't
  // configured a max HR yet — the HR Zone label falls back to the
  // generic "Zone N" string in that case. Stored as a small integer in
  // the realistic adult range (80-230).
  maxHr: integer("max_hr"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type UserPreferencesRow = typeof userPreferencesTable.$inferSelect;

export const RUN_TARGETING_MODES = [
  "effort",
  "intervals",
  "hr_zones",
  "pace",
] as const;
export type RunTargetingMode = (typeof RUN_TARGETING_MODES)[number];
