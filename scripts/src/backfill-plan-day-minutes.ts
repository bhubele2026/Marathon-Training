// One-shot backfill for the strength_min / run_min columns (and the matching
// seed_* mirrors) added by task #74.
//
// Pre-task, the canonical generator overloaded `cardio_min` as "run minutes"
// for run / long-run days and as "cross-train minutes" (bike / row / spin)
// for strength + cardio days. Task #74 splits the three buckets
// (strength_min, cardio_min, run_min) so the /today and /plan/:week pages
// can render an accurate TOTAL · LIFT · CARDIO · RUN breakdown.
//
// Backfill strategy is per-row, classification-aware:
//
//   1. Classify each row from its OWN data (sessionType / equipment /
//      description / distance) — `classifySession` returns one of:
//        - "rest"            — explicit rest day
//        - "run-led"         — equipment is Tread / Outdoor / Run, or the
//                              session type names a run, or distance > 0
//        - "strength-cardio" — Tonal / lift mention or cardio keywords
//        - "ambiguous"       — none of the above
//
//   2. Apply the right rule for that classification:
//
//        * rest: every NULL minute column → 0.
//        * run-led: if run_min is NULL, the legacy cardio_min on this row
//          actually stored the run minutes — move cardio_min → run_min and
//          set cardio_min to the inferred cross-train value (usually 0).
//          When cardio_min is also NULL, fall back to distance × pace
//          inference. NEVER set run_min from inference while leaving a
//          conflicting cardio_min in place — that would double-count.
//        * strength-cardio: cardio_min already holds a genuine cross-train
//          value, leave it alone. Set run_min = 0 if NULL.
//        * ambiguous: only fill NULL columns when the inference produced a
//          confident non-null value; otherwise leave them NULL so the
//          "ambiguous rows untouched" rule still holds.
//
//   3. strength_min: backfilled from inference whenever NULL and inference
//      was confident, regardless of classification.
//
//   4. seed_* mirrors: when the row carries an "edited" marker
//      (seed_session_type IS NOT NULL), run the same inference + classifier
//      on the seed snapshot and apply the same rules. Otherwise the next
//      "Reset to original" would restore NULL minute buckets.
//
// Idempotent: rows whose minute columns are already populated (and whose
// cardio_min isn't a misplaced run-minute) get skipped, so re-running the
// script after a seed / full-reset is a no-op. Runs as part of
// `scripts/post-merge.sh`.

import { eq } from "drizzle-orm";
import { db, planDaysTable } from "@workspace/db";
import {
  classifySession,
  inferPlanDayMinutes,
  type InferenceInput,
  type SessionClassification,
} from "./lib/infer-plan-day-minutes";

interface MinutesTriple {
  strengthMin: number | null;
  cardioMin: number | null;
  runMin: number | null;
}

// `MinutesUpdate` differs from `Partial<MinutesTriple>` in that its values
// are `number` only, never `null` — the backfill never writes `null` into
// any column it touches; "leave alone" is encoded as the absent key.
interface MinutesUpdate {
  strengthMin?: number;
  cardioMin?: number;
  runMin?: number;
}

interface BackfillUpdates {
  strengthMin?: number;
  cardioMin?: number;
  runMin?: number;
  seedStrengthMin?: number;
  seedCardioMin?: number;
  seedRunMin?: number;
}

// Compute the field-level updates for one logical "minute set" (either the
// row itself or its seed snapshot). Returns partial updates keyed by the
// canonical field names (strengthMin / cardioMin / runMin); the caller maps
// these onto either the live columns or the seed_* mirrors.
function computeMinutesUpdates(args: {
  current: MinutesTriple;
  inferred: MinutesTriple;
  classification: SessionClassification;
}): MinutesUpdate {
  const { current, inferred, classification } = args;
  const updates: MinutesUpdate = {};

  // Lift: same rule for every classification.
  if (current.strengthMin == null && inferred.strengthMin != null) {
    updates.strengthMin = inferred.strengthMin;
  }

  if (classification === "rest") {
    if (current.cardioMin == null) updates.cardioMin = 0;
    if (current.runMin == null) updates.runMin = 0;
    return updates;
  }

  if (classification === "run-led") {
    if (current.runMin == null) {
      if (current.cardioMin != null && current.cardioMin > 0) {
        // Legacy: cardio_min on this run-led row is actually the run
        // minutes. Move it to run_min and replace cardio_min with the
        // inferred cross-train value (almost always 0 for the seeded
        // plan; could be non-zero for hybrid rows).
        updates.runMin = current.cardioMin;
        const replacementCardio = inferred.cardioMin ?? 0;
        if (replacementCardio !== current.cardioMin) {
          updates.cardioMin = replacementCardio;
        }
      } else if (inferred.runMin != null) {
        // No legacy value to move; use the distance × pace inference.
        updates.runMin = inferred.runMin;
        if (current.cardioMin == null && inferred.cardioMin != null) {
          updates.cardioMin = inferred.cardioMin;
        }
      }
    } else if (current.cardioMin == null && inferred.cardioMin != null) {
      // run_min already populated; just fill cardio_min if missing.
      updates.cardioMin = inferred.cardioMin;
    }
    return updates;
  }

  if (classification === "strength-cardio") {
    // cardio_min on these rows already holds genuine cross-train minutes
    // — never re-bucket. run_min should be 0 unless explicitly set.
    if (current.cardioMin == null && inferred.cardioMin != null) {
      updates.cardioMin = inferred.cardioMin;
    }
    if (current.runMin == null) {
      updates.runMin = inferred.runMin ?? 0;
    }
    return updates;
  }

  // Ambiguous: only fill NULLs when inference is confident.
  if (current.cardioMin == null && inferred.cardioMin != null) {
    updates.cardioMin = inferred.cardioMin;
  }
  if (current.runMin == null && inferred.runMin != null) {
    updates.runMin = inferred.runMin;
  }
  return updates;
}

