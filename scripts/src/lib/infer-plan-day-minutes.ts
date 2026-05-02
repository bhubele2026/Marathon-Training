// Per-row heuristics for the strength_min / cardio_min / run_min backfill
// added by task #74. Pre-task, the canonical generator overloaded
// `cardio_min` as "run minutes" on run days and as "cross-train minutes"
// on strength + cardio days. We can't safely use the canonical generator
// to backfill anymore because some rows may have been edited by the user
// (sessionType / equipment / description / distanceMi / pace), so applying
// the canonical values by date would clobber their customizations.
//
// Instead, we infer each minute bucket from the row's *own* fields
// (sessionType, equipment, description, distanceMi, pace). When the row
// doesn't give us enough signal to be confident, we return null for that
// bucket and the caller leaves the column untouched.
//
// Conventions used by the seeded plan that the regexes target:
//   * "Tonal (45 min, ...)" or "25 min Tonal ..." for lift minutes.
//   * "25 min ... Peloton Bike spin" / "Peloton Row" / "spin" for cross-
//     train cardio minutes.
//   * "Tread run (1.5 mi, ...)" + a `pace` like "14:30" -> run minutes
//     come from distance × pace.
//   * "Long run/walk (2 mi): ..." -> run minutes from distance × pace,
//     no lift, no cross-train.
//   * isRest -> all three buckets are 0.
//
// When a regex matches, we return the parsed number. When the row clearly
// does *not* contain that modality (no "Tonal" / "lift" / "strength"
// anywhere in the description and equipment isn't Tonal), we return 0
// for that bucket. When it's ambiguous (modality keywords present but no
// "NN min" we can latch onto), we return null so the backfill leaves the
// column alone — that's the "ambiguous rows untouched" rule.

export interface InferenceInput {
  sessionType: string | null;
  equipment: string | null;
  description: string | null;
  distanceMi: string | number | null;
  pace: string | null;
  isRest: boolean;
}

export interface InferenceOutput {
  strengthMin: number | null;
  cardioMin: number | null;
  runMin: number | null;
}

// Top-level classification used by the backfill to decide *how* to apply
// inferred minutes. The legacy `cardio_min` column was overloaded:
//   * On run-led days it stored the run minutes (treadmill / outdoor).
//   * On strength + cardio days it stored cross-train minutes (bike, row,
//     spin) — i.e. the value the new `cardio_min` is supposed to hold.
// So when we backfill the new `run_min` column, we MUST know which of
// these two flavors a row was, otherwise we'll either (a) double-count
// (write inferred run_min while leaving the same minutes in cardio_min)
// or (b) clobber a genuine cross-train value.
export type SessionClassification =
  | "rest"
  | "run-led"
  | "strength-cardio"
  | "ambiguous";

const LIFT_KEYWORDS = /Tonal|\blift\b|\bstrength\b/i;
const CARDIO_KEYWORDS = /\bBike\b|\bRow\b|\bspin\b|\bcycle\b|\belliptical\b|cross[- ]?train/i;
const RUN_SESSION_KEYWORDS =
  /Run|Tempo|Interval|Aerobic Base|Quality|Threshold|Track|Fartlek/i;
const RUN_EQUIPMENT_KEYWORDS = /Tread|Outdoor|Run/i;

