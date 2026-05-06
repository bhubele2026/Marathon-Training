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

import type {
  UserPreferencesRunTargetingMode,
  UserPreferencesHrZoneModel,
} from "@workspace/api-client-react";

export type RunTargetingMode = UserPreferencesRunTargetingMode;
export type HrZoneModel = UserPreferencesHrZoneModel;

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
  // User's chosen HR zone model (Task #158). Drives the zone label and
  // percentage table the HR Zone targeting mode renders. Defaults to
  // the legacy 5-zone % of max model when omitted so existing callers
  // and pre-task accounts keep their current behavior.
  hrZoneModel?: HrZoneModel | null;
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

// Per-model zone table (Task #158). Each model defines its ordered
// zones (low → high intensity) and a mapping from our internal 1-5
// intensity bucket (driven by sessionType in `intensityBucket()`) to
// the model's zone index. Percentages are stored as fractions of max
// HR so the same `hrZoneBpmRange` math handles both % of max and
// Karvonen (HR-reserve) for every model.
//
// Bucket → zone mapping rationale (sessionType → intensity bucket
// → model zone): bucket 1 = recovery, 2 = easy/long, 3 = steady,
// 4 = tempo/threshold/race, 5 = intervals/VO2/speed. Models with
// fewer zones collapse adjacent buckets onto the same zone; models
// with more zones reserve the extra zones for the truly hard work.
//
// Friel/Coggan zones are traditionally expressed as % of LTHR. We
// convert with LTHR ≈ 89% of HRmax so the same `hrZoneBpmRange()`
// — which always works in % of HRmax (or Karvonen against HRR) — can
// drive every model without a model-specific resting/threshold input.
interface HrZoneDef {
  label: string;
  lowPct: number;
  highPct: number;
  // Tailwind class used as the swatch ramp on the Settings preview
  // table when this model is active. Ranges from cool (low intensity)
  // to hot (high intensity); models with extra zones get extra mid-
  // ramp shades so the gradient still reads as a temperature scale.
  swatchClass: string;
}

interface HrZoneModelDef {
  zones: HrZoneDef[];
  bucketToZoneIndex: Record<1 | 2 | 3 | 4 | 5, number>;
}

const HR_ZONE_MODEL_DEFS: Record<HrZoneModel, HrZoneModelDef> = {
  five_zone_max: {
    zones: [
      { label: "Zone 1", lowPct: 0.5, highPct: 0.6, swatchClass: "bg-slate-400" },
      { label: "Zone 2", lowPct: 0.6, highPct: 0.7, swatchClass: "bg-emerald-500" },
      { label: "Zone 3", lowPct: 0.7, highPct: 0.8, swatchClass: "bg-amber-400" },
      { label: "Zone 4", lowPct: 0.8, highPct: 0.9, swatchClass: "bg-orange-500" },
      { label: "Zone 5", lowPct: 0.9, highPct: 1.0, swatchClass: "bg-red-500" },
    ],
    bucketToZoneIndex: { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4 },
  },
  // Joe Friel running 7-zone (% LTHR converted to % HRmax assuming
  // LTHR ≈ 89% HRmax). Z5b is the "VO2max" rung most plans key off,
  // so bucket 5 (interval / VO2) lands there rather than maxing out
  // on Z5c which is reserved for short anaerobic bursts.
  friel_7_zone: {
    zones: [
      { label: "Zone 1", lowPct: 0.58, highPct: 0.72, swatchClass: "bg-slate-400" },
      { label: "Zone 2", lowPct: 0.73, highPct: 0.78, swatchClass: "bg-sky-500" },
      { label: "Zone 3", lowPct: 0.79, highPct: 0.83, swatchClass: "bg-emerald-500" },
      { label: "Zone 4", lowPct: 0.84, highPct: 0.88, swatchClass: "bg-amber-400" },
      { label: "Zone 5a", lowPct: 0.89, highPct: 0.91, swatchClass: "bg-orange-400" },
      { label: "Zone 5b", lowPct: 0.92, highPct: 0.94, swatchClass: "bg-orange-500" },
      { label: "Zone 5c", lowPct: 0.95, highPct: 1.0, swatchClass: "bg-red-500" },
    ],
    bucketToZoneIndex: { 1: 0, 2: 1, 3: 2, 4: 3, 5: 5 },
  },
  // Coggan's HR-zone table (5 zones, % LTHR converted to % HRmax).
  // The labels match the Coggan vocabulary so a runner reading their
  // training-peaks plan sees the same language here.
  coggan_5_zone: {
    zones: [
      { label: "Z1 Active Recovery", lowPct: 0.5, highPct: 0.61, swatchClass: "bg-slate-400" },
      { label: "Z2 Endurance", lowPct: 0.62, highPct: 0.74, swatchClass: "bg-emerald-500" },
      { label: "Z3 Tempo", lowPct: 0.75, highPct: 0.84, swatchClass: "bg-amber-400" },
      { label: "Z4 Threshold", lowPct: 0.85, highPct: 0.94, swatchClass: "bg-orange-500" },
      { label: "Z5 VO2max", lowPct: 0.95, highPct: 1.0, swatchClass: "bg-red-500" },
    ],
    bucketToZoneIndex: { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4 },
  },
  // Polarized 3-zone (Z1 < VT1, Z2 between VT1/VT2, Z3 > VT2).
  // VT1 ≈ 80% HRmax, VT2 ≈ 90% HRmax. Bucket 1/2 → Z1, bucket 3/4 → Z2,
  // bucket 5 → Z3.
  polarized_3_zone: {
    zones: [
      { label: "Z1 Easy", lowPct: 0.5, highPct: 0.8, swatchClass: "bg-emerald-500" },
      { label: "Z2 Threshold", lowPct: 0.8, highPct: 0.9, swatchClass: "bg-amber-400" },
      { label: "Z3 Hard", lowPct: 0.9, highPct: 1.0, swatchClass: "bg-red-500" },
    ],
    bucketToZoneIndex: { 1: 0, 2: 0, 3: 1, 4: 1, 5: 2 },
  },
};

