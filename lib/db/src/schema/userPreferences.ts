import {
  pgTable,
  integer,
  text,
  timestamp,
  doublePrecision,
} from "drizzle-orm/pg-core";

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
  // Which visual theme palette the runner picked (Task #196). The
  // theme picker on Settings (Task #188) originally only persisted to
  // localStorage so the choice was per-browser; storing it on the
  // user-preferences row lets the choice follow the runner across
  // devices. Null means "no choice saved yet" — the provider falls
  // back to localStorage and then to the arctic-performance default.
  // Stored as text; the lookup table of valid theme keys lives in the
  // frontend (`artifacts/command-center/src/lib/visual-themes.ts`).
  visualTheme: text("visual_theme"),

  // --- Goals & body stats (strength + cardio re-orientation) -------------
  // Inputs the runner enters on the Goals page; they feed the AI nutrition
  // target calculation and surface their current weight from the latest
  // body_measurements row (not stored here, to avoid duplicating it).
  // Height in whole inches. Null until the runner fills the Goals form.
  heightIn: integer("height_in"),
  // Age in years. Null until set.
  age: integer("age"),
  // "male" | "female" — drives the Mifflin-St Jeor BMR sex constant.
  sex: text("sex"),
  // Activity level bucket: sedentary | light | moderate | active | very_active.
  activityLevel: text("activity_level"),
  // Primary body goal driving the calorie strategy. Default "recomp" (lose
  // fat + build muscle near maintenance) per the app's strength-first focus.
  bodyGoal: text("body_goal").notNull().default("recomp"),
  // Target bodyweight in lb. Current weight comes from measurements; this is
  // the goal the AI and progress views aim at.
  goalWeightLb: doublePrecision("goal_weight_lb"),

  // --- AI-computed nutrition targets -------------------------------------
  // Written by POST /api/goals/compute-targets, which uses Claude + live web
  // search to research evidence-based daily intake for the runner's stats and
  // goal. Null until the runner first computes them. These drive the
  // Nutrition page's protein/calorie progress bars (replacing the old
  // hardcoded 200 g default).
  calorieTarget: integer("calorie_target"),
  proteinTargetG: integer("protein_target_g"),
  // AI-computed daily carbohydrate + fat targets (grams), written alongside
  // calorie/protein by compute-targets. Null until the runner first computes
  // them (or for rows predating full-macro targets) — the Nutrition page
  // falls back to showing the tracked value without a goal ring when null.
  carbsTargetG: integer("carbs_target_g"),
  fatTargetG: integer("fat_target_g"),
  // Short human-readable rationale the AI returned (what it found + why).
  targetsRationale: text("targets_rationale"),
  targetsComputedAt: timestamp("targets_computed_at", { withTimezone: true }),

  // --- Sodium limit ------------------------------------------------------
  // The runner's daily sodium ceiling in milligrams. Unlike the AI-computed
  // calorie/macro targets this is a fixed user-set LIMIT (sodium is tracked to
  // stay UNDER it, not hit it), so it is entered manually on the Goals page
  // and is not part of the calorie/macro math. Null until the runner sets one,
  // in which case the app falls back to the standard 2300 mg guideline.
  sodiumLimitMg: integer("sodium_limit_mg"),

  // --- Tonal Strength Score goal -----------------------------------------
  // The Tonal Strength Score is app-only (not exposed via Apple Health or any
  // API), so both the current value and the goal are entered manually on the
  // Goals page and tracked toward the target with a progress bar.
  strengthScoreCurrent: integer("strength_score_current"),
  strengthScoreGoal: integer("strength_score_goal"),

  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Body goal options (drives the AI calorie strategy). "recomp" = lose fat +
// build muscle near maintenance (the default); "cut" = fat loss in a deficit;
// "lean_bulk" = muscle gain in a slight surplus.
export const BODY_GOALS = ["recomp", "cut", "lean_bulk"] as const;
export type BodyGoal = (typeof BODY_GOALS)[number];

// Activity-level buckets mapped to standard TDEE multipliers by the AI prompt.
export const ACTIVITY_LEVELS = [
  "sedentary",
  "light",
  "moderate",
  "active",
  "very_active",
] as const;
export type ActivityLevel = (typeof ACTIVITY_LEVELS)[number];

export const SEXES = ["male", "female"] as const;
export type Sex = (typeof SEXES)[number];

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
