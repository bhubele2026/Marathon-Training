// Science-safe weight-loss guardrails for the nutrition BASELINE. Pure, DB-free,
// and AI-free so it can be unit-tested directly. goals.ts re-exports these and
// applies them to both the AI-computed and the plan-builder-supplied targets.
//
// Evidence-based bounds (the AI rationale cites live sources via web_search;
// these are the hard guardrails the server enforces regardless of the goal):
//  - Sustainable fat loss is ~0.5-1% of bodyweight per week, capped at an
//    absolute 2 lb/wk so a very heavy client isn't pushed past a safe rate.
//  - The deficit is capped at ~20-25% below maintenance — never a crash cut.
//  - A safe daily calorie floor (sex-specific clinical minimums) is never
//    breached.
//  - Protein stays high enough to spare muscle in a deficit (~0.8-1.0 g/lb).

export const SAFE_RATE_PCT_BW_PER_WK = 0.01; // 1% of bodyweight / week
export const SAFE_RATE_LB_PER_WK_CAP = 2.0; // absolute ceiling regardless of size
export const MAX_DEFICIT_FRACTION = 0.25; // never cut more than 25% below maintenance
export const CALORIE_FLOOR_MALE = 1500; // conventional safe daily minimums
export const CALORIE_FLOOR_FEMALE = 1200;
export const PROTEIN_FLOOR_G_PER_LB = 0.8; // muscle-sparing protein floor
export const KCAL_PER_LB = 3500; // kcal in a pound of bodyweight (rule of thumb)

// Plausibility clamps (units / hallucination guard). Shared with goals.ts.
export const MIN_CALORIES = 800;
export const MAX_CALORIES = 6000;
export const MIN_PROTEIN_G = 30;
export const MAX_PROTEIN_G = 400;
export const MIN_CARBS_G = 0;
export const MAX_CARBS_G = 700;
export const MIN_FAT_G = 0;
export const MAX_FAT_G = 300;

export type Macros = {
  calorieTarget: number;
  proteinTargetG: number;
  carbsTargetG: number;
  fatTargetG: number;
  rationale: string;
};

export type SafetyNote = {
  ok: boolean;
  message: string;
  impliedRateLbPerWk?: number | null;
  safeRateLbPerWk?: number | null;
  projectedDateISO?: string | null;
};

// The timeframe + goal context that lets the calculator reason about the RATE
// of weight change a plan implies — threaded in from the plan (target date /
// program length) when known. All optional: with none of it we fall back to a
// pure body-composition baseline (and no safety note).
export type GoalContext = {
  /** Goal bodyweight in lb (from prefs or the plan). */
  goalWeightLb?: number | null;
  /** Whole weeks the user has to get there (program length or to a target date). */
  timeframeWeeks?: number | null;
  /** Explicit desired weekly rate of loss (lb/wk), if the plan stated one. */
  desiredWeeklyRateLb?: number | null;
};

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// The safe per-week rate of loss for a client of this size: min(1% bodyweight,
// 2 lb) per week.
export function safeWeeklyRateLb(currentWeightLb: number): number {
  return Math.min(
    currentWeightLb * SAFE_RATE_PCT_BW_PER_WK,
    SAFE_RATE_LB_PER_WK_CAP,
  );
}

export function calorieFloor(sex: string | null): number {
  return sex === "female" ? CALORIE_FLOOR_FEMALE : CALORIE_FLOOR_MALE;
}

function addWeeksISO(weeks: number): string {
  const d = new Date();
  d.setDate(d.getDate() + Math.round(weeks * 7));
  return d.toISOString().slice(0, 10);
}

// The implied weekly rate the user's goal+timeframe (or desired rate) demands,
// or null when there's no loss to pace. Shared by computeSafety + the effective
// rate used to instruct the AI.
function impliedRateLb(currentWeightLb: number, ctx: GoalContext): number | null {
  const goal = ctx.goalWeightLb ?? null;
  const totalToLose = goal != null ? currentWeightLb - goal : 0;
  if (ctx.desiredWeeklyRateLb != null && ctx.desiredWeeklyRateLb > 0) {
    return ctx.desiredWeeklyRateLb;
  }
  if (totalToLose > 0.5 && ctx.timeframeWeeks != null && ctx.timeframeWeeks > 0) {
    return totalToLose / ctx.timeframeWeeks;
  }
  return null;
}

