// One-shot backfill for `race_results.race_kind` on legacy rows logged
// before Task #265 added the captured race-kind column.
//
// Pre-#265, race results were keyed only by `race_date` and the PR
// comparison rebuilt the kind on every read by joining against the
// active `plan_days` row at that date. Task #265 captured the kind at
// write time so PR comparisons survive Phase Planner re-applies (which
// wipe `plan_days` but leave `race_results` intact). Rows logged before
// that task — and any rows whose active plan_day at write time wasn't
// recognised by `detectRaceKind` — carry `race_kind = NULL` and are
// silently skipped by the PR comparison (`computeRaceResultExtras`
// returns the empty result for null-kind rows), so PR badges never
// light up for those legacy entries.
//
// This script walks every `race_results` row whose `race_kind IS NULL`,
// looks up the matching `plan_days` row at `race_date`, and runs the
// shared `detectRaceKind` helper — same description-prefix-then-distance
// fallback the PUT handler and /races endpoint already use. Rows whose
// plan_day still doesn't classify (no plan_day on that date, or the row
// isn't recognised as a real race day) are left as-is so a future
// Phase Planner apply that re-introduces the matching plan_day will
// classify them on the next backfill run.
//
// Idempotent: rows already carrying a non-null `race_kind` are skipped.
// Runs as part of `scripts/post-merge.sh` after the workout backfills.

import { eq, isNull, inArray } from "drizzle-orm";
import { db, raceResultsTable, planDaysTable } from "@workspace/db";
import { detectRaceKind, type RaceDayKind } from "@workspace/plan-generator";

interface PlanDayLookup {
  distanceMi: number | null;
  description: string | null;
  sessionType: string;
}

// Pure classifier: returns the detected race kind for a plan_day lookup,
// or null when no plan_day exists on that date or the row isn't
// recognised as a real race day. Exported for tests.
export function classifyRaceKind(
  lookup: PlanDayLookup | null,
): RaceDayKind | null {
  if (lookup == null) return null;
  return detectRaceKind(lookup.distanceMi, lookup.description, lookup.sessionType);
}

async function main(): Promise<void> {
  const legacy = await db
    .select()
    .from(raceResultsTable)
    .where(isNull(raceResultsTable.raceKind));

  if (legacy.length === 0) {
    console.log("Race-result kind backfill complete: 0 rows needed updating");
    return;
  }

  const dates = legacy.map((r) => r.raceDate);
  const planRows = await db
    .select({
      date: planDaysTable.date,
      distanceMi: planDaysTable.distanceMi,
      description: planDaysTable.description,
      sessionType: planDaysTable.sessionType,
    })
    .from(planDaysTable)
    .where(inArray(planDaysTable.date, dates));

  // Multiple plan_days can share a date once stacked programs land
  // (Task #135). Pick the first row that classifies as a race day so a
  // Tonal lift sharing the date with a half-marathon Sunday doesn't
  // shadow the actual race row.
  const lookupByDate = new Map<string, PlanDayLookup>();
  for (const p of planRows) {
    const kind = detectRaceKind(p.distanceMi, p.description, p.sessionType);
    if (kind != null) {
      lookupByDate.set(p.date, p);
      continue;
    }
    if (!lookupByDate.has(p.date)) {
      lookupByDate.set(p.date, p);
    }
  }

  let updated = 0;
  let unmatched = 0;
  for (const r of legacy) {
    const kind = classifyRaceKind(lookupByDate.get(r.raceDate) ?? null);
    if (kind == null) {
      unmatched++;
      continue;
    }
    await db
      .update(raceResultsTable)
      .set({ raceKind: kind })
      .where(eq(raceResultsTable.raceDate, r.raceDate));
    updated++;
  }
  console.log(
    `Race-result kind backfill complete: ${updated} updated, ${unmatched} left unmatched (out of ${legacy.length} legacy NULL rows)`,
  );
}

if (
  typeof process !== "undefined" &&
  process.argv[1] &&
  process.argv[1].endsWith("backfill-race-result-kind.ts")
) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Race-result kind backfill failed:", err);
      process.exit(1);
    });
}
