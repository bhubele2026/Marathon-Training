// Weekly weight-goal math. Pure + DB-free so it can be unit-tested directly and
// reused by the goals route (Phase 1) and the weekly rollup (Phase 2). The rate
// is ALWAYS clamped to the science-safe rate from nutrition-safety.ts — a weekly
// weight goal can never demand faster than safe.

import { safeWeeklyRateLb, round1 } from "./nutrition-safety";

// Modest cap on intentional weight GAIN (lean bulk) — gains aren't a fat-loss
// safety concern but shouldn't be silly fast either.
export const MAX_GAIN_RATE_LB_PER_WK = 0.5;

export type WeeklyRateClamp = {
  /** The signed rate actually applied (lb/wk; negative = loss). */
  rateLb: number;
  /** True when the requested rate was eased to a safe one. */
  clamped: boolean;
  /** Human note when clamped (else null). */
  note: string | null;
};

/**
 * Clamp a requested signed weekly rate (lb/wk; negative = loss) to a safe one
 * for a client of this size. Loss magnitude is capped at the safe rate (min 1%
 * bodyweight, ~2 lb/wk); gains are capped at a modest lean-bulk rate.
 */
export function clampWeeklyRate(
  desiredRateLb: number,
  currentWeightLb: number,
): WeeklyRateClamp {
  const safe = safeWeeklyRateLb(currentWeightLb); // positive magnitude
  if (desiredRateLb < 0) {
    const mag = Math.abs(desiredRateLb);
    if (mag > safe + 0.001) {
      return {
        rateLb: -round1(safe),
        clamped: true,
        note: `Eased your target from ${round1(-desiredRateLb)} to a safe ${round1(safe)} lb/wk of loss — faster than that isn't sustainable for your size.`,
      };
    }
    return { rateLb: round1(desiredRateLb), clamped: false, note: null };
  }
  if (desiredRateLb > 0) {
    if (desiredRateLb > MAX_GAIN_RATE_LB_PER_WK + 0.001) {
      return {
        rateLb: MAX_GAIN_RATE_LB_PER_WK,
        clamped: true,
        note: `Eased your gain target to ${MAX_GAIN_RATE_LB_PER_WK} lb/wk — a slow lean-bulk pace keeps the gains mostly muscle.`,
      };
    }
    return { rateLb: round1(desiredRateLb), clamped: false, note: null };
  }
  return { rateLb: 0, clamped: false, note: null };
}

export type WeeklyWeightInput = {
  startWeightLb: number;
  rateLb: number; // signed, already clamped
  goalWeightLb: number | null;
  anchorDateISO: string; // week 0
  todayISO: string;
  latestActualLb: number | null;
};

export type WeeklyWeightStatus = {
  rateLb: number;
  goalWeightLb: number | null;
  startWeightLb: number;
  anchorDateISO: string;
  /** Whole weeks elapsed since the anchor (>= 0). */
  weekIndex: number;
  /** The target bodyweight you should be at by the END of the current week,
   * clamped so it never overshoots the goal weight. */
  currentWeekTargetLb: number;
  latestActualLb: number | null;
  /** Actual minus this week's target (lb). Negative = ahead (for loss). null
   * when no actual weight yet. */
  varianceLb: number | null;
  /** True when the latest actual is at/ahead of this week's target (within a
   * small tolerance). null when no actual weight yet. */
  onTrack: boolean | null;
};

const ON_TRACK_TOLERANCE_LB = 1.5;
const DAY_MS = 86400000;

function wholeWeeksBetween(anchorISO: string, todayISO: string): number {
  const a = Date.parse(`${anchorISO}T00:00:00Z`);
  const t = Date.parse(`${todayISO}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(t) || t < a) return 0;
  return Math.floor((t - a) / (7 * DAY_MS));
}

/** Target weight by the end of week N (clamped at the goal so it never
 * overshoots). Exported for the per-week curve. */
export function targetWeightForWeek(
  input: Pick<WeeklyWeightInput, "startWeightLb" | "rateLb" | "goalWeightLb">,
  weekEnd: number,
): number {
  const raw = input.startWeightLb + input.rateLb * weekEnd;
  const goal = input.goalWeightLb;
  if (goal == null) return round1(raw);
  // Clamp toward the goal: don't pass it in the direction of travel.
  if (input.rateLb < 0) return round1(Math.max(goal, raw));
  if (input.rateLb > 0) return round1(Math.min(goal, raw));
  return round1(raw);
}

export function weeklyWeightStatus(input: WeeklyWeightInput): WeeklyWeightStatus {
  const weekIndex = wholeWeeksBetween(input.anchorDateISO, input.todayISO);
  // Target for the END of the CURRENT week (weekIndex + 1).
  const currentWeekTargetLb = targetWeightForWeek(input, weekIndex + 1);

  let varianceLb: number | null = null;
  let onTrack: boolean | null = null;
  if (input.latestActualLb != null) {
    varianceLb = round1(input.latestActualLb - currentWeekTargetLb);
    if (input.rateLb < 0) {
      onTrack = input.latestActualLb <= currentWeekTargetLb + ON_TRACK_TOLERANCE_LB;
    } else if (input.rateLb > 0) {
      onTrack = input.latestActualLb >= currentWeekTargetLb - ON_TRACK_TOLERANCE_LB;
    } else {
      onTrack = Math.abs(input.latestActualLb - currentWeekTargetLb) <= ON_TRACK_TOLERANCE_LB + 1;
    }
  }

  return {
    rateLb: input.rateLb,
    goalWeightLb: input.goalWeightLb,
    startWeightLb: input.startWeightLb,
    anchorDateISO: input.anchorDateISO,
    weekIndex,
    currentWeekTargetLb,
    latestActualLb: input.latestActualLb,
    varianceLb,
    onTrack,
  };
}
