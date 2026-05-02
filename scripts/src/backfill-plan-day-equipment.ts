// One-shot backfill for the equipment_list / seed_equipment_list columns
// (and the matching seed_* mirror) added by task #77.
//
// Pre-task, every plan day rendered a single equipment chip from the scalar
// `equipment` column. Task #77 introduces a chip rail so a Tue strength +
// cardio session shows "TONAL · PELOTON BIKE" and a Wed run-with-accessory
// shows "PELOTON TREAD · TONAL" instead of just "TONAL".
//
// The generator now emits the canonical chip rail at seed time and keeps
// the scalar `equipment` aligned with `equipment_list[0]`. This script
// retro-fits every legacy row whose `equipment_list` is still NULL by
// building `[scalar equipment, ...secondary machines mentioned in the
// description, in order of appearance]`, deduped — so the existing scalar
// stays at index 0 (preserving back-compat for any code path still
// reading the scalar) and the runner sees every secondary machine
// referenced in the prose.
//
// Recognized secondary machine names (each emitted at most once):
//   - Tonal           — every Tonal-paired session
//   - Peloton Bike    — bike spins
//   - Peloton Row     — row sessions
//   - Peloton Tread   — treadmill runs
//   - Outdoor         — outdoor / race-day runs
//
// When the description doesn't mention any additional machine, the
// resulting list is just `[equipment]` so the column is never left NULL
// and the renderer always has at least one chip to show.
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

// (regex, canonical-chip-name) pairs for every machine the chip rail
// renders. Order in this list does NOT determine the chip rail order —
// the parser sorts matches by their first occurrence index in the
// description so the rail mirrors the natural reading order of the prose.
//
// `Outdoor` only matches explicit outdoor phrases ("outdoor", "outside")
// or the literal race-day banner ("RACE DAY"). It deliberately does NOT
// match bare "race", because Tread workouts use phrases like
// `race-pace`, `Race-eve`, and `race tomorrow` while still being
// treadmill-only sessions — matching `race` there would falsely add an
// Outdoor chip.
const CHIP_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\btonal\b/i, "Tonal"],
  [/\bpeloton bike\b|\bbike spin\b|\beasy spin\b|\bspin\b/i, "Peloton Bike"],
  [/\bpeloton row\b|\brow\b/i, "Peloton Row"],
  [/\bpeloton tread\b|\btread\b|\btreadmill\b/i, "Peloton Tread"],
  [/\boutdoor\b|\boutside\b|\brace day\b/i, "Outdoor"],
] as const;

// Build the chip rail for one row. Per the task #77 contract the scalar
// `equipment` is always the first chip; any additional machines named in
// the description are appended in the order they appear in the prose,
// deduped against the scalar so it never repeats. Falls back to
// `[equipment]` (or `["Rest"]` for an empty scalar) when the description
// names no additional machine, so callers always get a non-empty array.
export function parseEquipmentList(input: ParseInput): string[] {
  const scalar = input.equipment?.trim() || "Rest";
  const desc = input.description ?? "";

  // Find the first index at which each known machine name appears.
  // Machines that aren't mentioned in this description are skipped. The
  // resulting list is sorted by index so the chip rail follows the
  // natural reading order of the description.
  const hits: Array<{ name: string; idx: number }> = [];
  for (const [pattern, name] of CHIP_PATTERNS) {
    const m = desc.match(pattern);
    if (m && typeof m.index === "number") {
      hits.push({ name, idx: m.index });
    }
  }
  hits.sort((a, b) => a.idx - b.idx);

  const result: string[] = [scalar];
  for (const { name } of hits) {
    if (!result.includes(name)) result.push(name);
  }
  return result;
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
