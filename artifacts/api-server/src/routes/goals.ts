import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  userPreferencesTable,
  measurementsTable,
  plannerConfigsTable,
  type UserPreferencesRow,
  BODY_GOALS,
  ACTIVITY_LEVELS,
  SEXES,
} from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import {
  getAnthropic,
  isConfigured,
  MODEL,
} from "@workspace/integrations-anthropic";
import {
  computeSafety,
  effectiveSafeRateLb,
  enforceSafeClamps,
  isPlausible,
  round1,
  KCAL_PER_LB,
  type SafetyNote,
  type GoalContext,
} from "../lib/nutrition-safety";
import {
  clampWeeklyRate,
  weeklyWeightStatus,
  type WeeklyWeightStatus,
} from "../lib/weekly-weight";

// Goals + body stats + AI-calculated nutrition targets + Tonal Strength Score
// goal. Singleton row (id=1), mirroring the lazy readOrSeed pattern in
// preferences.ts. Current bodyweight is read from the latest body_measurements
// row rather than duplicated here.
//
// POST /goals/compute-targets calls Claude (Opus 4.8) with the server-side
// web_search tool to research current evidence-based daily calorie + protein
// intake for the runner's stats and goal, then persists the result so the
// Nutrition page's progress bars use a personalized target instead of a
// hardcoded default.

const router: IRouter = Router();
const SINGLETON_ID = 1;

// Plausibility clamps for AI output (reject units/hallucination errors) live in
// nutrition-safety.ts alongside the safe-rate guardrails and isPlausible().
//
// Science-safe weight-loss guardrails live in a pure, DB-free module so they're
// directly unit-testable. goals.ts threads them into the AI prompt + clamps the
// result; the plan-builder reuses the same clamps on coach-supplied targets.

type ApiGoals = {
  heightIn: number | null;
  age: number | null;
  sex: string | null;
  activityLevel: string | null;
  bodyGoal: string;
  goalWeightLb: number | null;
  calorieTarget: number | null;
  proteinTargetG: number | null;
  carbsTargetG: number | null;
  fatTargetG: number | null;
  targetsRationale: string | null;
  targetsComputedAt: string | null;
  targetsSafety: SafetyNote | null;
  sodiumLimitMg: number | null;
  strengthScoreCurrent: number | null;
  strengthScoreGoal: number | null;
  currentWeightLb: number | null;
  /** Weekly weight goal status (Phase 1): the safe-clamped rate, this week's
   * target vs the latest actual, on-track. Null until a weekly goal is set. */
  weeklyWeight: (WeeklyWeightStatus & { note: string | null }) | null;
  aiConfigured: boolean;
  updatedAt: string;
};

// Derive the weekly weight-goal status for the API response from the persisted
// anchor + rate and the latest actual weight. Null until a weekly goal is set.
function buildWeeklyWeight(
  row: UserPreferencesRow,
  currentWeightLb: number | null,
): (WeeklyWeightStatus & { note: string | null }) | null {
  if (
    row.weeklyRateLb == null ||
    row.weeklyGoalStartWeightLb == null ||
    !row.weeklyGoalAnchorDate
  ) {
    return null;
  }
  const status = weeklyWeightStatus({
    startWeightLb: row.weeklyGoalStartWeightLb,
    rateLb: row.weeklyRateLb,
    goalWeightLb: row.goalWeightLb,
    anchorDateISO: row.weeklyGoalAnchorDate,
    todayISO: new Date().toISOString().slice(0, 10),
    latestActualLb: currentWeightLb,
  });
  return { ...status, note: row.weeklyGoalNote ?? null };
}

