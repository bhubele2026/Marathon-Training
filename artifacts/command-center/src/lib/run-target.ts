// Per-mode formatter for prescribed runs (Task #134).
//
// Owns the single string each run card surfaces as its target line on
// Today, Week Detail (collapsed + expanded), and the pre-launch first
// session preview. Driven by the user's `runTargetingMode` preference;
// when the preference is "pace" the legacy "9:30/mi" string is rendered
// (or, if no pace was prescribed, falls back to the planned run minutes
// so the card still has a target).
//
// Walk/run interval recipes scale with the planned run minutes AND with
// the plan week so a beginner's first weeks lean heavily on walking and
// late-campaign weeks ease toward continuous running. The taper week
// itself doesn't get its own special-case here — the prescription
// already shrinks via runMin.

import type { UserPreferencesRunTargetingMode } from "@workspace/api-client-react";

export type RunTargetingMode = UserPreferencesRunTargetingMode;

export interface RunTargetInput {
  sessionType: string;
  // Week number within the campaign (1-indexed). Drives the walk/run
  // interval ramp so beginner weeks lean on walking.
  week: number;
  // Prescribed running minutes for the day. Used by every mode as the
  // duration we have to fill.
  runMin: number | null | undefined;
  // Prescribed distance in miles. Used for pace-mode fallback wording
  // and as a minor signal for effort labels (longer = easier).
  distanceMi?: number | null;
  // Prescribed pace string (e.g. "9:30") if the plan day has one.
  pace?: string | null;
  // User's maximum heart rate in BPM (Task #141). Drives the HR Zone
  // mode's BPM range suffix (e.g. "Zone 2 · 134-148 bpm"). When null
  // or undefined we fall back to the generic "Zone N" label.
  maxHr?: number | null;
  // User's resting heart rate in BPM (Task #146). When provided alongside
  // maxHr, the HR Zone BPM range is computed via the Karvonen / heart-
  // rate-reserve formula instead of the simple % of max model. When null
  // or out-of-range, we fall back to % of max so the existing behavior
  // is unchanged.
  restingHr?: number | null;
}

export interface RunTargetOutput {
  // Headline string the card renders as the target line.
  primary: string;
  // Short mode tag the card renders as a small caption next to the
  // headline (e.g. "EFFORT", "INTERVALS", "ZONE", "PACE") so the user
  // remembers which mode their plan is being shown in.
  modeLabel: string;
  // The intensity bucket (1-5) we mapped this prescription to. Exposed
  // so hr_zones-mode callers can look up `HR_ZONE_COLORS[bucket]` for
  // the color swatch (Task #165) without re-deriving the bucket
  // themselves. Always populated; non-HR modes can ignore it.
  bucket: 1 | 2 | 3 | 4 | 5;
}

const MODE_LABELS: Record<RunTargetingMode, string> = {
  effort: "Effort",
  intervals: "Intervals",
  hr_zones: "HR Zone",
  pace: "Pace",
};

// Map sessionType to an intensity bucket (1=very easy ... 5=very hard).
// Anything that isn't an obvious quality session falls into the easy
// bucket — easy aerobic running is the dominant mode in every plan.
function intensityBucket(sessionType: string): 1 | 2 | 3 | 4 | 5 {
  const s = sessionType.toLowerCase();
  if (s.includes("recovery")) return 1;
  if (s.includes("long")) return 2;
  // "Steady" / steady-state aerobic prescriptions land in zone 3
  // (matches the EFFORT_LABELS[3] = "Steady moderate" rung). Without
  // this bucket 3 is unreachable from any sessionType, leaving the
  // amber-400 swatch in HR_ZONE_COLORS only locked in by the unit
  // test on the color map and never exercised end-to-end (Task #170).
  if (s.includes("steady")) return 3;
  if (s.includes("tempo") || s.includes("threshold")) return 4;
  if (s.includes("interval") || s.includes("vo2") || s.includes("speed")) return 5;
  if (s.includes("race") || s.includes("marathon-pace") || s.includes("goal")) return 4;
  return 2;
}