export function computeBackfillUpdates(args: {
  current: MinutesTriple;
  inferred: MinutesTriple;
  classification: SessionClassification;
  seed?: MinutesTriple;
  inferredSeed?: MinutesTriple;
  seedClassification?: SessionClassification;
}): BackfillUpdates {
  const liveUpdates = computeMinutesUpdates({
    current: args.current,
    inferred: args.inferred,
    classification: args.classification,
  });

  const out: BackfillUpdates = {};
  if (liveUpdates.strengthMin !== undefined) out.strengthMin = liveUpdates.strengthMin;
  if (liveUpdates.cardioMin !== undefined) out.cardioMin = liveUpdates.cardioMin;
  if (liveUpdates.runMin !== undefined) out.runMin = liveUpdates.runMin;

  if (args.seed && args.inferredSeed && args.seedClassification) {
    const seedUpdates = computeMinutesUpdates({
      current: args.seed,
      inferred: args.inferredSeed,
      classification: args.seedClassification,
    });
    if (seedUpdates.strengthMin !== undefined) out.seedStrengthMin = seedUpdates.strengthMin;
    if (seedUpdates.cardioMin !== undefined) out.seedCardioMin = seedUpdates.cardioMin;
    if (seedUpdates.runMin !== undefined) out.seedRunMin = seedUpdates.runMin;
  }

  return out;
}

async function main(): Promise<void> {
  const rows = await db.select().from(planDaysTable);
  let updated = 0;
  let skipped = 0;
  let leftAmbiguous = 0;

  for (const row of rows) {
    const inferenceInput: InferenceInput = {
      sessionType: row.sessionType,
      equipment: row.equipment,
      description: row.description,
      distanceMi: row.distanceMi,
      pace: row.pace,
      isRest: row.isRest,
    };
    const inferred = inferPlanDayMinutes(inferenceInput);
    const classification = classifySession(inferenceInput);

    let seed: MinutesTriple | undefined;
    let inferredSeed: MinutesTriple | undefined;
    let seedClassification: SessionClassification | undefined;
    if (row.seedSessionType != null) {
      seed = {
        strengthMin: row.seedStrengthMin,
        cardioMin: row.seedCardioMin,
        runMin: row.seedRunMin,
      };
      const seedInput: InferenceInput = {
        sessionType: row.seedSessionType,
        equipment: row.seedEquipment,
        description: row.seedDescription,
        distanceMi: row.seedDistanceMi,
        pace: row.seedPace,
        isRest: row.seedIsRest ?? row.isRest,
      };
      inferredSeed = inferPlanDayMinutes(seedInput);
      seedClassification = classifySession(seedInput);
    }

    const updates = computeBackfillUpdates({
      current: {
        strengthMin: row.strengthMin,
        cardioMin: row.cardioMin,
        runMin: row.runMin,
      },
      inferred,
      classification,
      seed,
      inferredSeed,
      seedClassification,
    });

    if (Object.keys(updates).length === 0) {
      if (
        (row.strengthMin == null && inferred.strengthMin == null) ||
        (row.runMin == null && inferred.runMin == null)
      ) {
        leftAmbiguous++;
      } else {
        skipped++;
      }
      continue;
    }

    await db
      .update(planDaysTable)
      .set(updates)
      .where(eq(planDaysTable.id, row.id));
    updated++;
  }

  console.log(
    `Backfill complete: ${updated} updated, ${skipped} already current, ${leftAmbiguous} left ambiguous (out of ${rows.length} total)`,
  );
}

if (
  typeof process !== "undefined" &&
  process.argv[1] &&
  process.argv[1].endsWith("backfill-plan-day-minutes.ts")
) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Backfill failed:", err);
      process.exit(1);
    });
}
