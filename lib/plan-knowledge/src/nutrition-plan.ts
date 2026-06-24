// Phase 15. A VIEWABLE personalized nutrition plan, derived deterministically
// from the plan's persisted daily targets (calorie + the three macros) plus the
// goal. Those four targets are authored by the plan builder (AiNutrition), safety
// -clamped, and persisted to user_preferences on accept; the reactive per-day
// target (nutrition-day-target) reads them back as its BASELINE. So everything
// here TRACES to the plan — this module just promotes the four scalars into the
// structured guidance the owner can actually look at: how to split protein across
// the day, how carbs/fat flex with training load, and a simple meal scaffold.
//
// Pure + DB-free + AI-free so it's identical on the server and in the UI and is
// trivially testable. It does NOT prescribe exercises/sets/reps (Studio rule) and
// does NOT re-derive the targets — body-comp math + safety clamps already happened
// upstream; we only shape what was decided.

import type { GoalKind } from "./types";

export interface NutritionPlanMeal {
  /** Meal label in day order. */
  name: string;
  proteinG: number;
  carbsG: number;
  fatG: number;
  /** The meal to land near the training session (extra carbs for fuel/recovery). */
  anchorNearSession?: boolean;
}

export interface NutritionPlanDayShape {
  /** Carbs for this day type (g). Protein is constant; fat absorbs the balance. */
  carbsG: number;
  fatG: number;
  /** One-line "why" for this day type. */
  note: string;
}

export interface NutritionPlanView {
  goalLabel: string;
  calorieTarget: number;
  proteinTargetG: number;
  carbsTargetG: number;
  fatTargetG: number;
  /** Macro share of total calories, rounded to whole %. */
  proteinPct: number;
  carbsPct: number;
  fatPct: number;
  /** Meals the protein is split across (3 or 4). */
  mealsPerDay: number;
  /** ~even protein per meal (g). */
  proteinPerMealG: number;
  /** g protein per lb bodyweight, when bodyweight is known (else null). */
  proteinPerLbG: number | null;
  meals: NutritionPlanMeal[];
  /** Carbs ride training load; these two show the swing without changing calories. */
  trainingDay: NutritionPlanDayShape;
  restDay: NutritionPlanDayShape;
  /** Coach-voice one-liner for the CoachNote surface. */
  guidance: string;
}

const GOAL_LABELS: Record<GoalKind, string> = {
  recomp: "Recomposition",
  strength: "Strength",
  hypertrophy: "Hypertrophy",
  fat_loss: "Fat loss",
  general: "General fitness",
  race: "Race build",
};

const kcalFromMacros = (p: number, c: number, f: number): number =>
  p * 4 + c * 4 + f * 9;

/** Fat (g) that makes calories balance for a given protein + carb split. */
const fatForBalance = (cal: number, proteinG: number, carbsG: number): number =>
  Math.max(0, Math.round((cal - proteinG * 4 - carbsG * 4) / 9));

function pct(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 100);
}

/**
 * Build the viewable plan from the four persisted targets + goal.
 * @param mealsPerDay clamped to 3–4 (default 4); fat-loss leans to 4 smaller meals.
 */
