// Task #228: personalize the race-day Sun pace target from the runner's
// recent quality (tempo / threshold / interval / sharpener / VO2) workouts
// rather than always rendering the static `RACE_DAY_SPECS[raceKind].pace`
// catalog value. Computed at READ time on the /plan/weeks/:week and
// /plan/today endpoints so changing training paces over the campaign
// refreshes the chip without regenerating the plan.
//
// The catalog stays as the fallback when the runner doesn't yet have
// enough quality work to average over (cold-start weeks, fresh re-applies,
// or runners who only do easy aerobic work). The result is plumbed onto
// the race-day plan_day's API payload as a `personalizedRacePace` object
// so the UI can render a small explainer chip / tooltip indicating
// whether the chip's pace is from the runner's history or the catalog
// default — matching the existing `paceSource: "plan" | "history"`
// contract used by `WorkoutSuggestions`.

import { RACE_DAY_SPECS } from "@workspace/plan-generator";
import type { PlanRaceKind } from "@workspace/plan-generator";

export type PersonalizedRacePaceSource = "personalized" | "catalog";

export type PersonalizableRaceKind = Exclude<PlanRaceKind, "none">;

export interface PersonalizedRacePace {
  // Final race-day pace string the chip should render (e.g. "10:55").
  // Either personalized from history or pulled from the catalog.
  pace: string;
  // Where the pace came from. "personalized" means we had at least
  // MIN_QUALITY_SAMPLE quality runs in the last `lookbackWeeks` and the
  // value was derived from their average; "catalog" means we fell back
  // to `RACE_DAY_SPECS[raceKind].pace`.
  source: PersonalizedRacePaceSource;
  // Number of quality workouts that fed the average. Always populated
  // (0 when source === "catalog" because the runner had nothing to
  // average over). Lets the UI tooltip render "Avg of N quality runs".
  sampleSize: number;
  // Lookback window in whole weeks. Mirrors the input so the UI tooltip
  // can render "last 8 weeks of training" without re-deriving it.
  lookbackWeeks: number;
  // Average pace seconds/mile of the quality sample BEFORE the per-kind
  // race-day offset is applied. Null when source === "catalog". Surfaced
  // so the tooltip can show the raw training pace alongside the
  // personalized race-day target ("8:42 tempo avg → 10:55 race target").
  basisPaceSeconds: number | null;
}

// Minimum number of quality workouts required to personalize. Below this
// threshold the small-sample noise outweighs the signal — a single 5K
// time trial logged at marathon pace would skew the chip badly. Three
// is the same floor coaches typically use for "do you have enough recent
// data to set goal paces from".
export const MIN_QUALITY_SAMPLE = 3;

// Default lookback window. Eight weeks is long enough to span a full
// build / sharpening block (so a runner who deloaded last week still
// has the prior weeks' tempos in the average) but short enough that
// stale early-base paces fall off as the campaign sharpens.
export const DEFAULT_LOOKBACK_WEEKS = 8;

// Per-kind offset (seconds/mi) applied to the average quality pace to
// derive a sensible race-day target. The four canonical race distances
// each sit at a different rung on the intensity ladder relative to
// tempo / threshold work:
//
//   * marathon — paced ~30s/mi SLOWER than tempo (steady marathon-pace
//     effort is sub-threshold; running tempo for 26.2 mi blows up).
//   * half     — paced ~10s/mi SLOWER than tempo (half pace sits just
//     under threshold for most runners).
//   * 10K      — paced ~5s/mi FASTER than tempo (10K is roughly at
//     lactate-threshold, edging into VO2max territory).
//   * 5K       — paced ~25s/mi FASTER than tempo (5K is at VO2max
//     effort, two notches up from tempo).
//
// The offsets are deliberately small and symmetric so the personalized
// chip never wanders dramatically away from the catalog pace for a
// runner whose tempo work is right at their catalog threshold; they
// shift the chip when the runner's actual training has drifted
// faster / slower than the seeded plan assumed.
const RACE_PACE_OFFSET_S: Readonly<Record<PersonalizableRaceKind, number>> = {
  marathon: 30,
  half: 10,
  "10k": -5,
  "5k": -25,
};

