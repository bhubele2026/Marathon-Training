// Task #295 guard: fail loudly if any workout still relies on the
// retired date-only fallback for plan_day attribution.
//
// Background: pre-Task #143 workouts had no `plan_day_id` and the
// /plan + /dashboard adherence queries fell back to matching by date.
// Task #161 backfilled every legacy row with a real `plan_day_id`,
// and Task #295 deleted that fallback so the SQL is a straight join
// on `plan_day_id`. Quick-logged off-plan / Lifestyle workouts are
// still allowed to carry a NULL `plan_day_id` (they intentionally
// don't credit any planned day) — but a NULL row that DOES have a
// matching `plan_days` entry on its date is now a regression: the
// runner's adherence math will silently undercount that day.
//
// This script runs after the backfill in `scripts/post-merge.sh` and
// counts workouts where `plan_day_id IS NULL AND EXISTS (a plan_day
// on the same date)`. Any non-zero count exits with status 1 so the
// merge surfaces the regression instead of letting it ride.
//
// Idempotent and read-only.

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

type OrphanRow = {
  id: number;
  date: string;
  session_type: string;
  equipment: string;
  [key: string]: unknown;
};

export async function findOrphanWorkouts(): Promise<OrphanRow[]> {
  const result = await db.execute<OrphanRow>(
    sql`SELECT w.id, w.date, w.session_type, w.equipment
        FROM workouts w
        WHERE w.plan_day_id IS NULL
          AND EXISTS (
            SELECT 1 FROM plan_days pd WHERE pd.date = w.date
          )
        ORDER BY w.date ASC, w.id ASC`,
  );
  return result.rows;
}

async function main(): Promise<void> {
  const orphans = await findOrphanWorkouts();
  if (orphans.length === 0) {
    console.log("Workout orphan check: no orphaned rows (every workout on a planned date carries plan_day_id).");
    return;
  }
  console.error(
    `Workout orphan check FAILED: ${orphans.length} workout row(s) have plan_day_id IS NULL but a plan_day exists on their date.`,
  );
  console.error("Re-run `pnpm --filter @workspace/scripts run backfill-workout-plan-day` to attribute them.");
  for (const r of orphans.slice(0, 10)) {
    console.error(`  - id=${r.id} date=${r.date} sessionType=${r.session_type} equipment=${r.equipment}`);
  }
  if (orphans.length > 10) {
    console.error(`  ... and ${orphans.length - 10} more`);
  }
  process.exit(1);
}

if (
  typeof process !== "undefined" &&
  process.argv[1] &&
  process.argv[1].endsWith("check-workout-orphans.ts")
) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Workout orphan check failed:", err);
      process.exit(1);
    });
}
