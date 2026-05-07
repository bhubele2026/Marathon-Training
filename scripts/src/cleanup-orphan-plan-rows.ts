// Task #327 guard: enforce the "plan tables stay EMPTY until a Phase
// Planner config has been applied" invariant introduced by Task #307
// and reinforced by Task #326 (Full Reset demotes applied configs back
// to draft).
//
// Background: pre-Task #307 the seed script auto-generated a 52-week
// canonical campaign and wrote it straight into plan_weeks / plan_days
// without ever recording an applied planner_configs row. Databases that
// were initialized under the old behavior still carry those orphan plan
// rows even though `planner_configs` has zero rows with a non-null
// `last_applied_at`. The /plan UI then renders a populated 52-week
// "Workout Plan" instead of the empty-plan CTA, breaking Task #307's
// fresh-install contract.
//
// This one-shot post-merge script restores the invariant: when no
// `planner_configs` row has `last_applied_at IS NOT NULL` and yet
// `plan_weeks` / `plan_days` have rows, TRUNCATE both tables so the UI
// falls back to the EmptyPlanState CTA. Workouts' `plan_day_id`
// references are detached first so the TRUNCATE doesn't cascade into
// the runner's logged history. Idempotent and safe to re-run: a normal
// applied campaign (a row with `last_applied_at IS NOT NULL` exists)
// is left untouched.

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export interface CleanupOrphanPlanRowsResult {
  appliedConfigCount: number;
  weeksWiped: number;
  daysWiped: number;
  workoutsDetached: number;
}

export async function cleanupOrphanPlanRows(): Promise<CleanupOrphanPlanRowsResult> {
  return await db.transaction(async (tx) => {
    await tx.execute(
      sql`LOCK TABLE planner_configs, plan_days, plan_weeks, workouts IN ACCESS EXCLUSIVE MODE`,
    );

    const [{ count: appliedConfigCount } = { count: 0 }] = (
      await tx.execute<{ count: number }>(
        sql`SELECT COUNT(*)::int AS count FROM planner_configs WHERE last_applied_at IS NOT NULL`,
      )
    ).rows;

    if (appliedConfigCount > 0) {
      return {
        appliedConfigCount,
        weeksWiped: 0,
        daysWiped: 0,
        workoutsDetached: 0,
      };
    }

    const [{ count: weeksWiped } = { count: 0 }] = (
      await tx.execute<{ count: number }>(
        sql`SELECT COUNT(*)::int AS count FROM plan_weeks`,
      )
    ).rows;
    const [{ count: daysWiped } = { count: 0 }] = (
      await tx.execute<{ count: number }>(
        sql`SELECT COUNT(*)::int AS count FROM plan_days`,
      )
    ).rows;

    if (weeksWiped === 0 && daysWiped === 0) {
      return {
        appliedConfigCount: 0,
        weeksWiped: 0,
        daysWiped: 0,
        workoutsDetached: 0,
      };
    }

    // Detach workout FKs first so the plan_days TRUNCATE doesn't
    // cascade-delete the runner's logged history. Workouts that
    // referenced one of these orphan plan_days fall back to the
    // unlinked-orphan code path (surfaced via /api/workouts/unlinked-count)
    // until the runner re-applies a config and the post-merge
    // workout-plan-day backfill rebinds them by date.
    const detached = await tx.execute<{ count: number }>(
      sql`WITH updated AS (
            UPDATE workouts SET plan_day_id = NULL
            WHERE plan_day_id IS NOT NULL
            RETURNING 1
          )
          SELECT COUNT(*)::int AS count FROM updated`,
    );
    const workoutsDetached = detached.rows[0]?.count ?? 0;

    await tx.execute(
      sql`TRUNCATE TABLE plan_days, plan_weeks RESTART IDENTITY CASCADE`,
    );

    return {
      appliedConfigCount: 0,
      weeksWiped,
      daysWiped,
      workoutsDetached,
    };
  });
}

async function main(): Promise<void> {
  const result = await cleanupOrphanPlanRows();
  if (result.appliedConfigCount > 0) {
    console.log(
      `Orphan plan-row cleanup: ${result.appliedConfigCount} applied planner_configs row(s) found — leaving plan tables intact.`,
    );
    return;
  }
  if (result.weeksWiped === 0 && result.daysWiped === 0) {
    console.log(
      "Orphan plan-row cleanup: no applied config and plan tables already empty — nothing to do.",
    );
    return;
  }
  console.log(
    `Orphan plan-row cleanup: no applied planner_configs row exists. Wiped ${result.weeksWiped} plan_weeks and ${result.daysWiped} plan_days; detached ${result.workoutsDetached} workout(s) from their plan_day_id. Apply a config from /planner to repopulate the plan.`,
  );
}

if (
  typeof process !== "undefined" &&
  process.argv[1] &&
  process.argv[1].endsWith("cleanup-orphan-plan-rows.ts")
) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Orphan plan-row cleanup failed:", err);
      process.exit(1);
    });
}
