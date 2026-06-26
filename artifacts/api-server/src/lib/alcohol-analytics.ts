// Alcohol analytics — the deterministic read behind the two scorecard tiles, the
// dashboard alcohol box, AND the coach briefing. Pure + DB-free so the date math
// and grouping are unit-testable; the route gathers entries/training/nutrition
// and the nutritionist overlays the words.
//
// This is a REDUCTION / AWARENESS tool, not a scold: dry days are the positive
// metric and count UP toward a weekly goal. A day is dry when, since tracking
// began, it is PAST with zero drinks, or TODAY carries an explicit "mark dry"
// (a standardDrinks = 0 entry). Today with no entry yet is "pending" — neither
// dry nor drinking — so we never claim a dry day the owner hasn't earned.

import type {
  AlcoholStats,
  AlcoholDay,
  AlcoholWeek,
  AlcoholImpact,
} from "@workspace/db";

// THE single configurable weekly goal. Prior briefs said "drink 3 days/week"
// (= 4 dry) and "3 days off" (= 3 dry); we pin ONE number used everywhere — the
// tiles, the dashboard box, the coach. Change it here (or pass an override into
// computeAlcoholStats from user preferences) and every surface follows.
export const DRY_DAYS_TARGET = 4;

// ~2 weeks of tracking before we trust an impact comparison (avoid false
// precision on a handful of days).
const SEED_DAYS = 14;
// Both groups need at least this many days before an impact delta is shown.
const MIN_IMPACT_GROUP = 2;
const STRIP_DAYS = 7;
const TREND_WEEKS = 6;

export type AlcoholAnalyticsInput = {
  today: string; // local YYYY-MM-DD
  entries: { date: string; standardDrinks: number }[];
  // Per-day context for the impact comparison (within the same window).
  trainingLoadByDate?: Record<string, number>;
  proteinByDate?: Record<string, number | null>;
  caloriesByDate?: Record<string, number | null>;
  waterOzByDate?: Record<string, number | null>;
  // Override the weekly goal (e.g. from user preferences). Defaults to the pin.
  dryDaysTarget?: number;
};

