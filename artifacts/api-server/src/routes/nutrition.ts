import { Router, type IRouter, type Request } from "express";
import {
  db,
  nutritionDaysTable,
  nutritionDayTargetsTable,
  nutritionistReportsTable,
  nutritionEntriesTable,
  userPreferencesTable,
  type NutritionDayRow,
  type NutritionEntryRow,
} from "@workspace/db";
import { and, desc, eq, gte, lte, lt } from "drizzle-orm";
import {
  CreateNutritionEntryBody,
  UpdateNutritionEntryBody,
  ListNutritionEntriesQueryParams,
} from "@workspace/api-zod";
import { getDayTarget, isValidDate } from "../lib/nutrition-day-target";
import { localToday } from "../lib/day-state";
import {
  recomputeDay,
  upsertHealthSyncEntry,
  upsertHealthSyncWater,
} from "../lib/nutrition-rollup";

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
// Sodium in milligrams. Daily intake well under this; anything above is almost
// certainly a units mistake (e.g. grams sent as mg-times-a-thousand).
const MAX_SODIUM_MG = 20000;
// Water in millilitres. 20 L/day is far past any real intake — reject above it.
const MAX_WATER_ML = 20000;
const ML_PER_FL_OZ = 29.5735;

type ApiNutritionDay = {
  date: string;
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  sodiumMg: number | null;
  waterMl: number | null;
  closedAt: string | null;
  updatedAt: string | null;
};

function toApi(row: NutritionDayRow): ApiNutritionDay {
  return {
    date: row.date,
    calories: row.calories,
    proteinG: row.proteinG,
    carbsG: row.carbsG,
    fatG: row.fatG,
    sodiumMg: row.sodiumMg,
    waterMl: row.waterMl,
    closedAt: row.closedAt ? row.closedAt.toISOString() : null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

// The runner's saved IANA timezone (Phase 9), or null → UTC fallback.
async function getUserTimezone(): Promise<string | null> {
  const rows = await db
    .select({ timezone: userPreferencesTable.timezone })
    .from(userPreferencesTable)
    .where(eq(userPreferencesTable.id, 1))
    .limit(1);
  return rows[0]?.timezone ?? null;
}

// "Today" as YYYY-MM-DD in the runner's LOCAL timezone (Phase 9), so an
// evening log doesn't roll into the next UTC day. Falls back to UTC when no
// timezone has been reported yet.
async function localToday_(): Promise<string> {
  return localToday(await getUserTimezone());
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

// Resolve a water value (in any supported unit) from the request body to
// millilitres. Priority: explicit mL, then fl oz, then litres, then a bare
// `water` field (assumed mL). Returns undefined when none were sent.
//
// Keys are matched CASE-INSENSITIVELY (waterOz / waterOZ / wateroz / water_oz
// all work) so the Apple-Shortcut author doesn't have to match capitalization
// exactly. A bare numeric value with a unit suffix (e.g. "24 fl oz") is also
// tolerated by stripping non-numeric characters.
function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}
function waterToMl(body: Record<string, unknown>): number | undefined {
  const lower: Record<string, unknown> = {};
  for (const k of Object.keys(body)) lower[k.toLowerCase()] = body[k];
  const ml = num(lower.waterml ?? lower.water_ml);
  if (ml != null) return ml;
  const oz = num(lower.wateroz ?? lower.water_oz);
  if (oz != null) return oz * ML_PER_FL_OZ;
  const l = num(lower.waterl ?? lower.water_l);
  if (l != null) return l * 1000;
  const bare = num(lower.water);
  if (bare != null) return bare;
  return undefined;
}

// POST /api/nutrition — idempotent upsert of one day's totals. Body:
//   { date?: "YYYY-MM-DD", calories?: number, proteinG?: number,
//     carbsG?: number, fatG?: number, sodiumMg?: number, token?: string }
// `date` defaults to today (UTC). At least one macro/calorie/sodium metric must
// be present. A push that carries only some metrics leaves the others untouched,
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
  const rawSodium = body.sodiumMg ?? body.sodium ?? body.sodium_mg;
  // Water: accept mL / fl oz / litres (or a bare `water`), normalized to mL.
  const rawWaterMl = waterToMl(body);
  const calories = parseMetric(body.calories, MAX_CALORIES);
  const proteinG = parseMetric(rawProtein, MAX_PROTEIN_G);
  const carbsG = parseMetric(rawCarbs, MAX_CARBS_G);
  const fatG = parseMetric(rawFat, MAX_FAT_G);
  const sodiumMg = parseMetric(rawSodium, MAX_SODIUM_MG);
  const waterMl = parseMetric(rawWaterMl, MAX_WATER_ML);
  if (!calories.ok || !proteinG.ok || !carbsG.ok || !fatG.ok || !sodiumMg.ok || !waterMl.ok) {
    res.status(400).json({
      error:
        "calories, proteinG, carbsG, fatG, sodiumMg and water must be non-negative numbers within range.",
    });
    return;
  }
  if (
    calories.value === undefined &&
    proteinG.value === undefined &&
    carbsG.value === undefined &&
    fatG.value === undefined &&
    sodiumMg.value === undefined &&
    waterMl.value === undefined
  ) {
    res.status(400).json({
      error: "Send at least one of calories, proteinG, carbsG, fatG, sodiumMg or water.",
    });
    return;
  }

  let date = await localToday_();
  if (typeof body.date === "string" && body.date.trim() !== "") {
    const d = body.date.trim();
    if (!DATE_RE.test(d)) {
      res.status(400).json({ error: "date must be YYYY-MM-DD." });
      return;
    }
    date = d;
  }

  // Phase 13: reconcile the push into the entries model instead of writing
  // nutrition_days directly. The day's synced totals collapse into ONE
  // health_sync entry (+ one health_sync water log), MERGING only the fields
  // this push sent so a protein-only push doesn't wipe earlier calories — then
  // recomputeDay rebuilds the nutrition_days cache from all entries (manual +
  // sync), so manual entries are never double-counted or clobbered.
  const providedMacros: Partial<
    Record<"calories" | "proteinG" | "carbsG" | "fatG" | "sodiumMg", number>
  > = {};
  if (calories.value !== undefined) providedMacros.calories = calories.value;
  if (proteinG.value !== undefined) providedMacros.proteinG = proteinG.value;
  if (carbsG.value !== undefined) providedMacros.carbsG = carbsG.value;
  if (fatG.value !== undefined) providedMacros.fatG = fatG.value;
  if (sodiumMg.value !== undefined) providedMacros.sodiumMg = sodiumMg.value;

  if (Object.keys(providedMacros).length > 0) {
    await upsertHealthSyncEntry(date, providedMacros);
  }
  if (waterMl.value !== undefined) {
    await upsertHealthSyncWater(date, waterMl.value);
  }
  await recomputeDay(date);

  const [row] = await db
    .select()
    .from(nutritionDaysTable)
    .where(eq(nutritionDaysTable.date, date))
    .limit(1);
  res.json(toApi(row!));
});

