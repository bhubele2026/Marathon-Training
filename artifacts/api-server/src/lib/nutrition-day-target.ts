import {
  db,
  userPreferencesTable,
  planDaysTable,
  workoutsTable,
  nutritionDaysTable,
  nutritionDayTargetsTable,
  type NutritionDayTargetRow,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { getAnthropic, isConfigured, MODEL } from "@workspace/integrations-anthropic";
import {
  computePlannedLoad,
  computeFallbackAdjustment,
  clampAdjustment,
  type BaselineMacros,
  type DayAdjustment,
} from "./nutrition-engine";

// R5. Per-day reactive nutrition target service.
//
// adjusted = baseline ± a delta driven by that day's training:
//   - BEFORE a workout is logged: reacts to the plan day's planned_load.
//   - AFTER a workout for the date is logged/edited/skipped: reacts to the
//     ACTUAL logged session instead.
// The AI decides the delta + a one-sentence rationale (recomp priority: protein
// kept ~stable, calories/carbs flex), clamped to sane bounds; a deterministic
// fallback keeps the endpoint alive when AI is unavailable.
//
// Results are cached in nutrition_day_targets, keyed on a fingerprint of the
// date's actual-workout state so a stale cached value is refreshed the moment a
// workout is logged or edited. The workouts route also proactively invalidates
// the row on create/patch/delete (see invalidateDayTarget) so the next GET
// recomputes.

const SINGLETON_ID = 1;

export type DayTargetResult = {
  date: string;
  baseline: { cal: number; protein: number; carbs: number; fat: number } | null;
  adjusted: { cal: number; protein: number; carbs: number; fat: number } | null;
  delta: { cal: number; protein: number; carbs: number; fat: number } | null;
  rationale: string | null;
  actual: { cal: number; protein: number; carbs: number; fat: number } | null;
  source: "planned" | "actual";
  // When the baseline isn't computed yet, name the missing piece so the UI can
  // route the runner to compute targets / apply a plan instead of showing a
  // wrong number.
  needsBaseline?: boolean;
  // The normalized training load that drove today's adjustment (0 = rest).
  trainingLoad: number;
  // Human-facing "what drove today's target" insight for the logged session(s).
  // Null until a workout is logged. `summary` is a short machine+minutes recap
  // ("Tonal 45 min, Peloton Row 10 min") so the UI can show WHY intake moved —
  // and make clear the bump tracks training load, NOT calories burned.
  training: {
    source: "planned" | "actual";
    load: number;
    skipped: boolean;
    summary: string | null;
  } | null;
};

// One workout for the date, reduced to the fields the load + skip logic needs,
// plus a short human recap of the machine(s) + minutes for the UI insight.
type ActualDay = {
  load: number;
  skipped: boolean;
  count: number;
  summary: string | null;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDate(date: string): boolean {
  return DATE_RE.test(date);
}

async function readBaseline(): Promise<BaselineMacros | null> {
  const rows = await db
    .select({
      cal: userPreferencesTable.calorieTarget,
      protein: userPreferencesTable.proteinTargetG,
      carbs: userPreferencesTable.carbsTargetG,
      fat: userPreferencesTable.fatTargetG,
    })
    .from(userPreferencesTable)
    .where(eq(userPreferencesTable.id, SINGLETON_ID))
    .limit(1);
  const r = rows[0];
  if (!r || r.cal == null || r.protein == null) return null;
  return {
    cal: r.cal,
    protein: r.protein,
    carbs: r.carbs ?? 0,
    fat: r.fat ?? 0,
  };
}

// Planned training load for the date = sum of plan days' planned_load (or
// recomputed from their minutes when the column is null). Multiple rows can
// share a date (concurrent programs), so they sum. Returns 0 when no plan day
// exists (an off-plan / rest-by-default day).
async function readPlannedLoad(date: string): Promise<{
  load: number;
  planned: { strengthMin: number; cardioMin: number; runMin: number };
  hasPlan: boolean;
}> {
  const rows = await db
    .select({
      plannedLoad: planDaysTable.plannedLoad,
      isRest: planDaysTable.isRest,
      strengthMin: planDaysTable.strengthMin,
      cardioMin: planDaysTable.cardioMin,
      runMin: planDaysTable.runMin,
    })
    .from(planDaysTable)
    .where(eq(planDaysTable.date, date));
  let load = 0;
  let strengthMin = 0;
  let cardioMin = 0;
  let runMin = 0;
  for (const r of rows) {
    load +=
      r.plannedLoad ??
      computePlannedLoad({
        isRest: r.isRest,
        strengthMin: r.strengthMin,
        cardioMin: r.cardioMin,
        runMin: r.runMin,
      });
    strengthMin += r.strengthMin ?? 0;
    cardioMin += r.cardioMin ?? 0;
    runMin += r.runMin ?? 0;
  }
  return {
    load: Math.round(load * 10) / 10,
    planned: { strengthMin, cardioMin, runMin },
    hasPlan: rows.length > 0,
  };
}

// Actual logged training for the date. A workout whose sessionType is the
// "skipped"/"rest" marker (or that carries zero minutes) is treated as a skip.
// Multiple workouts on a date sum their load.
async function readActualLoad(date: string): Promise<ActualDay | null> {
  const rows = await db
    .select({
      sessionType: workoutsTable.sessionType,
      equipment: workoutsTable.equipment,
      strengthMin: workoutsTable.strengthMin,
      cardioMin: workoutsTable.cardioMin,
      runMin: workoutsTable.runMin,
      durationMin: workoutsTable.durationMin,
      modality: workoutsTable.modality,
    })
    .from(workoutsTable)
    .where(eq(workoutsTable.date, date));
  if (rows.length === 0) return null;
  let load = 0;
  let anyMinutes = false;
  let allSkipped = true;
  const summaryParts: string[] = [];
  for (const r of rows) {
    const st = (r.sessionType ?? "").toLowerCase();
    const isSkipMarker = /skip|rest|off/.test(st);
    // Prefer bucketed minutes; fall back to durationMin bucketed by modality.
    let strengthMin = r.strengthMin ?? 0;
    let cardioMin = r.cardioMin ?? 0;
    let runMin = r.runMin ?? 0;
    if (
      strengthMin === 0 &&
      cardioMin === 0 &&
      runMin === 0 &&
      r.durationMin != null
    ) {
      const mod = (r.modality ?? "").toLowerCase();
      if (/strength|lift|tonal/.test(mod)) strengthMin = r.durationMin;
      else if (/run/.test(mod) || /run/.test(st)) runMin = r.durationMin;
      else cardioMin = r.durationMin;
    }
    const dayLoad = computePlannedLoad({
      isRest: isSkipMarker,
      strengthMin,
      cardioMin,
      runMin,
    });
    if (dayLoad > 0) {
      anyMinutes = true;
      allSkipped = false;
    } else if (!isSkipMarker) {
      // A logged session with no minutes that isn't an explicit skip — count
      // it as present-but-light rather than a skip.
      allSkipped = allSkipped && false;
    }
    load += dayLoad;
    // Recap line: "<machine> <minutes> min" (e.g. "Tonal 45 min"). Falls back
    // to the session type when no equipment is recorded; skip markers get no
    // line so a rest/skip day reads cleanly.
    if (!isSkipMarker) {
      const mins = r.durationMin ?? strengthMin + cardioMin + runMin;
      const label = r.equipment ?? r.sessionType ?? "Session";
      summaryParts.push(mins > 0 ? `${label} ${Math.round(mins)} min` : label);
    }
  }
  return {
    load: Math.round(load * 10) / 10,
    skipped: allSkipped && !anyMinutes,
    count: rows.length,
    summary: summaryParts.length ? summaryParts.join(", ") : null,
  };
}

async function readActualIntake(date: string): Promise<DayTargetResult["actual"]> {
  const rows = await db
    .select()
    .from(nutritionDaysTable)
    .where(eq(nutritionDaysTable.date, date))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  if (
    r.calories == null &&
    r.proteinG == null &&
    r.carbsG == null &&
    r.fatG == null
  ) {
    return null;
  }
  return {
    cal: r.calories ?? 0,
    protein: r.proteinG ?? 0,
    carbs: r.carbsG ?? 0,
    fat: r.fatG ?? 0,
  };
}

// Cache fingerprint: keys the cached target on the actual-workout state so a
// logged/edited/skipped workout busts the cache automatically on next GET. When
// no workout exists yet it's the plan-driven "planned:<load>" key.
function stateFingerprint(
  baseline: BaselineMacros,
  plannedLoad: number,
  actual: ActualDay | null,
): string {
  // v2: the macro model changed (carbs scale / protein bump / fat balances), so
  // bump the version so any pre-change cached rows recompute on next read.
  const base = `v2:${baseline.cal}/${baseline.protein}/${baseline.carbs}/${baseline.fat}`;
  if (actual) {
    return `actual:${actual.load}:skip=${actual.skipped}:n=${actual.count}:base=${base}`;
  }
  return `planned:${plannedLoad}:base=${base}`;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
// Ask the model for a small recomp-aware calorie/carb adjustment + a
// one-sentence rationale. Returns null on any failure so the caller falls back
// to the deterministic adjustment.
async function aiAdjustment(
  baseline: BaselineMacros,
  load: number,
  source: "planned" | "actual",
  detail: string,
): Promise<{ calDelta: number; carbDelta: number; proteinDelta: number; rationale: string } | null> {
  if (!isConfigured()) return null;
  const system = [
    "You are a sports-nutrition assistant adjusting a runner's FIXED daily",
    "recomposition baseline (lose fat + build muscle) for ONE day's training.",
    "MACRO MODEL: PROTEIN is anchored to the recomp floor every day (rest or not)",
    "— never reduce it; at most a small +0..20 g bump on the HEAVIEST lifting/long",
    "days. CARBS are the lever that scales with training load: more on heavy/long",
    "days, fewer on rest days (this is where day-to-day variation lives). FAT is",
    "the balancer (computed downstream) — you do not set it. So move calories",
    "mostly through CARBS. A rest/skip or much-lighter day means a small REDUCTION;",
    "a heavier-than-typical day a small INCREASE; a typical day ~0. Keep the",
    "calorie change within about ±400 kcal and carbs within about ±100 g. The",
    "training load reflects session DURATION and intensity, NOT calories burned.",
    "Never 'eat back' estimated calories burned — wearable/equipment burn figures",
    "overestimate, so even a hard day earns only a small carb-led fuel bump, never",
    "a 1:1 calorie refund. Reply with ONLY a JSON object, no prose, no code fence:",
    '{"calDelta": <integer kcal, signed>, "carbDelta": <integer g, signed>,',
    '"proteinDelta": <integer g, 0..20, only nonzero on heavy days>,',
    '"rationale": "<ONE sentence naming the carb/protein logic>"}',
  ].join(" ");
  const user = [
    `Baseline: ${baseline.cal} kcal, protein ${baseline.protein} g, carbs ${baseline.carbs} g, fat ${baseline.fat} g.`,
    `Training signal source: ${source}. Normalized training load today: ${load} (0 = rest).`,
    detail,
    "Give today's adjustment.",
  ].join(" ");
  try {
    const client: any = getAnthropic();
    const resp: any = await client.messages.create({
      model: MODEL,
      max_tokens: 600,
      system,
      messages: [{ role: "user", content: user }],
    });
    let out = "";
    for (const block of resp.content ?? []) {
      if (block?.type === "text") out += `${block.text}\n`;
    }
    const match = out.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const o = JSON.parse(match[0]) as Record<string, unknown>;
    const calDelta = Number(o.calDelta);
    const carbDelta = Number(o.carbDelta);
    const proteinDelta = Number(o.proteinDelta ?? 0);
    if (!Number.isFinite(calDelta) || !Number.isFinite(carbDelta)) return null;
    const rationale =
      typeof o.rationale === "string" && o.rationale.trim()
        ? o.rationale.trim()
        : "Adjusted today's calories and carbs for the day's training while keeping protein steady.";
    return {
      calDelta,
      carbDelta,
      proteinDelta: Number.isFinite(proteinDelta) ? proteinDelta : 0,
      rationale,
    };
  } catch {
    return null;
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// Compute the adjusted target (AI with deterministic fallback) for the day.
async function computeAdjustment(
  baseline: BaselineMacros,
  load: number,
  source: "planned" | "actual",
  skipped: boolean,
  detail: string,
): Promise<DayAdjustment> {
  const ai = await aiAdjustment(baseline, load, source, detail);
  if (ai) {
    const { adjusted, delta } = clampAdjustment(baseline, {
      calDelta: ai.calDelta,
      carbDelta: ai.carbDelta,
      proteinDelta: ai.proteinDelta,
    });
    return { adjusted, delta, rationale: ai.rationale };
  }
  return computeFallbackAdjustment(baseline, load, { skipped, source });
}

function rowToResult(
  date: string,
  row: NutritionDayTargetRow,
  actual: DayTargetResult["actual"],
  training: DayTargetResult["training"],
): DayTargetResult {
  return {
    date,
    baseline: {
      cal: row.baselineCalories,
      protein: row.baselineProteinG,
      carbs: row.baselineCarbsG,
      fat: row.baselineFatG,
    },
    adjusted: {
      cal: row.adjustedCalories,
      protein: row.adjustedProteinG,
      carbs: row.adjustedCarbsG,
      fat: row.adjustedFatG,
    },
    delta: {
      cal: row.adjustedCalories - row.baselineCalories,
      protein: row.adjustedProteinG - row.baselineProteinG,
      carbs: row.adjustedCarbsG - row.baselineCarbsG,
      fat: row.adjustedFatG - row.baselineFatG,
    },
    rationale: row.rationale,
    actual,
    source: row.source === "actual" ? "actual" : "planned",
    trainingLoad: row.trainingLoad,
    training,
  };
}

// Main entry point for GET /api/nutrition/day/:date.
export async function getDayTarget(date: string): Promise<DayTargetResult> {
  const baseline = await readBaseline();
  const actualIntake = await readActualIntake(date);
  if (!baseline) {
    // No baseline yet — surface a needsBaseline flag instead of a wrong number.
    return {
      date,
      baseline: null,
      adjusted: null,
      delta: null,
      rationale: null,
      actual: actualIntake,
      source: "planned",
      needsBaseline: true,
      trainingLoad: 0,
      training: null,
    };
  }

  const planned = await readPlannedLoad(date);
  const actual = await readActualLoad(date);
  const source: "planned" | "actual" = actual ? "actual" : "planned";
  const load = actual ? actual.load : planned.load;
  const fingerprint = stateFingerprint(baseline, planned.load, actual);
  // The "what drove today's target" insight surfaces only once a workout is
  // logged — that's when the runner is deciding whether to fuel for it.
  const training: DayTargetResult["training"] = actual
    ? {
        source: "actual",
        load: actual.load,
        skipped: actual.skipped,
        summary: actual.summary,
      }
    : null;

  // Serve a fresh cached row when the state fingerprint still matches.
  const cachedRows = await db
    .select()
    .from(nutritionDayTargetsTable)
    .where(eq(nutritionDayTargetsTable.date, date))
    .limit(1);
  const cached = cachedRows[0];
  if (cached && cached.sourceState === fingerprint) {
    return rowToResult(date, cached, actualIntake, training);
  }

  // Build a short human description of planned-vs-actual for the model.
  const detail = actual
    ? `Logged workout(s) today: ${actual.count} session(s), ${
        actual.skipped ? "marked skipped/rest" : `actual load ${actual.load}`
      }. Plan prescribed load was ${planned.load}.`
    : planned.hasPlan
      ? `Planned session today: strength ${planned.planned.strengthMin} min, cardio ${planned.planned.cardioMin} min, run ${planned.planned.runMin} min (load ${planned.load}). No workout logged yet.`
      : `No session planned today and nothing logged (treat as a rest day).`;

  const adj = await computeAdjustment(
    baseline,
    load,
    source,
    actual ? actual.skipped : !planned.hasPlan,
    detail,
  );

  // Persist the computed target keyed on the current state fingerprint.
  const persisted = await db
    .insert(nutritionDayTargetsTable)
    .values({
      date,
      baselineCalories: baseline.cal,
      baselineProteinG: baseline.protein,
      baselineCarbsG: baseline.carbs,
      baselineFatG: baseline.fat,
      adjustedCalories: adj.adjusted.cal,
      adjustedProteinG: adj.adjusted.protein,
      adjustedCarbsG: adj.adjusted.carbs,
      adjustedFatG: adj.adjusted.fat,
      trainingLoad: load,
      source,
      sourceState: fingerprint,
      rationale: adj.rationale,
    })
    .onConflictDoUpdate({
      target: nutritionDayTargetsTable.date,
      set: {
        baselineCalories: baseline.cal,
        baselineProteinG: baseline.protein,
        baselineCarbsG: baseline.carbs,
        baselineFatG: baseline.fat,
        adjustedCalories: adj.adjusted.cal,
        adjustedProteinG: adj.adjusted.protein,
        adjustedCarbsG: adj.adjusted.carbs,
        adjustedFatG: adj.adjusted.fat,
        trainingLoad: load,
        source,
        sourceState: fingerprint,
        rationale: adj.rationale,
        updatedAt: new Date(),
      },
    })
    .returning();

  return rowToResult(date, persisted[0]!, actualIntake, training);
}

// Invalidate the cached day target for a date so the next GET recomputes.
// Called from the workouts create/patch/delete path. Best-effort: a delete on a
// non-existent row is a no-op, and the lazy fingerprint check would catch a
// stale row anyway — this just makes the refresh eager/explicit.
export async function invalidateDayTarget(date: string): Promise<void> {
  if (!isValidDate(date)) return;
  await db
    .delete(nutritionDayTargetsTable)
    .where(eq(nutritionDayTargetsTable.date, date));
}