export function buildNutritionPlanView(input: {
  calorieTarget: number;
  proteinTargetG: number;
  carbsTargetG: number;
  fatTargetG: number;
  goalKind?: GoalKind | null;
  bodyweightLb?: number | null;
  mealsPerDay?: number;
}): NutritionPlanView {
  const goal = input.goalKind ?? "recomp";
  const cal = Math.max(0, Math.round(input.calorieTarget));
  const protein = Math.max(0, Math.round(input.proteinTargetG));
  const carbs = Math.max(0, Math.round(input.carbsTargetG));
  const fat = Math.max(0, Math.round(input.fatTargetG));

  const meals = Math.min(4, Math.max(3, input.mealsPerDay ?? 4));

  // Protein: spread as evenly as whole grams allow, remainder onto the first
  // meals so the per-meal numbers still sum to the daily target exactly.
  const baseProtein = Math.floor(protein / meals);
  const proteinRemainder = protein - baseProtein * meals;
  const proteinPerMealG = Math.round(protein / meals);

  // Carbs: weight more onto the session-anchored meal (fuel + recovery) and
  // breakfast; the anchor meal gets ~1.6x an even share, the rest split the
  // remainder. Fat: the inverse — lighter around the session, heavier on the
  // non-training meals. We snap to whole grams and let the last meal true-up.
  const anchorIdx = meals >= 4 ? 2 : 1; // mid-day-ish, near a typical session
  const evenCarb = carbs / meals;
  const mealCarbWeights = Array.from({ length: meals }, (_, i) =>
    i === anchorIdx ? 1.6 : (1 - 0.6 / (meals - 1)),
  );
  const weightSum = mealCarbWeights.reduce((s, w) => s + w, 0);

  const mealNames =
    meals === 4
      ? ["Breakfast", "Lunch", "Pre/post session", "Dinner"]
      : ["Breakfast", "Lunch", "Dinner"];
  if (meals >= 4) mealNames[anchorIdx] = "Pre/post session";

  const meals_: NutritionPlanMeal[] = [];
  let carbAcc = 0;
  let fatAcc = 0;
  for (let i = 0; i < meals; i++) {
    const isLast = i === meals - 1;
    const p = baseProtein + (i < proteinRemainder ? 1 : 0);
    let c: number;
    let f: number;
    if (isLast) {
      c = Math.max(0, carbs - carbAcc);
      f = Math.max(0, fat - fatAcc);
    } else {
      c = Math.round((carbs * mealCarbWeights[i]!) / weightSum);
      // Fat is the inverse weighting so heavier-carb meals carry less fat.
      const fatWeight = i === anchorIdx ? 0.6 : 1.15;
      f = Math.round((fat * fatWeight) / meals);
      carbAcc += c;
      fatAcc += f;
    }
    meals_.push({
      name: mealNames[i] ?? `Meal ${i + 1}`,
      proteinG: p,
      carbsG: c,
      fatG: f,
      anchorNearSession: i === anchorIdx,
    });
  }

  // Training vs rest day: carbs ride load. Swing carbs ±~20% around the target
  // and let fat absorb the calorie difference so total kcal holds steady. Protein
  // is constant (muscle priority). This mirrors the reactive engine's "carbs flex
  // with training load, never eat back the burn 1:1" rule.
  const carbSwing = Math.round(carbs * 0.2);
  const trainCarbs = carbs + carbSwing;
  const restCarbs = Math.max(0, carbs - carbSwing);
  const trainingDay: NutritionPlanDayShape = {
    carbsG: trainCarbs,
    fatG: fatForBalance(cal, protein, trainCarbs),
    note: "Training day — carbs up to fuel the session and refill glycogen.",
  };
  const restDay: NutritionPlanDayShape = {
    carbsG: restCarbs,
    fatG: fatForBalance(cal, protein, restCarbs),
    note: "Rest day — carbs ease back, fat fills the gap; protein holds.",
  };

  const proteinPerLbG =
    input.bodyweightLb && input.bodyweightLb > 0
      ? Math.round((protein / input.bodyweightLb) * 100) / 100
      : null;

  const totalCal = kcalFromMacros(protein, carbs, fat) || cal;

  const perLbBit = proteinPerLbG
    ? `${proteinPerLbG} g/lb`
    : `~${proteinPerMealG} g a meal`;
  const guidance =
    `${protein} g protein is the floor — split it ${proteinPerMealG} g across ${meals} meals (${perLbBit}), ` +
    `with one landing near your session. Carbs ride your training load; fat fills whatever's left. ` +
    `Hit the protein and the rest has room to move.`;

  return {
    goalLabel: GOAL_LABELS[goal],
    calorieTarget: cal,
    proteinTargetG: protein,
    carbsTargetG: carbs,
    fatTargetG: fat,
    proteinPct: pct(protein * 4, totalCal),
    carbsPct: pct(carbs * 4, totalCal),
    fatPct: pct(fat * 9, totalCal),
    mealsPerDay: meals,
    proteinPerMealG,
    proteinPerLbG,
    meals: meals_,
    trainingDay,
    restDay,
    guidance,
  };
}