// --- date helpers (string YYYY-MM-DD, UTC-noon to dodge DST) ---------------
function toUTC(date: string): number {
  return Date.parse(`${date}T12:00:00Z`);
}
function addDays(date: string, n: number): string {
  return new Date(toUTC(date) + n * 86_400_000).toISOString().slice(0, 10);
}
function daysBetween(a: string, b: string): number {
  return Math.round((toUTC(b) - toUTC(a)) / 86_400_000);
}
// Monday of the ISO week containing `date`.
function mondayOf(date: string): string {
  const day = new Date(toUTC(date)).getUTCDay(); // 0 Sun..6 Sat
  const offset = (day + 6) % 7; // Mon→0, Sun→6
  return addDays(date, -offset);
}
function avg(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

export function computeAlcoholStats(input: AlcoholAnalyticsInput): AlcoholStats {
  const { today } = input;
  const target = input.dryDaysTarget ?? DRY_DAYS_TARGET;
  const drinkingBudget = Math.max(0, 7 - target);

  // Per-day rollup.
  const drinksByDate = new Map<string, number>();
  const loggedDates = new Set<string>();
  for (const e of input.entries) {
    drinksByDate.set(e.date, (drinksByDate.get(e.date) ?? 0) + (e.standardDrinks || 0));
    loggedDates.add(e.date);
  }

  const active = input.entries.length > 0;
  const trackingStart = active
    ? input.entries.reduce((min, e) => (e.date < min ? e.date : min), input.entries[0]!.date)
    : null;
  const daysTracked = active && trackingStart ? Math.max(1, daysBetween(trackingStart, today) + 1) : 0;
  const seedState = !active || daysTracked < SEED_DAYS;

  // A day's state since tracking began.
  type DayKind = "dry" | "drink" | "pending" | "untracked";
  const classify = (d: string): DayKind => {
    if (!active || trackingStart == null || d < trackingStart || d > today) return "untracked";
    const drinks = drinksByDate.get(d) ?? 0;
    if (drinks > 0) return "drink";
    if (d < today) return "dry";
    // d === today: dry only if explicitly marked (an entry exists, summing to 0).
    return loggedDates.has(d) ? "dry" : "pending";
  };

  // --- 7-day strip (oldest → newest) ---
  const dailyStrip: AlcoholDay[] = [];
  for (let i = STRIP_DAYS - 1; i >= 0; i--) {
    const d = addDays(today, -i);
    const drinks = Math.round((drinksByDate.get(d) ?? 0) * 100) / 100;
    const kind = classify(d);
    dailyStrip.push({ date: d, drinks, isDry: kind === "dry", logged: loggedDates.has(d) });
  }

  // --- this week ---
  const thisMonday = mondayOf(today);
  let weekDrinks = 0;
  let drinkingDaysThisWeek = 0;
  let dryDaysThisWeek = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(thisMonday, i);
    if (d > today) break;
    const kind = classify(d);
    if (kind === "drink") {
      drinkingDaysThisWeek++;
      weekDrinks += drinksByDate.get(d) ?? 0;
    } else if (kind === "dry") {
      dryDaysThisWeek++;
    }
  }
  weekDrinks = Math.round(weekDrinks * 100) / 100;

  // --- streaks ---
  let currentDryStreak = 0;
  if (active) {
    const todayKind = classify(today);
    let cursor = todayKind === "pending" ? addDays(today, -1) : today;
    if (todayKind !== "drink") {
      while (classify(cursor) === "dry") {
        currentDryStreak++;
        cursor = addDays(cursor, -1);
      }
    }
  }
  let longestDryStreak = 0;
  if (active && trackingStart) {
    let run = 0;
    for (let d = trackingStart; d <= today; d = addDays(d, 1)) {
      const kind = classify(d);
      if (kind === "dry") {
        run++;
        if (run > longestDryStreak) longestDryStreak = run;
      } else if (kind === "drink") {
        run = 0;
      }
      // 'pending' (today unlogged) neither extends nor breaks the record.
    }
  }

  // --- week over week (last TREND_WEEKS, oldest → newest) ---
  const weeklyTrend: AlcoholWeek[] = [];
  for (let w = TREND_WEEKS - 1; w >= 0; w--) {
    const weekStart = addDays(thisMonday, -7 * w);
    const weekEnd = addDays(weekStart, 6);
    // Skip weeks entirely before tracking began.
    if (!active || trackingStart == null || weekEnd < trackingStart) continue;
    let dryDays = 0;
    let drinkingDays = 0;
    let drinks = 0;
    for (let i = 0; i < 7; i++) {
      const d = addDays(weekStart, i);
      if (d > today) break;
      const kind = classify(d);
      if (kind === "dry") dryDays++;
      else if (kind === "drink") {
        drinkingDays++;
        drinks += drinksByDate.get(d) ?? 0;
      }
    }
    weeklyTrend.push({
      weekStart,
      dryDays,
      drinkingDays,
      drinks: Math.round(drinks * 100) / 100,
      hitTarget: dryDays >= target,
      inProgress: weekStart === thisMonday,
    });
  }

  // Completed tracked weeks = fully in the past AND fully inside tracking.
  const completed = weeklyTrend.filter(
    (wk) => !wk.inProgress && trackingStart != null && wk.weekStart >= trackingStart,
  );
  const weeksTracked = completed.length;
  const weeksOnTarget = completed.filter((wk) => wk.hitTarget).length;
  const avgDryPerWeek =
    completed.length ? Math.round((avg(completed.map((wk) => wk.dryDays)) ?? 0) * 10) / 10 : null;
  let weeksOnTargetStreak = 0;
  for (let i = completed.length - 1; i >= 0; i--) {
    if (completed[i]!.hitTarget) weeksOnTargetStreak++;
    else break;
  }

  // --- impact: what drinking costs (honest, only past tracked days) ---
  const impact: AlcoholImpact[] = seedState ? [] : computeImpact(input, today, trackingStart!, classify);

  return {
    active,
    seedState,
    daysTracked,
    dryDaysTarget: target,
    weekDrinks,
    drinkingDaysThisWeek,
    drinkingBudget,
    dryDaysThisWeek,
    currentDryStreak,
    longestDryStreak,
    dailyStrip,
    weeklyTrend,
    avgDryPerWeek,
    weeksOnTarget,
    weeksTracked,
    weeksOnTargetStreak,
    impact,
  };
}

