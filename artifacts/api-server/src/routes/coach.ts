import { Router, type IRouter } from "express";
import {
  db,
  coachDailyNotesTable,
  nutritionDaysTable,
  planDaysTable,
  workoutsTable,
  userPreferencesTable,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { getAnthropic, isConfigured, MODEL } from "@workspace/integrations-anthropic";
import { COACH_PERSONA } from "@workspace/plan-knowledge";
import { buildDataSummary, type DayInputs } from "../lib/coach-voice";
import { getDayTarget } from "../lib/nutrition-day-target";

const router: IRouter = Router();
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Compact, stable content hash of the day's inputs. When this changes (food
// synced, workout logged/skipped), the cached note is stale and regenerated.
function hashInputs(obj: unknown): string {
  const s = JSON.stringify(obj);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}


async function gatherDay(date: string): Promise<DayInputs> {
  const prefsRows = await db
    .select({
      calorieTarget: userPreferencesTable.calorieTarget,
      proteinTargetG: userPreferencesTable.proteinTargetG,
      carbsTargetG: userPreferencesTable.carbsTargetG,
      fatTargetG: userPreferencesTable.fatTargetG,
      sex: userPreferencesTable.sex,
    })
    .from(userPreferencesTable)
    .where(eq(userPreferencesTable.id, 1))
    .limit(1);
  const prefs = prefsRows[0];

  const nutRows = await db
    .select()
    .from(nutritionDaysTable)
    .where(eq(nutritionDaysTable.date, date))
    .limit(1);
  const nut = nutRows[0];

  const planRows = await db
    .select({
      sessionType: planDaysTable.sessionType,
      isRest: planDaysTable.isRest,
      strengthMin: planDaysTable.strengthMin,
      cardioMin: planDaysTable.cardioMin,
      runMin: planDaysTable.runMin,
      description: planDaysTable.description,
    })
    .from(planDaysTable)
    .where(eq(planDaysTable.date, date))
    .limit(1);
  const pd = planRows[0];

  const wkAgg = await db.execute<{ cnt: number; mins: number }>(sql`
    SELECT COUNT(*)::int AS cnt,
           COALESCE(SUM(COALESCE(duration_min,
             COALESCE(strength_min,0)+COALESCE(cardio_min,0)+COALESCE(run_min,0))), 0)::int AS mins
    FROM workouts WHERE date = ${date}
  `);

  return {
    date,
    target: {
      calories: prefs?.calorieTarget ?? null,
      protein: prefs?.proteinTargetG ?? null,
      carbs: prefs?.carbsTargetG ?? null,
      fat: prefs?.fatTargetG ?? null,
    },
    actual: nut
      ? { calories: nut.calories, protein: nut.proteinG, carbs: nut.carbsG, fat: nut.fatG }
      : null,
    planned: pd
      ? {
          sessionType: pd.sessionType,
          isRest: pd.isRest,
          minutes: (pd.strengthMin ?? 0) + (pd.cardioMin ?? 0) + (pd.runMin ?? 0),
          lifting: (pd.strengthMin ?? 0) > 0,
          description: pd.description,
        }
      : null,
    loggedWorkouts: wkAgg.rows[0]?.cnt ?? 0,
    loggedMinutes: wkAgg.rows[0]?.mins ?? 0,
    sex: prefs?.sex ?? null,
    dayTarget: await readDayTarget(date),
  };
}

// The reactive macro target for the day (best-effort; null if no baseline yet)
// so the coach can reference the carb/protein logic in its line.
async function readDayTarget(date: string): Promise<DayInputs["dayTarget"]> {
  try {
    const t = await getDayTarget(date);
    if (!t.adjusted) return null;
    return {
      cal: t.adjusted.cal,
      protein: t.adjusted.protein,
      carbs: t.adjusted.carbs,
      load: t.trainingLoad,
      summary: t.training?.summary ?? null,
    };
  } catch {
    return null;
  }
}

// True when there's nothing worth reacting to (no plan, no food, no workout).
function isEmptyDay(d: DayInputs): boolean {
  return d.planned == null && d.actual == null && d.loggedWorkouts === 0;
}

// Generate the persona daily line. Returns null when AI is unconfigured or
// errors (caller treats as "no note"). `any`-typed SDK call like the rest.
/* eslint-disable @typescript-eslint/no-explicit-any */
async function generateDailyNote(d: DayInputs): Promise<string | null> {
  if (!isConfigured()) return null;
  const system =
    `${COACH_PERSONA}\n\n## Your task right now\n` +
    `Write the DAILY line shown on the client's Today screen. React to TODAY only, ` +
    `in 1-3 short, sharp sentences, fully in your voice. Reference the real numbers. ` +
    `When a fuel target is given, work the macro logic in (big day → more carbs to ` +
    `fuel it, protein stays high; rest day → carbs ease back) — it's load-based ` +
    `fuelling, never calories burned. ` +
    `Obey the wellbeing rails above without exception — if a SAFETY SIGNAL appears or ` +
    `the day shows under-eating, drop the sarcasm and be genuinely warm. Output ONLY ` +
    `the line itself: no preamble, no quotation marks, no sign-off.`;
  try {
    const client: any = getAnthropic();
    const resp: any = await client.messages.create({
      model: MODEL,
      max_tokens: 400,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      system,
      messages: [{ role: "user", content: buildDataSummary(d) }],
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

// GET /api/coach/daily/:date — the persona daily reaction. Cached per day;
// regenerated when the day's inputs change (hash mismatch).
router.get("/coach/daily/:date", async (req, res): Promise<void> => {
  const date = req.params.date;
  if (!ISO_DATE.test(date)) {
    res.status(400).json({ error: "date must be an ISO date (YYYY-MM-DD)." });
    return;
  }

  const inputs = await gatherDay(date);
  if (isEmptyDay(inputs)) {
    res.json({ date, note: null });
    return;
  }
  const inputHash = hashInputs(inputs);

  const cached = await db
    .select()
    .from(coachDailyNotesTable)
    .where(eq(coachDailyNotesTable.date, date))
    .limit(1);
  if (cached[0] && cached[0].inputHash === inputHash) {
    res.json({ date, note: cached[0].note, generatedAt: cached[0].generatedAt });
    return;
  }

  const note = await generateDailyNote(inputs);
  if (note == null) {
    // AI unavailable — don't cache; surface nothing.
    res.json({ date, note: null });
    return;
  }
  const now = new Date();
  await db
    .insert(coachDailyNotesTable)
    .values({ date, note, inputHash, generatedAt: now })
    .onConflictDoUpdate({
      target: coachDailyNotesTable.date,
      set: { note, inputHash, generatedAt: now },
    });
  res.json({ date, note, generatedAt: now });
});

// ---------------------------------------------------------------------------
// Always-on coach presence (Phase 1): a short, screen-contextual line for the
// persistent dock in the app shell. Reuses the same day inputs + persona as the
// daily note; the `context` only steers WHAT the line reacts to. Hand-fetched
// (not in openapi.yaml), matching the rest of the coach slice. Cheap: short
// line, low tokens, deduped in-process by context + input hash so we don't
// re-call the model until the day's data changes.
const COACH_CONTEXTS = new Set([
  "today",
  "nutrition",
  "body",
  "plan",
  "dashboard",
  "general",
]);
const contextLineCache = new Map<string, string>();

function contextInstruction(ctx: string): string {
  switch (ctx) {
    case "nutrition":
      return "The client is on the NUTRITION screen — react to TODAY's food vs targets (protein, calories, carbs) right now.";
    case "today":
      return "The client is on TODAY — react to today's planned/logged session and food.";
    case "body":
      return "The client is on the BODY / measurements screen — tie today's training + fuelling to recomp progress and consistency.";
    case "plan":
      return "The client is on the PLAN screen — react to whether they're hitting planned sessions; ride them about skips, credit consistency.";
    case "dashboard":
      return "The client is on the DASHBOARD — give the overall 'where are you at' read from today's data.";
    default:
      return "Give a short, contextual nudge from today's data.";
  }
}

async function generateContextLine(d: DayInputs, ctx: string): Promise<string | null> {
  if (!isConfigured()) return null;
  const system =
    `${COACH_PERSONA}\n\n## Your task right now\n` +
    `Write ONE short line (max ~20 words) for a persistent coach strip shown on ` +
    `the client's screen. ${contextInstruction(ctx)} Fully in your voice, ` +
    `reference a real number when you can, max sass — but obey the wellbeing ` +
    `rails without exception: if a SAFETY SIGNAL appears or the day shows ` +
    `under-eating, DROP the sarcasm and be genuinely warm. Output ONLY the line: ` +
    `no preamble, no quotation marks, no sign-off.`;
  try {
    const client: any = getAnthropic();
    const resp: any = await client.messages.create({
      model: MODEL,
      max_tokens: 200,
      system,
      messages: [{ role: "user", content: buildDataSummary(d) }],
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

// GET /api/coach/line?context=nutrition — the persistent dock line.
router.get("/coach/line", async (req, res): Promise<void> => {
  const raw = req.query.context;
  const ctx =
    typeof raw === "string" && COACH_CONTEXTS.has(raw) ? raw : "general";
  const date = new Date().toISOString().slice(0, 10);

  const inputs = await gatherDay(date);
  if (isEmptyDay(inputs)) {
    res.json({ context: ctx, line: null });
    return;
  }

  const key = `${ctx}:${hashInputs(inputs)}`;
  const cached = contextLineCache.get(key);
  if (cached) {
    res.json({ context: ctx, line: cached });
    return;
  }

  const line = await generateContextLine(inputs, ctx);
  if (line) {
    // Bound the in-process cache so it can't grow without limit across days.
    if (contextLineCache.size > 60) contextLineCache.clear();
    contextLineCache.set(key, line);
  }
  res.json({ context: ctx, line });
});

export default router;
