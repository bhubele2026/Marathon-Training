// Pure summarization for the weekly rollup (Phase 2). DB queries live in the
// route; these pure functions turn the raw rows into the numbers-only summary
// the daily/weekly coach voice reads. Kept pure + tested.

export type FoodDay = {
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
};

export type FoodTargets = {
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
};

export type FoodSummary = {
  daysLogged: number;
  avgCalories: number | null;
  avgProtein: number | null;
  avgCarbs: number | null;
  avgFat: number | null;
  target: FoodTargets;
  daysOverCalories: number;
  daysUnderCalories: number;
  /** Fraction of logged days that hit the protein target (0..1), null when no
   * protein target or no logged days. */
  proteinHitRate: number | null;
};

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

export function summarizeFood(days: FoodDay[], target: FoodTargets): FoodSummary {
  const cals = days.map((d) => d.calories).filter((v): v is number => v != null);
  const prot = days.map((d) => d.proteinG).filter((v): v is number => v != null);
  const carb = days.map((d) => d.carbsG).filter((v): v is number => v != null);
  const fat = days.map((d) => d.fatG).filter((v): v is number => v != null);
  const daysLogged = days.filter(
    (d) => d.calories != null || d.proteinG != null,
  ).length;

  let daysOver = 0;
  let daysUnder = 0;
  if (target.calories != null) {
    for (const c of cals) {
      if (c > target.calories) daysOver++;
      else if (c < target.calories) daysUnder++;
    }
  }

  let proteinHitRate: number | null = null;
  if (target.protein != null && prot.length > 0) {
    const hits = prot.filter((p) => p >= (target.protein as number)).length;
    proteinHitRate = Math.round((hits / prot.length) * 100) / 100;
  }

  return {
    daysLogged,
    avgCalories: avg(cals),
    avgProtein: avg(prot),
    avgCarbs: avg(carb),
    avgFat: avg(fat),
    target,
    daysOverCalories: daysOver,
    daysUnderCalories: daysUnder,
    proteinHitRate,
  };
}

export type WeightSummary = {
  startLb: number | null;
  endLb: number | null;
  actualChangeLb: number | null;
  /** The weekly weight goal's per-week target change (lb; negative = loss). */
  goalChangeLb: number | null;
  /** True when actual change met/beat the goal (within tolerance). null when no
   * goal or insufficient weigh-ins. */
  onTrack: boolean | null;
};

const WEIGHT_TOLERANCE_LB = 0.5;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function summarizeWeight(
  startLb: number | null,
  endLb: number | null,
  goalChangeLb: number | null,
): WeightSummary {
  const actualChangeLb =
    startLb != null && endLb != null ? round1(endLb - startLb) : null;

  let onTrack: boolean | null = null;
  if (actualChangeLb != null && goalChangeLb != null) {
    if (goalChangeLb < 0) {
      // Loss goal: on track if we lost at least the target (actual <= goal + tol).
      onTrack = actualChangeLb <= goalChangeLb + WEIGHT_TOLERANCE_LB;
    } else if (goalChangeLb > 0) {
      onTrack = actualChangeLb >= goalChangeLb - WEIGHT_TOLERANCE_LB;
    } else {
      onTrack = Math.abs(actualChangeLb) <= WEIGHT_TOLERANCE_LB + 0.5;
    }
  }

  return { startLb, endLb, actualChangeLb, goalChangeLb, onTrack };
}
