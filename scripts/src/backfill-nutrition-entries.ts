// Phase 13 one-time, idempotent, NON-DESTRUCTIVE backfill.
//
// Before Phase 13, daily intake lived as totals on `nutrition_days` (pushed by
// the Apple Shortcut). Phase 13 makes `nutrition_entries` + `water_logs` the
// source of truth and `nutrition_days` a derived rollup. To make all prior
// history visible as (synced) entries, this inserts ONE `health_sync`
// nutrition_entry per existing nutrition_days row — carrying that day's totals
// at loggedAt = noon of that date — plus one `health_sync` water_log when the
// day has water. The nutrition_days totals already match these, so no recompute
// is needed and the cache stays correct.
//
// Idempotent: a day that already has a health_sync entry is skipped, so this is
// safe to re-run on every merge AND every deploy (run-backfills.sh).
//
// DRY RUN: set DRY_RUN=1 to report what WOULD be inserted without writing.

import { and, eq } from "drizzle-orm";
import {
  db,
  nutritionDaysTable,
  nutritionEntriesTable,
  waterLogsTable,
} from "@workspace/db";

const DRY_RUN = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";
const ML_PER_FL_OZ = 29.5735;

async function main(): Promise<void> {
  const days = await db.select().from(nutritionDaysTable);
  let entriesInserted = 0;
  let watersInserted = 0;
  let skipped = 0;

  for (const day of days) {
    const existing = await db
      .select({ id: nutritionEntriesTable.id })
      .from(nutritionEntriesTable)
      .where(
        and(
          eq(nutritionEntriesTable.date, day.date),
          eq(nutritionEntriesTable.source, "health_sync"),
        ),
      )
      .limit(1);
    if (existing[0]) {
      skipped++;
      continue;
    }

    const hasMacro =
      day.calories != null ||
      day.proteinG != null ||
      day.carbsG != null ||
      day.fatG != null ||
      day.sodiumMg != null;
    const loggedAt = new Date(`${day.date}T12:00:00.000Z`);

    if (DRY_RUN) {
      console.log(
        `[dry-run] ${day.date}: ${hasMacro ? "entry" : "no-macro"}${day.waterMl != null ? " + water" : ""}`,
      );
    } else {
      if (hasMacro) {
        await db.insert(nutritionEntriesTable).values({
          date: day.date,
          loggedAt,
          label: "Apple Health sync",
          source: "health_sync",
          calories: day.calories,
          proteinG: day.proteinG,
          carbsG: day.carbsG,
          fatG: day.fatG,
          sodiumMg: day.sodiumMg,
        });
      }
      if (day.waterMl != null && day.waterMl > 0) {
        await db.insert(waterLogsTable).values({
          date: day.date,
          loggedAt,
          oz: Math.round(day.waterMl / ML_PER_FL_OZ),
          source: "health_sync",
        });
      }
    }
    if (hasMacro) entriesInserted++;
    if (day.waterMl != null && day.waterMl > 0) watersInserted++;
  }

  console.log(
    `${DRY_RUN ? "[dry-run] " : ""}Nutrition-entries backfill: ${entriesInserted} entries + ${watersInserted} water logs inserted, ${skipped} days already migrated (of ${days.length}).`,
  );
}

if (
  typeof process !== "undefined" &&
  process.argv[1] &&
  process.argv[1].endsWith("backfill-nutrition-entries.ts")
) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Nutrition-entries backfill failed:", err);
      process.exit(1);
    });
}

export { main as backfillNutritionEntries };