const EFFORT_LABELS: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: "Very easy recovery",
  2: "Easy conversational",
  3: "Steady moderate",
  4: "Hard but sustainable",
  5: "Very hard / repeats",
};

const HR_ZONE_LABELS: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: "Zone 1",
  2: "Zone 2",
  3: "Zone 3",
  4: "Zone 4",
  5: "Zone 5",
};

// Standard 5-zone color ramp used by watches and most popular training
// apps (Garmin, Polar, COROS): Zone 1 cool/grey, Zone 2 green, Zone 3
// yellow, Zone 4 orange, Zone 5 red. The mid-saturation 500-shade
// Tailwind tokens stay legible against both the light (~90% L muted)
// and dark (~15% L muted) preview backgrounds we render swatches on,
// so a single class string works in both themes without an explicit
// `dark:` variant. Anything that color-codes HR zones (Settings
// preview, Today's run target chip, expanded plan card detail) should
// pull from this map rather than hard-coding hex values.
export const HR_ZONE_COLORS: Record<
  1 | 2 | 3 | 4 | 5,
  { swatchClass: string }
> = {
  1: { swatchClass: "bg-slate-400" },
  2: { swatchClass: "bg-emerald-500" },
  3: { swatchClass: "bg-amber-400" },
  4: { swatchClass: "bg-orange-500" },
  5: { swatchClass: "bg-red-500" },
};

// Standard 5-zone "% of max heart rate" model (Task #141). Each zone is
// a [low, high] fraction of the user's max HR. Zone 1 starts at 50% so
// that a fully personalized "Zone 1 · 100-120 bpm" line still
// represents purposeful aerobic recovery rather than walking.
const HR_ZONE_PCT: Record<1 | 2 | 3 | 4 | 5, [number, number]> = {
  1: [0.5, 0.6],
  2: [0.6, 0.7],
  3: [0.7, 0.8],
  4: [0.8, 0.9],
  5: [0.9, 1.0],
};

// Realistic adult max HR range. Mirrors the OpenAPI bounds; values
// outside the window are treated as "not configured" so we fall back
// to the generic Zone N label rather than rendering a nonsense range.
const MIN_MAX_HR = 80;
const MAX_MAX_HR = 230;

// Realistic resting HR range (Task #146). Mirrors the OpenAPI bounds.
// Athletes can dip into the 30s; sedentary adults trend high. Values
// outside the window — or any restingHr that isn't strictly less than
// the configured maxHr — are ignored so we silently fall back to the
// % of max model rather than rendering a nonsense Karvonen range.
const MIN_RESTING_HR = 30;
const MAX_RESTING_HR = 110;

// Compute the BPM low/high range for a given zone bucket and the
// user's heart-rate inputs (Task #141 / #146). When restingHr is
// provided alongside maxHr, the range is computed via the Karvonen
// (heart-rate-reserve) formula `((maxHr - restingHr) * pct) + restingHr`
// — meaningfully more accurate for fitter runners. Otherwise we use
// the simple % of max model. Returns null when maxHr is missing or
// out of range so the caller can fall back to the unsuffixed
// "Zone N" label.
export function hrZoneBpmRange(
  bucket: 1 | 2 | 3 | 4 | 5,
  maxHr: number | null | undefined,
  restingHr?: number | null | undefined,
): { low: number; high: number } | null {
  if (
    maxHr == null ||
    !Number.isFinite(maxHr) ||
    maxHr < MIN_MAX_HR ||
    maxHr > MAX_MAX_HR
  ) {
    return null;
  }
  const [lowPct, highPct] = HR_ZONE_PCT[bucket];
  const restingValid =
    restingHr != null &&
    Number.isFinite(restingHr) &&
    restingHr >= MIN_RESTING_HR &&
    restingHr <= MAX_RESTING_HR &&
    restingHr < maxHr;
  if (restingValid) {
    const reserve = maxHr - (restingHr as number);
    return {
      low: Math.round(reserve * lowPct + (restingHr as number)),
      high: Math.round(reserve * highPct + (restingHr as number)),
    };
  }
  return {
    low: Math.round(maxHr * lowPct),
    high: Math.round(maxHr * highPct),
  };
}