// Pure, testable core of the safety guardrail. Decides the implied weekly rate,
// the safe weekly rate for this body, whether the implied rate is safe, and the
// realistic date if it isn't. Returns null when there's no weight-loss
// goal+timeframe to reason about (so callers fall through to a pure body-comp
// baseline with no safety note).
export function computeSafety(
  currentWeightLb: number,
  sex: string | null,
  ctx: GoalContext,
): SafetyNote | null {
  const goal = ctx.goalWeightLb ?? null;
  const safeRate = safeWeeklyRateLb(currentWeightLb);
  const totalToLose = goal != null ? currentWeightLb - goal : 0;
  const hasLossGoal = goal != null && totalToLose > 0.5;
  const impliedRate = impliedRateLb(currentWeightLb, ctx);

  if (!hasLossGoal && impliedRate == null) {
    return null; // recomp / maintenance / bulk — nothing to evaluate
  }

  // Loss goal but no implied rate (no timeframe): affirm the safe pace + project
  // the realistic finish date at the safe rate.
  if (impliedRate == null) {
    const weeksAtSafe = safeRate > 0 ? totalToLose / safeRate : 0;
    return {
      ok: true,
      message:
        `Targeting a sustainable ~${safeRate.toFixed(1)} lb/wk. At that pace you'd reach ` +
        `${goal} lb around ${addWeeksISO(weeksAtSafe)}. Set a target date to pace it precisely.`,
      impliedRateLbPerWk: null,
      safeRateLbPerWk: round1(safeRate),
      projectedDateISO: addWeeksISO(weeksAtSafe),
    };
  }

  const safeRound = round1(safeRate);
  const impliedRound = round1(impliedRate);

  // Unsafe / unachievable: demands faster than the safe rate. Clamp to safe +
  // give the realistic date.
  if (impliedRate > safeRate + 0.05) {
    const weeksAtSafe = safeRate > 0 ? totalToLose / safeRate : 0;
    const realisticDate = addWeeksISO(weeksAtSafe);
    return {
      ok: false,
      message:
        `That pace needs ~${impliedRound} lb/wk, which isn't safe or sustainable. ` +
        `I've set targets for a steady ~${safeRound} lb/wk instead` +
        (goal != null ? `; you'd reach ${goal} lb around ${realisticDate}.` : "."),
      impliedRateLbPerWk: impliedRound,
      safeRateLbPerWk: safeRound,
      projectedDateISO: realisticDate,
    };
  }

  // Safe goal — affirm.
  return {
    ok: true,
    message:
      `Your pace of ~${impliedRound} lb/wk is in the safe, sustainable range ` +
      `(up to ~${safeRound} lb/wk for your size). Targets set to support it.`,
    impliedRateLbPerWk: impliedRound,
    safeRateLbPerWk: safeRound,
    projectedDateISO: null,
  };
}

// The effective per-week loss rate the BASELINE should target: the smaller of
// what the plan implies and the safe rate (never faster than safe). 0 = not
// losing (recomp / maintenance / bulk).
export function effectiveSafeRateLb(
  currentWeightLb: number,
  ctx: GoalContext,
): number {
  const safeRate = safeWeeklyRateLb(currentWeightLb);
  const goal = ctx.goalWeightLb ?? null;
  const totalToLose = goal != null ? currentWeightLb - goal : 0;
  const implied = impliedRateLb(currentWeightLb, ctx);
  if (totalToLose <= 0.5 && implied == null) return 0;
  return implied != null ? Math.min(implied, safeRate) : safeRate;
}

// Plausibility clamp check (units / hallucination guard).
export function isPlausible(t: Macros): boolean {
  return (
    t.calorieTarget >= MIN_CALORIES &&
    t.calorieTarget <= MAX_CALORIES &&
    t.proteinTargetG >= MIN_PROTEIN_G &&
    t.proteinTargetG <= MAX_PROTEIN_G &&
    t.carbsTargetG >= MIN_CARBS_G &&
    t.carbsTargetG <= MAX_CARBS_G &&
    t.fatTargetG >= MIN_FAT_G &&
    t.fatTargetG <= MAX_FAT_G
  );
}

// Enforce the science-safe weight-loss guardrails on a set of targets,
// regardless of source (AI or the plan builder):
//   - never below the sex-specific safe calorie floor,
//   - protein never below the muscle-sparing floor (~0.8 g/lb of current weight),
//     capped at the plausibility ceiling.
// When calories are raised to satisfy a floor, the extra is added to carbs so
// the macro math stays roughly consistent. Pure + testable.
//
// NOTE: effSafeRateLb is accepted for symmetry with the caller (and future
// deficit-cap tightening) but the floors above are the binding guardrails here.
export function enforceSafeClamps(
  t: Macros,
  weight: number | null,
  sex: string | null,
  _effSafeRateLb: number,
): Macros {
  let calories = t.calorieTarget;

  const floor = calorieFloor(sex);
  if (calories < floor) calories = floor;

  let protein = t.proteinTargetG;
  if (weight != null) {
    const proteinFloor = Math.round(weight * PROTEIN_FLOOR_G_PER_LB);
    if (protein < proteinFloor) protein = Math.min(proteinFloor, MAX_PROTEIN_G);
  }

  const delta = calories - t.calorieTarget;
  const carbs = delta > 0 ? t.carbsTargetG + Math.round(delta / 4) : t.carbsTargetG;

  return {
    ...t,
    calorieTarget: Math.round(calories),
    proteinTargetG: Math.round(protein),
    carbsTargetG: Math.round(carbs),
    fatTargetG: Math.round(t.fatTargetG),
  };
}