// GET /api/nutrition/today — today's totals, or an empty shell so the client
// never has to special-case "nothing synced yet".
router.get("/nutrition/today", async (_req, res) => {
  const date = await localToday_();
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
    sodiumMg: null,
    waterMl: null,
    closedAt: null,
    updatedAt: null,
  });
});

// POST /api/nutrition/close — mark a day's eating DONE (or reopen it). Body:
//   { date?: "YYYY-MM-DD", closed?: boolean }  (date defaults to today UTC;
//   closed defaults to true). Closing sets closed_at = now so the coach +
//   nutritionist judge the day as final; reopening (closed:false) clears it so
//   the day is treated as in-progress again. Upserts the row if the day has no
//   intake yet. Same-origin UI action, ungated (like the other UI writes).
router.post("/nutrition/close", async (req, res): Promise<void> => {
  const raw = (req.body ?? {}) as { date?: unknown; closed?: unknown };
  let date = await localToday_();
  if (typeof raw.date === "string" && raw.date.trim() !== "") {
    if (!DATE_RE.test(raw.date.trim())) {
      res.status(400).json({ error: "date must be YYYY-MM-DD." });
      return;
    }
    date = raw.date.trim();
  }
  const closing = raw.closed !== false; // default true
  const closedAt = closing ? new Date() : null;

  const [row] = await db
    .insert(nutritionDaysTable)
    .values({ date, closedAt })
    .onConflictDoUpdate({
      target: nutritionDaysTable.date,
      set: { closedAt, updatedAt: new Date() },
    })
    .returning();
  res.json(toApi(row!));
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

// POST /api/nutrition/reset — "start nutrition tracking fresh from this date".
// Deletes every daily nutrition log STRICTLY BEFORE `before` (so that date and
// everything after it is kept), then clears the cached AI nutritionist report
// and the stale pre-cutoff per-day target cache so the analysis rebuilds from
// the new window on next load. Plan, body measurements, and workouts are NOT
// touched. `before` defaults to today (UTC) when omitted/invalid.
//
// Same-origin maintenance action triggered from the Nutrition page button,
// matching the unauthenticated DELETE pattern on measurements/workouts (the
// NUTRITION_TOKEN gate is specific to the public Apple-Shortcut ingest route).
router.post("/nutrition/reset", async (req, res): Promise<void> => {
  const raw = (req.body ?? {}) as { before?: unknown };
  const before =
    typeof raw.before === "string" && isValidDate(raw.before)
      ? raw.before
      : await localToday_();

  const deleted = await db
    .delete(nutritionDaysTable)
    .where(lt(nutritionDaysTable.date, before))
    .returning({ date: nutritionDaysTable.date });

  // Bust the caches that summarized the now-deleted history.
  await db.delete(nutritionistReportsTable);
  await db
    .delete(nutritionDayTargetsTable)
    .where(lt(nutritionDayTargetsTable.date, before));

  res.json({ before, deletedDays: deleted.length });
});

// ---------------------------------------------------------------------------
// Phase 13 — timestamped, source-aware nutrition entries (manual logging).
// In-app writes are ungated (same-origin, single-user), matching the
// measurements/workouts convention; the NUTRITION_TOKEN gate stays specific to
// the public Apple-Shortcut ingest route above. Every write recomputes the
// nutrition_days rollup so the existing reads stay correct.
// ---------------------------------------------------------------------------

function toApiEntry(row: NutritionEntryRow) {
  return {
    id: row.id,
    date: row.date,
    loggedAt: row.loggedAt.toISOString(),
    label: row.label,
    calories: row.calories,
    proteinG: row.proteinG,
    carbsG: row.carbsG,
    fatG: row.fatG,
    sodiumMg: row.sodiumMg,
    source: row.source as "manual" | "health_sync",
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// GET /api/nutrition/entries?date=YYYY-MM-DD | ?from=&to= — entries for a day
// or an inclusive range, newest first. No params → most recent 200.
router.get("/nutrition/entries", async (req, res): Promise<void> => {
  const parsed = ListNutritionEntriesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { date, from, to } = parsed.data;
  const conds = [];
  if (date && isValidDate(date)) conds.push(eq(nutritionEntriesTable.date, date));
  if (from && isValidDate(from)) conds.push(gte(nutritionEntriesTable.date, from));
  if (to && isValidDate(to)) conds.push(lte(nutritionEntriesTable.date, to));
  const rows = await db
    .select()
    .from(nutritionEntriesTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(nutritionEntriesTable.loggedAt))
    .limit(conds.length ? 1000 : 200);
  res.json(rows.map(toApiEntry));
});

// POST /api/nutrition/entries — log a manual food entry. date/loggedAt default
// to the runner's local day / now.
router.post("/nutrition/entries", async (req, res): Promise<void> => {
  const parsed = CreateNutritionEntryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const date = d.date && isValidDate(d.date) ? d.date : await localToday_();
  const [row] = await db
    .insert(nutritionEntriesTable)
    .values({
      date,
      loggedAt: d.loggedAt ? new Date(d.loggedAt) : new Date(),
      label: d.label ?? null,
      calories: d.calories ?? null,
      proteinG: d.proteinG ?? null,
      carbsG: d.carbsG ?? null,
      fatG: d.fatG ?? null,
      sodiumMg: d.sodiumMg ?? null,
      source: "manual",
    })
    .returning();
  await recomputeDay(date);
  res.status(201).json(toApiEntry(row!));
});

// PATCH /api/nutrition/entries/:id — edit a manual entry. If the date changes,
// both the old and new day rollups are recomputed.
router.patch("/nutrition/entries/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "invalid id" });
    return;
  }
  const parsed = UpdateNutritionEntryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const existing = await db
    .select()
    .from(nutritionEntriesTable)
    .where(eq(nutritionEntriesTable.id, id))
    .limit(1);
  if (!existing[0]) {
    res.status(404).json({ error: "not found" });
    return;
  }
  const d = parsed.data;
  const set: Partial<NutritionEntryRow> = { updatedAt: new Date() };
  if (d.date !== undefined && isValidDate(d.date)) set.date = d.date;
  if (d.loggedAt !== undefined) set.loggedAt = new Date(d.loggedAt);
  if (d.label !== undefined) set.label = d.label;
  if (d.calories !== undefined) set.calories = d.calories;
  if (d.proteinG !== undefined) set.proteinG = d.proteinG;
  if (d.carbsG !== undefined) set.carbsG = d.carbsG;
  if (d.fatG !== undefined) set.fatG = d.fatG;
  if (d.sodiumMg !== undefined) set.sodiumMg = d.sodiumMg;

  const [row] = await db
    .update(nutritionEntriesTable)
    .set(set)
    .where(eq(nutritionEntriesTable.id, id))
    .returning();
  await recomputeDay(existing[0].date);
  if (row && row.date !== existing[0].date) await recomputeDay(row.date);
  res.json(toApiEntry(row!));
});

// DELETE /api/nutrition/entries/:id — remove a manual entry, recompute its day.
router.delete("/nutrition/entries/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "invalid id" });
    return;
  }
  const [deleted] = await db
    .delete(nutritionEntriesTable)
    .where(eq(nutritionEntriesTable.id, id))
    .returning();
  if (deleted) await recomputeDay(deleted.date);
  res.status(204).send();
});

export default router;