// Resolve the HrZoneModel for a given (possibly null/undefined) input,
// always falling back to the legacy five_zone_max model. Centralized
// so every caller — formatRunTarget, hrZoneBpmRange, the Settings
// preview — agrees on the fallback.
export function resolveHrZoneModel(
  model: HrZoneModel | null | undefined,
): HrZoneModel {
  if (model && model in HR_ZONE_MODEL_DEFS) return model;
  return "five_zone_max";
}

// Look up the active model definition. Exposed so the Settings
// preview table can iterate `zones` without re-implementing the
// fallback logic.
export function getHrZoneModelDef(
  model: HrZoneModel | null | undefined,
): HrZoneModelDef {
  return HR_ZONE_MODEL_DEFS[resolveHrZoneModel(model)];
}

// Stable display name for each model used by the Settings dropdown.
export const HR_ZONE_MODEL_LABELS: Record<HrZoneModel, string> = {
  five_zone_max: "5-zone (% of max)",
  friel_7_zone: "Friel 7-zone (running)",
  coggan_5_zone: "Coggan HR zones",
  polarized_3_zone: "Polarized 3-zone",
};

// Short subtitle / description rendered next to each model option in
// Settings so the runner can pick without having to look the model up.
export const HR_ZONE_MODEL_DESCRIPTIONS: Record<HrZoneModel, string> = {
  five_zone_max:
    "The default Garmin / Polar / COROS split. Five zones from 50% to 100% of max HR.",
  friel_7_zone:
    "Joe Friel's running 7-zone model (Z1, Z2, Z3, Z4, Z5a, Z5b, Z5c). Best if your plan distinguishes lactate-threshold from VO2max work.",
  coggan_5_zone:
    "Andrew Coggan's threshold-anchored HR zones (Active Recovery → VO2max). Common in TrainingPeaks plans.",
  polarized_3_zone:
    "Easy / Threshold / Hard. Best for runners following a polarized 80/20 program.",
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

// Task #227: chip-surface tones keyed off the same 5-zone bucket as
// HR_ZONE_COLORS so any pace/target chip we want to dress in the
// runner's actual zone (e.g. the race-week pace chip — VO2 red for 5K,
// threshold orange for 10K, steady amber for marathon pace) can pull
// border / background / eyebrow-label classes from one place. The
// border/background opacities (40% / 10%) match the existing generic
// "border-primary/30 bg-primary/5" prominent-chip surface so the
// re-toned variant doesn't suddenly read as a louder/different
// element. The label tones use 700 in light / 300 in dark for AA
// contrast against the 10% wash background in either theme.
// Task #234: each tone also carries a one-line `description` decoding
// the color into the zone vocabulary the rest of the app uses (Z3,
// Z4, Z5 / steady / threshold / VO2). Race-week pace chips render
// the description as a caption below the chip so a runner who's
// new to zones learns that red 5K means "hard / VO2" while amber
// marathon means "settle in". Centralized here so every surface that
// dresses a chip in a zone tone (RunTargetLine prominent variant,
// race-week banner Target Pace tile, future surfaces) can render the
// same caption without re-stating the vocabulary.
export const HR_ZONE_TONES: Record<
  1 | 2 | 3 | 4 | 5,
  {
    borderClass: string;
    bgClass: string;
    labelClass: string;
    description: string;
  }
> = {
  1: {
    borderClass: "border-slate-400/40",
    bgClass: "bg-slate-400/10",
    labelClass: "text-slate-700 dark:text-slate-300",
    description: "Z1 · Recovery effort",
  },
  2: {
    borderClass: "border-emerald-500/40",
    bgClass: "bg-emerald-500/10",
    labelClass: "text-emerald-700 dark:text-emerald-300",
    description: "Z2 · Easy aerobic",
  },
  3: {
    borderClass: "border-amber-500/40",
    bgClass: "bg-amber-500/10",
    labelClass: "text-amber-700 dark:text-amber-300",
    description: "Z3 · Steady marathon-pace",
  },
  4: {
    borderClass: "border-orange-500/40",
    bgClass: "bg-orange-500/10",
    labelClass: "text-orange-700 dark:text-orange-300",
    description: "Z4 · Threshold effort",
  },
  5: {
    borderClass: "border-red-500/40",
    bgClass: "bg-red-500/10",
    labelClass: "text-red-700 dark:text-red-300",
    description: "Z5 · VO2 effort",
  },
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
// user's heart-rate inputs (Task #141 / #146 / #158). When restingHr
// is provided alongside maxHr, the range is computed via the Karvonen
// (heart-rate-reserve) formula `((maxHr - restingHr) * pct) + restingHr`
// — meaningfully more accurate for fitter runners. Otherwise we use
// the simple % of max model. Returns null when maxHr is missing or
// out of range so the caller can fall back to the unsuffixed
// "Zone N" label.
//
// Task #158: the active HR zone model is consulted to map the 1-5
// intensity bucket onto the model's zone index. Defaults to the
// legacy `five_zone_max` model when omitted so existing callers and
// pre-task accounts keep their current behavior.
export function hrZoneBpmRange(
  bucket: 1 | 2 | 3 | 4 | 5,
  maxHr: number | null | undefined,
  restingHr?: number | null | undefined,
  model?: HrZoneModel | null,
): { low: number; high: number } | null {
  if (
    maxHr == null ||
    !Number.isFinite(maxHr) ||
    maxHr < MIN_MAX_HR ||
    maxHr > MAX_MAX_HR
  ) {
    return null;
  }
  const def = getHrZoneModelDef(model);
  const zoneIndex = def.bucketToZoneIndex[bucket];
  const zone = def.zones[zoneIndex];
  const { lowPct, highPct } = zone;
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

// Companion lookup that returns the active model's zone label for a
// given intensity bucket. Used by both the HR Zone formatter and any
// surface that wants the model-aware "Zone N" text without rendering
// the BPM range too. Always returns a string — falls back to the
// 5-zone model's label when no maxHr is configured.
export function hrZoneLabel(
  bucket: 1 | 2 | 3 | 4 | 5,
  model?: HrZoneModel | null,
): string {
  const def = getHrZoneModelDef(model);
  return def.zones[def.bucketToZoneIndex[bucket]].label;
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
      const range = hrZoneBpmRange(
        bucket,
        input.maxHr,
        input.restingHr,
        input.hrZoneModel,
      );
      const label = hrZoneLabel(bucket, input.hrZoneModel);
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
