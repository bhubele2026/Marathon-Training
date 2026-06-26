import { Router, type IRouter } from "express";
import {
  db,
  userPreferencesTable,
  measurementsTable,
  nutritionDaysTable,
  workoutsTable,
  planDaysTable,
  progressDiagnosisTable,
} from "@workspace/db";
import { and, asc, desc, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import { getAnthropic, isConfigured, FAST_MODEL } from "@workspace/integrations-anthropic";
import { COACH_PERSONA } from "@workspace/plan-knowledge";
import { diagnose, type DiagnosisInput, type Finding } from "../lib/progress-diagnosis";
import { totalInches } from "../lib/dashboard-tracking";
import { summarizeFood, type FoodDay } from "../lib/week-review";
import { weeklyWeightStatus } from "../lib/weekly-weight";
import { calorieFloor, safeWeeklyRateLb } from "../lib/nutrition-safety";

const router: IRouter = Router();
const DAY_MS = 86_400_000;

function hashInputs(obj: unknown): string {
  const s = JSON.stringify(obj);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

// Build the analyzer input from the trailing `weeks` window.
async function gather(weeks: number): Promise<{ input: DiagnosisInput; today: string }> {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  const from = new Date(now.getTime() - weeks * 7 * DAY_MS).toISOString().slice(0, 10);

  const prefsRows = await db
    .select({
      goalWeightLb: userPreferencesTable.goalWeightLb,
      calorieTarget: userPreferencesTable.calorieTarget,
      proteinTargetG: userPreferencesTable.proteinTargetG,
      carbsTargetG: userPreferencesTable.carbsTargetG,
      fatTargetG: userPreferencesTable.fatTargetG,
      sex: userPreferencesTable.sex,
      weeklyRateLb: userPreferencesTable.weeklyRateLb,
      weeklyGoalStartWeightLb: userPreferencesTable.weeklyGoalStartWeightLb,
      weeklyGoalAnchorDate: userPreferencesTable.weeklyGoalAnchorDate,
    })
    .from(userPreferencesTable)
    .where(eq(userPreferencesTable.id, 1))
    .limit(1);
  const prefs = prefsRows[0];

  // Weight: latest overall + earliest in window + the dated span for the rate.
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
    currentW != null && startW != null ? Math.round((currentW - startW) * 10) / 10 : null;
  let weeksElapsed = 0;
  if (earliest[0]?.date && latest[0]?.date) {
    const span = Date.parse(`${latest[0].date}T00:00:00Z`) - Date.parse(`${earliest[0].date}T00:00:00Z`);
    weeksElapsed = Math.min(weeks, Math.max(0, Math.round(span / (7 * DAY_MS))));
  }

  // Inches trend (sum of circumferences) first vs last in window.
  const measRows = await db
    .select({
      belly: measurementsTable.belly,
      chest: measurementsTable.chest,
      lArm: measurementsTable.lArm,
      rArm: measurementsTable.rArm,
      lLeg: measurementsTable.lLeg,
      rLeg: measurementsTable.rLeg,
      date: measurementsTable.date,
    })
    .from(measurementsTable)
    .where(gte(measurementsTable.date, from))
    .orderBy(asc(measurementsTable.date));
  const inches = measRows
    .map((m) => totalInches(m))
    .filter((v): v is number => v != null);
  const inchesChange =
    inches.length >= 2 ? Math.round((inches[inches.length - 1]! - inches[0]!) * 10) / 10 : null;

  // Nutrition adherence.
  const nutRows = await db
    .select({
      calories: nutritionDaysTable.calories,
      proteinG: nutritionDaysTable.proteinG,
      carbsG: nutritionDaysTable.carbsG,
      fatG: nutritionDaysTable.fatG,
    })
    .from(nutritionDaysTable)
    .where(and(gte(nutritionDaysTable.date, from), lte(nutritionDaysTable.date, to)));
  const food = summarizeFood(nutRows as FoodDay[], {
    calories: prefs?.calorieTarget ?? null,
    protein: prefs?.proteinTargetG ?? null,
    carbs: prefs?.carbsTargetG ?? null,
    fat: prefs?.fatTargetG ?? null,
  });

  // Training consistency.
  const doneRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(workoutsTable)
    .where(and(gte(workoutsTable.date, from), lte(workoutsTable.date, to)));
  const plannedRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(planDaysTable)
    .where(and(gte(planDaysTable.date, from), lte(planDaysTable.date, to), eq(planDaysTable.isRest, false)));

  // Weight-goal status (on-track / variance) when a weekly goal exists.
  let onTrack: boolean | null = null;
  let varianceLb: number | null = null;
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
    varianceLb = st.varianceLb;
  }

  const goalDirection: DiagnosisInput["goalDirection"] =
    rate == null ? "none" : rate < 0 ? "loss" : rate > 0 ? "gain" : "maintain";

  const input: DiagnosisInput = {
    weeks,
    weeksElapsed,
    goalDirection,
    weightChangeLb,
    goalRateLbPerWk: rate,
    onTrack,
    varianceLb,
    avgCalories: food.avgCalories,
    calorieTarget: prefs?.calorieTarget ?? null,
    avgProtein: food.avgProtein,
    proteinTarget: prefs?.proteinTargetG ?? null,
    proteinHitRate: food.proteinHitRate,
    sessionsDone: doneRows[0]?.count ?? 0,
    plannedSessions: plannedRows[0]?.count ?? 0,
    inchesChange,
    safeFloorKcal: calorieFloor(prefs?.sex ?? null),
    safeRateLbPerWk: safeWeeklyRateLb(currentW ?? 200),
  };
  return { input, today: to };
}

// Narrate the top findings in the coach persona (supportive tone is enforced for
// health-flag findings). Returns null on any failure → deterministic fallback.
/* eslint-disable @typescript-eslint/no-explicit-any */
async function narrate(findings: Finding[]): Promise<string | null> {
  if (!isConfigured()) return null;
  const top = findings.slice(0, 2);
  const system =
    `${COACH_PERSONA}\n\n## Your task right now\n` +
    `Narrate this progress diagnosis on the client's dashboard in 2-4 sharp sentences, ` +
    `fully in your voice. LEAD with the real cause and the safe fix — the substance ` +
    `matters more than the joke. For any finding marked tone "supportive" (under-eating, ` +
    `losing too fast, a health flag) DROP the sarcasm entirely and be genuinely warm; ` +
    `never suggest eating less than the safe floor or losing faster than the safe rate. ` +
    `For "sassy" findings (effort/adherence) you may roast the effort, never the person. ` +
    `Output ONLY the narration: no preamble, no quotes, no lists.`;
  const user = top
    .map((f) => `Finding (${f.tone}): ${f.title}. Cause: ${f.cause} Fix: ${f.fix}`)
    .join("\n");
  try {
    const client: any = getAnthropic();
    const resp: any = await client.messages.create({
      // Pure narration of an already-computed diagnosis (findings + fixes) —
      // the faster Sonnet-class model, not Opus.
      model: FAST_MODEL,
      max_tokens: 500,
      system,
      messages: [{ role: "user", content: user }],
    });
    let text = "";
    for (const block of resp.content ?? []) {
      if (block?.type === "text") text += block.text;
    }
    text = text.trim().replace(/^["']|["']$/g, "");
    return text || null;
  } catch {
    return null;
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function fallbackNarrative(findings: Finding[]): string {
  return findings
    .slice(0, 2)
    .map((f) => `${f.title}. ${f.cause} ${f.fix}`)
    .join(" ");
}

// GET /api/progress/diagnosis?weeks=12 — the "what's going on" panel. Persists
// the latest (singleton id=1), regenerating only when the metrics change.
router.get("/progress/diagnosis", async (req, res): Promise<void> => {
  const rawWeeks = Number(req.query.weeks);
  const weeks = Number.isFinite(rawWeeks) ? Math.min(26, Math.max(4, Math.round(rawWeeks))) : 12;

  const { input } = await gather(weeks);
  const { findings, headline } = diagnose(input);
  const inputHash = hashInputs({ weeks, input });

  const cachedRows = await db
    .select()
    .from(progressDiagnosisTable)
    .where(eq(progressDiagnosisTable.id, 1))
    .limit(1);
  const cached = cachedRows[0];
  if (cached && cached.inputHash === inputHash) {
    res.json({
      weeks: cached.weeks,
      headline: cached.headline,
      findings: cached.findings,
      narrative: cached.narrative,
      generatedAt: cached.generatedAt,
      stale: false,
    });
    return;
  }

  const narrative = (await narrate(findings)) ?? fallbackNarrative(findings);
  const now = new Date();
  await db
    .insert(progressDiagnosisTable)
    .values({ id: 1, weeks, headline, findings, narrative, inputHash, generatedAt: now })
    .onConflictDoUpdate({
      target: progressDiagnosisTable.id,
      set: { weeks, headline, findings, narrative, inputHash, generatedAt: now },
    });
  res.json({ weeks, headline, findings, narrative, generatedAt: now, stale: false });
});

export default router;
