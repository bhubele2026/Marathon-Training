import { pgTable, serial, integer, text, date, doublePrecision, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";

export const planDaysTable = pgTable("plan_days", {
  id: serial("id").primaryKey(),
  week: integer("week").notNull(),
  phase: text("phase").notNull(),
  date: date("date").notNull(),
  day: text("day").notNull(),
  // Task #135: program/entry attribution for concurrent overlapping
  // programs. Each plan_day belongs to one TemplateEntry within the
  // active planner config. For legacy single-program campaigns and for
  // blocks-mode configs every row has sourceEntryIndex=0; with multiple
  // overlapping entries each entry gets its own index (0, 1, 2…) so two
  // sessions on the same date are distinguishable. The composite UNIQUE
  // (date, source_entry_index) replaces the old UNIQUE(date) so multiple
  // rows can share a calendar date as long as they come from different
  // entries. `sourceEntryLabel` is the human-readable program name shown
  // in the UI badge ("Tonal Lift", "5K Improver"); falls back to the
  // template's name when the entry has no customName set.
  sourceEntryIndex: integer("source_entry_index").notNull().default(0),
  sourceEntryLabel: text("source_entry_label"),
  strengthLoad: doublePrecision("strength_load"),
  equipment: text("equipment").notNull(),
  // Ordered list of every machine the runner will use that day (e.g. a Tue
  // strength + cardio session uses both Tonal and Peloton Bike). Added by
  // task #77 so the day card can render every machine as a chip
  // ("TONAL · PELOTON BIKE") instead of the single scalar `equipment` chip
  // we used to show. The scalar `equipment` column is preserved as-is for
  // back-compat with downstream code (dashboard aggregations, suggestions
  // pairKey, /equipment page); the list is owned by the generator and
  // refreshed to `[equipment]` whenever the runner edits the scalar value
  // through the form. Nullable so existing rows pre-backfill stay valid;
  // the backfill (scripts/src/backfill-plan-day-equipment.ts) populates it
  // by parsing the description for known machine names. Renderers fall
  // back to `[equipment]` when the column is null.
  equipmentList: text("equipment_list").array(),
  description: text("description").notNull(),
  // Three-bucket minute breakdown for the prescribed session. Pre-task #74
  // the schema only carried `cardio_min`, which the generator overloaded as
  // "run minutes" for run/long-run days and as "cross-train minutes" for
  // strength+cardio days. That made it impossible to render an accurate
  // TOTAL · LIFT · CARDIO · RUN breakdown on workout cards. We now split the
  // prescription into three orthogonal columns:
  //   * strength_min: Tonal / lift minutes (heavy block + accessory work)
  //   * cardio_min:   non-running cross-train minutes (bike, row, spin)
  //   * run_min:      treadmill or outdoor running minutes
  // total minutes = sum of the three (computed on the server side, see
  // `toPlanDay` in api-server/src/lib/transforms.ts). All three are nullable
  // so existing rows pre-backfill remain valid; the backfill script
  // (scripts/src/backfill-plan-day-minutes.ts) populates them from the
  // canonical generator output by date.
  strengthMin: doublePrecision("strength_min"),
  cardioMin: doublePrecision("cardio_min"),
  runMin: doublePrecision("run_min"),
  distanceMi: doublePrecision("distance_mi"),
  pace: text("pace"),
  sessionType: text("session_type").notNull(),
  isRest: boolean("is_rest").notNull().default(false),
  totalLoad: doublePrecision("total_load").notNull(),
  // Snapshot of the originally-seeded prescription, written either at seed time
  // or lazily the first time the row is edited. Used by the "Reset to original"
  // action so a user can revert a plan day to its pristine prescription.
  // All seed columns are nullable so a freshly-pushed schema (pre-snapshot)
  // remains valid; the reset endpoint treats a NULL seed_session_type as
  // "nothing to restore" and is a no-op for that row.
  seedSessionType: text("seed_session_type"),
  seedEquipment: text("seed_equipment"),
  // Mirror snapshot of `equipment_list` (task #77). Captured at seed time
  // and lazily on first edit so /reset can restore the original chip rail
  // even after the runner has edited it.
  seedEquipmentList: text("seed_equipment_list").array(),
  seedDescription: text("seed_description"),
  seedDistanceMi: doublePrecision("seed_distance_mi"),
  seedStrengthMin: doublePrecision("seed_strength_min"),
  seedCardioMin: doublePrecision("seed_cardio_min"),
  seedRunMin: doublePrecision("seed_run_min"),
  seedPace: text("seed_pace"),
  seedStrengthLoad: doublePrecision("seed_strength_load"),
  seedTotalLoad: doublePrecision("seed_total_load"),
  seedIsRest: boolean("seed_is_rest"),
}, (t) => ({
  weekIdx: index("plan_days_week_idx").on(t.week),
  dateIdx: index("plan_days_date_idx").on(t.date),
  // Task #135: composite unique replaces the old UNIQUE(date) so
  // overlapping concurrent programs can each emit a row on the same
  // calendar date (one per entry).
  dateEntryUnique: uniqueIndex("plan_days_date_entry_unique").on(
    t.date,
    t.sourceEntryIndex,
  ),
  sourceEntryIdx: index("plan_days_source_entry_idx").on(t.sourceEntryIndex),
}));

export type PlanDayRow = typeof planDaysTable.$inferSelect;
