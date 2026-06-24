import { Router, type IRouter } from "express";
import {
  db,
  userPreferencesTable,
  workoutsTable,
  type UserPreferencesRow,
} from "@workspace/db";
import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import { UpdateUserPreferencesBody } from "@workspace/api-zod";

// Heuristic constants for the suggested resting HR endpoint (Task #157).
// We scan the last SUGGESTION_WINDOW_DAYS of workouts that carry an
// `avg_hr` value, take the lowest steady-state average, and subtract a
// fixed offset because even an easy walk / cooldown averages well above
// true resting. Requires a minimum sample size so a single fluky low HR
// doesn't drive the suggestion. Final value is clamped to the same range
// the input accepts.
const SUGGESTION_WINDOW_DAYS = 90;
const SUGGESTION_MIN_SAMPLES = 5;
const SUGGESTION_OFFSET_BPM = 35;
const SUGGESTION_MIN_BPM = 30;
const SUGGESTION_MAX_BPM = 110;

const router: IRouter = Router();

const SINGLETON_ID = 1;

type ApiUserPreferences = {
  runTargetingMode: string;
  maxHr: number | null;
  restingHr: number | null;
  hrZoneModel: string;
  visualTheme: string | null;
  timezone: string | null;
  updatedAt: string;
};

function toApi(row: UserPreferencesRow): ApiUserPreferences {
  return {
    runTargetingMode: row.runTargetingMode,
    maxHr: row.maxHr,
    restingHr: row.restingHr,
    hrZoneModel: row.hrZoneModel,
    visualTheme: row.visualTheme,
    timezone: row.timezone,
    updatedAt: row.updatedAt.toISOString(),
  };
}

// Lazy upsert of the singleton row so the client never has to handle the
// "no prefs yet" case. Returns the row whether we just inserted it or it
// already existed.
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
  // Lost the race against a concurrent insert; re-read.
  const again = await db
    .select()
    .from(userPreferencesTable)
    .where(eq(userPreferencesTable.id, SINGLETON_ID))
    .limit(1);
  return again[0]!;
}

router.get("/preferences", async (_req, res) => {
  const row = await readOrSeed();
  res.json(toApi(row));
});

router.put("/preferences", async (req, res) => {
  const parsed = UpdateUserPreferencesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  await readOrSeed();
  const updates: Partial<UserPreferencesRow> = {};
  if (parsed.data.runTargetingMode !== undefined) {
    updates.runTargetingMode = parsed.data.runTargetingMode;
  }
  // Send maxHr=null to explicitly clear the value, omit to leave alone.
  if (parsed.data.maxHr !== undefined) {
    updates.maxHr = parsed.data.maxHr;
  }
  // Same convention for restingHr (Task #146): null clears, omit leaves alone.
  if (parsed.data.restingHr !== undefined) {
    updates.restingHr = parsed.data.restingHr;
  }
  // Task #158 — HR zone model. Treated like runTargetingMode: enum
  // string, not nullable; omit to leave the saved choice alone.
  if (parsed.data.hrZoneModel !== undefined) {
    updates.hrZoneModel = parsed.data.hrZoneModel;
  }
  // Task #196 — visual theme palette. Nullable: send `null` to clear
  // the saved choice (provider falls back to localStorage / default);
  // omit to leave the saved choice alone.
  if (parsed.data.visualTheme !== undefined) {
    updates.visualTheme = parsed.data.visualTheme;
  }
  // Phase 9 — IANA timezone. Nullable: send `null` to clear (server falls
  // back to UTC); omit to leave alone. The client PATCHes this on app load
  // when the detected browser zone differs from the stored one.
  if (parsed.data.timezone !== undefined) {
    updates.timezone = parsed.data.timezone;
  }
  if (Object.keys(updates).length === 0) {
    const row = await readOrSeed();
    res.json(toApi(row));
    return;
  }
  const updated = await db
    .update(userPreferencesTable)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(userPreferencesTable.id, SINGLETON_ID))
    .returning();
  res.json(toApi(updated[0]!));
});

router.get("/preferences/suggested-resting-hr", async (_req, res) => {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - SUGGESTION_WINDOW_DAYS);
  const cutoffDate = cutoff.toISOString().slice(0, 10);

  const rows = await db
    .select({
      minHr: sql<number | null>`min(${workoutsTable.avgHr})`,
      sampleCount: sql<number>`count(${workoutsTable.avgHr})`,
    })
    .from(workoutsTable)
    .where(
      and(
        isNotNull(workoutsTable.avgHr),
        gte(workoutsTable.date, cutoffDate),
      ),
    );

  const row = rows[0];
  const sampleCount = Number(row?.sampleCount ?? 0);
  const minHr = row?.minHr == null ? null : Number(row.minHr);

  let value: number | null = null;
  if (
    sampleCount >= SUGGESTION_MIN_SAMPLES &&
    minHr != null &&
    Number.isFinite(minHr)
  ) {
    const raw = Math.round(minHr - SUGGESTION_OFFSET_BPM);
    const clamped = Math.max(
      SUGGESTION_MIN_BPM,
      Math.min(SUGGESTION_MAX_BPM, raw),
    );
    value = clamped;
  }

  res.json({
    value,
    sampleCount,
    windowDays: SUGGESTION_WINDOW_DAYS,
  });
});

export default router;