// Pick a beginner-friendly run/walk recipe that covers approximately
// `runMin` minutes of total work and eases the walk portion as the
// runner banks weeks. Returns null when there's not enough planned run
// time to make a recipe (rest/cross-train days).
//
// Ratio progression by week:
//   weeks 1-2  : 1 min run / 2 min walk (3-min cycle)
//   weeks 3-4  : 2 min run / 2 min walk (4-min cycle)
//   weeks 5-6  : 3 min run / 2 min walk (5-min cycle)
//   weeks 7-8  : 5 min run / 1 min walk (6-min cycle)
//   weeks 9+   : 9 min run / 1 min walk (10-min cycle)
//
// We compute reps to fill the planned duration as closely as possible
// while always keeping at least one rep — a 12-min easy run still
// becomes "1 min run / 2 min walk × 4" rather than dropping the walks.
function intervalRecipe(
  runMin: number,
  week: number,
): string | null {
  if (!Number.isFinite(runMin) || runMin <= 0) return null;
  let runSeg: number;
  let walkSeg: number;
  if (week <= 2) {
    runSeg = 1;
    walkSeg = 2;
  } else if (week <= 4) {
    runSeg = 2;
    walkSeg = 2;
  } else if (week <= 6) {
    runSeg = 3;
    walkSeg = 2;
  } else if (week <= 8) {
    runSeg = 5;
    walkSeg = 1;
  } else {
    runSeg = 9;
    walkSeg = 1;
  }
  const cycle = runSeg + walkSeg;
  const reps = Math.max(1, Math.round(runMin / cycle));
  return `${runSeg} min run / ${walkSeg} min walk × ${reps}`;
}

// True when this prescription is a run we should re-target. Cardio /
// strength / rest days shouldn't get an effort label slapped on them.
export function isRunSession(input: {
  sessionType: string;
  runMin?: number | null;
  distanceMi?: number | null;
}): boolean {
  if ((input.runMin ?? 0) > 0) return true;
  if ((input.distanceMi ?? 0) > 0) return true;
  const s = input.sessionType.toLowerCase();
  return s.includes("run") || s.includes("tempo") || s.includes("interval");
}

export function formatRunTarget(
  mode: RunTargetingMode,
  input: RunTargetInput,
): RunTargetOutput {
  const bucket = intensityBucket(input.sessionType);
  const modeLabel = MODE_LABELS[mode];
  switch (mode) {
    case "effort":
      return { primary: EFFORT_LABELS[bucket], modeLabel, bucket };
    case "hr_zones": {
      const range = hrZoneBpmRange(bucket, input.maxHr, input.restingHr);
      const label = HR_ZONE_LABELS[bucket];
      if (range) {
        return {
          primary: `${label} · ${range.low}-${range.high} bpm`,
          modeLabel,
          bucket,
        };
      }
      return { primary: label, modeLabel, bucket };
    }
    case "intervals": {
      const runMin = input.runMin ?? 0;
      const recipe = intervalRecipe(runMin, input.week);
      if (recipe) return { primary: recipe, modeLabel, bucket };
      // Fall back to effort label when there's no run minutes to fill.
      return { primary: EFFORT_LABELS[bucket], modeLabel, bucket };
    }
    case "pace":
    default: {
      if (input.pace) return { primary: `${input.pace}/mi`, modeLabel, bucket };
      const runMin = input.runMin ?? 0;
      if (runMin > 0) {
        return { primary: `${runMin} min easy`, modeLabel, bucket };
      }
      return { primary: EFFORT_LABELS[bucket], modeLabel, bucket };
    }
  }
}
