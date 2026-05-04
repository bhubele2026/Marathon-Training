import { Router, type IRouter } from "express";
import {
  db,
  userPreferencesTable,
  type UserPreferencesRow,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { UpdateUserPreferencesBody } from "@workspace/api-zod";

const router: IRouter = Router();

const SINGLETON_ID = 1;

type ApiUserPreferences = {
  runTargetingMode: string;
  maxHr: number | null;
  restingHr: number | null;
  updatedAt: string;
};

function toApi(row: UserPreferencesRow): ApiUserPreferences {
  return {
    runTargetingMode: row.runTargetingMode,
    maxHr: row.maxHr,
    restingHr: row.restingHr,
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

export default router;
