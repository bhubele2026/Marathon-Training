import { Router, type IRouter } from "express";
import { db, workoutsTable } from "@workspace/db";
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { CreateWorkoutBody, UpdateWorkoutBody, ListWorkoutsQueryParams } from "@workspace/api-zod";
import { toWorkout } from "../lib/transforms";

const router: IRouter = Router();

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
    .orderBy(desc(workoutsTable.date), desc(workoutsTable.createdAt))
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
  const inserted = await db.insert(workoutsTable).values({
    planDayId: d.planDayId ?? null,
    date: d.date,
    equipment: d.equipment,
    sessionType: d.sessionType,
    durationMin: d.durationMin ?? null,
    distanceMi: d.distanceMi ?? null,
    pace: d.pace ?? null,
    avgHr: d.avgHr ?? null,
    rpe: d.rpe ?? null,
    strengthLoad: d.strengthLoad ?? null,
    totalLoad: d.totalLoad ?? null,
    notes: d.notes ?? null,
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
  const updated = await db.update(workoutsTable).set(parsed.data).where(eq(workoutsTable.id, id)).returning();
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
