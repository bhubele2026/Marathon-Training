import { Router, type IRouter } from "express";
import {
  db,
  planDaysTable,
  raceWeekChecklistTable,
  raceResultsTable,
  scheduledRacesTable,
} from "@workspace/db";
import { eq, asc, desc, ne, and, inArray } from "drizzle-orm";
import {
  SetRaceWeekChecklistItemBody,
  CreateRaceWeekChecklistItemBody,
  SetRaceResultBody,
} from "@workspace/api-zod";
import { randomUUID } from "node:crypto";
import { detectRaceKind, type RaceDayKind } from "@workspace/plan-generator";
import { readActiveRaceDate } from "./planner";
import { toRaceResult, type RaceResultExtras } from "../lib/transforms";
import type { RaceResultRow } from "@workspace/db";

const RACE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

// Task #265. Parse a free-form finish-time string ("H:MM:SS",
// "MM:SS", or with optional fractional seconds) into total seconds.
// Returns null when the string can't be confidently parsed so the PR
// comparison silently falls back to "no comparison" rather than
// surfacing a wildly wrong delta.
export function parseFinishTimeToSeconds(value: string | null | undefined): number | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Accept H:MM:SS, MM:SS, or SS (with optional .frac on the seconds).
  const parts = trimmed.split(":").map((p) => p.trim());
  if (parts.length < 1 || parts.length > 3) return null;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) return null;
  let h = 0,
    m = 0,
    s = 0;
  if (parts.length === 3) {
    [h, m, s] = nums as [number, number, number];
  } else if (parts.length === 2) {
    [m, s] = nums as [number, number];
  } else {
    [s] = nums as [number];
  }
  if (m >= 60 || s >= 60) return null;
  const total = h * 3600 + m * 60 + s;
  if (total <= 0) return null;
  return Math.round(total);
}

