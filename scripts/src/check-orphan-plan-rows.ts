// Task #328 guard: fail loudly if `plan_weeks` / `plan_days` carry rows
// while no `planner_configs` row has `last_applied_at IS NOT NULL`.
//
// Background: Task #307 introduced the "plan tables stay EMPTY until a
// Phase Planner config has been applied" contract. Task #327 added the
// post-merge `cleanup-orphan-plan-rows` script that wipes legacy
// pre-Task #307 auto-seeded plan rows on existing databases. But the
// underlying tables still have no schema-level guard tying them to an
// applied config — a future change (or a manual `pnpm --filter
// @workspace/db run push` against a stale schema) could silently
// re-introduce orphan plan rows.
//
// Cross-table CHECK constraints aren't supported in Postgres without
// triggers, so this CI-style guard runs after the cleanup step in
// `scripts/post-merge.sh` and counts plan_weeks + plan_days when
// no applied planner_configs row exists. Any non-zero count exits with
// status 1 so the merge surfaces the regression instead of letting it
// ride.
//
// Idempotent and read-only.

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export interface OrphanPlanRowsCheckResult {
  appliedConfigCount: number;
  weeksCount: number;
  daysCount: number;
}

export async function checkOrphanPlanRows(): Promise<OrphanPlanRowsCheckResult> {
  const [{ count: appliedConfigCount } = { count: 0 }] = (
    await db.execute<{ count: number }>(
      sql`SELECT COUNT(*)::int AS count FROM planner_configs WHERE last_applied_at IS NOT NULL`,
    )
  ).rows;
  const [{ count: weeksCount } = { count: 0 }] = (
    await db.execute<{ count: number }>(
      sql`SELECT COUNT(*)::int AS count FROM plan_weeks`,
    )
  ).rows;
  const [{ count: daysCount } = { count: 0 }] = (
    await db.execute<{ count: number }>(
      sql`SELECT COUNT(*)::int AS count FROM plan_days`,
    )
  ).rows;
  return { appliedConfigCount, weeksCount, daysCount };
}

export function isOrphanPlanRowsViolation(
  result: OrphanPlanRowsCheckResult,
): boolean {
  return (
    result.appliedConfigCount === 0 &&
    (result.weeksCount > 0 || result.daysCount > 0)
  );
}

async function main(): Promise<void> {
  const result = await checkOrphanPlanRows();
  if (result.appliedConfigCount > 0) {
    console.log(
      `Orphan plan-rows check: ${result.appliedConfigCount} applied planner_configs row(s) found — plan tables may carry rows. OK.`,
    );
    return;
  }
  if (!isOrphanPlanRowsViolation(result)) {
    console.log(
      "Orphan plan-rows check: no applied config and plan tables are empty. OK.",
    );
    return;
  }
  console.error(
    `Orphan plan-rows check FAILED: no planner_configs row has last_applied_at IS NOT NULL, but plan_weeks has ${result.weeksCount} row(s) and plan_days has ${result.daysCount} row(s).`,
  );
  console.error(
    "Re-run `pnpm --filter @workspace/scripts run cleanup-orphan-plan-rows` to restore the Task #307 invariant, or apply a config from /planner.",
  );
  process.exit(1);
}

if (
  typeof process !== "undefined" &&
  process.argv[1] &&
  process.argv[1].endsWith("check-orphan-plan-rows.ts")
) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Orphan plan-rows check failed:", err);
      process.exit(1);
    });
}