function computeImpact(
  input: AlcoholAnalyticsInput,
  today: string,
  trackingStart: string,
  classify: (d: string) => "dry" | "drink" | "pending" | "untracked",
): AlcoholImpact[] {
  const drinkingDays: string[] = [];
  const dryDays: string[] = [];
  for (let d = trackingStart; d < today; d = addDays(d, 1)) {
    const kind = classify(d);
    if (kind === "drink") drinkingDays.push(d);
    else if (kind === "dry") dryDays.push(d);
  }

  const load = input.trainingLoadByDate ?? {};
  const protein = input.proteinByDate ?? {};
  const cals = input.caloriesByDate ?? {};
  const water = input.waterOzByDate ?? {};

  // NEXT-day metrics read d+1 (the morning after); SAME-day metrics read d.
  const nextVals = (days: string[], src: Record<string, number | null | undefined>) =>
    days
      .map((d) => src[addDays(d, 1)])
      .filter((v): v is number => typeof v === "number");
  const sameVals = (days: string[], src: Record<string, number | null | undefined>) =>
    days.map((d) => src[d]).filter((v): v is number => typeof v === "number");
  const nextSessionRate = (days: string[]) => {
    const present = days.filter((d) => addDays(d, 1) <= today);
    if (!present.length) return [] as number[];
    return present.map((d) => ((load[addDays(d, 1)] ?? 0) > 0 ? 1 : 0));
  };

  const out: AlcoholImpact[] = [];
  const push = (
    key: AlcoholImpact["key"],
    label: string,
    drinkVals: number[],
    dryValsArr: number[],
    betterWhenDry: boolean,
    noteFor: (deltaPct: number | null, dAvg: number | null, yAvg: number | null) => string,
  ) => {
    if (drinkVals.length < MIN_IMPACT_GROUP || dryValsArr.length < MIN_IMPACT_GROUP) return;
    const dAvg = avg(drinkVals);
    const yAvg = avg(dryValsArr);
    const deltaPct =
      dAvg != null && yAvg != null && yAvg !== 0 ? Math.round(((dAvg - yAvg) / Math.abs(yAvg)) * 100) : null;
    out.push({
      key,
      label,
      drinkingAvg: dAvg != null ? Math.round(dAvg * 10) / 10 : null,
      dryAvg: yAvg != null ? Math.round(yAvg * 10) / 10 : null,
      deltaPct,
      betterWhenDry,
      note: noteFor(deltaPct, dAvg, yAvg),
    });
  };

  push(
    "trainingLoad",
    "Next-day training load",
    nextVals(drinkingDays, load),
    nextVals(dryDays, load),
    true,
    (delta) =>
      delta == null
        ? "Too few matched days to read the next-morning hit yet."
        : delta < 0
          ? `Next-day load averages ${Math.abs(delta)}% lower after a drinking day.`
          : delta > 0
            ? `Next-day load held up (${delta}% higher after drinking) — small sample, keep watching.`
            : "Next-day load looks about even so far.",
  );
  push(
    "sessionAdherence",
    "Next-day session rate",
    nextSessionRate(drinkingDays).map((v) => v * 100),
    nextSessionRate(dryDays).map((v) => v * 100),
    true,
    (_d, dAvg, yAvg) =>
      dAvg == null || yAvg == null
        ? "Not enough matched mornings to compare session rate."
        : `Got a session in the next day ${Math.round(dAvg)}% of the time after drinking vs ${Math.round(yAvg)}% after a dry night.`,
  );
  push(
    "protein",
    "Protein (g/day)",
    sameVals(drinkingDays, protein),
    sameVals(dryDays, protein),
    true,
    (delta) =>
      delta == null || delta === 0
        ? "Protein lands about the same drinking or dry."
        : delta < 0
          ? `Protein runs ${Math.abs(delta)}% lower on drinking days — booze crowds it out.`
          : `Protein actually ran higher on drinking days (small sample).`,
  );
  push(
    "calories",
    "Calories (kcal/day)",
    sameVals(drinkingDays, cals),
    sameVals(dryDays, cals),
    true,
    (delta) =>
      delta == null || delta === 0
        ? "Calories land about the same either way."
        : delta > 0
          ? `Intake runs ${delta}% higher on drinking days — the empty calories add up against the deficit.`
          : `Intake ran lower on drinking days (watch it's not skipped meals).`,
  );
  push(
    "hydration",
    "Water (oz/day)",
    sameVals(drinkingDays, water),
    sameVals(dryDays, water),
    true,
    (delta) =>
      delta == null || delta === 0
        ? "Hydration looks similar drinking or dry."
        : delta < 0
          ? `Water runs ${Math.abs(delta)}% lower on drinking days — alcohol dehydrates, so top up.`
          : `Water held up on drinking days — good.`,
  );

  return out;
}
