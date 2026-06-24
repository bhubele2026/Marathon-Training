import { Router, type IRouter } from "express";
import {
  db,
  waterLogsTable,
  userPreferencesTable,
  type WaterLogRow,
} from "@workspace/db";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import {
  CreateWaterLogBody,
  UpdateWaterLogBody,
  ListWaterLogsQueryParams,
} from "@workspace/api-zod";
import { localToday } from "../lib/day-state";
import { recomputeDay } from "../lib/nutrition-rollup";

// Phase 13 — timestamped water logs (fl oz). In-app writes are ungated
// (same-origin, single-user), matching measurements/workouts. Each write
// recomputes the nutrition_days rollup so water_ml stays in sync for the
// existing reads + the coach.
const router: IRouter = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_OZ = 1024; // ~30 L/day — far past any real intake; reject above.

async function localToday_(): Promise<string> {
  const rows = await db
    .select({ timezone: userPreferencesTable.timezone })
    .from(userPreferencesTable)
    .where(eq(userPreferencesTable.id, 1))
    .limit(1);
  return localToday(rows[0]?.timezone ?? null);
}

function isValidDate(d: string): boolean {
  return DATE_RE.test(d);
}

function toApi(row: WaterLogRow) {
  return {
    id: row.id,
    date: row.date,
    loggedAt: row.loggedAt.toISOString(),
    oz: row.oz,
    source: row.source as "manual" | "health_sync",
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// GET /api/water?date= | ?from=&to= — logs for a day or inclusive range,
// newest first; no params → most recent 200.
router.get("/water", async (req, res): Promise<void> => {
  const parsed = ListWaterLogsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { date, from, to } = parsed.data;
  const conds = [];
  if (date && isValidDate(date)) conds.push(eq(waterLogsTable.date, date));
  if (from && isValidDate(from)) conds.push(gte(waterLogsTable.date, from));
  if (to && isValidDate(to)) conds.push(lte(waterLogsTable.date, to));
  const rows = await db
    .select()
    .from(waterLogsTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(waterLogsTable.loggedAt))
    .limit(conds.length ? 1000 : 200);
  res.json(rows.map(toApi));
});

// POST /api/water — add a water log (a cup or custom oz). date/loggedAt default
// to the runner's local day / now.
router.post("/water", async (req, res): Promise<void> => {
  const parsed = CreateWaterLogBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  if (!Number.isFinite(d.oz) || d.oz < 0 || d.oz > MAX_OZ) {
    res.status(400).json({ error: `oz must be between 0 and ${MAX_OZ}.` });
    return;
  }
  const date = d.date && isValidDate(d.date) ? d.date : await localToday_();
  const [row] = await db
    .insert(waterLogsTable)
    .values({
      date,
      loggedAt: d.loggedAt ? new Date(d.loggedAt) : new Date(),
      oz: Math.round(d.oz),
      source: "manual",
    })
    .returning();
  await recomputeDay(date);
  res.status(201).json(toApi(row!));
});

// PATCH /api/water/:id — edit a log; recompute old + new day on a date change.
router.patch("/water/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "invalid id" });
    return;
  }
  const parsed = UpdateWaterLogBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const existing = await db
    .select()
    .from(waterLogsTable)
    .where(eq(waterLogsTable.id, id))
    .limit(1);
  if (!existing[0]) {
    res.status(404).json({ error: "not found" });
    return;
  }
  const d = parsed.data;
  const set: Partial<WaterLogRow> = { updatedAt: new Date() };
  if (d.oz !== undefined) {
    if (!Number.isFinite(d.oz) || d.oz < 0 || d.oz > MAX_OZ) {
      res.status(400).json({ error: `oz must be between 0 and ${MAX_OZ}.` });
      return;
    }
    set.oz = Math.round(d.oz);
  }
  if (d.date !== undefined && isValidDate(d.date)) set.date = d.date;
  if (d.loggedAt !== undefined) set.loggedAt = new Date(d.loggedAt);

  const [row] = await db
    .update(waterLogsTable)
    .set(set)
    .where(eq(waterLogsTable.id, id))
    .returning();
  await recomputeDay(existing[0].date);
  if (row && row.date !== existing[0].date) await recomputeDay(row.date);
  res.json(toApi(row!));
});

// DELETE /api/water/:id — remove a log, recompute its day.
router.delete("/water/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "invalid id" });
    return;
  }
  const [deleted] = await db
    .delete(waterLogsTable)
    .where(eq(waterLogsTable.id, id))
    .returning();
  if (deleted) await recomputeDay(deleted.date);
  res.status(204).send();
});

export default router;
