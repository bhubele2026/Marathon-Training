// Backfill workouts.equipment_list from the scalar `equipment` for
// legacy rows whose column is NULL or empty. Idempotent.

import { eq } from "drizzle-orm";
import { db, workoutsTable } from "@workspace/db";

interface BackfillUpdates {
  equipmentList?: string[];
}

function needsBackfill(list: string[] | null): boolean {
  return list == null || list.length === 0;
}

export function computeWorkoutEquipmentBackfillUpdates(row: {
  equipment: string;
  equipmentList: string[] | null;
}): BackfillUpdates {
  if (!needsBackfill(row.equipmentList)) return {};
  return { equipmentList: [row.equipment] };
}

async function main(): Promise<void> {
  const rows = await db.select().from(workoutsTable);
  let updated = 0;
  let skipped = 0;
  for (const row of rows) {
    const updates = computeWorkoutEquipmentBackfillUpdates(row);
    if (Object.keys(updates).length === 0) {
      skipped++;
      continue;
    }
    await db
      .update(workoutsTable)
      .set(updates)
      .where(eq(workoutsTable.id, row.id));
    updated++;
  }
  console.log(
    `Workout equipment backfill complete: ${updated} updated, ${skipped} already current (out of ${rows.length} total)`,
  );
}

if (
  typeof process !== "undefined" &&
  process.argv[1] &&
  process.argv[1].endsWith("backfill-workout-equipment.ts")
) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Workout equipment backfill failed:", err);
      process.exit(1);
    });
}
