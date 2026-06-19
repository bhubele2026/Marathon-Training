import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  userPreferencesTable,
  measurementsTable,
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

// Plausibility clamps for AI output — reject anything outside these as a units
// or hallucination error rather than store garbage.
const MIN_CALORIES = 800;
const MAX_CALORIES = 6000;
const MIN_PROTEIN_G = 30;
const MAX_PROTEIN_G = 400;
// Carbs/fat have no sensible lower bound (a strict cut can run very low), so
// only the upper clamp guards against a units/hallucination error.
const MIN_CARBS_G = 0;
const MAX_CARBS_G = 700;
const MIN_FAT_G = 0;
const MAX_FAT_G = 300;

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
  sodiumLimitMg: number | null;
  strengthScoreCurrent: number | null;
  strengthScoreGoal: number | null;
  currentWeightLb: number | null;
  aiConfigured: boolean;
  updatedAt: string;
};

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
    sodiumLimitMg: row.sodiumLimitMg,
    strengthScoreCurrent: row.strengthScoreCurrent,
    strengthScoreGoal: row.strengthScoreGoal,
    currentWeightLb,
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
): Promise<BaselineResult> {
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

  const system = [
    "You are a sports-nutrition assistant. Use the web_search tool to ground your",
    "recommendation in current, evidence-based guidance (e.g. Mifflin-St Jeor BMR,",
    "activity TDEE multipliers, protein intake for muscle retention/gain ~0.8–1.0 g",
    "per lb of bodyweight, and the calorie strategy appropriate to the stated goal).",
    "For a recomposition goal use a MODEST deficit to near-maintenance (lose fat",
    "while building muscle) with protein PRIORITIZED. This is the runner's fixed",
    "daily BASELINE — it is later nudged up or down per-day for training load, so",
    "give the steady all-week baseline, not a single hard day's intake.",
    "Search for recent reputable sources before answering. Then give ONE daily",
    "calorie target plus a full macro split — protein, carbohydrate and fat targets",
    "(all in grams) — for THIS person. The macro grams should be roughly consistent",
    "with the calorie target (protein 4 kcal/g, carbs 4 kcal/g, fat 9 kcal/g), with",
    "protein prioritized for muscle retention and the remaining calories split between",
    "carbs and fat per the goal.",
    "",
    "After your reasoning, end your reply with a single fenced ```json code block",
    'containing exactly: {"calorieTarget": <integer kcal>, "proteinTargetG": <integer grams>,',
    '"carbsTargetG": <integer grams>, "fatTargetG": <integer grams>,',
    '"rationale": "<2-4 sentences: the TDEE estimate, the recomp adjustment, the',
    'protein basis, the carb/fat split rationale, and any caveat>"}. No other text after',
    "the code block.",
  ].join(" ");

  const userText = [
    `Calculate my fixed daily BASELINE calorie target and full macro split (protein, carbs, fat). Goal: ${goalLabel}.`,
    `Stats: ${row.sex}, age ${row.age}, height ${ft}'${inch}" (${row.heightIn} in),`,
    `current weight ${weight} lb${row.goalWeightLb ? `, goal weight ${row.goalWeightLb} lb` : ""},`,
    `activity level: ${row.activityLevel}.`,
    "I lift on a Tonal 5–6x/week plus cardio and the occasional 5K, so protein is a priority.",
  ].join(" ");

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

  if (
    !targets ||
    targets.calorieTarget < MIN_CALORIES ||
    targets.calorieTarget > MAX_CALORIES ||
    targets.proteinTargetG < MIN_PROTEIN_G ||
    targets.proteinTargetG > MAX_PROTEIN_G ||
    targets.carbsTargetG < MIN_CARBS_G ||
    targets.carbsTargetG > MAX_CARBS_G ||
    targets.fatTargetG < MIN_FAT_G ||
    targets.fatTargetG > MAX_FAT_G
  ) {
    return {
      ok: false,
      reason: "implausible",
      message: "The AI returned an unreadable or implausible result. Try again.",
    };
  }

  return { ok: true, targets };
}

// R4 best-effort hook: compute + persist the recomp baseline as part of another
// flow (plan apply / AI plan accept). Never throws and never returns an HTTP
// concern — callers log the outcome and move on. Returns the persisted targets
// on success, or a short note on why it couldn't (missing stat / AI down).
export async function computeAndPersistBaselineBestEffort(): Promise<
  | { ok: true; targets: ComputedTargets }
  | { ok: false; reason: string; message: string }
> {
  try {
    const row = await readOrSeed();
    const weight = await latestWeightLb();
    const result = await computeBaselineTargets(row, weight);
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

// Persist the four baseline macros + rationale onto the singleton row. The
// targetsComputedAt timestamp marks this as the current baseline R5 adjusts.
async function persistBaseline(targets: ComputedTargets): Promise<UserPreferencesRow> {
  const updated = await db
    .update(userPreferencesTable)
    .set({
      calorieTarget: targets.calorieTarget,
      proteinTargetG: targets.proteinTargetG,
      carbsTargetG: targets.carbsTargetG,
      fatTargetG: targets.fatTargetG,
      targetsRationale: targets.rationale || null,
      targetsComputedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(userPreferencesTable.id, SINGLETON_ID))
    .returning();
  return updated[0]!;
}

// Shared handler for the on-demand baseline endpoints (compute-targets +
// recompute-targets are aliases). Runs computeBaselineTargets and persists the
// baseline, mapping the structured result onto HTTP. A missing essential input
// returns HTTP 200 with a { needs, message } body so the UI prompts for just
// that field instead of treating it as a hard error.
async function handleBaselineCompute(req: Request, res: Response): Promise<void> {
  const row = await readOrSeed();
  const weight = await latestWeightLb();
  const result = await computeBaselineTargets(row, weight);
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

export default router;
