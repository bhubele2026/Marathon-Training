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
// IMPORTANT: classification is GATED on an explicit race signal —
// either the row's `sessionType === "Race"` or the description starts
// with the generator's "RACE DAY — " prefix. Without this guard a
// regular 13.1 mi long run (or a 3.1 mi shakeout) would mis-classify
// as a race day from distance alone, and the calendar would paint a
// stray "Half Marathon Day" / "5K Day" badge on it. Once the row is
// confirmed to be a race day, kind is resolved from the description
// prefix first (survives a runner editing the distance), then falls
// back to `distance_mi` for legacy / hand-edited rows.
//
// Returns `null` when the row is not a recognised race-day Sunday so
// callers can fall through to the generic session-type title.

export type RaceDayKind = "5k" | "10k" | "half" | "marathon";

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

function kindFromDescription(description: string | null | undefined): RaceDayKind | null {
  if (!description) return null;
  // Generator writes "RACE DAY — <label>." with an em-dash. Be tolerant
  // of a regular "-" in case a customization round-trips through an
  // editor that normalises punctuation.
  const m = description.match(/^RACE DAY\s*[—-]\s*(Marathon|Half|10K|5K)\b/i);
  if (!m) return null;
  const tag = m[1]!.toLowerCase();
  if (tag === "marathon") return "marathon";
  if (tag === "half") return "half";
  if (tag === "10k") return "10k";
  if (tag === "5k") return "5k";
  return null;
}

function kindFromDistance(distanceMi: number | null | undefined): RaceDayKind | null {
  if (distanceMi == null) return null;
  // Allow a small tolerance so the float round-trip through the API
  // doesn't miss a match. The four real distances are far enough apart
  // (≥3.1 mi gap to the next kind) that 0.05 mi can never collide.
  const eq = (a: number, b: number) => Math.abs(a - b) <= 0.05;
  if (eq(distanceMi, 26.2)) return "marathon";
  if (eq(distanceMi, 13.1)) return "half";
  if (eq(distanceMi, 6.2)) return "10k";
  if (eq(distanceMi, 3.1)) return "5k";
  return null;
}

// Cheap guard so a race-day row is identifiable even when only the
// description is available (e.g. the dashboard's RaceDayHero, which
// reads from `/race-week` and doesn't carry sessionType). Matches the
// generator's "RACE DAY — " prefix tolerantly (em-dash OR hyphen,
// optional surrounding whitespace).
const RACE_DAY_PREFIX_RE = /^RACE DAY\s*[—-]\s*/i;

export function raceDayLabel(
  distanceMi: number | null | undefined,
  description: string | null | undefined,
  sessionType?: string | null | undefined,
): RaceDayLabelInfo | null {
  // Gate on an explicit race signal so non-race rows at canonical race
  // distances (13.1 mi long runs, 3.1 mi shakeouts, 6.2 mi taper runs,
  // 26.2 mi anything) cannot be mis-labeled as race days from the
  // distance fallback. Either the row IS a Race session, OR the
  // description carries the generator's "RACE DAY — " prefix.
  const hasRacePrefix = !!description && RACE_DAY_PREFIX_RE.test(description);
  const isRaceSession = typeof sessionType === "string" && sessionType.trim().toLowerCase() === "race";
  if (!hasRacePrefix && !isRaceSession) return null;

  const fromDesc = kindFromDescription(description);
  if (fromDesc) return KIND_INFO[fromDesc];
  const fromDist = kindFromDistance(distanceMi);
  if (fromDist) return KIND_INFO[fromDist];
  return null;
}
