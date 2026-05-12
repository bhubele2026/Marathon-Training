import { Router, type IRouter } from "express";
import { db, scheduledRacesTable, raceResultsTable } from "@workspace/db";
import { desc, eq, inArray } from "drizzle-orm";
import {
  CreateScheduledRaceBody,
  UpdateScheduledRaceBody,
} from "@workspace/api-zod";
import { toScheduledRace } from "../lib/transforms";

const RACE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_KINDS = new Set(["marathon", "half", "10k", "5k"]);

const router: IRouter = Router();

async function loadHasResultMap(dates: string[]): Promise<Map<string, boolean>> {
  if (dates.length === 0) return new Map();
  const rows = await db
    .select({ raceDate: raceResultsTable.raceDate })
    .from(raceResultsTable)
    .where(inArray(raceResultsTable.raceDate, dates));
  const set = new Set(rows.map((r) => r.raceDate));
  const out = new Map<string, boolean>();
  for (const d of dates) out.set(d, set.has(d));
  return out;
}

router.get("/scheduled-races", async (_req, res) => {
  const rows = await db
    .select()
    .from(scheduledRacesTable)
    .orderBy(desc(scheduledRacesTable.raceDate));
  const hasResult = await loadHasResultMap(rows.map((r) => r.raceDate));
  res.json(rows.map((r) => toScheduledRace(r, hasResult.get(r.raceDate) ?? false)));
});

router.post("/scheduled-races", async (req, res): Promise<void> => {
  const parsed = CreateScheduledRaceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { raceDate, raceKind, name, notes } = parsed.data;
  if (!RACE_DATE_RE.test(raceDate)) {
    res.status(400).json({ error: "raceDate must be ISO yyyy-mm-dd" });
    return;
  }
  if (!VALID_KINDS.has(raceKind)) {
    res.status(400).json({ error: "invalid raceKind" });
    return;
  }
  const existing = (
    await db
      .select()
      .from(scheduledRacesTable)
      .where(eq(scheduledRacesTable.raceDate, raceDate))
      .limit(1)
  )[0];
  if (existing) {
    res
      .status(409)
      .json({ error: "a scheduled race already exists for this date" });
    return;
  }
  const inserted = await db
    .insert(scheduledRacesTable)
    .values({
      raceDate,
      raceKind,
      name: name ?? null,
      notes: notes ?? null,
    })
    .returning();
  const hasResult = await loadHasResultMap([raceDate]);
  res.json(toScheduledRace(inserted[0]!, hasResult.get(raceDate) ?? false));
});

router.patch("/scheduled-races/:raceDate", async (req, res): Promise<void> => {
  const raceDate = req.params.raceDate;
  if (!raceDate || !RACE_DATE_RE.test(raceDate)) {
    res.status(400).json({ error: "invalid raceDate" });
    return;
  }
  const parsed = UpdateScheduledRaceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const patch: Partial<typeof scheduledRacesTable.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (parsed.data.raceKind !== undefined) {
    if (!VALID_KINDS.has(parsed.data.raceKind)) {
      res.status(400).json({ error: "invalid raceKind" });
      return;
    }
    patch.raceKind = parsed.data.raceKind;
  }
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.notes !== undefined) patch.notes = parsed.data.notes;
  const updated = await db
    .update(scheduledRacesTable)
    .set(patch)
    .where(eq(scheduledRacesTable.raceDate, raceDate))
    .returning();
  if (!updated[0]) {
    res.status(404).json({ error: "scheduled race not found" });
    return;
  }
  const hasResult = await loadHasResultMap([raceDate]);
  res.json(toScheduledRace(updated[0], hasResult.get(raceDate) ?? false));
});

router.delete("/scheduled-races/:raceDate", async (req, res): Promise<void> => {
  const raceDate = req.params.raceDate;
  if (!raceDate || !RACE_DATE_RE.test(raceDate)) {
    res.status(400).json({ error: "invalid raceDate" });
    return;
  }
  await db
    .delete(scheduledRacesTable)
    .where(eq(scheduledRacesTable.raceDate, raceDate));
  res.status(204).send();
});

export default router;
