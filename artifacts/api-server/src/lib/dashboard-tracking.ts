// Pure aggregation for the dashboard "tracking" hub (recomp, training
// consistency, nutrition adherence, machine mix). DB gathering lives in the
// route; these turn raw rows into the numbers the dashboard renders, so they're
// unit-testable without a database. Reuses the same load model the reactive
// nutrition engine uses so a session's load is computed identically everywhere.

import { computePlannedLoad } from "./nutrition-engine";

export type VerdictBucket =
  | "over"
  | "complete"
  | "close"
  | "short"
  | "skipped"
  | "bonus";

// Same thresholds as the client-side session verdict (session-verdict.ts) so the
// dashboard counts match the per-card verdicts the runner sees on Today.
export function verdictBucket(
  plannedMin: number,
  actualMin: number,
): VerdictBucket | null {
  const p = Math.max(0, plannedMin);
  const a = Math.max(0, actualMin);
  if (p <= 0 && a <= 0) return null;
  if (p <= 0 && a > 0) return "bonus";
  if (a <= 0) return "skipped";
  const r = a / p;
  if (r > 1.15) return "over";
  if (r >= 0.9) return "complete";
  if (r >= 0.6) return "close";
  return "short";
}

// One logged workout + the planned minutes of the plan day it links to (null for
// off-plan rows). `plannedMin` is the sum of the matched plan day's buckets.
export type TrainingRow = {
  date: string;
  equipment: string | null;
  sessionType: string | null;
  durationMin: number | null;
  strengthMin: number | null;
  cardioMin: number | null;
  runMin: number | null;
  modality: string | null;
  plannedMin: number | null;
};

export type MachineMix = { equipment: string; minutes: number; sessions: number };

// Minutes a session actually represents: prefer the bucketed total, else the
// flat duration.
function sessionMinutes(r: TrainingRow): number {
  const bucketed = (r.strengthMin ?? 0) + (r.cardioMin ?? 0) + (r.runMin ?? 0);
  return bucketed > 0 ? bucketed : (r.durationMin ?? 0);
}

// Normalized load for a session — mirrors readActualLoad's bucketing so a
// duration-only row still lands in the right bucket by modality/sessionType.
function sessionLoad(r: TrainingRow): number {
  let s = r.strengthMin ?? 0;
  let c = r.cardioMin ?? 0;
  let run = r.runMin ?? 0;
  if (s === 0 && c === 0 && run === 0 && r.durationMin != null) {
    const mod = (r.modality ?? "").toLowerCase();
    const st = (r.sessionType ?? "").toLowerCase();
    if (/strength|lift|tonal/.test(mod)) s = r.durationMin;
    else if (/run/.test(mod) || /run/.test(st)) run = r.durationMin;
    else c = r.durationMin;
  }
  return computePlannedLoad({ strengthMin: s, cardioMin: c, runMin: run });
}

export function summarizeMachineMix(rows: TrainingRow[]): MachineMix[] {
  const map = new Map<string, { minutes: number; sessions: number }>();
  for (const r of rows) {
    const eq = r.equipment ?? r.sessionType ?? "Other";
    const cur = map.get(eq) ?? { minutes: 0, sessions: 0 };
    cur.minutes += sessionMinutes(r);
    cur.sessions += 1;
    map.set(eq, cur);
  }
  return [...map.entries()]
    .map(([equipment, v]) => ({
      equipment,
      minutes: Math.round(v.minutes),
      sessions: v.sessions,
    }))
    .sort((a, b) => b.minutes - a.minutes);
}

export type ConsistencySummary = {
  sessionsDone: number;
  daysTrained: number;
  minutesDone: number;
  loadTotal: number;
  verdicts: Record<VerdictBucket, number>;
};

export function summarizeConsistency(rows: TrainingRow[]): ConsistencySummary {
  const dates = new Set<string>();
  let load = 0;
  let minutes = 0;
  let done = 0;
  const verdicts: Record<VerdictBucket, number> = {
    over: 0,
    complete: 0,
    close: 0,
    short: 0,
    skipped: 0,
    bonus: 0,
  };
  for (const r of rows) {
    const st = (r.sessionType ?? "").toLowerCase();
    const isSkip = /skip|rest|off/.test(st);
    const mins = sessionMinutes(r);
    if (!isSkip) {
      done += 1;
      dates.add(r.date);
      minutes += mins;
    }
    load += sessionLoad(r);
    const b = verdictBucket(r.plannedMin ?? 0, mins);
    // "skipped" never comes from a logged row (it has minutes); the route adds
    // real skips (planned days with no workout) separately.
    if (b && b !== "skipped") verdicts[b] += 1;
  }
  return {
    sessionsDone: done,
    daysTrained: dates.size,
    minutesDone: Math.round(minutes),
    loadTotal: Math.round(load * 10) / 10,
    verdicts,
  };
}

export type RecompSummary = {
  currentWeightLb: number | null;
  startWeightLb: number | null;
  goalWeightLb: number | null;
  changeLb: number | null;
  toGoalLb: number | null;
  strengthCurrent: number | null;
  strengthGoal: number | null;
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function summarizeRecomp(input: {
  currentWeightLb: number | null;
  startWeightLb: number | null;
  goalWeightLb: number | null;
  strengthCurrent: number | null;
  strengthGoal: number | null;
}): RecompSummary {
  const { currentWeightLb, startWeightLb, goalWeightLb } = input;
  return {
    currentWeightLb,
    startWeightLb,
    goalWeightLb,
    changeLb:
      currentWeightLb != null && startWeightLb != null
        ? round1(currentWeightLb - startWeightLb)
        : null,
    toGoalLb:
      currentWeightLb != null && goalWeightLb != null
        ? round1(currentWeightLb - goalWeightLb)
        : null,
    strengthCurrent: input.strengthCurrent,
    strengthGoal: input.strengthGoal,
  };
}