function toApi(row: UserPreferencesRow, currentWeightLb: number | null): ApiGoals {
  return {
    heightIn: row.heightIn,
    age: row.age,
    sex: row.sex,
    activityLevel: row.activityLevel,
    bodyGoal: row.bodyGoal,
    goalWeightLb: row.goalWeightLb,
    calorieTarget: row.calorieTarget,
    proteinTargetG: row.proteinTargetG,
    carbsTargetG: row.carbsTargetG,
    fatTargetG: row.fatTargetG,
    targetsRationale: row.targetsRationale,
    targetsComputedAt: row.targetsComputedAt
      ? row.targetsComputedAt.toISOString()
      : null,
    targetsSafety: row.targetsSafety ?? null,
    sodiumLimitMg: row.sodiumLimitMg,
    strengthScoreCurrent: row.strengthScoreCurrent,
    strengthScoreGoal: row.strengthScoreGoal,
    currentWeightLb,
    weeklyWeight: buildWeeklyWeight(row, currentWeightLb),
    aiConfigured: isConfigured(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// Lazy upsert of the singleton row (same as preferences.ts).
async function readOrSeed(): Promise<UserPreferencesRow> {
  const existing = await db
    .select()
    .from(userPreferencesTable)
    .where(eq(userPreferencesTable.id, SINGLETON_ID))
    .limit(1);
  if (existing[0]) return existing[0];
  const inserted = await db
    .insert(userPreferencesTable)
    .values({ id: SINGLETON_ID })
    .onConflictDoNothing()
    .returning();
  if (inserted[0]) return inserted[0];
  const again = await db
    .select()
    .from(userPreferencesTable)
    .where(eq(userPreferencesTable.id, SINGLETON_ID))
    .limit(1);
  return again[0]!;
}

async function latestWeightLb(): Promise<number | null> {
  const rows = await db
    .select({ weight: measurementsTable.weight })
    .from(measurementsTable)
    .orderBy(desc(measurementsTable.date))
    .limit(1);
  return rows[0]?.weight ?? null;
}

// R3. The essential inputs computeBaselineTargets() depends on. When any are
// missing the baseline can't be computed and the UI is asked to prompt for
// JUST the missing one(s) via a `needs` array rather than a generic 400.
function missingEssentialInputs(
  row: UserPreferencesRow,
  weight: number | null,
): { key: string; label: string }[] {
  const missing: { key: string; label: string }[] = [];
  if (row.heightIn == null) missing.push({ key: "height", label: "your height" });
  if (row.age == null) missing.push({ key: "age", label: "your age" });
  if (!row.sex) missing.push({ key: "sex", label: "your sex" });
  if (!row.activityLevel)
    missing.push({ key: "activity", label: "your activity level" });
  if (weight == null)
    missing.push({ key: "weight", label: "your current weight (log a measurement)" });
  return missing;
}

// Coerce an incoming numeric field to a clamped integer or validation error.
// undefined/null/"" → leave-alone (undefined); a number out of range → error.
function parseIntField(
  value: unknown,
  min: number,
  max: number,
): { ok: true; value: number | null | undefined } | { ok: false } {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null || value === "") return { ok: true, value: null };
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || n < min || n > max) {
    return { ok: false };
  }
  return { ok: true, value: Math.round(n) };
}

router.get("/goals", async (_req, res) => {
  const [row, weight] = await Promise.all([readOrSeed(), latestWeightLb()]);
  res.json(toApi(row, weight));
});

router.put("/goals", async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const updates: Partial<UserPreferencesRow> = {};

  const heightIn = parseIntField(body.heightIn, 36, 90);
  const age = parseIntField(body.age, 12, 100);
  const goalWeight = parseIntField(body.goalWeightLb, 60, 700);
  const scoreNow = parseIntField(body.strengthScoreCurrent, 0, 2000);
  const scoreGoal = parseIntField(body.strengthScoreGoal, 0, 2000);
  // Daily sodium ceiling in mg. A fixed user LIMIT (not part of the AI macro
  // math); null clears it back to the 2300 mg default.
  const sodiumLimit = parseIntField(body.sodiumLimitMg, 0, 10000);
  if (
    !heightIn.ok ||
    !age.ok ||
    !goalWeight.ok ||
    !scoreNow.ok ||
    !scoreGoal.ok ||
    !sodiumLimit.ok
  ) {
    res.status(400).json({ error: "A stat value is out of range." });
    return;
  }
  if (heightIn.value !== undefined) updates.heightIn = heightIn.value;
  if (age.value !== undefined) updates.age = age.value;
  if (goalWeight.value !== undefined) updates.goalWeightLb = goalWeight.value;
  if (scoreNow.value !== undefined) updates.strengthScoreCurrent = scoreNow.value;
  if (scoreGoal.value !== undefined) updates.strengthScoreGoal = scoreGoal.value;
  if (sodiumLimit.value !== undefined) updates.sodiumLimitMg = sodiumLimit.value;

  // Enum/text fields: null clears, omit leaves alone, invalid → 400.
  if (body.sex !== undefined) {
    if (body.sex === null) updates.sex = null;
    else if (typeof body.sex === "string" && (SEXES as readonly string[]).includes(body.sex)) {
      updates.sex = body.sex;
    } else {
      res.status(400).json({ error: "sex must be male or female." });
      return;
    }
  }
  if (body.activityLevel !== undefined) {
    if (body.activityLevel === null) updates.activityLevel = null;
    else if (
      typeof body.activityLevel === "string" &&
      (ACTIVITY_LEVELS as readonly string[]).includes(body.activityLevel)
    ) {
      updates.activityLevel = body.activityLevel;
    } else {
      res.status(400).json({ error: "Invalid activityLevel." });
      return;
    }
  }
  // bodyGoal is NOT nullable — omit leaves alone.
  if (body.bodyGoal !== undefined) {
    if (typeof body.bodyGoal === "string" && (BODY_GOALS as readonly string[]).includes(body.bodyGoal)) {
      updates.bodyGoal = body.bodyGoal;
    } else {
      res.status(400).json({ error: "Invalid bodyGoal." });
      return;
    }
  }

  await readOrSeed();
  if (Object.keys(updates).length > 0) {
    await db
      .update(userPreferencesTable)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(userPreferencesTable.id, SINGLETON_ID));
  }
  const [row, weight] = await Promise.all([readOrSeed(), latestWeightLb()]);
  res.json(toApi(row, weight));
});

