// Data-driven insights engine (Phase 16). PURE + framework-free so it is unit
// testable: it takes the real logged history (nutrition entries, water logs,
// workouts, body measurements — the Phase 13 entries model + existing lists)
// over a window and returns a RANKED set of findings, each citing the owner's
// actual numbers, in the coach's register. It never fabricates a trend: every
// finding self-gates on having enough real data, and when nothing qualifies the
// caller shows an honest empty state.
//
// Ranking: things that need attention surface above things that are working,
// and within a tier the bigger the deviation the higher it ranks — so the most
// actionable read is always first. Tone drives the CoachNote colour on screen.

export type InsightTone = "positive" | "sassy" | "supportive" | "neutral";

export interface Insight {
  id: string;
  /** 1-based rank after sorting (1 = most actionable). */
  rank: number;
  tone: InsightTone;
  title: string;
  /** One line that cites the real numbers behind the finding. */
  detail: string;
}

export interface InsightEntry {
  date: string; // YYYY-MM-DD (local day)
  calories?: number | null;
  proteinG?: number | null;
}
export interface InsightWater {
  date: string;
  oz: number;
}
export interface InsightWorkout {
  date: string;
  totalMin?: number | null;
  durationMin?: number | null;
}
export interface InsightMeasurement {
  date: string;
  weight?: number | null;
  bodyFatPct?: number | null;
}

export interface InsightInputs {
  entries: InsightEntry[];
  waters: InsightWater[];
  workouts: InsightWorkout[];
  measurements: InsightMeasurement[];
  targets?: { calorieTarget?: number | null; proteinTargetG?: number | null } | null;
  /** recomp | fat_loss | strength | hypertrophy | general | race | null */
  goalKind?: string | null;
  /** How many days the window spans (drives per-week math + cadence). */
  windowDays: number;
  /** Injectable "now" for deterministic streak math in tests. */
  now?: Date;
}

export interface InsightsResult {
  findings: Insight[];
  hasEnoughData: boolean;
}

interface Candidate {
  id: string;
  tone: InsightTone;
  title: string;
  detail: string;
  /** Sort key — higher surfaces first. */
  priority: number;
}

const round = (n: number, d = 0): number => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};

const isCutGoal = (g?: string | null): boolean =>
  g === "fat_loss" || g === "cut";

