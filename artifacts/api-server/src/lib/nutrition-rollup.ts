// Phase 13 — derived rollup + sync reconciliation.
//
// `nutrition_entries` + `water_logs` are the source of truth; `nutrition_days`
// is a CACHE (one row per date = the sum of that date's entries/logs) so every
// existing read path (GET /nutrition/today, /recent, the day-target's
// readActualIntake, the nutritionist gather) keeps working unchanged. Call
// `recomputeDay(date)` after every entry/water write.

import {
  db,
  nutritionDaysTable,
  nutritionEntriesTable,
  waterLogsTable,
  type NutritionEntryRow,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";

export const ML_PER_FL_OZ = 29.5735;

type MacroKey = "calories" | "proteinG" | "carbsG" | "fatG" | "sodiumMg";
const MACRO_KEYS: MacroKey[] = ["calories", "proteinG", "carbsG", "fatG", "sodiumMg"];

// Sum a macro across entries. Returns null when NO entry carries it, preserving
// the "null = not tracked" semantics nutrition_days has always used (so a
// protein-only history stays calories=null rather than collapsing to 0).
function sumMacro(rows: NutritionEntryRow[], key: MacroKey): number | null {
  let any = false;
  let total = 0;
  for (const r of rows) {
    const v = r[key];
    if (v != null) {
      any = true;
      total += v;
    }
  }
  return any ? total : null;
}

// Recompute and upsert the nutrition_days cache row for `date` from its entries
// + water logs. Never touches closed_at (open/closed state is a day property,
// independent of intake).
export async function recomputeDay(date: string): Promise<void> {
  const entries = await db
    .select()
    .from(nutritionEntriesTable)
    .where(eq(nutritionEntriesTable.date, date));
  const waters = await db
    .select()
    .from(waterLogsTable)
    .where(eq(waterLogsTable.date, date));

  const calories = sumMacro(entries, "calories");
  const proteinG = sumMacro(entries, "proteinG");
  const carbsG = sumMacro(entries, "carbsG");
  const fatG = sumMacro(entries, "fatG");
  const sodiumMg = sumMacro(entries, "sodiumMg");
  const waterMl =
    waters.length > 0
      ? Math.round(waters.reduce((s, w) => s + (w.oz ?? 0), 0) * ML_PER_FL_OZ)
      : null;

  await db
    .insert(nutritionDaysTable)
    .values({ date, calories, proteinG, carbsG, fatG, sodiumMg, waterMl })
    .onConflictDoUpdate({
      target: nutritionDaysTable.date,
      set: { calories, proteinG, carbsG, fatG, sodiumMg, waterMl, updatedAt: new Date() },
    });
}

// Reconcile the Apple-Shortcut push into a SINGLE health_sync entry per day.
// Re-pushing a day MERGES the newly-sent fields over the prior sync entry (so a
// protein-only re-push doesn't wipe the calories synced earlier) and leaves the
// one health_sync row in place — never duplicating, never double-counting
// against the runner's manual entries. `provided` carries only the fields the
// push actually sent (undefined = not sent → keep prior).
export async function upsertHealthSyncEntry(
  date: string,
  provided: Partial<Record<MacroKey, number>>,
): Promise<void> {
  const existing = await db
    .select()
    .from(nutritionEntriesTable)
    .where(
      and(
        eq(nutritionEntriesTable.date, date),
        eq(nutritionEntriesTable.source, "health_sync"),
      ),
    )
    .limit(1);

  const merged: Record<MacroKey, number | null> = {
    calories: null,
    proteinG: null,
    carbsG: null,
    fatG: null,
    sodiumMg: null,
  };
  const prior = existing[0];
  for (const k of MACRO_KEYS) {
    merged[k] = provided[k] ?? prior?.[k] ?? null;
  }

  if (prior) {
    await db
      .update(nutritionEntriesTable)
      .set({ ...merged, loggedAt: new Date(), updatedAt: new Date() })
      .where(eq(nutritionEntriesTable.id, prior.id));
  } else {
    await db.insert(nutritionEntriesTable).values({
      date,
      label: "Apple Health sync",
      source: "health_sync",
      ...merged,
    });
  }
}

// Reconcile the push's water into a single health_sync water log per day
// (replaced on re-push). `ml` is the day's synced water in millilitres.
export async function upsertHealthSyncWater(date: string, ml: number): Promise<void> {
  const oz = Math.round(ml / ML_PER_FL_OZ);
  const existing = await db
    .select()
    .from(waterLogsTable)
    .where(and(eq(waterLogsTable.date, date), eq(waterLogsTable.source, "health_sync")))
    .limit(1);
  if (existing[0]) {
    await db
      .update(waterLogsTable)
      .set({ oz, loggedAt: new Date(), updatedAt: new Date() })
      .where(eq(waterLogsTable.id, existing[0].id));
  } else {
    await db.insert(waterLogsTable).values({ date, oz, source: "health_sync" });
  }
}