// ---------------------------------------------------------------------------
// AI target computation
// ---------------------------------------------------------------------------

type ComputedTargets = {
  calorieTarget: number;
  proteinTargetG: number;
  carbsTargetG: number;
  fatTargetG: number;
  rationale: string;
  // Weight-loss safety note (when a goal + timeframe imply a rate). Null when
  // there's no loss goal to evaluate (recomp / maintenance / bulk).
  safety?: SafetyNote | null;
};

// Pull the recommended targets out of the model's free text. Prefers a fenced
// ```json block; falls back to the first object literal that carries the keys.
// All four macros are required — calories, protein, carbs and fat.
function parseTargets(text: string): ComputedTargets | null {
  const tryObj = (raw: string): ComputedTargets | null => {
    try {
      const o = JSON.parse(raw) as Record<string, unknown>;
      const cal = Number(o.calorieTarget);
      const pro = Number(o.proteinTargetG);
      const carb = Number(o.carbsTargetG);
      const fat = Number(o.fatTargetG);
      if (
        !Number.isFinite(cal) ||
        !Number.isFinite(pro) ||
        !Number.isFinite(carb) ||
        !Number.isFinite(fat)
      )
        return null;
      return {
        calorieTarget: Math.round(cal),
        proteinTargetG: Math.round(pro),
        carbsTargetG: Math.round(carb),
        fatTargetG: Math.round(fat),
        rationale: typeof o.rationale === "string" ? o.rationale : "",
      };
    } catch {
      return null;
    }
  };
  // Fenced blocks, last one wins (the model's final answer).
  const fences = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((m) => m[1]);
  for (const f of fences.reverse()) {
    const o = tryObj(f.trim());
    if (o) return o;
  }
  // Bare object containing the key.
  const bare = text.match(/\{[^{}]*"calorieTarget"[\s\S]*?\}/);
  if (bare) {
    const o = tryObj(bare[0]);
    if (o) return o;
  }
  return null;
}

