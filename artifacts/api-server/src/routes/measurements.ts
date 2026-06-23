import { Router, type IRouter } from "express";
import {
  db,
  measurementsTable,
  userPreferencesTable,
  type MeasurementRow,
} from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { CreateMeasurementBody, UpdateMeasurementBody } from "@workspace/api-zod";
import { toMeasurement } from "../lib/transforms";
import { navyBodyFatPct } from "../lib/body-fat";

const router: IRouter = Router();

// When the runner taped neck + waist (belly) this request but did NOT enter an
// explicit body-fat %, fill body_fat_pct from the US Navy formula using their
// height + sex from preferences. Rules that keep it predictable:
//   - an explicit body-fat % in the request always wins (e.g. a DEXA number);
//   - a request that didn't touch a tape site is left alone, so editing weight
//     or notes never recomputes / clobbers an existing value.
async function deriveBodyFat(
  row: MeasurementRow,
  explicitBf: boolean,
  touchedTape: boolean,
): Promise<MeasurementRow> {
  if (explicitBf || !touchedTape) return row;
  if (row.neck == null || row.belly == null) return row;
  const prefs = await db
    .select({ heightIn: userPreferencesTable.heightIn, sex: userPreferencesTable.sex })
    .from(userPreferencesTable)
    .where(eq(userPreferencesTable.id, 1))
    .limit(1);
  const pct = navyBodyFatPct({
    sex: prefs[0]?.sex ?? null,
    heightIn: prefs[0]?.heightIn ?? null,
    neckIn: row.neck,
    waistIn: row.belly,
  });
  if (pct == null) return row;
  const updated = await db
    .update(measurementsTable)
    .set({ bodyFatPct: pct })
    .where(eq(measurementsTable.id, row.id))
    .returning();
  return updated[0] ?? row;
}

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
    neck: d.neck ?? null,
    bodyFatPct: d.bodyFatPct ?? null,
    notes: d.notes ?? null,
  }).returning();
  const row = await deriveBodyFat(
    inserted[0]!,
    d.bodyFatPct != null,
    d.neck != null || d.belly != null,
  );
  res.status(201).json(toMeasurement(row));
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
  const row = await deriveBodyFat(
    updated[0],
    parsed.data.bodyFatPct != null,
    parsed.data.neck != null || parsed.data.belly != null,
  );
  res.json(toMeasurement(row));
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
