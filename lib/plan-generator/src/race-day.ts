// Task #210: shared race-day detection. The api-server `/plan/overview`
// route and the command-center `raceDayLabel` helper used to carry
// line-for-line copies of the same regex / distance-tolerance logic
// (originally added in Task #204 and Task #201 respectively). Both
// surfaces must agree on which trailing Sundays count as race days
// because they consume the same `RACE_DAY_SPECS` description prefix
// (see `templates.ts`) — so the canonical helper lives here, next to
// the spec it mirrors.
//
// Resolution rules (kept identical to the legacy duplicates):
//   * Gate on an explicit race signal — either `sessionType === "Race"`
//     (case + whitespace tolerant) OR the description starts with the
//     generator's "RACE DAY — " prefix. Without this guard a stray
//     13.1 mi long run / 3.1 mi shakeout / 6.2 mi taper run / 26.2 mi
//     anything would mis-classify from distance alone.
//   * Resolve kind from the description prefix first (survives a
//     runner editing `distance_mi` away from the canonical value).
//   * Fall back to `distance_mi` for legacy / hand-edited rows that
//     lost the prefix. The four canonical distances are far enough
//     apart (≥3.1 mi gap) that 0.05 mi tolerance can never collide.
//
// Returns `null` when the row is not a recognised race-day Sunday so
// callers can fall through to the generic session-type title.

export type RaceDayKind = "marathon" | "half" | "10k" | "5k";

// Generator writes "RACE DAY — <label>." with an em-dash. Be tolerant
// of a regular "-" in case a customization round-trips through an
// editor that normalises punctuation.
const RACE_DAY_PREFIX_RE = /^RACE DAY\s*[—-]\s*/i;
const RACE_DAY_KIND_RE = /^RACE DAY\s*[—-]\s*(Marathon|Half|10K|5K)\b/i;

function kindFromDescription(description: string): RaceDayKind | null {
  const m = description.match(RACE_DAY_KIND_RE);
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
  const eq = (a: number, b: number) => Math.abs(a - b) <= 0.05;
  if (eq(distanceMi, 26.2)) return "marathon";
  if (eq(distanceMi, 13.1)) return "half";
  if (eq(distanceMi, 6.2)) return "10k";
  if (eq(distanceMi, 3.1)) return "5k";
  return null;
}

export function detectRaceKind(
  distanceMi: number | null | undefined,
  description: string | null | undefined,
  sessionType?: string | null | undefined,
): RaceDayKind | null {
  const desc = description ?? "";
  const hasRacePrefix = RACE_DAY_PREFIX_RE.test(desc);
  const isRaceSession =
    typeof sessionType === "string" &&
    sessionType.trim().toLowerCase() === "race";
  if (!hasRacePrefix && !isRaceSession) return null;

  const fromDesc = kindFromDescription(desc);
  if (fromDesc) return fromDesc;
  const fromDist = kindFromDistance(distanceMi);
  if (fromDist) return fromDist;
  return null;
}