// Run a single web-search-enabled turn loop, draining server-tool pauses, and
// return all assistant text concatenated. The web_search tool + adaptive
// thinking are GA on the API; params are cast (like plan-builder.ts) so the
// installed SDK's static types don't block the build.
// SDK calls are `any`-typed on purpose: web_search, adaptive thinking, and
// output_config are GA on the wire but the installed SDK's static types lag, so
// typing them strictly is what breaks the build. The wire shapes are correct.
/* eslint-disable @typescript-eslint/no-explicit-any */
async function researchTargets(system: string, userText: string): Promise<string> {
  const client: any = getAnthropic();
  const messages: any[] = [{ role: "user", content: userText }];
  let text = "";
  for (let i = 0; i < 6; i++) {
    const resp: any = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      system,
      tools: [{ type: "web_search_20260209", name: "web_search" }],
      messages,
    });
    for (const block of resp.content ?? []) {
      if (block?.type === "text") text += `${block.text}\n`;
    }
    // Server-tool loop hit its internal limit — re-send the conversation so the
    // server resumes (echo the assistant turn back, no extra user message).
    if (resp.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: resp.content });
      continue;
    }
    break;
  }
  return text;
}

// Fallback: coerce free text into the JSON shape with a cheap no-tools call.
async function extractTargets(text: string): Promise<ComputedTargets | null> {
  const direct = parseTargets(text);
  if (direct) return direct;
  const client: any = getAnthropic();
  const resp: any = await client.messages.create({
    model: MODEL,
    max_tokens: 1000,
    system:
      "You extract structured data. Reply with ONLY a JSON object and nothing else.",
    messages: [
      {
        role: "user",
        content:
          'From the text below, return ONLY this JSON object (no prose, no code fence): {"calorieTarget": <integer kcal>, "proteinTargetG": <integer grams>, "carbsTargetG": <integer grams>, "fatTargetG": <integer grams>, "rationale": "<one or two sentences>"}\n\nText:\n' +
          text,
      },
    ],
  });
  let out = "";
  for (const block of resp.content ?? []) {
    if (block?.type === "text") out += `${block.text}\n`;
  }
  return parseTargets(out);
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// R3. Result of computeBaselineTargets(): either a ready-to-persist set of
// recomp BASELINE targets, or a structured `needs` signal naming the missing
// essential inputs so the UI can prompt for just those fields.
export type BaselineResult =
  | { ok: true; targets: ComputedTargets }
  | { ok: false; reason: "needs"; needs: string[]; message: string }
  | { ok: false; reason: "ai_unavailable"; message: string }
  | { ok: false; reason: "ai_error"; message: string }
  | { ok: false; reason: "implausible"; message: string };

// R3. The reusable, server-side recomp BASELINE target service. Computes a
// FIXED baseline (Mifflin-St Jeor × activity → recomp strategy: protein-priority
// ~0.8–1.0 g/lb, modest deficit / near-maintenance for "lose fat + build
// muscle") grounded with Opus + web_search, clamped to plausibility. These four
// numbers ARE the baseline that R5 adjusts daily. Returns a `needs` result
// (not an exception) when a required input is missing so callers can prompt for
// just that field. Best-effort callers (plan apply) can ignore non-`ok`
// results without breaking their own flow.
export async function computeBaselineTargets(
  row: UserPreferencesRow,
  weight: number | null,
  ctx: GoalContext = {},
  override?: ComputedTargets | null,
): Promise<BaselineResult> {
  // Resolve the goal weight from the plan context first, then the prefs row.
  const goalWeightLb = ctx.goalWeightLb ?? row.goalWeightLb ?? null;
  const goalCtx: GoalContext = { ...ctx, goalWeightLb };

  // Safety + the effective (never-faster-than-safe) weekly loss rate. Computed
  // before we ask the AI so we can both INSTRUCT it to the safe rate and CLAMP
  // its answer to it. Null safety = no loss goal/timeframe to reason about.
  const safety =
    weight != null ? computeSafety(weight, row.sex, goalCtx) : null;
  const effRate = weight != null ? effectiveSafeRateLb(weight, goalCtx) : 0;

  // The plan builder may hand us its own targets. When it does we skip the AI
  // round-trip and just safety-clamp + persist what the coach proposed.
  if (override) {
    const clamped = enforceSafeClamps(override, weight, row.sex, effRate);
    if (!isPlausible(clamped)) {
      return {
        ok: false,
        reason: "implausible",
        message: "The plan's nutrition targets were implausible. Recompute on Goals.",
      };
    }
    return { ok: true, targets: { ...clamped, safety } };
  }

  const missing = missingEssentialInputs(row, weight);
  if (missing.length > 0) {
    const labels = missing.map((m) => m.label).join(", ");
    return {
      ok: false,
      reason: "needs",
      needs: missing.map((m) => m.key),
      message: `Enter ${labels} to compute your nutrition baseline.`,
    };
  }
  if (!isConfigured()) {
    return {
      ok: false,
      reason: "ai_unavailable",
      message:
        "AI is not configured. Add ANTHROPIC_API_KEY as a Replit secret (Tools → Secrets) to calculate targets.",
    };
  }

  const goalLabel =
    row.bodyGoal === "cut"
      ? "lose fat (cut) while preserving muscle"
      : row.bodyGoal === "lean_bulk"
        ? "build muscle (lean bulk) with minimal fat gain"
        : "body recomposition — lose fat AND build muscle near maintenance";

  const ft = Math.floor((row.heightIn as number) / 12);
  const inch = (row.heightIn as number) % 12;

  // Translate the safe weekly rate into a daily deficit guide for the prompt.
  const dailyDeficitGuide =
    effRate > 0 ? Math.round((effRate * KCAL_PER_LB) / 7) : 0;

  const system = [
    "You are a sports-nutrition assistant. Use the web_search tool to ground your",
    "recommendation in current, evidence-based guidance (e.g. Mifflin-St Jeor BMR,",
    "activity TDEE multipliers, protein intake for muscle retention/gain ~0.8–1.0 g",
    "per lb of bodyweight, and the calorie strategy appropriate to the stated goal).",
    "SAFETY IS NON-NEGOTIABLE: a sustainable fat-loss rate is ~0.5-1% of bodyweight",
    "per week (and never more than ~2 lb/wk). Keep the deficit modest — at most",
    "~20-25% below maintenance — never a crash deficit, even if a goal seems to",
    "demand it. Never drop daily calories below a safe floor (~1500 kcal for men,",
    "~1200 for women). Keep protein high (~0.8-1.0 g/lb) to spare muscle in a deficit.",
    "For a recomposition goal use a MODEST deficit to near-maintenance (lose fat",
    "while building muscle) with protein PRIORITIZED. This is the runner's fixed",
    "daily BASELINE — it is later nudged up or down per-day for training load, so",
    "give the steady all-week baseline, not a single hard day's intake.",
    "Search for recent reputable sources (cite the rate/protein guidance in your",
    "rationale). Then give ONE daily calorie target plus a full macro split — protein,",
    "carbohydrate and fat targets (all in grams) — for THIS person. The macro grams",
    "should be roughly consistent with the calorie target (protein 4 kcal/g, carbs 4",
    "kcal/g, fat 9 kcal/g), with protein prioritized for muscle retention and the",
    "remaining calories split between carbs and fat per the goal.",
    "",
    "After your reasoning, end your reply with a single fenced ```json code block",
    'containing exactly: {"calorieTarget": <integer kcal>, "proteinTargetG": <integer grams>,',
    '"carbsTargetG": <integer grams>, "fatTargetG": <integer grams>,',
    '"rationale": "<2-4 sentences: the TDEE estimate, the deficit + safe-rate basis, the',
    'protein basis, the carb/fat split rationale, and any caveat>"}. No other text after',
    "the code block.",
  ].join(" ");

  const userText = [
    `Calculate my fixed daily BASELINE calorie target and full macro split (protein, carbs, fat). Goal: ${goalLabel}.`,
    `Stats: ${row.sex}, age ${row.age}, height ${ft}'${inch}" (${row.heightIn} in),`,
    `current weight ${weight} lb${goalWeightLb ? `, goal weight ${goalWeightLb} lb` : ""},`,
    `activity level: ${row.activityLevel}.`,
    effRate > 0
      ? `Target a SAFE, sustainable loss of ~${round1(effRate)} lb/wk (about a ${dailyDeficitGuide} kcal/day deficit below maintenance) — do not exceed this even if my goal date suggests faster.`
      : "",
    "I lift on a Tonal 5–6x/week plus cardio and the occasional 5K, so protein is a priority.",
  ]
    .filter(Boolean)
    .join(" ");

  let targets: ComputedTargets | null = null;
  try {
    const text = await researchTargets(system, userText);
    targets = await extractTargets(text);
  } catch {
    return {
      ok: false,
      reason: "ai_error",
      message: "The AI request failed. Try again.",
    };
  }

  if (!targets) {
    return {
      ok: false,
      reason: "implausible",
      message: "The AI returned an unreadable or implausible result. Try again.",
    };
  }

  // Enforce the science-safe guardrails on the AI's numbers (deficit cap,
  // calorie floor, protein floor) BEFORE the plausibility check.
  const safeTargets = enforceSafeClamps(targets, weight, row.sex, effRate);

  if (!isPlausible(safeTargets)) {
    return {
      ok: false,
      reason: "implausible",
      message: "The AI returned an unreadable or implausible result. Try again.",
    };
  }

  return { ok: true, targets: { ...safeTargets, safety } };
}

// R4 best-effort hook: compute + persist the recomp baseline as part of another
// flow (plan apply / AI plan accept). Never throws and never returns an HTTP
// concern — callers log the outcome and move on. Returns the persisted targets
// on success, or a short note on why it couldn't (missing stat / AI down).
export async function computeAndPersistBaselineBestEffort(
  ctx: GoalContext = {},
  override?: ComputedTargets | null,
): Promise<
  | { ok: true; targets: ComputedTargets }
  | { ok: false; reason: string; message: string }
> {
  try {
    const row = await readOrSeed();
    const weight = await latestWeightLb();
    const result = await computeBaselineTargets(row, weight, ctx, override);
    if (!result.ok) {
      return { ok: false, reason: result.reason, message: result.message };
    }
    await persistBaseline(result.targets);
    return { ok: true, targets: result.targets };
  } catch (err) {
    return {
      ok: false,
      reason: "error",
      message: err instanceof Error ? err.message : "baseline compute failed",
    };
  }
}

// Persist the four baseline macros + rationale (+ safety note) onto the
// singleton row. The targetsComputedAt timestamp marks this as the current
// baseline R5 adjusts.
async function persistBaseline(targets: ComputedTargets): Promise<UserPreferencesRow> {
  const updated = await db
    .update(userPreferencesTable)
    .set({
      calorieTarget: targets.calorieTarget,
      proteinTargetG: targets.proteinTargetG,
      carbsTargetG: targets.carbsTargetG,
      fatTargetG: targets.fatTargetG,
      targetsRationale: targets.rationale || null,
      targetsSafety: targets.safety ?? null,
      targetsComputedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(userPreferencesTable.id, SINGLETON_ID))
    .returning();
  return updated[0]!;
}

// Resolve the timeframe context for the on-demand Goals compute from the active
// planner config: weeks remaining (program length or to a target date). Used so
// the Goals "Compute targets" button reflects the same plan-aware safe rate the
// plan-apply path does. Best-effort — any failure falls back to no timeframe.
async function activePlanGoalContext(): Promise<GoalContext> {
  try {
    const rows = await db
      .select({
        startDate: plannerConfigsTable.startDate,
        marathonDate: plannerConfigsTable.marathonDate,
        goalWeight: plannerConfigsTable.goalWeight,
        aiPlan: plannerConfigsTable.aiPlan,
      })
      .from(plannerConfigsTable)
      .where(eq(plannerConfigsTable.isActive, true))
      .limit(1);
    const cfg = rows[0];
    if (!cfg) return {};

    let timeframeWeeks: number | null = null;
    // AI plans carry their own week count; templates use start→marathon dates.
    const aiWeeks = (cfg.aiPlan as { weeks?: unknown[] } | null)?.weeks;
    if (Array.isArray(aiWeeks) && aiWeeks.length > 0) {
      timeframeWeeks = aiWeeks.length;
    } else if (cfg.startDate && cfg.marathonDate) {
      timeframeWeeks = weeksBetween(cfg.startDate, cfg.marathonDate);
    }
    return {
      goalWeightLb: cfg.goalWeight ?? null,
      timeframeWeeks,
    };
  } catch {
    return {};
  }
}

// Whole weeks between two ISO dates (>= 0).
function weeksBetween(startISO: string, endISO: string): number | null {
  const start = Date.parse(startISO);
  const end = Date.parse(endISO);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return Math.max(1, Math.round((end - start) / (7 * 24 * 60 * 60 * 1000)));
}

// Shared handler for the on-demand baseline endpoints (compute-targets +
// recompute-targets are aliases). Runs computeBaselineTargets and persists the
// baseline, mapping the structured result onto HTTP. A missing essential input
// returns HTTP 200 with a { needs, message } body so the UI prompts for just
// that field instead of treating it as a hard error.
async function handleBaselineCompute(req: Request, res: Response): Promise<void> {
  const row = await readOrSeed();
  const weight = await latestWeightLb();
  // Pull the active plan's goal weight + timeframe so the on-demand compute is
  // plan-aware (safe-rate + safety note), same as the plan-apply path.
  const planCtx = await activePlanGoalContext();
  const result = await computeBaselineTargets(row, weight, planCtx);
  if (!result.ok) {
    if (result.reason === "needs") {
      // 200 + needs[] — not an error, a prompt for the missing field(s).
      res.status(200).json({ needs: result.needs, message: result.message });
      return;
    }
    if (result.reason === "ai_unavailable") {
      res.status(503).json({ error: result.message });
      return;
    }
    if (result.reason === "ai_error") {
      req.log?.error("compute-targets failed");
      res.status(502).json({ error: result.message });
      return;
    }
    res.status(502).json({ error: result.message });
    return;
  }
  const updated = await persistBaseline(result.targets);
  res.json(toApi(updated, weight));
}

// POST /api/goals/compute-targets — research + persist personalized baseline.
router.post("/goals/compute-targets", handleBaselineCompute);

// POST /api/goals/recompute-targets (R3) — alias of compute-targets. Recomputes
// the fixed recomp baseline on demand and persists baseline + targetsComputedAt.
router.post("/goals/recompute-targets", handleBaselineCompute);

// POST /api/goals/weekly-weight — set/adjust the weekly weight goal.
// Body: { weeklyRateLb: number (signed, negative = loss), goalWeightLb?: number|null }.
// Anchors the per-week target curve at the CURRENT weight + today, clamps the
// rate to the science-safe maximum (nutrition-safety), and persists. A weekly
// goal can never demand faster than safe.
router.post("/goals/weekly-weight", async (req, res): Promise<void> => {
  const body = (req.body ?? {}) as {
    weeklyRateLb?: unknown;
    goalWeightLb?: unknown;
  };
  const rawRate = body.weeklyRateLb;
  if (typeof rawRate !== "number" || !Number.isFinite(rawRate)) {
    res.status(400).json({ error: "weeklyRateLb (a number, lb/wk, negative = loss) is required." });
    return;
  }
  if (rawRate < -3 || rawRate > 3) {
    res.status(400).json({ error: "weeklyRateLb is out of range (expected roughly -3 to 3 lb/wk)." });
    return;
  }

  const weight = await latestWeightLb();
  if (weight == null) {
    res.status(400).json({
      error: "Log a current weight (a measurement) before setting a weekly weight goal.",
    });
    return;
  }

  const clamp = clampWeeklyRate(rawRate, weight);

  // Optional goal-weight update (null clears it).
  let goalWeightLb: number | null | undefined = undefined;
  if (body.goalWeightLb === null) goalWeightLb = null;
  else if (typeof body.goalWeightLb === "number" && Number.isFinite(body.goalWeightLb)) {
    if (body.goalWeightLb < 50 || body.goalWeightLb > 700) {
      res.status(400).json({ error: "goalWeightLb is out of range." });
      return;
    }
    goalWeightLb = body.goalWeightLb;
  }

  await readOrSeed();
  const today = new Date().toISOString().slice(0, 10);
  await db
    .update(userPreferencesTable)
    .set({
      weeklyRateLb: clamp.rateLb,
      weeklyGoalStartWeightLb: weight,
      weeklyGoalAnchorDate: today,
      weeklyGoalNote: clamp.note,
      ...(goalWeightLb !== undefined ? { goalWeightLb } : {}),
      updatedAt: new Date(),
    })
    .where(eq(userPreferencesTable.id, SINGLETON_ID));

  const [row, w] = await Promise.all([readOrSeed(), latestWeightLb()]);
  res.json(toApi(row, w));
});

export default router;
