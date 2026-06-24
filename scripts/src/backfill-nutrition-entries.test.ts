import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  db,
  nutritionDaysTable,
  nutritionEntriesTable,
  waterLogsTable,
} from "@workspace/db";
import { backfillNutritionEntries } from "./backfill-nutrition-entries";

// Phase 13 backfill: migrate prior nutrition_days totals into the entries
// model. Uses a 2099 test-year date and cleans up around itself.
const D = "2099-07-15";

async function cleanup() {
  await db.delete(nutritionEntriesTable).where(eq(nutritionEntriesTable.date, D));
  await db.delete(waterLogsTable).where(eq(waterLogsTable.date, D));
  await db.delete(nutritionDaysTable).where(eq(nutritionDaysTable.date, D));
}

beforeEach(cleanup);
afterEach(cleanup);

describe("backfill-nutrition-entries", () => {
  it("migrates a nutrition_days row into a health_sync entry + water log, idempotently", async () => {
    await db
      .insert(nutritionDaysTable)
      .values({ date: D, calories: 1800, proteinG: 140, waterMl: 2000 });

    await backfillNutritionEntries();

    const entries = await db
      .select()
      .from(nutritionEntriesTable)
      .where(
        and(
          eq(nutritionEntriesTable.date, D),
          eq(nutritionEntriesTable.source, "health_sync"),
        ),
      );
    expect(entries).toHaveLength(1);
    expect(entries[0]!.calories).toBe(1800);
    expect(entries[0]!.proteinG).toBe(140);

    const waters = await db
      .select()
      .from(waterLogsTable)
      .where(eq(waterLogsTable.date, D));
    expect(waters).toHaveLength(1);
    expect(waters[0]!.oz).toBe(Math.round(2000 / 29.5735));

    // Re-run is a no-op (no duplicate entries / logs).
    await backfillNutritionEntries();
    const entries2 = await db
      .select()
      .from(nutritionEntriesTable)
      .where(eq(nutritionEntriesTable.date, D));
    expect(entries2).toHaveLength(1);
    const waters2 = await db
      .select()
      .from(waterLogsTable)
      .where(eq(waterLogsTable.date, D));
    expect(waters2).toHaveLength(1);
  });
});
