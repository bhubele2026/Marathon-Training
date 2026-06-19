import { Router, type IRouter, type Request } from "express";
import { db, nutritionDaysTable, type NutritionDayRow } from "@workspace/db";
import { desc, eq, gte } from "drizzle-orm";
import { getDayTarget, isValidDate } from "../lib/nutrition-day-target";

// Daily calories + protein synced from a food tracker (MyNetDiary → Apple
// Health → an Apple Shortcut that POSTs here once a day). The ingest route
// is the only write surface; the GET routes feed the /nutrition page.
//
// Auth: the rest of this personal-use app has no auth layer, but this is a
// write endpoint reachable from the public deployment URL, so the push is
// gated by a shared secret in the NUTRITION_TOKEN env var. The Shortcut
// sends it as `Authorization: Bearer <token>` (preferred) or in the JSON
// body as `token` / `secret`. If NUTRITION_TOKEN is unset the route fails
// closed (503) rather than silently accepting unauthenticated writes.

const router: IRouter = Router();

const RECENT_DEFAULT_DAYS = 14;
const RECENT_MAX_DAYS = 90;
// Calories/protein are integers; anything above these is almost certainly a
// units mistake (e.g. protein sent in mg). Reject rather than store garbage.
const MAX_CALORIES = 20000;
const MAX_PROTEIN_G = 2000;
// Carbs/fat share the same "reject units mistakes" intent; daily intake well
// under these in grams.
const MAX_CARBS_G = 2000;
const MAX_FAT_G = 1000;

type ApiNutritionDay = {
  date: string;
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  updatedAt: string | null;
};

function toApi(row: NutritionDayRow): ApiNutritionDay {
  return {
    date: row.date,
    calories: row.calories,
    proteinG: row.proteinG,
    carbsG: row.carbsG,
    fatG: row.fatG,
    updatedAt: row.updatedAt.toISOString(),
  };
}

// "Today" in UTC, matching the rest of the app's day math (see replit.md
// deployment notes). YYYY-MM-DD.
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Pull the presented secret from the Authorization header or the body.
function presentedToken(req: Request): string | null {
  const auth = req.header("authorization");
  if (auth && /^Bearer\s+/i.test(auth)) {
    return auth.replace(/^Bearer\s+/i, "").trim();
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const fromBody = body.token ?? body.secret;
  return typeof fromBody === "string" ? fromBody.trim() : null;
}

// Coerce an incoming numeric field to a clamped non-negative integer, or a
// validation error. `undefined` means "field not sent" (left untouched on
// upsert); an explicit null also means "not sent".
function parseMetric(
  value: unknown,
  max: number,
): { ok: true; value: number | undefined } | { ok: false } {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: undefined };
  }
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > max) {
    return { ok: false };
  }
  return { ok: true, value: Math.round(n) };
}

