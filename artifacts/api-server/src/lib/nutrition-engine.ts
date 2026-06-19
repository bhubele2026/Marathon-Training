// Pure (DB-free, AI-free) helpers for the reactive nutrition engine.
//
// Two concerns live here so they can be unit-tested without a database or an
// Anthropic key:
//   1. plannedLoad — a normalized training-intensity number derived from a
//      plan/workout day's minute breakdown. Strength minutes weigh heaviest
//      (Tonal lifting is the recomp priority + most metabolically taxing per
//      minute here), running next, low-intensity cardio lightest. Rest = 0.
//   2. computeFallbackAdjustment — the deterministic baseline ± delta used
//      when the AI is unavailable (or as the floor the AI's answer is clamped
//      to), so GET /nutrition/day/:date never hard-fails.
//
// Both the planner apply path and the per-day endpoint import from here.

// Per-minute weights. Tuned so a typical ~45 min Tonal lift lands near a load
// of ~68 and a ~40 min easy run near ~40, giving the day endpoint a stable
// 0..~120 scale to react against. Rest days score 0.
export const STRENGTH_LOAD_PER_MIN = 1.5;
export const RUN_LOAD_PER_MIN = 1.0;
export const CARDIO_LOAD_PER_MIN = 0.8;

export type LoadInput = {
  isRest?: boolean | null;
  strengthMin?: number | null;
  cardioMin?: number | null;
  runMin?: number | null;
};

// Normalized intensity for a single day's prescribed/actual minute buckets.
// Returns 0 for a rest day or an all-null/empty day. Always a non-negative,
// rounded-to-1-decimal number.
export function computePlannedLoad(input: LoadInput): number {
  if (input.isRest) return 0;
  const strength = Math.max(0, input.strengthMin ?? 0);
  const cardio = Math.max(0, input.cardioMin ?? 0);
  const run = Math.max(0, input.runMin ?? 0);
  const raw =
    strength * STRENGTH_LOAD_PER_MIN +
    run * RUN_LOAD_PER_MIN +
    cardio * CARDIO_LOAD_PER_MIN;
  return Math.round(raw * 10) / 10;
}

export type BaselineMacros = {
  cal: number;
  protein: number;
  carbs: number;
  fat: number;
};

export type DayAdjustment = {
  adjusted: BaselineMacros;
  delta: BaselineMacros;
  rationale: string;
};

// Sane bounds on the per-day calorie/carb swing so neither the AI nor the
// fallback can move a recomp target into nonsense territory.
export const MAX_CAL_DELTA = 500;
export const MAX_CARB_DELTA = 120;

// A "typical" training day's load — the pivot the fallback reacts around. A
// day notably above this nudges intake up; a rest/skip day or a much lighter
// session nudges it down. Roughly a ~45 min lift (≈68) blended with an easy
// cardio day.
export const REFERENCE_LOAD = 60;

function clampInt(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

// Deterministic baseline ± delta from the day's effective training load.
// `load` is the plannedLoad BEFORE the day is logged, or the actual logged
// workout's load AFTER. Protein is held steady (recomp priority); calories +
// carbs flex with load. Used as the AI-unavailable fallback AND as the clamp
// the AI's own answer is bounded to.
export function computeFallbackAdjustment(
  baseline: BaselineMacros,
  load: number,
  opts: { skipped?: boolean; source: "planned" | "actual" } = {
    source: "planned",
  },
): DayAdjustment {
  const noTraining = opts.skipped || load <= 0;

  let calDelta: number;
  let reason: string;
  if (noTraining) {
    // Rest / skipped day — modest calorie + carb reduction toward maintenance.
    calDelta = -250;
    reason = opts.skipped
      ? "Workout skipped, so calories and carbs trimmed toward a rest-day intake while protein holds steady."
      : "Rest day — calories and carbs eased back toward maintenance with protein held steady for recovery.";
  } else {
    // Scale the swing by how far this day's load sits from a typical day.
    const ratio = (load - REFERENCE_LOAD) / REFERENCE_LOAD; // -1..+
    calDelta = clampInt(ratio * 300, -MAX_CAL_DELTA, MAX_CAL_DELTA);
    if (calDelta > 20) {
      reason =
        "Heavier-than-typical training today, so a small fuel bump in calories and carbs supports the work; protein unchanged.";
    } else if (calDelta < -20) {
      reason =
        "Lighter session than a typical day, so calories and carbs dialed back slightly with protein held steady.";
    } else {
      reason =
        "Training load is about typical, so today's target sits at your baseline with protein held steady.";
    }
  }

  calDelta = clampInt(calDelta, -MAX_CAL_DELTA, MAX_CAL_DELTA);
  // Move ~all of the calorie swing through carbs (4 kcal/g), leave fat + protein
  // alone so the recomp protein floor never drifts.
  const carbDelta = clampInt(calDelta / 4, -MAX_CARB_DELTA, MAX_CARB_DELTA);

  const delta: BaselineMacros = {
    cal: calDelta,
    protein: 0,
    carbs: carbDelta,
    fat: 0,
  };
  const adjusted: BaselineMacros = {
    cal: Math.max(800, baseline.cal + delta.cal),
    protein: baseline.protein,
    carbs: Math.max(0, baseline.carbs + delta.carbs),
    fat: baseline.fat,
  };
  // Recompute the realized delta after the calorie/carb floors clamp it.
  return {
    adjusted,
    delta: {
      cal: adjusted.cal - baseline.cal,
      protein: 0,
      carbs: adjusted.carbs - baseline.carbs,
      fat: 0,
    },
    rationale: reason,
  };
}

// Clamp an AI-proposed adjustment to the same sane bounds the fallback obeys,
// keeping protein/fat near-steady (recomp priority). Returns the clamped
// adjusted macros + realized delta; the caller supplies the AI's rationale.
export function clampAdjustment(
  baseline: BaselineMacros,
  proposed: { calDelta: number; carbDelta: number; proteinDelta?: number },
): { adjusted: BaselineMacros; delta: BaselineMacros } {
  const calDelta = clampInt(proposed.calDelta, -MAX_CAL_DELTA, MAX_CAL_DELTA);
  const carbDelta = clampInt(proposed.carbDelta, -MAX_CARB_DELTA, MAX_CARB_DELTA);
  // Protein may nudge a little but is held tight to protect the recomp floor.
  const proteinDelta = clampInt(proposed.proteinDelta ?? 0, -15, 15);
  const adjusted: BaselineMacros = {
    cal: Math.max(800, baseline.cal + calDelta),
    protein: Math.max(0, baseline.protein + proteinDelta),
    carbs: Math.max(0, baseline.carbs + carbDelta),
    fat: baseline.fat,
  };
  return {
    adjusted,
    delta: {
      cal: adjusted.cal - baseline.cal,
      protein: adjusted.protein - baseline.protein,
      carbs: adjusted.carbs - baseline.carbs,
      fat: 0,
    },
  };
}
