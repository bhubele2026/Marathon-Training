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
  // User's resting heart rate in BPM (Task #146). When set alongside
  // maxHr, the HR Zone targeting mode switches from the simple "% of
  // max" model to the Karvonen / heart-rate-reserve formula
  // (((maxHr - restingHr) * pct) + restingHr), which is meaningfully
  // more accurate for fitter athletes whose resting HR sits well
  // below average. Null when the user hasn't measured / configured
  // theirs — the HR Zone math falls back to % of max in that case.
  // Stored as a small integer in a realistic range (30-110); the API
  // and UI both clamp to the same window.
  restingHr: integer("resting_hr"),
  // Which HR zone model the user follows (Task #158). Drives the zone
  // labels and percentage table the HR Zone targeting mode renders. The
  // 5-zone % of max model is the legacy default; runners coached on
  // Friel's 7-zone, Coggan's HR zones, or a polarized 3-zone framework
  // pick their preferred model here so "Zone 2" means what their plan
  // expects. Stored as text; the lookup table lives in the frontend
  // (`artifacts/command-center/src/lib/run-target.ts`).
  hrZoneModel: text("hr_zone_model").notNull().default("five_zone_max"),
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

// Supported HR zone models (Task #158). Each one ships with its own
// label set and percentage table in the frontend run-target lookup.
//   - five_zone_max    : default. 50/60/70/80/90% of max, Z1-Z5.
//   - friel_7_zone     : Joe Friel's running 7-zone model (% LTHR
//                        converted to % HRmax).
//   - coggan_5_zone    : Coggan HR zones (% LTHR converted to % HRmax).
//   - polarized_3_zone : 3-zone polarized model (Z1 below VT1, Z2
//                        between VT1-VT2, Z3 above VT2).
export const HR_ZONE_MODELS = [
  "five_zone_max",
  "friel_7_zone",
  "coggan_5_zone",
  "polarized_3_zone",
] as const;
export type HrZoneModel = (typeof HR_ZONE_MODELS)[number];
