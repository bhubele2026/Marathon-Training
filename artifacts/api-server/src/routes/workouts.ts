import { Router, type IRouter } from "express";
import { db, workoutsTable } from "@workspace/db";
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { CreateWorkoutBody, UpdateWorkoutBody, ListWorkoutsQueryParams } from "@workspace/api-zod";
import { LIFESTYLE_EQUIPMENT } from "@workspace/plan-generator";
import { toWorkout } from "../lib/transforms";

const router: IRouter = Router();

// Canonical chip-rail priority enforced server-side so every client
// (UI, scripts, third-party) persists the same order. The lead chip is
// also the scalar `equipment` for back-compat readers.
const CANONICAL_EQUIPMENT_PRIORITY = [
  "Tonal",
  "Peloton Bike",
  "Peloton Row",
  "Peloton Tread",
  "Outdoor",
  LIFESTYLE_EQUIPMENT,
  "None",
] as const;

const EQUIPMENT_RANK = new Map<string, number>(
  CANONICAL_EQUIPMENT_PRIORITY.map((name, idx) => [name, idx]),
);

function sortEquipmentByCanonicalPriority(values: string[]): string[] {
  return [...values].sort((a, b) => {
    const ra = EQUIPMENT_RANK.get(a) ?? Number.MAX_SAFE_INTEGER;
    const rb = EQUIPMENT_RANK.get(b) ?? Number.MAX_SAFE_INTEGER;
    return ra - rb;
  });
}

// Reconcile (equipment, equipmentList) so the lead chip and the legacy
// scalar can't disagree, and so the rail is always persisted in canonical
// priority order regardless of client. Returns `null` for inconsistent
// input (caller rejects with 400). Empty `{}` means "patch touches neither".
function resolveEquipment(
  body: { equipment?: string; equipmentList?: string[] | null | undefined },
): { equipment?: string; equipmentList?: string[] } | null {
  const list = body.equipmentList;
  const scalar = body.equipment;
  if (list != null) {
    if (list.length === 0) return null;
    const sorted = sortEquipmentByCanonicalPriority(list);
    const lead = sorted[0]!;
    if (scalar != null && scalar !== lead) return null;
    return { equipment: lead, equipmentList: sorted };
  }
  if (scalar != null) {
    return { equipment: scalar, equipmentList: [scalar] };
  }
  return {};
}

router.get("/workouts", async (req, res): Promise<void> => {
  const parsed = ListWorkoutsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { limit, from, to, equipment } = parsed.data;
  const conditions = [];
  if (from) conditions.push(gte(workoutsTable.date, from));
  if (to) conditions.push(lte(workoutsTable.date, to));
  if (equipment) conditions.push(eq(workoutsTable.equipment, equipment));
  const rows = await db
    .select()
    .from(workoutsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(
      desc(workoutsTable.date),
      // Within a single day, surface AM tags before PM, then Other, then
      // untagged. Falls back to createdAt desc so the newest log wins ties.
      sql`CASE ${workoutsTable.timeOfDay}
        WHEN 'AM' THEN 0
        WHEN 'PM' THEN 1
        WHEN 'Other' THEN 2
        ELSE 3
      END`,
      desc(workoutsTable.createdAt),
    )
    .limit(limit ?? 500);
  res.json(rows.map(toWorkout));
});

router.post("/workouts", async (req, res): Promise<void> => {
  const parsed = CreateWorkoutBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const equip = resolveEquipment(d);
  if (equip == null) {
    res.status(400).json({
      error: "equipmentList must be non-empty and equipmentList[0] must equal equipment when both are provided",
    });
    return;
  }
  const inserted = await db.insert(workoutsTable).values({
    planDayId: d.planDayId ?? null,
    date: d.date,
    equipment: equip.equipment ?? d.equipment,
    equipmentList: equip.equipmentList ?? [d.equipment],
    sessionType: d.sessionType,
    durationMin: d.durationMin ?? null,
    // Per-bucket actual minutes (Task #76). Nullable so existing
    // duration-only logging flows still work; the form / Crushed-It
    // shortcut populate these alongside `durationMin` when a plan day
    // breakdown is available.
    strengthMin: d.strengthMin ?? null,
    cardioMin: d.cardioMin ?? null,
    runMin: d.runMin ?? null,
    distanceMi: d.distanceMi ?? null,
    pace: d.pace ?? null,
    avgHr: d.avgHr ?? null,
    rpe: d.rpe ?? null,
    strengthLoad: d.strengthLoad ?? null,
    totalLoad: d.totalLoad ?? null,
    notes: d.notes ?? null,
    timeOfDay: d.timeOfDay ?? null,
    modality: d.modality ?? null,
  }).returning();
  res.status(201).json(toWorkout(inserted[0]!));
});

router.patch("/workouts/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "invalid id" });
    return;
  }
  const parsed = UpdateWorkoutBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const equip = resolveEquipment(parsed.data);
  if (equip == null) {
    res.status(400).json({
      error: "equipmentList must be non-empty and equipmentList[0] must equal equipment when both are provided",
    });
    return;
  }
  const patch: Record<string, unknown> = { ...parsed.data };
  if (equip.equipment != null) {
    patch.equipment = equip.equipment;
  }
  if (equip.equipmentList != null) {
    patch.equipmentList = equip.equipmentList;
  } else {
    // An explicit `equipmentList: null` from the client is treated as
    // "not provided" rather than "clear the rail", so a subsequent PATCH
    // that only touches unrelated fields can never erase a previously
    // multi-machine rail.
    delete patch.equipmentList;
  }
  const updated = await db.update(workoutsTable).set(patch).where(eq(workoutsTable.id, id)).returning();
  if (!updated[0]) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json(toWorkout(updated[0]));
});

router.delete("/workouts/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "invalid id" });
    return;
  }
  await db.delete(workoutsTable).where(eq(workoutsTable.id, id));
  res.status(204).send();
});

export default router;
