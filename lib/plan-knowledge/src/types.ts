import type { DayName } from "./dates";

// ---------------------------------------------------------------------------
// AiPlan — the structured object Claude returns via the `propose_plan` tool.
//
// Design choices that keep Claude reliable:
//  - Claude does NOT emit calendar dates. It emits a `startDate` (a Monday) and
//    a week index per week; the server computes every day's ISO date. Date math
//    is the most error-prone thing for an LLM, so we don't ask it to.
//  - Claude emits the three-bucket minute breakdown (strength/cardio/run) plus
//    optional distance + pace. The server derives load/equipment-scalar/total
//    and the weekly aggregates. This is exactly the plan_days contract minus the
//    bookkeeping columns.
// ---------------------------------------------------------------------------

export type RaceKind = "marathon" | "half" | "10k" | "5k" | "none";

export interface AiDay {
  day: DayName;
  isRest: boolean;
  /** e.g. "Rest", "Long Run", "Strength + Cardio", "Run + Accessory". */
  sessionType: string;
  /** Tonal / lifting minutes. */
  strengthMin: number;
  /** Non-running cross-train minutes (bike/row/spin). */
  cardioMin: number;
  /** Treadmill or outdoor running minutes. */
  runMin: number;
  /** Run distance in miles (omit/null for non-run days). */
  distanceMi?: number | null;
  /** Pace target, "mm:ss" per mile (omit/null when not a run). */
  pace?: string | null;
  /** Ordered machines used that day (e.g. ["Tonal", "Peloton Bike"]). */
  equipmentList: string[];
  /** One-sentence prose prescription shown on the day card. */
  description: string;
}

export interface AiWeek {
  week: number;
  /** Phase label, e.g. "Foundation Build", "Aerobic Build", "Taper & Race". */
  phase: string;
  days: AiDay[];
}

/** Daily nutrition targets the coach attaches to a plan. On accept these become
 * the persisted BASELINE (server safety-clamps them), so they reflect the plan's
 * goal + a safe deficit rather than pure body-composition math alone. Optional —
 * a plan without a nutrition focus may omit it, in which case the server falls
 * back to computeBaselineTargets with the plan's goal/timeframe context. */
export interface AiNutrition {
  /** Daily calorie target (kcal). */
  calorieTarget: number;
  /** Daily protein target (g) — prioritized to spare muscle in a deficit. */
  proteinTargetG: number;
  /** Daily carbohydrate target (g). */
  carbsTargetG: number;
  /** Daily fat target (g). */
  fatTargetG: number;
  /** The safe weekly rate of weight change this plan targets (lb/wk; >0 = loss).
   * Lets the server compute the safety note + realistic finish date. */
  weeklyRateLb?: number | null;
  /** One-sentence rationale shown alongside the targets. */
  rationale?: string | null;
}

export interface AiPlan {
  /** Short human summary shown in the chat after a proposal. */
  summary: string;
  /** Suggested config name (the runner can override). */
  name: string;
  /** What the plan builds toward; gates race-week framing. */
  raceKind: RaceKind;
  /** Campaign start — must be a Monday (week 1, day Mon). */
  startDate: string;
  weeks: AiWeek[];
  /** Daily nutrition targets tied to the plan's goal + a safe deficit. On accept
   * these become the persisted nutrition baseline. Optional. */
  nutrition?: AiNutrition | null;
}

// ---------------------------------------------------------------------------
// Personalization context fed into the system briefing (gathered server-side
// from the DB — measurements, prefs, equipment usage, active config).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Daily time budget. The runner trains on a FIXED weekly cadence (regardless of
// plan type — AI or template):
//   - Mon: ALWAYS full rest, 0 minutes (hard invariant).
//   - Tue/Wed/Thu: SHORT days  — default 30-50 min.
//   - Fri/Sat/Sun: LONG  days  — default 60-90 min.
//
// The canonical fields are short{Min,Max} (Tue-Thu) + long{Min,Max} (Fri-Sun).
// The legacy weekday{Min,Max}/weekendMin fields are kept OPTIONAL so existing
// stored plannerConfigs.dailyBudget jsonb rows (pre-cadence-overhaul) still read
// without error; `normalizeDailyBudget` backfills the new buckets from them.
// ---------------------------------------------------------------------------
export interface DailyBudget {
  /** Tue-Thu lower bound (min). Default 30. */
  shortDayMin?: number | null;
  /** Tue-Thu upper bound (min). Default 50. */
  shortDayMax?: number | null;
  /** Fri-Sun lower bound (min). Default 60. */
  longDayMin?: number | null;
  /** Fri-Sun upper bound (min). Default 90. */
  longDayMax?: number | null;

  /** @deprecated legacy Tue-Sat lower bound; read-only back-compat. */
  weekdayMin?: number | null;
  /** @deprecated legacy Tue-Sat upper bound; read-only back-compat. */
  weekdayMax?: number | null;
  /** @deprecated legacy Sunday floor; read-only back-compat. */
  weekendMin?: number | null;
}

// Canonical cadence defaults.
export const SHORT_DAY_MIN_DEFAULT = 30;
export const SHORT_DAY_MAX_DEFAULT = 50;
export const LONG_DAY_MIN_DEFAULT = 60;
export const LONG_DAY_MAX_DEFAULT = 90;

/** A resolved {min,max} window for a single day. */
export interface DayBudgetWindow {
  min: number;
  max: number;
}

/** Canonical four-bucket budget, all fields resolved to concrete numbers. */
export interface NormalizedDailyBudget {
  shortDayMin: number;
  shortDayMax: number;
  longDayMin: number;
  longDayMax: number;
}

