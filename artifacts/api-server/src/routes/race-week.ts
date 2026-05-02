import { Router, type IRouter } from "express";
import { db, planDaysTable, raceWeekChecklistTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { SetRaceWeekChecklistItemBody } from "@workspace/api-zod";
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

const KNOWN_ITEM_IDS = new Set(RACE_WEEK_CHECKLIST_DEFAULTS.map((d) => d.itemId));

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
  const inWindow = dayDelta >= 0 && dayDelta <= WINDOW_DAYS;

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

  const stored = await db.select().from(raceWeekChecklistTable);
  const byId = new Map(stored.map((r) => [r.itemId, r] as const));
  const checklist = RACE_WEEK_CHECKLIST_DEFAULTS.map((d) => {
    const row = byId.get(d.itemId);
    return {
      itemId: d.itemId,
      label: d.label,
      checked: row?.checked ?? false,
      checkedAt: row?.checked && row.updatedAt ? row.updatedAt.toISOString() : null,
    };
  });

  res.json({
    raceDate,
    daysToRace,
    hoursToRace,
    inWindow,
    isRaceDay,
    racePlan,
    checklist,
  });
});

router.put("/race-week/checklist/:itemId", async (req, res): Promise<void> => {
  const itemId = req.params.itemId;
  if (!itemId || !KNOWN_ITEM_IDS.has(itemId)) {
    res.status(404).json({ error: "checklist item not found" });
    return;
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
    .values({ itemId, checked, updatedAt: now })
    .onConflictDoUpdate({
      target: raceWeekChecklistTable.itemId,
      set: { checked, updatedAt: now },
    })
    .returning();
  const row = upserted[0]!;
  const def = RACE_WEEK_CHECKLIST_DEFAULTS.find((d) => d.itemId === itemId)!;
  res.json({
    itemId: row.itemId,
    label: def.label,
    checked: row.checked,
    checkedAt: row.checked ? row.updatedAt.toISOString() : null,
  });
});

export default router;
