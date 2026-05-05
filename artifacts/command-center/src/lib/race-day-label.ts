// Task #201: derive a runner-facing per-kind label for the race-day
// Sunday (e.g. "5K Day", "10K Day", "Half Marathon Day", "Marathon
// Day") so calendar / dashboard surfaces can headline the right
// distance regardless of which race kind the campaign was built
// around. Task #191 already emits per-kind Sundays in the generator —
// `plan_days.distance_mi` is one of {3.1, 6.2, 13.1, 26.2} and
// `plan_days.description` always begins with "RACE DAY — <label>." for
// the four real-race kinds (see RACE_DAY_SPECS in
// lib/plan-generator/src/templates.ts).
//
// Task #210: the actual race-day classification (regex + distance
// tolerance + session-type gate) lives in the shared
// `@workspace/plan-generator` `detectRaceKind` helper so the api-server
// `/plan/overview` route and this module can never drift. This file
// stays the home of the runner-facing LABEL mapping (long / short /
// canonical distance) — kept on the client because no server surface
// needs the strings today.

import { detectRaceKind, type RaceDayKind } from "@workspace/plan-generator";

export type { RaceDayKind };

export interface RaceDayLabelInfo {
  kind: RaceDayKind;
  // Long, runner-facing badge / headline (e.g. "Marathon Day").
  label: string;
  // Short chip variant used inside compact rows.
  shortLabel: string;
  // Canonical distance for the kind, in miles.
  distanceMi: number;
  // Task #227: training-zone bucket the actual race-day pace lives in
  // (1..5, matching HR_ZONE_COLORS / HR_ZONE_TONES). Drives the
  // race-week pace chip's tone on dashboard / Today / week-detail so
  // the runner sees at a glance that 5K race pace is meant to feel
  // VO2 (red), 10K threshold (orange), and marathon-pace steady
  // (amber) — rather than the generic primary chip styling that gave
  // the same visual weight to "10:30/mi" 5K pace and "11:30/mi"
  // marathon pace. Co-located with the rest of the per-kind table so
  // RACE_DAY_SPECS[kind] → zone tone has a single source of truth
  // (the test in race-day-label.test.ts pins this mapping).
  zoneBucket: 1 | 2 | 3 | 4 | 5;
}

// Single source of truth mapping `RaceDayKind` → 5-zone bucket.
// Exported separately from KIND_INFO so callers can look the bucket
// up directly (e.g. RaceDayHero on the dashboard, where the row that
// drives the chip doesn't carry a sessionType so the full
// raceDayLabel() classifier path isn't needed).
//
// Bucket choices follow the task #227 brief
// (marathon/half = race-pace tone, 10K = threshold, 5K = VO2):
//   - marathon : Z3 amber  — marathon pace is a steady aerobic effort
//   - half     : Z3 amber  — paired with marathon as "race-pace" tone
//                            (RACE_DAY_SPECS sets the same 11:30 pace
//                            ladder for both, so they share a tone)
//   - 10K      : Z4 orange — lactate-threshold effort
//   - 5K       : Z5 red    — VO2max effort, hard from the gun
//
// Mirrors the per-kind pace ladder in `RACE_DAY_SPECS` (templates.ts):
// "11:30" marathon/half (steady race-pace), "11:00" 10K (threshold),
// "10:30" 5K (VO2). Any future change to RACE_DAY_SPECS that reshuffles
// effort tiers should be mirrored here.
export const RACE_DAY_ZONE_BUCKET: Readonly<
  Record<RaceDayKind, 1 | 2 | 3 | 4 | 5>
> = {
  marathon: 3,
  half: 3,
  "10k": 4,
  "5k": 5,
};

const KIND_INFO: Readonly<Record<RaceDayKind, RaceDayLabelInfo>> = {
  marathon: {
    kind: "marathon",
    label: "Marathon Day",
    shortLabel: "Marathon",
    distanceMi: 26.2,
    zoneBucket: RACE_DAY_ZONE_BUCKET.marathon,
  },
  half: {
    kind: "half",
    label: "Half Marathon Day",
    shortLabel: "Half",
    distanceMi: 13.1,
    zoneBucket: RACE_DAY_ZONE_BUCKET.half,
  },
  "10k": {
    kind: "10k",
    label: "10K Day",
    shortLabel: "10K",
    distanceMi: 6.2,
    zoneBucket: RACE_DAY_ZONE_BUCKET["10k"],
  },
  "5k": {
    kind: "5k",
    label: "5K Day",
    shortLabel: "5K",
    distanceMi: 3.1,
    zoneBucket: RACE_DAY_ZONE_BUCKET["5k"],
  },
};

export function raceDayLabel(
  distanceMi: number | null | undefined,
  description: string | null | undefined,
  sessionType?: string | null | undefined,
): RaceDayLabelInfo | null {
  const kind = detectRaceKind(distanceMi, description, sessionType);
  return kind ? KIND_INFO[kind] : null;
}