// Task #265. Format a signed second-delta back into a "−1:43" / "+0:08"
// style string for the PR comparison line. Hours-level deltas wrap to
// "H:MM:SS" so a marathon that beats the prior best by 11 minutes
// still reads cleanly.
export function formatSignedDelta(deltaSeconds: number): string {
  const sign = deltaSeconds < 0 ? "−" : deltaSeconds > 0 ? "+" : "±";
  const abs = Math.abs(deltaSeconds);
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = abs % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${sign}${h}:${mm}:${ss}` : `${sign}${mm}:${ss}`;
}

// Task #265. Look up the active race-day plan_day at `raceDate` and
// classify it via the shared `detectRaceKind` helper so the captured
// race kind matches the rest of the app (dashboard banner, week
// detail, etc). Falls back to null when the plan_day is missing or
// the row isn't recognised as a real race day.
async function detectRaceKindForDate(raceDate: string): Promise<RaceDayKind | null> {
  const planRow = (
    await db.select().from(planDaysTable).where(eq(planDaysTable.date, raceDate)).limit(1)
  )[0];
  if (!planRow) return null;
  return detectRaceKind(planRow.distanceMi, planRow.description, planRow.sessionType);
}

// Task #345. Resolve the captured `race_kind` for an arbitrary
// `raceDate` upsert. Prefers an explicit scheduled_races row (set by
// the runner when they put the supplemental race on the calendar),
// then falls back to the plan_days race-day classifier so logging the
// active campaign A-race still works without a corresponding
// scheduled_races row.
async function resolveRaceKindForUpsert(raceDate: string): Promise<RaceDayKind | null> {
  const sched = (
    await db
      .select({ raceKind: scheduledRacesTable.raceKind })
      .from(scheduledRacesTable)
      .where(eq(scheduledRacesTable.raceDate, raceDate))
      .limit(1)
  )[0];
  if (sched && sched.raceKind) {
    const k = sched.raceKind;
    if (k === "marathon" || k === "half" || k === "10k" || k === "5k") {
      return k;
    }
  }
  return detectRaceKindForDate(raceDate);
}

// Task #265. Compute the previous-best comparison for `current`. We
// scan every other `race_results` row sharing the same `raceKind`
// (excluding `current.raceDate`), pick the one with the lowest
// parseable finish time, and return both the absolute prior best and
// the signed second-delta. Returns the empty result when no prior row
// of the same kind exists, when the current row has no parseable
// finish time, or when no prior row has a parseable finish time.
async function computeRaceResultExtras(current: RaceResultRow): Promise<RaceResultExtras> {
  const empty: RaceResultExtras = { previousBest: null, isPersonalRecord: false };
  if (!current.raceKind) return empty;
  const currentSeconds = parseFinishTimeToSeconds(current.finishTime);
  if (currentSeconds == null) return empty;

  const peers = await db
    .select()
    .from(raceResultsTable)
    .where(
      and(
        eq(raceResultsTable.raceKind, current.raceKind),
        ne(raceResultsTable.raceDate, current.raceDate),
      ),
    );

  let best: { row: RaceResultRow; seconds: number } | null = null;
  for (const peer of peers) {
    const peerSeconds = parseFinishTimeToSeconds(peer.finishTime);
    if (peerSeconds == null) continue;
    if (best == null || peerSeconds < best.seconds) {
      best = { row: peer, seconds: peerSeconds };
    }
  }
  if (best == null) return empty;
  return {
    previousBest: {
      raceDate: best.row.raceDate,
      finishTime: best.row.finishTime ?? "",
      deltaSeconds: currentSeconds - best.seconds,
    },
    isPersonalRecord: currentSeconds < best.seconds,
  };
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

  // Task #40: surface any logged race result so the post-race banner can
  // switch between the empty "Log your race" form and a saved-result
  // summary. Only emitted once the race has actually passed; pre-race
  // and race-day responses leave `raceResult` null even if a result row
  // exists from a prior campaign at the same date (defensive — should
  // not happen in practice because Full Reset wipes race_results too).
  let raceResult = null as ReturnType<typeof toRaceResult> | null;
  if (racePassed) {
    const resultRow = (
      await db
        .select()
        .from(raceResultsTable)
        .where(eq(raceResultsTable.raceDate, raceDate))
        .limit(1)
    )[0];
    if (resultRow) {
      const extras = await computeRaceResultExtras(resultRow);
      raceResult = toRaceResult(resultRow, extras);
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
  // Task #39: surface the unchecked count so the dashboard header and
  // Today page can render a compact reminder badge without
  // recomputing it client-side.
  const uncheckedCount = checklist.filter((c) => !c.checked).length;

  res.json({
    raceDate,
    daysToRace,
    hoursToRace,
    inWindow,
    isRaceDay,
    racePassed,
    daysAfterRace,
    racePlan,
    raceResult,
    checklist,
    uncheckedCount,
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

// Task #266. List every persisted race result, newest first, with a
// best-effort `raceKind` derived from the matching plan_days row on the
// same date. Backs the dedicated /races history page so runners can
// revisit prior campaigns long after the post-race banner has expired.
router.get("/race-results", async (_req, res) => {
  const rows = await db
    .select()
    .from(raceResultsTable)
    .orderBy(desc(raceResultsTable.raceDate));
  if (rows.length === 0) {
    res.json([]);
    return;
  }
  const dates = rows.map((r) => r.raceDate);
  const planRows = await db
    .select({
      date: planDaysTable.date,
      distanceMi: planDaysTable.distanceMi,
      description: planDaysTable.description,
      sessionType: planDaysTable.sessionType,
    })
    .from(planDaysTable)
    .where(inArray(planDaysTable.date, dates));
  const kindByDate = new Map<string, RaceDayKind | null>();
  for (const p of planRows) {
    kindByDate.set(
      p.date,
      detectRaceKind(p.distanceMi, p.description, p.sessionType),
    );
  }
  res.json(
    rows.map((r) => toRaceResult(r, { raceKind: kindByDate.get(r.raceDate) ?? null })),
  );
});

// Task #345. Upsert a race result by its primary key so the /races
// and /today "Log result" CTAs can write a finish for any scheduled
// supplemental race date (not just the active campaign A-race that
// PUT /race-week/result targets). Captures `raceKind` from the
// matching scheduled_races row when one exists, falling back to the
// plan_days classifier.
router.put("/race-results/:raceDate", async (req, res): Promise<void> => {
  const raceDate = req.params.raceDate;
  if (!raceDate || !RACE_DATE_RE.test(raceDate)) {
    res.status(400).json({ error: "invalid raceDate" });
    return;
  }
  const parsed = SetRaceResultBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const isPositiveIntOrNullish = (v: number | null | undefined) =>
    v == null || (Number.isInteger(v) && v >= 1);
  if (
    !isPositiveIntOrNullish(parsed.data.placementOverall) ||
    !isPositiveIntOrNullish(parsed.data.placementTotal)
  ) {
    res.status(400).json({
      error: "placementOverall and placementTotal must be positive integers",
    });
    return;
  }
  const now = new Date();
  const detectedKind = await resolveRaceKindForUpsert(raceDate);
  const values = {
    raceDate,
    finishTime: parsed.data.finishTime ?? null,
    placementOverall: parsed.data.placementOverall ?? null,
    placementTotal: parsed.data.placementTotal ?? null,
    feltRating: parsed.data.feltRating ?? null,
    notes: parsed.data.notes ?? null,
    raceKind: detectedKind,
    updatedAt: now,
  };
  const upserted = await db
    .insert(raceResultsTable)
    .values({ ...values, recordedAt: now })
    .onConflictDoUpdate({
      target: raceResultsTable.raceDate,
      set: values,
    })
    .returning();
  const row = upserted[0]!;
  const extras = await computeRaceResultExtras(row);
  res.json(toRaceResult(row, extras));
});

// Task #266. Edit a stored race result by its primary key. Reuses
// SetRaceResultBody so the same edit form drives both the post-race
// banner and the history page.
router.patch("/race-results/:raceDate", async (req, res): Promise<void> => {
  const raceDate = req.params.raceDate;
  if (!raceDate || !RACE_DATE_RE.test(raceDate)) {
    res.status(400).json({ error: "invalid raceDate" });
    return;
  }
  const parsed = SetRaceResultBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const isPositiveIntOrNullish = (v: number | null | undefined) =>
    v == null || (Number.isInteger(v) && v >= 1);
  if (
    !isPositiveIntOrNullish(parsed.data.placementOverall) ||
    !isPositiveIntOrNullish(parsed.data.placementTotal)
  ) {
    res.status(400).json({
      error: "placementOverall and placementTotal must be positive integers",
    });
    return;
  }
  const now = new Date();
  const updated = await db
    .update(raceResultsTable)
    .set({
      finishTime: parsed.data.finishTime ?? null,
      placementOverall: parsed.data.placementOverall ?? null,
      placementTotal: parsed.data.placementTotal ?? null,
      feltRating: parsed.data.feltRating ?? null,
      notes: parsed.data.notes ?? null,
      updatedAt: now,
    })
    .where(eq(raceResultsTable.raceDate, raceDate))
    .returning();
  if (!updated[0]) {
    res.status(404).json({ error: "race result not found" });
    return;
  }
  res.json(toRaceResult(updated[0]));
});

// Task #266. Delete a stored race result so runners can clean up
// stale entries (test rows, campaigns they never actually ran).
router.delete("/race-results/:raceDate", async (req, res): Promise<void> => {
  const raceDate = req.params.raceDate;
  if (!raceDate || !RACE_DATE_RE.test(raceDate)) {
    res.status(400).json({ error: "invalid raceDate" });
    return;
  }
  await db.delete(raceResultsTable).where(eq(raceResultsTable.raceDate, raceDate));
  res.status(204).send();
});

router.put("/race-week/result", async (req, res): Promise<void> => {
  const parsed = SetRaceResultBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  // Orval generates `.number().min(1)` for OpenAPI `type: integer` —
  // not `.int()` — so we belt-and-suspenders the integer constraint
  // on the placement fields here. Decimals like 312.5 would otherwise
  // round-trip through to the DB and produce off-by-half placements.
  const isPositiveIntOrNullish = (v: number | null | undefined) =>
    v == null || (Number.isInteger(v) && v >= 1);
  if (
    !isPositiveIntOrNullish(parsed.data.placementOverall) ||
    !isPositiveIntOrNullish(parsed.data.placementTotal)
  ) {
    res.status(400).json({
      error: "placementOverall and placementTotal must be positive integers",
    });
    return;
  }
  const raceDate = await readActiveRaceDate();
  const now = new Date();
  // Task #265. Capture the race kind at write time from the active
  // plan_day so PR comparisons across past campaigns survive Phase
  // Planner re-applies (which wipe plan_days but leave race_results
  // intact). Falls back to null when the plan_day is missing or
  // unrecognised — the comparison silently skips those rows.
  const detectedKind = await detectRaceKindForDate(raceDate);
  const values = {
    raceDate,
    finishTime: parsed.data.finishTime ?? null,
    placementOverall: parsed.data.placementOverall ?? null,
    placementTotal: parsed.data.placementTotal ?? null,
    feltRating: parsed.data.feltRating ?? null,
    notes: parsed.data.notes ?? null,
    raceKind: detectedKind,
    updatedAt: now,
  };
  const upserted = await db
    .insert(raceResultsTable)
    .values({ ...values, recordedAt: now })
    .onConflictDoUpdate({
      target: raceResultsTable.raceDate,
      // recordedAt is preserved on update so the original capture
      // timestamp survives subsequent edits — only updatedAt moves.
      set: values,
    })
    .returning();
  const row = upserted[0]!;
  const extras = await computeRaceResultExtras(row);
  res.json(toRaceResult(row, extras));
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