/**
 * Normalize any stored/loaded DailyBudget into the canonical four-bucket shape,
 * filling defaults and backfilling from the legacy weekday/weekend fields when a
 * row predates the cadence overhaul. Clamps sanely (min <= max, non-negative).
 */
export function normalizeDailyBudget(
  budget?: DailyBudget | null,
): NormalizedDailyBudget {
  const b = budget ?? {};
  const num = (v: number | null | undefined): number | undefined =>
    typeof v === "number" && Number.isFinite(v) ? v : undefined;

  // Prefer canonical fields; fall back to legacy shape; finally to defaults.
  let shortMin = num(b.shortDayMin) ?? num(b.weekdayMin) ?? SHORT_DAY_MIN_DEFAULT;
  let shortMax = num(b.shortDayMax) ?? num(b.weekdayMax) ?? SHORT_DAY_MAX_DEFAULT;
  let longMin = num(b.longDayMin) ?? num(b.weekendMin) ?? LONG_DAY_MIN_DEFAULT;
  let longMax = num(b.longDayMax) ?? LONG_DAY_MAX_DEFAULT;

  // Clamp non-negative.
  shortMin = Math.max(0, shortMin);
  shortMax = Math.max(0, shortMax);
  longMin = Math.max(0, longMin);
  longMax = Math.max(0, longMax);

  // Keep each window coherent (min <= max).
  if (shortMin > shortMax) shortMax = shortMin;
  if (longMin > longMax) longMax = longMin;

  return {
    shortDayMin: shortMin,
    shortDayMax: shortMax,
    longDayMin: longMin,
    longDayMax: longMax,
  };
}

/**
 * Resolve the {min,max} minute window for a given weekday index.
 * Index convention matches the app's Mon->Sun week order (0=Mon .. 6=Sun,
 * see DAY_ORDER / weekdayIndex in ./dates):
 *   - 0 (Mon)        -> {0, 0}    full rest
 *   - 1,2,3 (Tue-Thu)-> short window
 *   - 4,5,6 (Fri-Sun)-> long window
 */
export function dayBudgetForWeekday(
  weekdayIdx: number,
  budget?: DailyBudget | null,
): DayBudgetWindow {
  if (weekdayIdx === 0) return { min: 0, max: 0 };
  const n = normalizeDailyBudget(budget);
  if (weekdayIdx >= 1 && weekdayIdx <= 3) {
    return { min: n.shortDayMin, max: n.shortDayMax };
  }
  return { min: n.longDayMin, max: n.longDayMax };
}

/**
 * Resolve the {min,max} window for a day name ("Mon".."Sun"), matching the
 * Mon->Sun convention in ./dates DAY_ORDER.
 */
export function dayBudgetForDayName(
  day: DayName,
  budget?: DailyBudget | null,
): DayBudgetWindow {
  if (day === "Mon") return { min: 0, max: 0 };
  const n = normalizeDailyBudget(budget);
  if (day === "Tue" || day === "Wed" || day === "Thu") {
    return { min: n.shortDayMin, max: n.shortDayMax };
  }
  // Fri, Sat, Sun.
  return { min: n.longDayMin, max: n.longDayMax };
}

/** Current macro / calorie goals (from user_preferences). Null until the runner
 * computes targets on Goals. Fed into the nutrition brain so Claude reasons from
 * the runner's actual numbers rather than re-deriving them. */
export interface MacroTargets {
  calorieTarget?: number | null;
  proteinTargetG?: number | null;
  carbsTargetG?: number | null;
  fatTargetG?: number | null;
  /** "recomp" | "cut" | "lean_bulk" — drives the calorie strategy. */
  bodyGoal?: string | null;
}

/** Recomposition signal distilled from measurements + the Tonal strength score.
 * Recomp (lose inches + gain muscle) is the DEFAULT objective when no race is
 * set, so Claude needs to see where the runner is on it. */
export interface RecompSignal {
  /** Σ inches lost across all four measured sites (fat loss + any limb shrink). */
  totalInchesLost?: number | null;
  /** Σ growth across arm + leg sites (lean-mass proxy). */
  muscleProxyInchesGained?: number | null;
  /** Tonal Strength Score, app-only (entered on Goals). */
  strengthScoreCurrent?: number | null;
  strengthScoreGoal?: number | null;
  /** Latest / baseline bodyweight from measurements, lb. */
  weightLatestLbs?: number | null;
  weightBaselineLbs?: number | null;
}

export interface PersonalContext {
  /** ISO date "today" (UTC) so Claude anchors relative dates correctly. */
  todayISO: string;
  currentWeightLbs?: number | null;
  goalWeightLbs?: number | null;
  /** Machines the runner owns / uses, canonical order. */
  equipment: string[];
  budget: DailyBudget;
  /** Free-text rollup of recent logged workouts + weight trend, if any. */
  recentActivitySummary?: string | null;
  /** Anything the runner typed into the active config's notes field. */
  notes?: string | null;
  /** Recomp progress (inches / muscle proxy / strength score / weight). The
   * recomp signal is the DEFAULT objective when no race is set. */
  recomp?: RecompSignal | null;
  /** Current macro + calorie goals so the nutrition brain references real numbers. */
  macros?: MacroTargets | null;
}

// ---------------------------------------------------------------------------
// Guardrail findings — soft checks run over a proposed plan. Never block; they
// are surfaced to the runner and (optionally) fed back to Claude to self-correct.
// ---------------------------------------------------------------------------

export type GuardrailLevel = "warn" | "info";

export interface Guardrail {
  level: GuardrailLevel;
  code: string;
  message: string;
  week?: number;
  day?: DayName;
}
