// Idempotent drop of the legacy marathon race tables (scheduled_races /
// race_week_checklist / race_results). The overhaul removed these from the
// Drizzle schema, but a database that still carries them makes the subsequent
// `drizzle-kit push` diff RENAME-AMBIGUOUS — drizzle can't tell whether the new
// nutrition_entries / water_logs tables are fresh creates or renames of the
// orphaned race tables, and asks an interactive question. That question can't
// be answered in the non-interactive deploy build container, so the push leaves
// the new tables uncreated and the nutrition-entries backfill then fails with
// `relation "nutrition_entries" does not exist`.
//
// Dropping the dead tables FIRST (before the push, see run-backfills.sh) makes
// the push purely additive + non-interactive. Idempotent: DROP TABLE IF EXISTS
// is a no-op once the tables are gone, so this is safe on every deploy/merge.
// Runs ahead of the schema push in scripts/run-backfills.sh.

import { pool } from "@workspace/db";

async function main(): Promise<void> {
  await pool.query(
    "DROP TABLE IF EXISTS scheduled_races, race_week_checklist, race_results CASCADE",
  );
  console.log(
    "drop-legacy-race-tables: dropped scheduled_races / race_week_checklist / race_results if present.",
  );
}

if (
  typeof process !== "undefined" &&
  process.argv[1] &&
  process.argv[1].endsWith("drop-legacy-race-tables.ts")
) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("drop-legacy-race-tables failed:", err);
      process.exit(1);
    });
}
