import { Router, type IRouter } from "express";
import {
  db,
  userPreferencesTable,
  measurementsTable,
  nutritionDaysTable,
  workoutsTable,
  planDaysTable,
  nutritionistReportsTable,
  type NutritionistReport,
  type NutritionInsight,
  type BodyTrajectoryPoint,
} from "@workspace/db";
import { and, asc, desc, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import { getAnthropic, isConfigured, MODEL } from "@workspace/integrations-anthropic";
import { COACH_PERSONA } from "@workspace/plan-knowledge";
import { diagnose, type DiagnosisInput } from "../lib/progress-diagnosis";
import { totalInches } from "../lib/dashboard-tracking";
import { summarizeFood, type FoodDay } from "../lib/week-review";
import { weeklyWeightStatus } from "../lib/weekly-weight";
import { calorieFloor, safeWeeklyRateLb, PROTEIN_FLOOR_G_PER_LB } from "../lib/nutrition-safety";
import { computePlannedLoad } from "../lib/nutrition-engine";
import { dayState, localToday } from "../lib/day-state";
import {
  type AnalysisInput,
  type DailyLogPoint,
  computeBodyComp,
  computeInsights,
  proteinGPerLb,
  buildNutritionistSystem,
  buildNutritionistUser,
  fallbackReport,
  NUTRITIONIST_TOOL,
  NUTRITIONIST_TOOL_NAME,
} from "../lib/nutritionist";

// Bump when the report SHAPE changes so cached rows (keyed by inputHash) are
// invalidated and regenerated into the new structure.
const REPORT_VERSION = 2;

const router: IRouter = Router();
const DAY_MS = 86_400_000;
const round1 = (n: number) => Math.round(n * 10) / 10;

function hashInputs(obj: unknown): string {
  const s = JSON.stringify(obj);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

// Build the comprehensive nutritionist input from the trailing `weeks` window.
async function gather(weeks: number): Promise<AnalysisInput> {
  const now = new Date();

  const prefsRows = await db
    .select({
      goalWeightLb: userPreferencesTable.goalWeightLb,
      calorieTarget: userPreferencesTable.calorieTarget,
      proteinTargetG: userPreferencesTable.proteinTargetG,
      carbsTargetG: userPreferencesTable.carbsTargetG,
      fatTargetG: userPreferencesTable.fatTargetG,
      sex: userPreferencesTable.sex,
      age: userPreferencesTable.age,
      heightIn: userPreferencesTable.heightIn,
      activityLevel: userPreferencesTable.activityLevel,
      bodyGoal: userPreferencesTable.bodyGoal,
      weeklyRateLb: userPreferencesTable.weeklyRateLb,
      weeklyGoalStartWeightLb: userPreferencesTable.weeklyGoalStartWeightLb,
      weeklyGoalAnchorDate: userPreferencesTable.weeklyGoalAnchorDate,
      sodiumLimitMg: userPreferencesTable.sodiumLimitMg,
      timezone: userPreferencesTable.timezone,
    })
    .from(userPreferencesTable)
    .where(eq(userPreferencesTable.id, 1))
    .limit(1);
  const prefs = prefsRows[0];
  // Phase 9: "today" and the window are the runner's LOCAL day, not UTC, so an
  // evening log isn't seen as tomorrow and a half-eaten day isn't graded early.
  const tz = prefs?.timezone ?? null;
  const today = dayState(tz, {}, now);
  const to = today.localDate;
  const from = localToday(tz, new Date(now.getTime() - weeks * 7 * DAY_MS));

  // Weight: latest overall + earliest in window.
  const latest = await db
    .select({ weight: measurementsTable.weight, date: measurementsTable.date })
    .from(measurementsTable)
    .where(isNotNull(measurementsTable.weight))
    .orderBy(desc(measurementsTable.date))
    .limit(1);
  const earliest = await db
    .select({ weight: measurementsTable.weight, date: measurementsTable.date })
    .from(measurementsTable)
    .where(and(isNotNull(measurementsTable.weight), gte(measurementsTable.date, from)))
    .orderBy(asc(measurementsTable.date))
    .limit(1);

  const currentW = latest[0]?.weight ?? null;
  const startW = earliest[0]?.weight ?? null;
  const weightChangeLb =
    currentW != null && startW != null ? round1(currentW - startW) : null;
  let weeksElapsed = 0;
  if (earliest[0]?.date && latest[0]?.date) {
    const span = Date.parse(`${latest[0].date}T00:00:00Z`) - Date.parse(`${earliest[0].date}T00:00:00Z`);
    weeksElapsed = Math.min(weeks, Math.max(0, Math.round(span / (7 * DAY_MS))));
  }

  // Body-fat %: latest overall + earliest in window → lean/fat mass trend.
  const bfLatest = await db
    .select({ bodyFatPct: measurementsTable.bodyFatPct, weight: measurementsTable.weight })
    .from(measurementsTable)
    .where(isNotNull(measurementsTable.bodyFatPct))
    .orderBy(desc(measurementsTable.date))
    .limit(1);
  const bfEarliest = await db
    .select({ bodyFatPct: measurementsTable.bodyFatPct, weight: measurementsTable.weight })
    .from(measurementsTable)
    .where(and(isNotNull(measurementsTable.bodyFatPct), gte(measurementsTable.date, from)))
    .orderBy(asc(measurementsTable.date))
    .limit(1);

  const bodyFatPct = bfLatest[0]?.bodyFatPct ?? null;
  const startBodyFatPct = bfEarliest[0]?.bodyFatPct ?? null;
  const nowComp = computeBodyComp(currentW, bodyFatPct);
  // Use each reading's own paired weight for the start composition so the lean/fat
  // delta reflects real readings, not today's weight applied to an old bf%.
  const startComp = computeBodyComp(bfEarliest[0]?.weight ?? startW, startBodyFatPct);
  const leanMassChangeLb =
    nowComp.leanMassLb != null && startComp.leanMassLb != null
      ? round1(nowComp.leanMassLb - startComp.leanMassLb)
      : null;
  const fatMassChangeLb =
    nowComp.fatMassLb != null && startComp.fatMassLb != null
      ? round1(nowComp.fatMassLb - startComp.fatMassLb)
      : null;

  // Tape inches (sum of circumferences) first vs last in window.
  const measRows = await db
    .select({
      belly: measurementsTable.belly,
      chest: measurementsTable.chest,
      lArm: measurementsTable.lArm,
      rArm: measurementsTable.rArm,
      lLeg: measurementsTable.lLeg,
      rLeg: measurementsTable.rLeg,
      weight: measurementsTable.weight,
      bodyFatPct: measurementsTable.bodyFatPct,
      date: measurementsTable.date,
    })
    .from(measurementsTable)
    .where(gte(measurementsTable.date, from))
    .orderBy(asc(measurementsTable.date));
  const inches = measRows
    .map((m) => totalInches(m))
    .filter((v): v is number => v != null);
  const inchesChange =
    inches.length >= 2 ? round1(inches[inches.length - 1]! - inches[0]!) : null;

  // Body-composition trajectory for the recomp chart: every reading in the
  // window that has a weight or body-fat %, with lean/fat derived per reading.
  const bodyLog: BodyTrajectoryPoint[] = measRows
    .filter((m) => m.weight != null || m.bodyFatPct != null)
    .map((m) => {
      const comp = computeBodyComp(m.weight ?? null, m.bodyFatPct ?? null);
      return {
        date: m.date,
        weightLb: m.weight ?? null,
        bodyFatPct: m.bodyFatPct ?? null,
        leanLb: comp.leanMassLb,
        fatLb: comp.fatMassLb,
      };
    });

  // Nutrition adherence + full macro averages.
  const nutRows = await db
    .select({
      date: nutritionDaysTable.date,
      calories: nutritionDaysTable.calories,
      proteinG: nutritionDaysTable.proteinG,
      carbsG: nutritionDaysTable.carbsG,
      fatG: nutritionDaysTable.fatG,
      waterMl: nutritionDaysTable.waterMl,
      sodiumMg: nutritionDaysTable.sodiumMg,
      closedAt: nutritionDaysTable.closedAt,
    })
    .from(nutritionDaysTable)
    .where(and(gte(nutritionDaysTable.date, from), lte(nutritionDaysTable.date, to)));

  // A day is FINAL for judging if it's in the past OR has been closed. TODAY is
  // "open" (still eating) until closed, so its partial intake is excluded from
  // the averages/flags — we don't warn about a half-eaten day.
  const finalRows = nutRows.filter((r) => r.date < to || r.closedAt != null);
  const todayRow = nutRows.find((r) => r.date === to);
  const todayOpen = !!todayRow && todayRow.closedAt == null;
  const todayCaloriesSoFar = todayOpen ? (todayRow?.calories ?? null) : null;
  const todayProteinSoFar = todayOpen ? (todayRow?.proteinG ?? null) : null;
  const todayCarbsSoFar = todayOpen ? (todayRow?.carbsG ?? null) : null;
  const todayFatSoFar = todayOpen ? (todayRow?.fatG ?? null) : null;
  const todayWaterMl = todayOpen ? (todayRow?.waterMl ?? null) : null;
  const todaySodiumMg = todayOpen ? (todayRow?.sodiumMg ?? null) : null;

  // Sodium average over final days (mg). The runner tracks sodium against a
  // ceiling (sodiumLimitMg, default 2300), but training + sweat raise the need.
  const sodiums = finalRows
    .map((r) => r.sodiumMg)
    .filter((v): v is number => v != null);
  const avgSodiumMg =
    sodiums.length > 0 ? Math.round(sodiums.reduce((a, b) => a + b, 0) / sodiums.length) : null;

  const waters = finalRows
    .map((r) => r.waterMl)
    .filter((v): v is number => v != null);
  const avgWaterMl =
    waters.length > 0 ? Math.round(waters.reduce((a, b) => a + b, 0) / waters.length) : null;
  const food = summarizeFood(finalRows as FoodDay[], {
    calories: prefs?.calorieTarget ?? null,
    protein: prefs?.proteinTargetG ?? null,
    carbs: prefs?.carbsTargetG ?? null,
    fat: prefs?.fatTargetG ?? null,
  });
  const safeFloorKcal = calorieFloor(prefs?.sex ?? null);
  const daysUnderFloor = finalRows.filter(
    (r) => r.calories != null && r.calories > 0 && r.calories < safeFloorKcal,
  ).length;

  // Calorie adherence: share of logged days landing within ~±10% of the target.
  const calTargetVal = prefs?.calorieTarget ?? null;
  const calsLogged = finalRows
    .map((r) => r.calories)
    .filter((v): v is number => v != null && v > 0);
  const calorieHitRate =
    calTargetVal != null && calTargetVal > 0 && calsLogged.length > 0
      ? Math.round(
          (calsLogged.filter((c) => Math.abs(c - calTargetVal) <= calTargetVal * 0.1).length /
            calsLogged.length) *
            100,
        ) / 100
      : null;

  // Training consistency + average load.
  const doneRows = await db
    .select({
      strengthMin: workoutsTable.strengthMin,
      cardioMin: workoutsTable.cardioMin,
      runMin: workoutsTable.runMin,
    })
    .from(workoutsTable)
    .where(and(gte(workoutsTable.date, from), lte(workoutsTable.date, to)));
  const loads = doneRows.map((w) =>
    computePlannedLoad({
      strengthMin: w.strengthMin ?? 0,
      cardioMin: w.cardioMin ?? 0,
      runMin: w.runMin ?? 0,
    }),
  );
  const avgTrainingLoad =
    loads.length > 0 ? round1(loads.reduce((a, b) => a + b, 0) / loads.length) : null;
  const plannedRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(planDaysTable)
    .where(and(gte(planDaysTable.date, from), lte(planDaysTable.date, to), eq(planDaysTable.isRest, false)));

  // Weight-goal status (on-track) when a weekly goal exists.
  let onTrack: boolean | null = null;
  const rate = prefs?.weeklyRateLb ?? null;
  if (rate != null && prefs?.weeklyGoalStartWeightLb != null && prefs?.weeklyGoalAnchorDate) {
    const st = weeklyWeightStatus({
      startWeightLb: prefs.weeklyGoalStartWeightLb,
      rateLb: rate,
      goalWeightLb: prefs.goalWeightLb ?? null,
      anchorDateISO: prefs.weeklyGoalAnchorDate,
      todayISO: to,
      latestActualLb: currentW,
    });
    onTrack = st.onTrack;
  }

  const goalDirection: AnalysisInput["goalDirection"] =
    rate == null ? "none" : rate < 0 ? "loss" : rate > 0 ? "gain" : "maintain";
  const safeRateLbPerWk = safeWeeklyRateLb(currentW ?? 200);

  // Reuse the deterministic diagnosis engine for ground-truth flag titles, so
  // Claude can't contradict the hard safety findings.
  const diagInput: DiagnosisInput = {
    weeks,
    weeksElapsed,
    goalDirection,
    weightChangeLb,
    goalRateLbPerWk: rate,
    onTrack,
    varianceLb: null,
    avgCalories: food.avgCalories,
    calorieTarget: prefs?.calorieTarget ?? null,
    avgProtein: food.avgProtein,
    proteinTarget: prefs?.proteinTargetG ?? null,
    proteinHitRate: food.proteinHitRate,
    sessionsDone: doneRows.length,
    plannedSessions: plannedRows[0]?.count ?? 0,
    inchesChange,
    safeFloorKcal,
    safeRateLbPerWk,
  };
  const groundTruthFlags = diagnose(diagInput).findings.map((f) => f.title);

  // Actual weekly rate of weight change over the observed span — the clearest
  // "is this working?" signal to set against the target rate.
  const actualWeeklyRateLb =
    weightChangeLb != null && weeksElapsed > 0
      ? round1(weightChangeLb / weeksElapsed)
      : null;

  // Per-day FINAL logged days (oldest → newest, recent window capped to keep the
  // sparklines + adherence dots glanceable) — the values the averages were built
  // from, surfaced so the engine can draw each metric's trend + streak.
  const dailyLog: DailyLogPoint[] = [...finalRows]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .slice(-21)
    .map((r) => ({
      date: r.date,
      calories: r.calories ?? null,
      proteinG: r.proteinG ?? null,
      carbsG: r.carbsG ?? null,
      fatG: r.fatG ?? null,
      waterOz: r.waterMl != null ? Math.round(r.waterMl / 29.5735) : null,
      sodiumMg: r.sodiumMg ?? null,
    }));

  return {
    weeks,
    weeksElapsed,
    sex: prefs?.sex ?? null,
    age: prefs?.age ?? null,
    heightIn: prefs?.heightIn ?? null,
    activityLevel: prefs?.activityLevel ?? null,
    bodyGoal: prefs?.bodyGoal ?? "recomp",
    goalWeightLb: prefs?.goalWeightLb ?? null,
    weeklyRateLb: rate,
    actualWeeklyRateLb,
    goalDirection,
    onTrack,
    currentWeightLb: currentW,
    startWeightLb: startW,
    weightChangeLb,
    bodyFatPct,
    startBodyFatPct,
    leanMassLb: nowComp.leanMassLb,
    fatMassLb: nowComp.fatMassLb,
    leanMassChangeLb,
    fatMassChangeLb,
    inchesChange,
    daysLogged: food.daysLogged,
    avgCalories: food.avgCalories,
    calorieTarget: prefs?.calorieTarget ?? null,
    avgProtein: food.avgProtein,
    proteinTarget: prefs?.proteinTargetG ?? null,
    proteinHitRate: food.proteinHitRate,
    calorieHitRate,
    proteinGPerLb: proteinGPerLb(food.avgProtein, currentW),
    avgCarbs: food.avgCarbs,
    carbsTarget: prefs?.carbsTargetG ?? null,
    avgFat: food.avgFat,
    fatTarget: prefs?.fatTargetG ?? null,
    avgWaterMl,
    avgSodiumMg,
    sodiumLimitMg: prefs?.sodiumLimitMg ?? null,
    todayOpen,
    todayCaloriesSoFar,
    todayProteinSoFar,
    todayCarbsSoFar,
    todayFatSoFar,
    todayWaterMl,
    todaySodiumMg,
    todayLocalHour: todayOpen ? today.localHour : null,
    todayFractionElapsed: todayOpen ? today.fractionOfDayElapsed : null,
    daysUnderFloor,
    sessionsDone: doneRows.length,
    plannedSessions: plannedRows[0]?.count ?? 0,
    avgTrainingLoad,
    safeFloorKcal,
    safeRateLbPerWk,
    proteinFloorGPerLb: PROTEIN_FLOOR_G_PER_LB,
    groundTruthFlags,
    dailyLog,
    bodyLog,
  };
}

// Build the full report: Claude reasons via the structured-output tool; on any
// failure we fall back to the deterministic report so the feature never breaks.
/* eslint-disable @typescript-eslint/no-explicit-any */
async function buildReport(input: AnalysisInput): Promise<NutritionistReport> {
  const fb = fallbackReport(input);
  if (!isConfigured()) return fb;
  try {
    const client: any = getAnthropic();
    const resp: any = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      // Adaptive thinking for a deeper "why" diagnosis. tool_choice is left at
      // the default ("auto") on purpose — the API disallows FORCED tool use
      // together with extended thinking; the strong system instruction plus the
      // deterministic fallback below cover the rare turn that skips the tool.
      thinking: { type: "adaptive" } as any,
      system: buildNutritionistSystem(COACH_PERSONA),
      tools: [NUTRITIONIST_TOOL as any],
      messages: [{ role: "user", content: buildNutritionistUser(input) }],
    });
    const tool = (resp.content ?? []).find(
      (b: any) => b?.type === "tool_use" && b.name === NUTRITIONIST_TOOL_NAME,
    );
    if (!tool) return fb;
    const out = tool.input as Partial<NutritionistReport> & {
      insights?: Record<string, { caption?: string; detail?: string }>;
    };

    // Engine owns every NUMBER (and the deterministic fallback copy); Claude owns
    // only the words. Overlay its caption/detail per insight by id; everything
    // numeric (actual/target/floor/series/status) stays exactly as computed, so
    // the charts are correct regardless of the model.
    const skeleton: NutritionInsight[] = computeInsights(input);
    const copy: Record<string, { caption?: string; detail?: string }> = out.insights ?? {};
    const insights: NutritionInsight[] = skeleton.map((ins) => {
      const c = copy[ins.id];
      return {
        ...ins,
        caption: typeof c?.caption === "string" && c.caption.trim() ? c.caption.trim() : ins.caption,
        detail: typeof c?.detail === "string" && c.detail.trim() ? c.detail.trim() : ins.detail,
      };
    });

    return {
      weeks: input.weeks,
      weeksElapsed: input.weeksElapsed,
      headline: out.headline ?? fb.headline,
      insights,
      today: out.today ?? fb.today,
      keyMoves: Array.isArray(out.keyMoves) && out.keyMoves.length ? out.keyMoves.slice(0, 4) : fb.keyMoves,
      confidence: out.confidence ?? fb.confidence,
      dataGaps: Array.isArray(out.dataGaps) ? out.dataGaps.slice(0, 4) : fb.dataGaps,
      narrative: out.narrative ?? fb.narrative,
    };
  } catch {
    return fb;
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// GET /api/nutritionist/analysis?weeks=8 — the AI Nutritionist report. Persists
// the latest (singleton id=1), regenerating only when the metrics change.
router.get("/nutritionist/analysis", async (req, res): Promise<void> => {
  const rawWeeks = Number(req.query.weeks);
  const weeks = Number.isFinite(rawWeeks) ? Math.min(26, Math.max(2, Math.round(rawWeeks))) : 8;

  const input = await gather(weeks);
  const inputHash = hashInputs({ v: REPORT_VERSION, weeks, input });

  const cachedRows = await db
    .select()
    .from(nutritionistReportsTable)
    .where(eq(nutritionistReportsTable.id, 1))
    .limit(1);
  const cached = cachedRows[0];
  if (cached && cached.inputHash === inputHash) {
    res.json({ ...cached.report, generatedAt: cached.generatedAt, cached: true });
    return;
  }

  const report = await buildReport(input);
  const now = new Date();
  await db
    .insert(nutritionistReportsTable)
    .values({ id: 1, weeks, report, inputHash, generatedAt: now })
    .onConflictDoUpdate({
      target: nutritionistReportsTable.id,
      set: { weeks, report, inputHash, generatedAt: now },
    });
  res.json({ ...report, generatedAt: now, cached: false });
});

export default router;
