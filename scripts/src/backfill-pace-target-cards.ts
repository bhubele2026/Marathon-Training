// Task #365 backfill: retrofit pace-target run cards onto an already-
// applied campaign WITHOUT wiping workouts or measurements.
//
// Before Task #365, run cards carried one of three legacy description
// shapes:
//   - "Easy aerobic Tread run (X mi, conversational)..."
//   - "Long aerobic run (X mi): conversational pace..."
//   - "Tread tempo (X mi: 5 min easy, ...)"
//   - "N x (2:00 walk + 1:00 jog) on Peloton Tread" (walk-run on-ramp)
//
// The generator now emits a single coherent pace-target sentence
// "{Kind} run: {min} min @ {pace}/mi (~{dist} mi)" on every run day,
// and applies a race-distance pace offset so easy/long pace slows
// with race length (Daniels/Pfitz alignment). Plan_days rows seeded
// BEFORE the fix still carry the old descriptions (+ pre-offset paces).
//
// This script:
//   1. Loads the most-recently-applied planner_configs row and
//      re-runs expandConfigToPlanRows to get the per-entry tagged
//      daily output (matching the same row identity used by
//      backfill-walk-run-coherence). plan_days is keyed by
//      UNIQUE(date, source_entry_index).
//   2. For each existing plan_day, compares the seed snapshot
//      against the regenerated values. Rows already up-to-date are
//      skipped.
//   3. Scopes patches to Task #365 run rows ONLY: we patch a row
//      only when EITHER the existing seed description OR the
//      regenerated description matches the legacy run-card shapes
//      (walk-run, easy aerobic, long aerobic, tread tempo, steady,
//      threshold, race-pace, sharpener) OR the new pace-target
//      sentence shape. Generator drift on unrelated rows is left
//      alone so this script does not double as a generic seed-refresh.
//   4. Updates the seed_* columns to the regenerated values, and
//      mirrors into the runtime columns ONLY when the row hasn't
//      been customized by the runner (runtime still equals prior
//      seed). Preserves any /plan edits the runner has made.
//
// Workouts, body_measurements, race_results, and race_week_checklist
// are NEVER touched. Idempotent — safe to re-run. Runs automatically
// from scripts/post-merge.sh + the deploy hook in .replit.
//
// Task #367 NOTE: this script also corrects already-applied campaigns
// for the run-card minute-math fix. It re-runs expandConfigToPlanRows
// from the live generator, so the new run_min = distance × pace
// formula (no 20-min floor, no per-mile constants) flows in
// automatically on the next post-merge pass — no script changes
// needed. The pace-target sentence regex above also matches new
// post-#367 descriptions whose minute count differs from the
// pre-#367 row, so seedRunMin / seedDescription / runtime mirrors
// are corrected in place.

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

// Match any legacy run-card shape OR the new pace-target sentence.
// Either side of the comparison matching is sufficient to scope the
// patch to a Task #365 row. Order doesn't matter — we just need any
// of these patterns to identify the row as a run card.
const RUN_CARD_REGEXES: RegExp[] = [
  // New pace-target sentence
  /(?:Easy|Long|Tempo|Steady|Sharpener|Race-pace|Threshold) run: \d+ min @ \d{1,2}:\d{2}\/mi \(~\d+(?:\.\d+)? mi\)/,
  // Legacy walk-run on-ramp
  /\d+ x \(2:00 walk @ 18:00\/mi \+ 1:00 jog @ 14:00\/mi\)/,
  // Legacy easy/long/tempo/steady/threshold/race-pace headlines
  /Easy aerobic Tread run \(/,
  /Easy recovery Tread run \(/,
  /Long aerobic run \(/,
  /Long run\/walk \(/,
  /Steady long run \(/,
  /Goal-pace long \(/,
  /Final long efforts \(/,
  /Reduced long run \(/,
  /Short taper long \(/,
  /Tread tempo \(/,
  /Tread threshold \(/,
  /Tread race-pace \(/,
  /Tread marathon-pace \(/,
  /Tread sharpener \(/,
  /Tread taper tempo \(/,
  /Easy Tread run \(/,
  /Easy Tread shakeout \(/,
  /Steady-state Tread run \(/,
  /Tune-up Tread run \(/,
];

function isRunCardDescription(desc: string): boolean {
  for (const re of RUN_CARD_REGEXES) {
    if (re.test(desc)) return true;
  }
  return false;
}

interface GeneratedSnapshot {
  description: string;
  runMin: number;
  distanceMi: number | null;
  pace: string | null;
}

function approxEq(a: number | null, b: number | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return Math.abs(a - b) < 1e-6;
}

function snapshotKey(date: string, sourceEntryIndex: number): string {
  return `${date}#${sourceEntryIndex}`;
}

export async function backfillPaceTargetCards(): Promise<{
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
      pace: t.row.pace ?? null,
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
      approxEq(row.seedDistanceMi ?? null, gen.distanceMi) &&
      (row.seedPace ?? null) === (gen.pace ?? null);
    if (seedMatches) continue;

    // Scope to Task #365 run-card rows only.
    const isRunCard =
      isRunCardDescription(row.seedDescription ?? "") ||
      isRunCardDescription(gen.description);
    if (!isRunCard) {
      outOfScopeSkipped += 1;
      continue;
    }

    const runtimeUntouched =
      (row.description ?? "") === (row.seedDescription ?? "") &&
      row.runMin === row.seedRunMin &&
      approxEq(row.distanceMi ?? null, row.seedDistanceMi ?? null) &&
      (row.pace ?? null) === (row.seedPace ?? null);

    const patch: Partial<typeof planDaysTable.$inferInsert> = {
      seedDescription: gen.description,
      seedRunMin: gen.runMin,
      seedDistanceMi: gen.distanceMi,
      seedPace: gen.pace,
    };
    if (runtimeUntouched) {
      patch.description = gen.description;
      patch.runMin = gen.runMin;
      patch.distanceMi = gen.distanceMi;
      patch.pace = gen.pace;
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
  const result = await backfillPaceTargetCards();
  console.log(
    `backfill-pace-target-cards: scanned=${result.scanned} seedUpdated=${result.seedUpdated} runtimeUpdated=${result.runtimeUpdated} customizedSkipped=${result.customizedSkipped} outOfScopeSkipped=${result.outOfScopeSkipped}`,
  );
  process.exit(0);
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("backfill-pace-target-cards.ts");
if (invokedDirectly) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