// POST /api/nutrition — idempotent upsert of one day's totals. Body:
//   { date?: "YYYY-MM-DD", calories?: number, proteinG?: number,
//     carbsG?: number, fatG?: number, token?: string }
// `date` defaults to today (UTC). At least one macro/calorie metric must be
// present. A push that carries only some metrics leaves the others untouched,
// so a protein-only Apple Shortcut keeps working unchanged and carbs/fat stay
// null until a push carries them.
router.post("/nutrition", async (req, res) => {
  const required = process.env.NUTRITION_TOKEN;
  if (!required) {
    res.status(503).json({
      error:
        "Nutrition sync is not configured. Set the NUTRITION_TOKEN secret on the server.",
    });
    return;
  }
  if (presentedToken(req) !== required) {
    res.status(401).json({ error: "Invalid or missing nutrition token." });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;

  // Accept proteinG, protein, or protein_g for the Shortcut author's sanity;
  // same alias forgiveness for carbs (carbs/carbsG/carbs_g) and fat.
  const rawProtein = body.proteinG ?? body.protein ?? body.protein_g;
  const rawCarbs = body.carbsG ?? body.carbs ?? body.carbs_g;
  const rawFat = body.fatG ?? body.fat ?? body.fat_g;
  const calories = parseMetric(body.calories, MAX_CALORIES);
  const proteinG = parseMetric(rawProtein, MAX_PROTEIN_G);
  const carbsG = parseMetric(rawCarbs, MAX_CARBS_G);
  const fatG = parseMetric(rawFat, MAX_FAT_G);
  if (!calories.ok || !proteinG.ok || !carbsG.ok || !fatG.ok) {
    res.status(400).json({
      error:
        "calories, proteinG, carbsG and fatG must be non-negative numbers within range.",
    });
    return;
  }
  if (
    calories.value === undefined &&
    proteinG.value === undefined &&
    carbsG.value === undefined &&
    fatG.value === undefined
  ) {
    res
      .status(400)
      .json({ error: "Send at least one of calories, proteinG, carbsG or fatG." });
    return;
  }

  let date = todayUtc();
  if (typeof body.date === "string" && body.date.trim() !== "") {
    const d = body.date.trim();
    if (!DATE_RE.test(d)) {
      res.status(400).json({ error: "date must be YYYY-MM-DD." });
      return;
    }
    date = d;
  }

  // Only write the fields that were actually sent so a protein-only push
  // doesn't blow away an earlier calories value (and vice versa).
  const provided: Partial<NutritionDayRow> = {};
  if (calories.value !== undefined) provided.calories = calories.value;
  if (proteinG.value !== undefined) provided.proteinG = proteinG.value;
  if (carbsG.value !== undefined) provided.carbsG = carbsG.value;
  if (fatG.value !== undefined) provided.fatG = fatG.value;

  const [row] = await db
    .insert(nutritionDaysTable)
    .values({ date, ...provided })
    .onConflictDoUpdate({
      target: nutritionDaysTable.date,
      set: { ...provided, updatedAt: new Date() },
    })
    .returning();

  res.json(toApi(row!));
});

// GET /api/nutrition/today — today's totals, or an empty shell so the client
// never has to special-case "nothing synced yet".
router.get("/nutrition/today", async (_req, res) => {
  const date = todayUtc();
  const rows = await db
    .select()
    .from(nutritionDaysTable)
    .where(eq(nutritionDaysTable.date, date))
    .limit(1);
  if (rows[0]) {
    res.json(toApi(rows[0]));
    return;
  }
  res.json({
    date,
    calories: null,
    proteinG: null,
    carbsG: null,
    fatG: null,
    updatedAt: null,
  });
});

// GET /api/nutrition/recent?days=14 — most recent days with data, newest
// first, for the trend strip on the /nutrition page.
router.get("/nutrition/recent", async (req, res) => {
  const raw = Number(req.query.days);
  const days =
    Number.isFinite(raw) && raw > 0
      ? Math.min(Math.floor(raw), RECENT_MAX_DAYS)
      : RECENT_DEFAULT_DAYS;

  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - (days - 1));
  const cutoffDate = cutoff.toISOString().slice(0, 10);

  const rows = await db
    .select()
    .from(nutritionDaysTable)
    .where(gte(nutritionDaysTable.date, cutoffDate))
    .orderBy(desc(nutritionDaysTable.date));

  res.json({ days, entries: rows.map(toApi) });
});

// GET /api/nutrition/day/:date (R5) — the reactive per-day target. Returns the
// fixed recomp baseline, the training-reactive adjusted target, the delta, the
// AI/fallback rationale, the actual logged intake (or null), and whether the
// signal is "planned" (pre-log) or "actual" (a workout exists for the date).
// Hand-fetched (not in openapi.yaml), matching the goals/nutrition convention.
router.get("/nutrition/day/:date", async (req, res): Promise<void> => {
  const date = req.params.date;
  if (!isValidDate(date)) {
    res.status(400).json({ error: "date must be YYYY-MM-DD." });
    return;
  }
  const result = await getDayTarget(date);
  res.json(result);
});

export default router;
