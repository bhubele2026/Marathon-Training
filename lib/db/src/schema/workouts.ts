import { pgTable, serial, integer, text, date, doublePrecision, timestamp, index } from "drizzle-orm/pg-core";

export const workoutsTable = pgTable("workouts", {
  id: serial("id").primaryKey(),
  planDayId: integer("plan_day_id"),
  date: date("date").notNull(),
  equipment: text("equipment").notNull(),
  // Ordered chip rail of every machine used in the session. The scalar
  // `equipment` always equals `equipmentList[0]` in canonical priority
  // (Tonal > Bike > Row > Tread > Outdoor > Lifestyle > None). Nullable
  // for legacy rows; backfill + API fall back to `[equipment]`.
  equipmentList: text("equipment_list").array(),
  sessionType: text("session_type").notNull(),
  durationMin: doublePrecision("duration_min"),
  // Three-bucket minute breakdown for the *actual* logged session, mirroring
  // the prescribed split on plan_days (strength_min / cardio_min / run_min).
  // Pre-task #76 the workouts table only carried `duration_min`, which made
  // it impossible to compare actuals against the planned breakdown ("you ran
  // 28 min vs planned 36 min, you lifted 40 min vs planned 45 min"). We now
  // capture each bucket independently:
  //   * strength_min: Tonal / lift minutes
  //   * cardio_min:   non-running cross-train minutes (bike, row, spin)
  //   * run_min:      treadmill or outdoor running minutes
  // All three are nullable so existing rows logged before these columns
  // existed remain valid; the UI falls back to `duration_min` when none of
  // the buckets are populated.
  strengthMin: doublePrecision("strength_min"),
  cardioMin: doublePrecision("cardio_min"),
  runMin: doublePrecision("run_min"),
  distanceMi: doublePrecision("distance_mi"),
  pace: text("pace"),
  avgHr: integer("avg_hr"),
  rpe: integer("rpe"),
  strengthLoad: doublePrecision("strength_load"),
  totalLoad: doublePrecision("total_load"),
  notes: text("notes"),
  // Optional tag for ordering and labeling same-day sessions ("AM" / "PM" /
  // "Other"). Nullable so existing rows logged before this column existed
  // continue to render and sort by createdAt as before.
  timeOfDay: text("time_of_day"),
  // Optional high-level modality of the session: "Cardio" / "Strength" /
  // "Mixed". Nullable so existing rows logged before this column existed
  // remain valid; the UI can fall back to inferring modality from equipment.
  modality: text("modality"),
  // Task #270: snapshot of the originally-logged values, written lazily the
  // first time a workout is edited via PATCH /api/workouts/:id. Mirrors the
  // same `seed_*` mechanism `plan_days` uses for the "Edited" badge so the
  // training log can show before/after diffs after a runner adjusts a
  // previously-logged session (e.g. corrected distance, swapped equipment,
  // updated RPE). All seed columns are nullable: NULL means the row has
  // never been edited, so isCustomized=false and the diff is empty. Once
  // populated, every mutable column has a snapshot so the diff is
  // well-defined for every field.
  seedSessionType: text("seed_session_type"),
  seedEquipment: text("seed_equipment"),
  seedEquipmentList: text("seed_equipment_list").array(),
  seedDurationMin: doublePrecision("seed_duration_min"),
  seedStrengthMin: doublePrecision("seed_strength_min"),
  seedCardioMin: doublePrecision("seed_cardio_min"),
  seedRunMin: doublePrecision("seed_run_min"),
  seedDistanceMi: doublePrecision("seed_distance_mi"),
  seedPace: text("seed_pace"),
  seedAvgHr: integer("seed_avg_hr"),
  seedRpe: integer("seed_rpe"),
  seedStrengthLoad: doublePrecision("seed_strength_load"),
  seedTotalLoad: doublePrecision("seed_total_load"),
  seedNotes: text("seed_notes"),
  seedTimeOfDay: text("seed_time_of_day"),
  seedModality: text("seed_modality"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  dateIdx: index("workouts_date_idx").on(t.date),
  sessionEquipmentRecentIdx: index("workouts_session_equipment_recent_idx").on(
    t.sessionType,
    t.equipment,
    t.date.desc(),
    t.createdAt.desc(),
  ),
}));

export type WorkoutRow = typeof workoutsTable.$inferSelect;
