// Task #361 backfill: retrofit the walk-run coherence fix onto an
// already-applied campaign WITHOUT wiping workouts or measurements.
//
// Pre-fix, walk-run on-ramp days carried three labels that disagreed:
// DISTANCE 1.00 mi, RUN 20 min, and "6 x (2:00 walk + 1:00 jog)" (which
// actually summed to 18 min / ~1.10 mi). The generator now emits a
// coherent triple — but plan_days rows seeded BEFORE the fix still
// carry the old run_min + description.
//
// This script:
//   1. Loads the most-recently-applied planner_configs row (same path
//      seed.ts uses) and re-runs expandConfigToPlanRows to get the
//      per-entry tagged daily output. plan_days is keyed by
//      UNIQUE(date, source_entry_index) so stacked overlapping
//      programs produce multiple rows per date — the backfill matches
//      regenerated rows against existing rows by the same composite
//      identity to avoid cross-entry clobber.
//   2. For each existing plan_day, compares the seed snapshot columns
//      (seed_description / seed_run_min / seed_distance_mi) against
//      the regenerated values. Rows already up-to-date are skipped.
//   3. Scopes patches narrowly to Task #361 walk-run rows ONLY: we
//      patch a row only when EITHER the existing seed description OR
//      the regenerated description matches the walk-run interval
//      shape. Generator drift on unrelated rows is left alone so
//      this script does not accidentally double as a generic
//      seed-refresh.
//   4. Updates the seed_* columns to the regenerated values, and
//      mirrors into the runtime columns ONLY when the row hasn't
//      been customized by the runner — i.e. when the runtime values
//      still equal the prior seed values. This preserves any /plan
//      edits the runner has made through the form.
//
// Workouts, body_measurements, race_results, and race_week_checklist
// are NEVER touched. Idempotent — safe to re-run. Runs automatically
// from scripts/post-merge.sh.

import {
  db,
  planDaysTable,
  plannerConfigsTable,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import {
  expandConfigToPlanRows,
  type PhaseBlock,
  type PlannerConfig,
  type TemplateEntry,
} from "@workspace/plan-generator";

// Walk-run on-ramp description signature. Matches both the legacy
// pre-fix shape ("6 x (2:00 walk @ 18:00/mi + 1:00 jog @ 14:00/mi)")
// and the post-fix shape (which may carry an optional 1-2 min tail).
// Either side of the comparison matching this pattern is sufficient
// to scope the patch to a Task #361 row.
const WALK_RUN_REGEX =
  /\d+ x \(2:00 walk @ 18:00\/mi \+ 1:00 jog @ 14:00\/mi\)/;

interface GeneratedSnapshot {
  description: string;
  runMin: number;
  distanceMi: number | null;
}

function approxEq(a: number | null, b: number | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return Math.abs(a - b) < 1e-6;
}

function snapshotKey(date: string, sourceEntryIndex: number): string {
  return `${date}#${sourceEntryIndex}`;
}

export async function backfillWalkRunCoherence(): Promise<{
  scanned: number;
  seedUpdated: number;
  runtimeUpdated: number;
  customizedSkipped: number;
  outOfScopeSkipped: number;
}> {
  const cfgRows = await db
    .select()
    .from(plannerConfigsTable)
    .where(sql`${plannerConfigsTable.lastAppliedAt} IS NOT NULL`)
    .orderBy(sql`${plannerConfigsTable.lastAppliedAt} DESC`)
    .limit(1);
  const cfg = cfgRows[0];
  if (
    !cfg ||
    !cfg.appliedStartDate ||
    !cfg.appliedMarathonDate ||
    !cfg.appliedBlocks
  ) {
    return {
      scanned: 0,
      seedUpdated: 0,
      runtimeUpdated: 0,
      customizedSkipped: 0,
      outOfScopeSkipped: 0,
    };
  }

  const config: PlannerConfig = {
    startDate: cfg.appliedStartDate,
    marathonDate: cfg.appliedMarathonDate,
    blocks: cfg.appliedBlocks as PhaseBlock[],
    entries: (cfg.appliedEntries as TemplateEntry[] | null) ?? null,
  };
  const { taggedDaily } = expandConfigToPlanRows(config);
  const byKey = new Map<string, GeneratedSnapshot>();
  for (const t of taggedDaily) {
    byKey.set(snapshotKey(t.row.date, t.sourceEntryIndex), {
      description: t.row.description ?? "",
      runMin: t.row.run_min,
      distanceMi: t.row.distance_mi ?? null,
    });
  }

  const rows = await db.select().from(planDaysTable);
  let scanned = 0;
  let seedUpdated = 0;
  let runtimeUpdated = 0;
  let customizedSkipped = 0;
  let outOfScopeSkipped = 0;

  for (const row of rows) {
    const gen = byKey.get(snapshotKey(row.date, row.sourceEntryIndex));
    if (!gen) continue;
    scanned += 1;

    const seedMatches =
      (row.seedDescription ?? "") === gen.description &&
      row.seedRunMin === gen.runMin &&
      approxEq(row.seedDistanceMi ?? null, gen.distanceMi);
    if (seedMatches) continue;

    // Scope to Task #361 walk-run rows only. If neither the existing
    // seed nor the regenerated description matches the walk-run
    // signature, leave the row alone so generic generator drift on
    // unrelated days doesn't silently rewrite seed snapshots.
    const isWalkRunRow =
      WALK_RUN_REGEX.test(row.seedDescription ?? "") ||
      WALK_RUN_REGEX.test(gen.description);
    if (!isWalkRunRow) {
      outOfScopeSkipped += 1;
      continue;
    }

    const runtimeUntouched =
      (row.description ?? "") === (row.seedDescription ?? "") &&
      row.runMin === row.seedRunMin &&
      approxEq(row.distanceMi ?? null, row.seedDistanceMi ?? null);

    const patch: Partial<typeof planDaysTable.$inferInsert> = {
      seedDescription: gen.description,
      seedRunMin: gen.runMin,
      seedDistanceMi: gen.distanceMi,
    };
    if (runtimeUntouched) {
      patch.description = gen.description;
      patch.runMin = gen.runMin;
      patch.distanceMi = gen.distanceMi;
      runtimeUpdated += 1;
    } else {
      customizedSkipped += 1;
    }

    await db
      .update(planDaysTable)
      .set(patch)
      .where(
        and(
          eq(planDaysTable.date, row.date),
          eq(planDaysTable.sourceEntryIndex, row.sourceEntryIndex),
        ),
      );
    seedUpdated += 1;
  }

  return {
    scanned,
    seedUpdated,
    runtimeUpdated,
    customizedSkipped,
    outOfScopeSkipped,
  };
}

async function main() {
  const result = await backfillWalkRunCoherence();
  console.log(
    `backfill-walk-run-coherence: scanned=${result.scanned} seedUpdated=${result.seedUpdated} runtimeUpdated=${result.runtimeUpdated} customizedSkipped=${result.customizedSkipped} outOfScopeSkipped=${result.outOfScopeSkipped}`,
  );
  process.exit(0);
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("backfill-walk-run-coherence.ts");
if (invokedDirectly) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
