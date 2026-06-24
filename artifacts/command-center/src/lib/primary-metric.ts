// Picks the single "headline" number to show on a slimmed-down session card
// (Task #133). Cards used to crowd in TOTAL · LIFT · CARDIO · RUN minute
// chips, distance, pace, strength load, total load and equipment chips.
// Now we surface just the workout title and the one most-relevant number;
// everything else moves into the expand affordance.
//
// Selection rule (most → least specific):
//   1. If the session has run distance (distanceMi > 0) → show miles.
//   2. If more than one minute bucket (lift / cardio / run) is populated
//      and we have a totalMin → show total minutes ("mixed" sessions).
//   3. Otherwise pick the single populated bucket: lift → cardio → run.
//   4. Fall back to totalMin / durationMin if nothing else is set
//      (legacy quick-logged Lifestyle rows have only durationMin).
//   5. If none of the above is positive → null (nothing to show).
//
// The same rule runs for both the planned and the logged side. For logged
// sessions we also expose `getPrimaryMetricCompare`, which picks the kind
// off the *plan* (so the on-card display is apples-to-apples: planned
// 6 mi run → "5.20 / 6.00 mi" on the logged card, even if the runner
// also recorded some lift minutes).

import { formatDistance, formatDuration } from "@/lib/format";

export type PrimaryMetricKind =
  | "distance"
  | "lift"
  | "cardio"
  | "run"
  | "total";

export interface PrimaryMetric {
  kind: PrimaryMetricKind;
  label: string;
  value: number;
  formatted: string;
}

export interface PrimaryMetricCompare {
  actual: PrimaryMetric;
  /** Planned counterpart in the same kind, when one exists & is positive. */
  planned?: PrimaryMetric;
}

const LABEL: Record<PrimaryMetricKind, string> = {
  distance: "Distance",
  lift: "Lift",
  cardio: "Cardio",
  run: "Run",
  total: "Total",
};

// Shape we accept: any subset of the planned/logged session columns we
// care about. Using a structural type avoids coupling this helper to the
// generated OpenAPI types (planned vs logged share most of these names
// but not all).
export interface PrimaryMetricSource {
  distanceMi?: number | null;
  strengthMin?: number | null;
  cardioMin?: number | null;
  runMin?: number | null;
  totalMin?: number | null;
  durationMin?: number | null;
}

function pickKind(s: PrimaryMetricSource): PrimaryMetricKind | null {
  const dist = s.distanceMi ?? 0;
  if (dist > 0) return "distance";
  const lift = s.strengthMin ?? 0;
  const cardio = s.cardioMin ?? 0;
  const run = s.runMin ?? 0;
  const total = s.totalMin ?? s.durationMin ?? 0;
  const populated = [lift > 0, cardio > 0, run > 0].filter(Boolean).length;
  if (populated > 1 && total > 0) return "total";
  if (lift > 0) return "lift";
  if (cardio > 0) return "cardio";
  if (run > 0) return "run";
  if (total > 0) return "total";
  return null;
}

function valueFor(s: PrimaryMetricSource, kind: PrimaryMetricKind): number {
  switch (kind) {
    case "distance":
      return s.distanceMi ?? 0;
    case "lift":
      return s.strengthMin ?? 0;
    case "cardio":
      return s.cardioMin ?? 0;
    case "run":
      return s.runMin ?? 0;
    case "total":
      return s.totalMin ?? s.durationMin ?? 0;
  }
}

function formatFor(kind: PrimaryMetricKind, value: number): string {
  if (kind === "distance") return formatDistance(value);
  return formatDuration(value);
}

// The broad activity family a metric kind belongs to. Used to detect when the
// plan's headline metric and what was actually logged are different KINDS of
// work (plan said cardio, the runner ran or lifted) vs the same activity just
// missing a sub-metric (a run logged without its distance). distance + run are
// the same family (running); lift = strength; cardio = cardio.
function family(kind: PrimaryMetricKind): "run" | "strength" | "cardio" | "total" {
  if (kind === "distance" || kind === "run") return "run";
  if (kind === "lift") return "strength";
  if (kind === "cardio") return "cardio";
  return "total";
}

export function getPrimaryMetric(
  s: PrimaryMetricSource | null | undefined,
): PrimaryMetric | null {
  if (!s) return null;
  const kind = pickKind(s);
  if (!kind) return null;
  const value = valueFor(s, kind);
  if (value <= 0) return null;
  return { kind, label: LABEL[kind], value, formatted: formatFor(kind, value) };
}

/**
 * Build a comparable actual-vs-planned headline for a logged session.
 * The kind is taken from the plan when one exists so the displayed value
 * lines up with what was prescribed (e.g. always show miles on a run day,
 * even if the runner only recorded total minutes).
 */
export function getPrimaryMetricCompare(
  actual: PrimaryMetricSource | null | undefined,
  planned: PrimaryMetricSource | null | undefined,
): PrimaryMetricCompare | null {
  const plannedKind = planned ? pickKind(planned) : null;
  const actualKind = actual ? pickKind(actual) : null;
  let kind = plannedKind ?? actualKind;
  if (!kind) return null;

  // When the plan's headline bucket and what was actually logged are different
  // FAMILIES of work (e.g. the plan logged the day as `cardio` but the session
  // came in as a run or a lift), comparing inside the plan's bucket shows a
  // misleading actual = 0. Fall back to TOTAL minutes so the card honestly
  // reads the real work vs planned (e.g. "30 / 40 min"), matching the detail
  // breakdown's Total row. Same-family gaps (a run with no recorded distance
  // vs a planned-distance run) are left alone so "0.00 / 6.00 mi" still works.
  if (
    plannedKind &&
    actualKind &&
    family(plannedKind) !== family(actualKind) &&
    actual != null &&
    valueFor(actual, plannedKind) <= 0
  ) {
    kind = "total";
  }

  const aValue = actual ? valueFor(actual, kind) : 0;
  const aMetric: PrimaryMetric = {
    kind,
    label: LABEL[kind],
    value: aValue,
    formatted: formatFor(kind, aValue),
  };
  let pMetric: PrimaryMetric | undefined;
  if (planned) {
    const pValue = valueFor(planned, kind);
    if (pValue > 0) {
      pMetric = {
        kind,
        label: LABEL[kind],
        value: pValue,
        formatted: formatFor(kind, pValue),
      };
    }
  }
  return { actual: aMetric, planned: pMetric };
}
