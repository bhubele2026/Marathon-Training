import { Router, type IRouter } from "express";
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

type ApiGoals = {
  heightIn: number | null;
  age: number | null;
  sex: string | null;
  activityLevel: string | null;
  bodyGoal: string;
  goalWeightLb: number | null;
  calorieTarget: number | null;
  proteinTargetG: number | null;
  targetsRationale: string | null;
  targetsComputedAt: string | null;
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
    targetsRationale: row.targetsRationale,
    targetsComputedAt: row.targetsComputedAt
      ? row.targetsComputedAt.toISOString()
      : null,
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
  if (!heightIn.ok || !age.ok || !goalWeight.ok || !scoreNow.ok || !scoreGoal.ok) {
    res.status(400).json({ error: "A stat value is out of range." });
    return;
  }
  if (heightIn.value !== undefined) updates.heightIn = heightIn.value;
  if (age.value !== undefined) updates.age = age.value;
  if (goalWeight.value !== undefined) updates.goalWeightLb = goalWeight.value;
  if (scoreNow.value !== undefined) updates.strengthScoreCurrent = scoreNow.value;
  if (scoreGoal.value !== undefined) updates.strengthScoreGoal = scoreGoal.value;

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

type ComputedTargets = { calorieTarget: number; proteinTargetG: number; rationale: string };

// Pull the recommended targets out of the model's free text. Prefers a fenced
// ```json block; falls back to the first object literal that carries the keys.
function parseTargets(text: string): ComputedTargets | null {
  const tryObj = (raw: string): ComputedTargets | null => {
    try {
      const o = JSON.parse(raw) as Record<string, unknown>;
      const cal = Number(o.calorieTarget);
      const pro = Number(o.proteinTargetG);
      if (!Number.isFinite(cal) || !Number.isFinite(pro)) return null;
      return {
        calorieTarget: Math.round(cal),
        proteinTargetG: Math.round(pro),
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
          'From the text below, return ONLY this JSON object (no prose, no code fence): {"calorieTarget": <integer kcal>, "proteinTargetG": <integer grams>, "rationale": "<one or two sentences>"}\n\nText:\n' +
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

// POST /api/goals/compute-targets — research + persist personalized targets.
router.post("/goals/compute-targets", async (req, res) => {
  if (!isConfigured()) {
    res.status(503).json({
      error:
        "AI is not configured. Add ANTHROPIC_API_KEY as a Replit secret (Tools → Secrets) to calculate targets.",
    });
    return;
  }

  const row = await readOrSeed();
  const weight = await latestWeightLb();

  // Require the inputs the calculation depends on.
  const missing: string[] = [];
  if (row.heightIn == null) missing.push("height");
  if (row.age == null) missing.push("age");
  if (!row.sex) missing.push("sex");
  if (!row.activityLevel) missing.push("activity level");
  if (weight == null) missing.push("current weight (log a measurement)");
  if (missing.length > 0) {
    res.status(400).json({
      error: `Fill in your stats first — missing: ${missing.join(", ")}.`,
    });
    return;
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
    "activity TDEE multipliers, protein intake for muscle retention/gain ~0.7–1.0 g",
    "per lb of bodyweight, and the calorie strategy appropriate to the stated goal).",
    "Search for recent reputable sources before answering. Then give ONE daily",
    "calorie target and ONE daily protein target (grams) for THIS person.",
    "",
    "After your reasoning, end your reply with a single fenced ```json code block",
    'containing exactly: {"calorieTarget": <integer kcal>, "proteinTargetG": <integer grams>,',
    '"rationale": "<2-4 sentences: the TDEE estimate, the adjustment for the goal, the',
    'protein basis, and any caveat>"}. No other text after the code block.',
  ].join(" ");

  const userText = [
    `Calculate my daily calorie and protein targets. Goal: ${goalLabel}.`,
    `Stats: ${row.sex}, age ${row.age}, height ${ft}'${inch}" (${row.heightIn} in),`,
    `current weight ${weight} lb${row.goalWeightLb ? `, goal weight ${row.goalWeightLb} lb` : ""},`,
    `activity level: ${row.activityLevel}.`,
    "I lift on a Tonal 5–6x/week plus cardio and the occasional 5K, so protein is a priority.",
  ].join(" ");

  let targets: ComputedTargets | null = null;
  try {
    const text = await researchTargets(system, userText);
    targets = await extractTargets(text);
  } catch (err) {
    req.log?.error({ err }, "compute-targets failed");
    res.status(502).json({ error: "The AI request failed. Try again." });
    return;
  }

  if (
    !targets ||
    targets.calorieTarget < MIN_CALORIES ||
    targets.calorieTarget > MAX_CALORIES ||
    targets.proteinTargetG < MIN_PROTEIN_G ||
    targets.proteinTargetG > MAX_PROTEIN_G
  ) {
    res.status(502).json({
      error: "The AI returned an unreadable or implausible result. Try again.",
    });
    return;
  }

  const updated = await db
    .update(userPreferencesTable)
    .set({
      calorieTarget: targets.calorieTarget,
      proteinTargetG: targets.proteinTargetG,
      targetsRationale: targets.rationale || null,
      targetsComputedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(userPreferencesTable.id, SINGLETON_ID))
    .returning();

  res.json(toApi(updated[0]!, weight));
});

export default router;
