import { Router, type IRouter } from "express";
import { db, planDaysTable, raceWeekChecklistTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import {
  SetRaceWeekChecklistItemBody,
  CreateRaceWeekChecklistItemBody,
} from "@workspace/api-zod";
import { randomUUID } from "node:crypto";
import { readActiveRaceDate } from "./planner";

const router: IRouter = Router();

const WINDOW_DAYS = 21;

export const RACE_WEEK_CHECKLIST_DEFAULTS: ReadonlyArray<{ itemId: string; label: string }> = [
  { itemId: "ease-volume", label: "Ease back on volume — short, easy efforts only" },
  { itemId: "hydrate", label: "Hydrate consistently throughout each day" },
  { itemId: "lay-out-kit", label: "Lay out race kit, shoes, socks, hat" },
  { itemId: "set-alarms", label: "Set race-morning alarms (and a backup)" },
  { itemId: "plan-transport", label: "Plan transport / parking to the start line" },
  { itemId: "confirm-fuel", label: "Confirm fueling plan and stock gels" },
  { itemId: "shakeout", label: "Easy shakeout run the day before" },
  { itemId: "charge-watch", label: "Charge GPS watch and pacing devices" },
  { itemId: "pin-bib", label: "Pin bib to race kit before bed" },
];

const KNOWN_DEFAULT_ITEM_IDS = new Set(RACE_WEEK_CHECKLIST_DEFAULTS.map((d) => d.itemId));
const DEFAULT_LABEL_BY_ID = new Map(
  RACE_WEEK_CHECKLIST_DEFAULTS.map((d) => [d.itemId, d.label] as const),
);

const CUSTOM_ITEM_PREFIX = "custom-";

function todayUtcMidnight(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function extractFuelingNote(description: string | null | undefined): string | null {
  if (!description) return null;
  const match = description.match(/fuel[^.]*?\bevery\b[^.]*/i);
  return match ? match[0].trim() : null;
}

router.get("/race-week", async (_req, res) => {
  // Anchor race-week math on the runner's APPLIED marathon date so the
  // status, race-day plan lookup, and checklist all follow the active plan.
  const raceDate = await readActiveRaceDate();
  const raceStart = new Date(`${raceDate}T00:00:00.000Z`);
  const today = todayUtcMidnight();
  const msPerDay = 24 * 3600 * 1000;
  const daysToRace = Math.max(0, Math.ceil((raceStart.getTime() - Date.now()) / msPerDay));
  const hoursToRace = Math.max(0, Math.ceil((raceStart.getTime() - Date.now()) / (3600 * 1000)));
  const dayDelta = Math.round((raceStart.getTime() - today.getTime()) / msPerDay);
  const isRaceDay = dayDelta === 0;
  const racePassed = dayDelta < 0;
  const daysAfterRace = racePassed ? Math.abs(dayDelta) : null;
  const inWindow = (dayDelta >= 0 && dayDelta <= WINDOW_DAYS) || (racePassed && Math.abs(dayDelta) <= 14);

  // Pull race-day plan row to summarize race plan when in the window.
  let racePlan: {
    distanceMi: number;
    targetPace: string | null;
    fuelingNote: string | null;
    description: string;
  } | null = null;
  if (inWindow) {
    const planRow = (
      await db.select().from(planDaysTable).where(eq(planDaysTable.date, raceDate)).limit(1)
    )[0];
    if (planRow && planRow.distanceMi != null) {
      racePlan = {
        distanceMi: planRow.distanceMi,
        targetPace: planRow.pace,
        fuelingNote: extractFuelingNote(planRow.description),
        description: planRow.description,
      };
    }
  }

  // Order by `created_at` so custom items keep a stable display order
  // independent of toggling (toggles bump `updated_at`, which would
  // otherwise shuffle the list every time a runner ticks an item).
  const stored = await db
    .select()
    .from(raceWeekChecklistTable)
    .orderBy(asc(raceWeekChecklistTable.createdAt));
  const byId = new Map(stored.map((r) => [r.itemId, r] as const));
  const defaults = RACE_WEEK_CHECKLIST_DEFAULTS.map((d) => {
    const row = byId.get(d.itemId);
    return {
      itemId: d.itemId,
      label: d.label,
      checked: row?.checked ?? false,
      checkedAt: row?.checked && row.updatedAt ? row.updatedAt.toISOString() : null,
      isCustom: false,
    };
  });
  const customs = stored
    .filter((r) => r.isCustom)
    .map((r) => ({
      itemId: r.itemId,
      label: r.label ?? "(unnamed)",
      checked: r.checked,
      checkedAt: r.checked && r.updatedAt ? r.updatedAt.toISOString() : null,
      isCustom: true,
    }));
  const checklist = [...defaults, ...customs];

  res.json({
    raceDate,
    daysToRace,
    hoursToRace,
    inWindow,
    isRaceDay,
    racePassed,
    daysAfterRace,
    racePlan,
    checklist,
  });
});

router.post("/race-week/checklist", async (req, res): Promise<void> => {
  const parsed = CreateRaceWeekChecklistItemBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const label = parsed.data.label.trim();
  if (label.length === 0) {
    res.status(400).json({ error: "label cannot be empty" });
    return;
  }
  const itemId = `${CUSTOM_ITEM_PREFIX}${randomUUID()}`;
  const now = new Date();
  const inserted = await db
    .insert(raceWeekChecklistTable)
    .values({ itemId, checked: false, isCustom: true, label, createdAt: now, updatedAt: now })
    .returning();
  const row = inserted[0]!;
  res.json({
    itemId: row.itemId,
    label: row.label ?? label,
    checked: row.checked,
    checkedAt: null,
    isCustom: true,
  });
});

router.put("/race-week/checklist/:itemId", async (req, res): Promise<void> => {
  const itemId = req.params.itemId;
  if (!itemId) {
    res.status(404).json({ error: "checklist item not found" });
    return;
  }
  const isDefault = KNOWN_DEFAULT_ITEM_IDS.has(itemId);
  let existing: typeof raceWeekChecklistTable.$inferSelect | undefined;
  if (!isDefault) {
    existing = (
      await db
        .select()
        .from(raceWeekChecklistTable)
        .where(eq(raceWeekChecklistTable.itemId, itemId))
        .limit(1)
    )[0];
    if (!existing) {
      res.status(404).json({ error: "checklist item not found" });
      return;
    }
  }
  const parsed = SetRaceWeekChecklistItemBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { checked } = parsed.data;
  const now = new Date();
  const upserted = await db
    .insert(raceWeekChecklistTable)
    .values({
      itemId,
      checked,
      isCustom: existing?.isCustom ?? false,
      label: existing?.label ?? null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: raceWeekChecklistTable.itemId,
      set: { checked, updatedAt: now },
    })
    .returning();
  const row = upserted[0]!;
  const label = row.isCustom
    ? row.label ?? "(unnamed)"
    : DEFAULT_LABEL_BY_ID.get(itemId) ?? "";
  res.json({
    itemId: row.itemId,
    label,
    checked: row.checked,
    checkedAt: row.checked ? row.updatedAt.toISOString() : null,
    isCustom: row.isCustom,
  });
});

router.delete("/race-week/checklist/:itemId", async (req, res): Promise<void> => {
  const itemId = req.params.itemId;
  if (!itemId) {
    res.status(404).json({ error: "checklist item not found" });
    return;
  }
  if (KNOWN_DEFAULT_ITEM_IDS.has(itemId)) {
    res.status(400).json({ error: "default checklist items cannot be deleted" });
    return;
  }
  const existing = (
    await db
      .select()
      .from(raceWeekChecklistTable)
      .where(eq(raceWeekChecklistTable.itemId, itemId))
      .limit(1)
  )[0];
  if (!existing) {
    res.status(404).json({ error: "checklist item not found" });
    return;
  }
  if (!existing.isCustom) {
    res.status(400).json({ error: "default checklist items cannot be deleted" });
    return;
  }
  await db.delete(raceWeekChecklistTable).where(eq(raceWeekChecklistTable.itemId, itemId));
  res.json({ itemId, deleted: true });
});

export default router;
