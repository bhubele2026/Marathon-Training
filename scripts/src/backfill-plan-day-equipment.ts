// One-shot backfill for the equipment_list / seed_equipment_list columns
// (and the matching seed_* mirror) added by task #77.
//
// Pre-task, every plan day rendered a single equipment chip from the scalar
// `equipment` column. Task #77 introduces a chip rail so a Tue strength +
// cardio session shows "TONAL · PELOTON BIKE" and a Wed run-with-accessory
// shows "TONAL · PELOTON TREAD" instead of just "TONAL".
//
// The generator now emits the canonical chip rail at seed time. This script
// retro-fits every existing row whose `equipment_list` is still NULL by
// parsing the description for known machine names in canonical priority
// order:
//
//   1. Tonal           — every Tonal-paired session
//   2. Peloton Bike    — bike spins
//   3. Peloton Row     — row sessions
//   4. Peloton Tread   — treadmill runs
//   5. Outdoor         — outdoor / race-day runs
//
// When the description doesn't mention any known machine (e.g. legacy "Off
// / Rest" rows or runner-edited descriptions), the script falls back to
// `[equipment]` so the column is never left null after the script runs and
// the renderer always has at least one chip to show.
//
// Idempotent: rows whose `equipment_list` is already non-null are skipped.
// `seed_equipment_list` is mirrored from a parse of `seed_description` (or
// `description` when no seed snapshot exists) so a subsequent /reset
// restores the chip rail too.
//
// Runs as part of `scripts/post-merge.sh` after the minutes backfill.

import { eq } from "drizzle-orm";
import { db, planDaysTable } from "@workspace/db";

interface ParseInput {
  description: string | null;
  equipment: string;
}

// Ordered list of (regex, canonical-chip-name) pairs. The order is the
// canonical priority order; the parser walks the list and pushes a chip
// the first time its regex matches in the description. Each chip is
// emitted at most once per row.
const CHIP_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\btonal\b/i, "Tonal"],
  [/\bpeloton bike\b|\bbike spin\b|\beasy spin\b|\bspin\b/i, "Peloton Bike"],
  [/\bpeloton row\b|\brow\b/i, "Peloton Row"],
  [/\bpeloton tread\b|\btread\b|\btreadmill\b/i, "Peloton Tread"],
  [/\boutdoor\b|\brace\b/i, "Outdoor"],
] as const;

// Parse the description into a chip rail in canonical priority order.
// Falls back to `[equipment]` (or `["Rest"]` for an empty equipment) when
// no known machine name appears in the description so callers always get a
// non-empty array.
export function parseEquipmentList(input: ParseInput): string[] {
  const desc = input.description ?? "";
  const chips: string[] = [];
  for (const [pattern, name] of CHIP_PATTERNS) {
    if (pattern.test(desc) && !chips.includes(name)) {
      chips.push(name);
    }
  }
  if (chips.length === 0) {
    const fallback = input.equipment?.trim() || "Rest";
    return [fallback];
  }
  return chips;
}

interface BackfillUpdates {
  equipmentList?: string[];
  seedEquipmentList?: string[];
}

// Compute the field-level updates for one row. Live `equipment_list` is
// only populated when NULL; the seed mirror is only populated when NULL
// AND the row carries an "edited" marker (seed_session_type IS NOT NULL).
// Rows whose seed snapshot has never been recorded leave seed_* alone so
// the "row was never edited" signal stays intact.
export function computeEquipmentBackfillUpdates(row: {
  equipment: string;
  description: string | null;
  equipmentList: string[] | null;
  seedSessionType: string | null;
  seedEquipment: string | null;
  seedDescription: string | null;
  seedEquipmentList: string[] | null;
}): BackfillUpdates {
  const out: BackfillUpdates = {};
  if (row.equipmentList == null) {
    out.equipmentList = parseEquipmentList({
      description: row.description,
      equipment: row.equipment,
    });
  }
  if (row.seedSessionType != null && row.seedEquipmentList == null) {
    out.seedEquipmentList = parseEquipmentList({
      description: row.seedDescription,
      equipment: row.seedEquipment ?? row.equipment,
    });
  }
  return out;
}

async function main(): Promise<void> {
  const rows = await db.select().from(planDaysTable);
  let updated = 0;
  let skipped = 0;
  for (const row of rows) {
    const updates = computeEquipmentBackfillUpdates(row);
    if (Object.keys(updates).length === 0) {
      skipped++;
      continue;
    }
    await db
      .update(planDaysTable)
      .set(updates)
      .where(eq(planDaysTable.id, row.id));
    updated++;
  }
  console.log(
    `Equipment backfill complete: ${updated} updated, ${skipped} already current (out of ${rows.length} total)`,
  );
}

if (
  typeof process !== "undefined" &&
  process.argv[1] &&
  process.argv[1].endsWith("backfill-plan-day-equipment.ts")
) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Equipment backfill failed:", err);
      process.exit(1);
    });
}