// "Tonal (45 min, ...)" or "Tonal (45-min ...)"
const LIFT_PAREN_RE = /Tonal\s*\((\d+)\s*[- ]?\s*min/i;
// "45 min Tonal", "45 min of Tonal", "25 min Tonal core", "25 min ... lift"
const LIFT_INLINE_RE =
  /(\d+)\s*min(?:utes?)?\s+(?:of\s+)?(?:[A-Za-z][\w/-]*\s+){0,3}?(?:Tonal|lift|strength)/i;

// "25 min ... Peloton Bike spin", "25 min steady Peloton Row",
// "25 min steady bike on Peloton Bike"
const CARDIO_INLINE_RE =
  /(\d+)\s*min(?:utes?)?\s+(?:[A-Za-z][\w/-]*\s+){0,4}?(?:Bike|Row|spin|cycle|elliptical|cross[- ]?train)/i;
// "Peloton Bike (25 min ...)" - paren form, less common but cheap to support.
const CARDIO_PAREN_RE =
  /(?:Bike|Row|spin|cycle|elliptical|cross[- ]?train)\s*\((\d+)\s*[- ]?\s*min/i;

// Walk allowance (e.g. "Optional 20 min walk") on rest days isn't training
// time; we don't want to count it toward any bucket.

function paceToMinutes(pace: string): number | null {
  const m = pace.trim().match(/^(\d+):(\d{2})$/);
  if (!m) return null;
  return parseInt(m[1], 10) + parseInt(m[2], 10) / 60;
}

function parseDistance(d: string | number | null): number | null {
  if (d == null) return null;
  if (typeof d === "number") return Number.isFinite(d) ? d : null;
  const n = parseFloat(d);
  return Number.isFinite(n) ? n : null;
}

// Explicit negation phrases that the canonical generator emits on long-run
// or recovery days, e.g. "NO lift today.", "no heavy lifting".
const LIFT_NEGATION_RE = /\bno\s+(?:heavy\s+)?(?:lift(?:ing)?|Tonal|strength)\b/i;

function inferLift(row: InferenceInput): number | null {
  const desc = row.description ?? "";
  const eq = row.equipment ?? "";
  const sess = row.sessionType ?? "";

  // If a concrete "NN min ... Tonal" / "Tonal (NN min" phrase exists, trust
  // it — even when the description also includes a qualifier like
  // "(no heavy lifting)" attached to the Tonal session itself.
  const m = desc.match(LIFT_PAREN_RE) ?? desc.match(LIFT_INLINE_RE);
  if (m) return parseInt(m[1], 10);

  // Otherwise an explicit "NO lift today" / "no Tonal" / "no strength"
  // phrase means a clean zero (e.g. long-run-only days).
  if (LIFT_NEGATION_RE.test(desc)) return 0;

  const hasLiftSignal =
    LIFT_KEYWORDS.test(desc) ||
    /Tonal/i.test(eq) ||
    /Strength/i.test(sess);

  if (!hasLiftSignal) return 0;

  // Lift is clearly present but we can't extract minutes -> ambiguous.
  return null;
}

function inferCardio(row: InferenceInput): number | null {
  const desc = row.description ?? "";

  const hasCardioSignal = CARDIO_KEYWORDS.test(desc);

  if (!hasCardioSignal) return 0;

  const m = desc.match(CARDIO_INLINE_RE) ?? desc.match(CARDIO_PAREN_RE);
  if (m) return parseInt(m[1], 10);

  return null;
}

function inferRun(row: InferenceInput): number | null {
  const eq = row.equipment ?? "";
  const sess = row.sessionType ?? "";
  const dist = parseDistance(row.distanceMi);

  const hasRunSignal =
    RUN_SESSION_KEYWORDS.test(sess) ||
    RUN_EQUIPMENT_KEYWORDS.test(eq) ||
    dist != null;

  if (!hasRunSignal) return 0;

  if (dist != null && dist > 0 && row.pace) {
    const paceMin = paceToMinutes(row.pace);
    if (paceMin != null) return Math.round(dist * paceMin);
  }

  // Run is plausible but we can't compute minutes -> ambiguous.
  return null;
}

export function inferPlanDayMinutes(row: InferenceInput): InferenceOutput {
  if (row.isRest) {
    return { strengthMin: 0, cardioMin: 0, runMin: 0 };
  }
  return {
    strengthMin: inferLift(row),
    cardioMin: inferCardio(row),
    runMin: inferRun(row),
  };
}

export function classifySession(row: InferenceInput): SessionClassification {
  if (row.isRest) return "rest";
  const eq = row.equipment ?? "";
  const sess = row.sessionType ?? "";
  const dist = parseDistance(row.distanceMi);
  const isRun =
    RUN_EQUIPMENT_KEYWORDS.test(eq) ||
    RUN_SESSION_KEYWORDS.test(sess) ||
    (dist != null && dist > 0);
  if (isRun) return "run-led";
  const desc = row.description ?? "";
  const isStrengthCardio =
    LIFT_KEYWORDS.test(desc) ||
    /Tonal/i.test(eq) ||
    /Strength/i.test(sess) ||
    CARDIO_KEYWORDS.test(desc);
  if (isStrengthCardio) return "strength-cardio";
  return "ambiguous";
}
