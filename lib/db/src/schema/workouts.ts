import { pgTable, serial, integer, text, date, doublePrecision, timestamp, index } from "drizzle-orm/pg-core";

export const workoutsTable = pgTable("workouts", {
  id: serial("id").primaryKey(),
  planDayId: integer("plan_day_id"),
  date: date("date").notNull(),
  equipment: text("equipment").notNull(),
  sessionType: text("session_type").notNull(),
  durationMin: doublePrecision("duration_min"),
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