// Lower bound on what we'll print as a pace. Anything faster than this
// is almost certainly a parsing artifact (a 4-minute / mi pace is faster
// than any human race pace) and we'd rather fall back to the catalog
// than print a chip that looks like a typo.
const MIN_PACE_SECONDS = 240; // 4:00/mi
// Upper bound matches the max pace we'd ever print for a beginner —
// 20:00/mi is essentially walking. Beyond this the data is noise.
const MAX_PACE_SECONDS = 1200; // 20:00/mi

// True when this sessionType counts as "quality" running work that
// should feed the race-day pace personalization. Filters case-
// insensitively against the canonical session_type strings the
// generator emits ("Tempo Run", "Sharpener", "Speed", etc.) plus any
// hand-edited variants a runner might log ("threshold intervals",
// "10K race", "vo2 repeats"). Long Run and Aerobic Base are
// intentionally excluded — those are easy aerobic days and would drag
// the average toward easy pace, defeating the whole point of using
// quality work as the basis.
export function isQualityRunSession(sessionType: string | null | undefined): boolean {
  if (!sessionType) return false;
  const s = sessionType.toLowerCase();
  return (
    s.includes("tempo") ||
    s.includes("threshold") ||
    s.includes("sharpener") ||
    s.includes("interval") ||
    s.includes("speed") ||
    s.includes("vo2") ||
    s.includes("race-pace") ||
    s.includes("race pace") ||
    // A logged Race itself is the highest-quality data point we have —
    // include it so a runner who races a tune-up 10K mid-campaign sees
    // that pace flow into the personalized goal.
    s === "race"
  );
}

export function parsePaceToSeconds(pace: string | null | undefined): number | null {
  if (!pace) return null;
  const match = pace.match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || seconds >= 60) return null;
  return minutes * 60 + seconds;
}

export function formatSecondsAsPace(totalSeconds: number): string {
  const rounded = Math.round(totalSeconds);
  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

// Compute the personalized race-day pace from a list of recent quality
// pace strings. Caller is responsible for filtering the workouts to the
// quality session types AND to the desired lookback window — this
// helper just averages the parseable pace strings, applies the per-kind
// offset, and clamps to plausible bounds. Returns the catalog fallback
// whenever fewer than MIN_QUALITY_SAMPLE valid paces are supplied or
// the personalized result lands outside the plausible range.
export function personalizeRacePace(args: {
  raceKind: PersonalizableRaceKind;
  qualityPaces: ReadonlyArray<string | null | undefined>;
  lookbackWeeks?: number;
}): PersonalizedRacePace {
  const lookbackWeeks = args.lookbackWeeks ?? DEFAULT_LOOKBACK_WEEKS;
  const spec = RACE_DAY_SPECS[args.raceKind];
  const catalog: PersonalizedRacePace = {
    pace: spec.pace,
    source: "catalog",
    sampleSize: 0,
    lookbackWeeks,
    basisPaceSeconds: null,
  };

  const parsed = args.qualityPaces
    .map(parsePaceToSeconds)
    .filter((v): v is number => v != null);
  if (parsed.length < MIN_QUALITY_SAMPLE) return catalog;

  const avg = parsed.reduce((s, v) => s + v, 0) / parsed.length;
  const adjusted = avg + RACE_PACE_OFFSET_S[args.raceKind];
  if (adjusted < MIN_PACE_SECONDS || adjusted > MAX_PACE_SECONDS) return catalog;

  return {
    pace: formatSecondsAsPace(adjusted),
    source: "personalized",
    sampleSize: parsed.length,
    lookbackWeeks,
    basisPaceSeconds: Math.round(avg),
  };
}
