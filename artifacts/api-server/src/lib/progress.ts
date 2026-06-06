import { db, measurementsTable, plannerConfigsTable } from "@workspace/db";
import { sql, eq, isNotNull, asc } from "drizzle-orm";

// Computes the client's training progress from the data they're already
// logging — weigh-ins, workouts, and completed-vs-planned sessions — from the
// start of their history up to today. Fed into Claude's briefing so every plan
// adapts to where they actually are, and exposed via GET /plan-builder/progress
// for the coach check-in UI.

export interface ProgressSnapshot {
  hasData: boolean;
  /** Human-readable narrative used in the briefing + UI. */
  summary: string;
  weight: {
    startLb: number;
    startDate: string;
    latestLb: number;
    latestDate: string;
    deltaLb: number;
    perWeekLb: number | null;
    goalLb: number | null;
  } | null;
  pace: {
    recentAvg: string | null;
    priorAvg: string | null;
    direction: "faster" | "slower" | "flat" | null;
  } | null;
  strength: {
    recentMin: number;
    priorMin: number;
    direction: "up" | "down" | "flat";
  } | null;
  adherence: {
    windowDays: number;
    planned: number;
    completed: number;
    pct: number;
  } | null;
}

function paceToSec(p: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(p.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}
function secToPace(s: number): string {
  const mm = Math.floor(s / 60);
  const ss = Math.round(s % 60);
  return `${mm}:${ss.toString().padStart(2, "0")}`;
}
function daysBetween(aISO: string, bISO: string): number {
  return Math.round(
    (Date.parse(`${bISO}T00:00:00Z`) - Date.parse(`${aISO}T00:00:00Z`)) /
      86_400_000,
  );
}

export async function computeProgress(): Promise<ProgressSnapshot> {
  const today = new Date().toISOString().slice(0, 10);

  // --- Weight (full history: first logged → latest) ---
  const weights = await db
    .select({ date: measurementsTable.date, weight: measurementsTable.weight })
    .from(measurementsTable)
    .where(isNotNull(measurementsTable.weight))
    .orderBy(asc(measurementsTable.date));
  const activeRows = await db
    .select()
    .from(plannerConfigsTable)
    .where(eq(plannerConfigsTable.isActive, true))
    .limit(1);
  const goalLb = activeRows[0]?.goalWeight ?? null;

  let weight: ProgressSnapshot["weight"] = null;
  if (weights.length >= 1) {
    const first = weights[0]!;
    const last = weights[weights.length - 1]!;
    const startLb = first.weight as number;
    const latestLb = last.weight as number;
    const span = daysBetween(first.date, last.date);
    const perWeekLb = span >= 7 ? ((latestLb - startLb) / span) * 7 : null;
    weight = {
      startLb,
      startDate: first.date,
      latestLb,
      latestDate: last.date,
      deltaLb: +(latestLb - startLb).toFixed(1),
      perWeekLb: perWeekLb == null ? null : +perWeekLb.toFixed(2),
      goalLb,
    };
  }

  // --- Run pace trend (last ~3 weeks vs the 3 before) ---
  const paceRows = (
    await db.execute<{ date: string; pace: string }>(
      sql`SELECT date::text AS date, pace FROM workouts WHERE pace IS NOT NULL AND distance_mi > 0 ORDER BY date`,
    )
  ).rows;
  let pace: ProgressSnapshot["pace"] = null;
  if (paceRows.length >= 2) {
    const recent: number[] = [];
    const prior: number[] = [];
    for (const r of paceRows) {
      const sec = paceToSec(r.pace);
      if (sec == null) continue;
      const age = daysBetween(r.date, today);
      if (age <= 21) recent.push(sec);
      else if (age <= 49) prior.push(sec);
    }
    const avg = (a: number[]) =>
      a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
    const ra = avg(recent);
    const pa = avg(prior);
    let direction: "faster" | "slower" | "flat" | null = null;
    if (ra != null && pa != null) {
      const diff = pa - ra; // positive => recent is faster (fewer sec/mi)
      direction = Math.abs(diff) < 5 ? "flat" : diff > 0 ? "faster" : "slower";
    }
    pace = {
      recentAvg: ra == null ? null : `${secToPace(ra)}/mi`,
      priorAvg: pa == null ? null : `${secToPace(pa)}/mi`,
      direction,
    };
  }

  // --- Strength volume trend (last 3 wks vs prior 3 wks) ---
  const sAgg = (
    await db.execute<{ recent: number; prior: number }>(
      sql`SELECT
        COALESCE(SUM(strength_min) FILTER (WHERE date >= CURRENT_DATE - INTERVAL '21 days'), 0)::float AS recent,
        COALESCE(SUM(strength_min) FILTER (WHERE date >= CURRENT_DATE - INTERVAL '42 days' AND date < CURRENT_DATE - INTERVAL '21 days'), 0)::float AS prior
        FROM workouts`,
    )
  ).rows[0] ?? { recent: 0, prior: 0 };
  let strength: ProgressSnapshot["strength"] = null;
  if (sAgg.recent > 0 || sAgg.prior > 0) {
    const direction =
      Math.abs(sAgg.recent - sAgg.prior) < 20
        ? "flat"
        : sAgg.recent > sAgg.prior
          ? "up"
          : "down";
    strength = {
      recentMin: Math.round(sAgg.recent),
      priorMin: Math.round(sAgg.prior),
      direction,
    };
  }

  // --- Adherence (last 4 weeks: completed vs planned non-rest days) ---
  const adh = (
    await db.execute<{ planned: number; completed: number }>(
      sql`SELECT
        (SELECT COUNT(*)::int FROM plan_days
           WHERE is_rest = false AND date >= CURRENT_DATE - INTERVAL '28 days' AND date <= CURRENT_DATE) AS planned,
        (SELECT COUNT(DISTINCT pd.id)::int FROM plan_days pd
           JOIN workouts w ON w.plan_day_id = pd.id
           WHERE pd.is_rest = false AND pd.date >= CURRENT_DATE - INTERVAL '28 days' AND pd.date <= CURRENT_DATE) AS completed`,
    )
  ).rows[0] ?? { planned: 0, completed: 0 };
  let adherence: ProgressSnapshot["adherence"] = null;
  if (adh.planned > 0) {
    adherence = {
      windowDays: 28,
      planned: adh.planned,
      completed: adh.completed,
      pct: Math.round((adh.completed / adh.planned) * 100),
    };
  }

  // --- Narrative ---
  const parts: string[] = [];
  if (weight) {
    const dir =
      weight.deltaLb < 0 ? "down" : weight.deltaLb > 0 ? "up" : "flat";
    parts.push(
      `Weight: ${weight.startLb}→${weight.latestLb} lb (${dir} ${Math.abs(
        weight.deltaLb,
      )} lb${
        weight.perWeekLb != null ? `, ~${Math.abs(weight.perWeekLb)} lb/wk` : ""
      })${weight.goalLb != null ? `, goal ${weight.goalLb} lb` : ""}.`,
    );
  }
  if (pace) {
    parts.push(
      `Run pace: recent avg ${pace.recentAvg ?? "n/a"}${
        pace.priorAvg ? ` vs ${pace.priorAvg} earlier` : ""
      }${pace.direction ? ` (${pace.direction})` : ""}.`,
    );
  }
  if (strength) {
    parts.push(
      `Strength volume (last 3 wks vs prior): ${strength.recentMin} vs ${strength.priorMin} min (${strength.direction}).`,
    );
  }
  if (adherence) {
    parts.push(
      `Adherence (last 4 wks): ${adherence.completed}/${adherence.planned} planned sessions done (${adherence.pct}%).`,
    );
  }

  const hasData = parts.length > 0;
  const summary = hasData
    ? parts.join(" ")
    : "No training or weight history logged yet — treat this as a fresh start.";

  return { hasData, summary, weight, pace, strength, adherence };
}
