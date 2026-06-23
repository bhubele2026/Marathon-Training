import { Router, type IRouter } from "express";
import { db, measurementsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { CreateMeasurementBody, UpdateMeasurementBody } from "@workspace/api-zod";
import { toMeasurement } from "../lib/transforms";

const router: IRouter = Router();

router.get("/measurements", async (_req, res) => {
  const rows = await db.select().from(measurementsTable).orderBy(desc(measurementsTable.date));
  res.json(rows.map(toMeasurement));
});

router.post("/measurements", async (req, res): Promise<void> => {
  const parsed = CreateMeasurementBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const inserted = await db.insert(measurementsTable).values({
    date: d.date,
    weight: d.weight ?? null,
    lArm: d.lArm ?? null,
    rArm: d.rArm ?? null,
    lLeg: d.lLeg ?? null,
    rLeg: d.rLeg ?? null,
    belly: d.belly ?? null,
    chest: d.chest ?? null,
    bodyFatPct: d.bodyFatPct ?? null,
    notes: d.notes ?? null,
  }).returning();
  res.status(201).json(toMeasurement(inserted[0]!));
});

router.patch("/measurements/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "invalid id" });
    return;
  }
  const parsed = UpdateMeasurementBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const updated = await db.update(measurementsTable).set(parsed.data).where(eq(measurementsTable.id, id)).returning();
  if (!updated[0]) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json(toMeasurement(updated[0]));
});

router.delete("/measurements/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "invalid id" });
    return;
  }
  await db.delete(measurementsTable).where(eq(measurementsTable.id, id));
  res.status(204).send();
});

export default router;
