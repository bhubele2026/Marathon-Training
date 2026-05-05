// One-shot backfill for `workouts.plan_day_id` on legacy rows logged
// before Task #143 introduced per-plan_day attribution.
//
// Pre-#143, workouts were credited to plan_days purely by date. That works
// fine for a single-program week, but as soon as two overlapping programs
// (Task #135) share a calendar date the date-only fallback in /plan and
// /dashboard credits the legacy row to whichever plan_day sorts lowest by
// `source_entry_index` — which is arbitrary and frequently wrong.
//
// This script walks every workout whose `plan_day_id IS NULL`, looks up
// every plan_day on that date, and picks the most-likely match using a
// simple priority scoring:
//
//   * +2 if the plan_day's `session_type` matches the workout's
//   * +1 if the plan_day's `equipment` matches the workout's
//
// Highest score wins. Ties (and date-only matches with no signal) fall
// back to the lowest `source_entry_index` so the backfill agrees with the
// existing date-only fallback for those rows. When no plan_day exists on
// the workout's date the row is left as-is.
//
// Idempotent: rows already carrying a non-null `plan_day_id` are skipped.
// After a successful run the date-only fallback branch in plan.ts /
// dashboard.ts becomes a safety net for any future rows logged before
// the matching plan_day exists, rather than the load-bearing path for
// historical adherence math.

import { eq, isNull } from "drizzle-orm";
import { db, workoutsTable, planDaysTable } from "@workspace/db";

interface WorkoutInput {
  sessionType: string;
  equipment: string;
}

interface PlanDayCandidate {
  id: number;
  sessionType: string;
  equipment: string;
  sourceEntryIndex: number;
}

// Pure picker: returns the best candidate plan_day id for a workout, or
// null when there are no candidates on that date. Exported for tests.
export function pickBestPlanDayId(
  workout: WorkoutInput,
  candidates: ReadonlyArray<PlanDayCandidate>,
): number | null {
  if (candidates.length === 0) return null;
  let best: PlanDayCandidate | null = null;
  let bestScore = -1;
  for (const c of candidates) {
    const sessionMatch = c.sessionType === workout.sessionType ? 2 : 0;
    const equipmentMatch = c.equipment === workout.equipment ? 1 : 0;
    const score = sessionMatch + equipmentMatch;
    if (
      score > bestScore ||
      (score === bestScore &&
        best != null &&
        c.sourceEntryIndex < best.sourceEntryIndex)
    ) {
      best = c;
      bestScore = score;
    }
  }
  return best?.id ?? null;
}

async function main(): Promise<void> {
  const legacy = await db
    .select()
    .from(workoutsTable)
    .where(isNull(workoutsTable.planDayId));

  // Group candidate plan_days by date in a single fetch so we don't
  // round-trip per workout.
  const planDays = await db.select().from(planDaysTable);
  const byDate = new Map<string, PlanDayCandidate[]>();
  for (const pd of planDays) {
    const list = byDate.get(pd.date) ?? [];
    list.push({
      id: pd.id,
      sessionType: pd.sessionType,
      equipment: pd.equipment,
      sourceEntryIndex: pd.sourceEntryIndex,
    });
    byDate.set(pd.date, list);
  }

  let updated = 0;
  let unmatched = 0;
  for (const w of legacy) {
    const candidates = byDate.get(w.date) ?? [];
    const picked = pickBestPlanDayId(
      { sessionType: w.sessionType, equipment: w.equipment },
      candidates,
    );
    if (picked == null) {
      unmatched++;
      continue;
    }
    await db
      .update(workoutsTable)
      .set({ planDayId: picked })
      .where(eq(workoutsTable.id, w.id));
    updated++;
  }
  console.log(
    `Workout plan_day backfill complete: ${updated} updated, ${unmatched} left unmatched (out of ${legacy.length} legacy NULL rows)`,
  );
}

if (
  typeof process !== "undefined" &&
  process.argv[1] &&
  process.argv[1].endsWith("backfill-workout-plan-day.ts")
) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Workout plan_day backfill failed:", err);
      process.exit(1);
    });
}
