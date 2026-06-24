// One-shot, idempotent backfill that re-buckets plan_days minutes by session
// TYPE, fixing AI-authored plans that parked a Run or Strength day's minutes in
// cardio_min (so the session card's headline read the wrong, empty bucket and
// couldn't line up with the logged actual, which buckets by type).
//
// Uses the SAME rule the live materialize path uses (normalizeSessionBuckets in
// @workspace/plan-knowledge), so the backfill and forward path can't drift. The
// rule only MOVES minutes out of cardio for a clearly run/strength session whose
// own bucket is empty — intentional mixed sessions and real cardio-machine days
// are left alone — so it's safe and idempotent (re-running is a no-op once the
// minutes sit in the right bucket).
//
// Also fixes the seed_* mirror (seedStrengthMin/seedCardioMin/seedRunMin) when a
// row carries an edit marker, so "Reset to original" doesn't restore the bad
// bucketing.
//
// DRY RUN: set DRY_RUN=1 to report what WOULD change without writing.
// Runs as part of scripts/run-backfills.sh (dev merge + prod deploy).

import { eq } from "drizzle-orm";
import { db, planDaysTable } from "@workspace/db";
import { normalizeSessionBuckets } from "@workspace/plan-knowledge";

const DRY_RUN = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";

type Triple = { strengthMin: number; cardioMin: number; runMin: number };

// Returns the changed fields (or null when nothing moves) for one minute set.
function rebucket(
  sessionType: string | null,
  s: number | null,
  c: number | null,
  r: number | null,
): Triple | null {
  const cur: Triple = { strengthMin: s ?? 0, cardioMin: c ?? 0, runMin: r ?? 0 };
  const next = normalizeSessionBuckets(sessionType, cur);
  const moved =
    next.strengthMin !== cur.strengthMin ||
    next.cardioMin !== cur.cardioMin ||
    next.runMin !== cur.runMin;
  return moved ? next : null;
}

async function main(): Promise<void> {
  const rows = await db.select().from(planDaysTable);
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const set: Record<string, number> = {};

    const live = rebucket(row.sessionType, row.strengthMin, row.cardioMin, row.runMin);
    if (live) {
      set.strengthMin = live.strengthMin;
      set.cardioMin = live.cardioMin;
      set.runMin = live.runMin;
    }

    if (row.seedSessionType != null) {
      const seed = rebucket(
        row.seedSessionType,
        row.seedStrengthMin,
        row.seedCardioMin,
        row.seedRunMin,
      );
      if (seed) {
        set.seedStrengthMin = seed.strengthMin;
        set.seedCardioMin = seed.cardioMin;
        set.seedRunMin = seed.runMin;
      }
    }

    if (Object.keys(set).length === 0) {
      skipped++;
      continue;
    }

    if (DRY_RUN) {
      console.log(
        `[dry-run] ${row.date} "${row.sessionType}" -> ${JSON.stringify(set)}`,
      );
    } else {
      await db.update(planDaysTable).set(set).where(eq(planDaysTable.id, row.id));
    }
    updated++;
  }

  console.log(
    `${DRY_RUN ? "[dry-run] " : ""}Plan-day bucket backfill: ${updated} re-bucketed, ${skipped} already correct (of ${rows.length}).`,
  );
}

if (
  typeof process !== "undefined" &&
  process.argv[1] &&
  process.argv[1].endsWith("backfill-plan-day-buckets.ts")
) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Plan-day bucket backfill failed:", err);
      process.exit(1);
    });
}