function toLocalDateStr(d: Date): string {
  // Local YYYY-MM-DD (matches how entries are keyed).
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Sum nutrition entries into per-day totals (a day = sum of its entries). */
function perDayNutrition(
  entries: InsightEntry[],
): Map<string, { calories: number; protein: number; hasCal: boolean; hasPro: boolean }> {
  const byDay = new Map<
    string,
    { calories: number; protein: number; hasCal: boolean; hasPro: boolean }
  >();
  for (const e of entries) {
    const cur =
      byDay.get(e.date) ?? { calories: 0, protein: 0, hasCal: false, hasPro: false };
    if (e.calories != null) {
      cur.calories += e.calories;
      cur.hasCal = true;
    }
    if (e.proteinG != null) {
      cur.protein += e.proteinG;
      cur.hasPro = true;
    }
    byDay.set(e.date, cur);
  }
  return byDay;
}

/** Consecutive-day logging streak ending today (or yesterday if today empty). */
function loggingStreak(loggedDays: Set<string>, now: Date): number {
  let streak = 0;
  const cursor = new Date(now);
  // Allow the streak to count from yesterday if today hasn't been logged yet.
  if (!loggedDays.has(toLocalDateStr(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
  }
  while (loggedDays.has(toLocalDateStr(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export function computeInsights(input: InsightInputs): InsightsResult {
  const {
    entries,
    waters,
    workouts,
    measurements,
    targets,
    goalKind,
    windowDays,
    now = new Date(),
  } = input;
  const weeks = Math.max(windowDays / 7, 1 / 7);
  const candidates: Candidate[] = [];

  // ---- Weight trend + rate (needs >=2 weigh-ins) ---------------------------
  const weighIns = measurements
    .filter((m) => m.weight != null)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
  if (weighIns.length >= 2) {
    const first = weighIns[0]!;
    const last = weighIns[weighIns.length - 1]!;
    const spanDays = Math.max(
      1,
      (Date.parse(last.date) - Date.parse(first.date)) / 86_400_000,
    );
    const spanWeeks = Math.max(spanDays / 7, 1 / 7);
    const deltaLb = (last.weight as number) - (first.weight as number);
    const rate = deltaLb / spanWeeks; // lb / week
    const absRate = Math.abs(rate);
    const dir = rate < -0.05 ? "down" : rate > 0.05 ? "up" : "flat";
    const arrow = dir === "down" ? "▼" : dir === "up" ? "▲" : "·";
    let tone: InsightTone = "neutral";
    let title = "Weight is holding steady";
    if (dir === "flat") {
      tone = "neutral";
      title = "Weight is holding steady";
    } else if (isCutGoal(goalKind)) {
      tone = dir === "down" ? "positive" : "sassy";
      title = dir === "down" ? "The cut is working" : "Weight is going the wrong way";
    } else if (goalKind === "hypertrophy" || goalKind === "strength") {
      tone = dir === "up" ? "positive" : "neutral";
      title = dir === "up" ? "Lean-mass build is trending up" : "Scale weight is flat for a build";
    } else {
      // recomp / general / race: gentle loss or hold is fine.
      tone = dir === "up" ? "neutral" : "positive";
      title = dir === "down" ? "Recomp is trending down" : "Weight is drifting up";
    }
    candidates.push({
      id: "weight-trend",
      tone,
      title,
      detail: `Weight ${arrow} ${round(absRate, 2)} lb/wk over the last ${weighIns.length} weigh-ins (${round(first.weight as number, 1)} → ${round(last.weight as number, 1)} lb).`,
      priority: (tone === "sassy" ? 100 : tone === "positive" ? 60 : 30) + absRate * 8,
    });
  }

  // ---- Body-fat trend (needs >=2 readings) ---------------------------------
  const bf = measurements
    .filter((m) => m.bodyFatPct != null)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
  if (bf.length >= 2) {
    const d = (bf[bf.length - 1]!.bodyFatPct as number) - (bf[0]!.bodyFatPct as number);
    if (Math.abs(d) >= 0.3) {
      const down = d < 0;
      candidates.push({
        id: "bodyfat-trend",
        tone: down ? "positive" : "neutral",
        title: down ? "Body fat is coming down" : "Body fat ticked up",
        detail: `Body fat ${down ? "▼" : "▲"} ${round(Math.abs(d), 1)} pts (${round(bf[0]!.bodyFatPct as number, 1)}% → ${round(bf[bf.length - 1]!.bodyFatPct as number, 1)}%).`,
        priority: (down ? 60 : 45) + Math.abs(d) * 4,
      });
    }
  }

  // ---- Nutrition adherence (needs >=3 logged days) -------------------------
  const byDay = perDayNutrition(entries);
  const proDays = [...byDay.values()].filter((d) => d.hasPro);
  const calDays = [...byDay.values()].filter((d) => d.hasCal);
  const proTarget = targets?.proteinTargetG ?? null;
  const calTarget = targets?.calorieTarget ?? null;

  if (proDays.length >= 3 && proTarget && proTarget > 0) {
    const avgPro = proDays.reduce((s, d) => s + d.protein, 0) / proDays.length;
    const hitDays = proDays.filter((d) => d.protein >= proTarget * 0.95).length;
    const pct = avgPro / proTarget;
    let tone: InsightTone;
    let title: string;
    if (pct >= 0.95) {
      tone = "positive";
      title = "Protein is dialed in";
    } else if (pct >= 0.8) {
      tone = "neutral";
      title = "Protein is close";
    } else {
      tone = "sassy";
      title = "Protein is short";
    }
    candidates.push({
      id: "protein-adherence",
      tone,
      title,
      detail: `Protein averaging ${round(avgPro)} g/day vs ${round(proTarget)} g target — hit it ${hitDays} of ${proDays.length} logged days.`,
      priority: (tone === "sassy" ? 100 : tone === "positive" ? 60 : 30) + (1 - pct) * 60,
    });
  }

  if (calDays.length >= 3 && calTarget && calTarget > 0) {
    const avgCal = calDays.reduce((s, d) => s + d.calories, 0) / calDays.length;
    const ratio = avgCal / calTarget;
    // Read calories AGAINST the weight result when we have a trend.
    const weightDir =
      weighIns.length >= 2
        ? (weighIns[weighIns.length - 1]!.weight as number) -
            (weighIns[0]!.weight as number) <
          -0.05
          ? "down"
          : (weighIns[weighIns.length - 1]!.weight as number) -
                (weighIns[0]!.weight as number) >
              0.05
            ? "up"
            : "flat"
        : "unknown";
    let tone: InsightTone = "neutral";
    let title = "Calories are tracking the target";
    let detail = `Eating ~${round(avgCal)} kcal/day vs ${round(calTarget)} target.`;
    if (isCutGoal(goalKind) && ratio <= 1.02 && weightDir === "down") {
      tone = "positive";
      title = "Calories and results agree";
      detail = `~${round(avgCal)} kcal/day under the ${round(calTarget)} target and the scale is moving down — it's working.`;
    } else if (isCutGoal(goalKind) && ratio > 1.08 && weightDir !== "down") {
      tone = "sassy";
      title = "Calories are outrunning the cut";
      detail = `~${round(avgCal)} kcal/day vs ${round(calTarget)} target and the scale isn't dropping — the maths checks out.`;
    } else if (ratio > 1.1) {
      tone = "neutral";
      title = "Calories are running over target";
      detail = `Averaging ~${round(avgCal)} kcal/day, ${round((ratio - 1) * 100)}% over the ${round(calTarget)} target.`;
    }
    candidates.push({
      id: "calorie-adherence",
      tone,
      title,
      detail,
      priority: (tone === "sassy" ? 95 : tone === "positive" ? 58 : 28) + Math.abs(ratio - 1) * 40,
    });
  }

  // ---- Training load / consistency (needs >=1 workout) ---------------------
  if (workouts.length >= 1) {
    const totalMin = workouts.reduce(
      (s, w) => s + (w.totalMin ?? w.durationMin ?? 0),
      0,
    );
    const perWeek = workouts.length / weeks;
    const sparse = perWeek < 2.5;
    candidates.push({
      id: "training-load",
      tone: sparse ? "sassy" : "positive",
      title: sparse ? "Training is thin on the ground" : "Training is consistent",
      detail: `${workouts.length} session${workouts.length === 1 ? "" : "s"} / ${round(totalMin)} min over ${round(windowDays)} days — about ${round(perWeek, 1)}/wk.`,
      priority: (sparse ? 90 : 55) + (sparse ? (2.5 - perWeek) * 10 : 0),
    });
  }

  // ---- Logging streak (needs any logged day) -------------------------------
  const loggedDays = new Set<string>([
    ...entries.map((e) => e.date),
    ...waters.map((w) => w.date),
  ]);
  if (loggedDays.size >= 1) {
    const streak = loggingStreak(loggedDays, now);
    if (streak >= 2) {
      candidates.push({
        id: "logging-streak",
        tone: streak >= 5 ? "positive" : "neutral",
        title: streak >= 5 ? "Logging streak is strong" : "Logging streak is building",
        detail: `${streak}-day logging streak — consistency is what makes the rest of this readable.`,
        priority: 40 + Math.min(streak, 14),
      });
    }
  }

  // ---- Hydration (needs >=3 water days) ------------------------------------
  const waterByDay = new Map<string, number>();
  for (const w of waters) waterByDay.set(w.date, (waterByDay.get(w.date) ?? 0) + w.oz);
  if (waterByDay.size >= 3) {
    const avgOz = [...waterByDay.values()].reduce((s, n) => s + n, 0) / waterByDay.size;
    candidates.push({
      id: "hydration",
      tone: avgOz >= 64 ? "positive" : "neutral",
      title: avgOz >= 64 ? "Hydration is on point" : "Hydration has room",
      detail: `Averaging ${round(avgOz)} oz water/day across ${waterByDay.size} logged days.`,
      priority: avgOz >= 64 ? 50 : 35,
    });
  }

  const findings: Insight[] = candidates
    .sort((a, b) => b.priority - a.priority)
    .map((c, i) => ({
      id: c.id,
      rank: i + 1,
      tone: c.tone,
      title: c.title,
      detail: c.detail,
    }));

  return { findings, hasEnoughData: findings.length > 0 };
}
