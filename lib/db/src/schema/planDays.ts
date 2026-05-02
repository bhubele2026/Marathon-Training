import { pgTable, serial, integer, text, date, doublePrecision, boolean, index } from "drizzle-orm/pg-core";

export const planDaysTable = pgTable("plan_days", {
  id: serial("id").primaryKey(),
  week: integer("week").notNull(),
  phase: text("phase").notNull(),
  date: date("date").notNull().unique(),
  day: text("day").notNull(),
  strengthLoad: doublePrecision("strength_load"),
  equipment: text("equipment").notNull(),
  description: text("description").notNull(),
  cardioMin: doublePrecision("cardio_min"),
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
  seedDescription: text("seed_description"),
  seedDistanceMi: doublePrecision("seed_distance_mi"),
  seedCardioMin: doublePrecision("seed_cardio_min"),
  seedPace: text("seed_pace"),
  seedStrengthLoad: doublePrecision("seed_strength_load"),
  seedTotalLoad: doublePrecision("seed_total_load"),
  seedIsRest: boolean("seed_is_rest"),
}, (t) => ({
  weekIdx: index("plan_days_week_idx").on(t.week),
  dateIdx: index("plan_days_date_idx").on(t.date),
}));

export type PlanDayRow = typeof planDaysTable.$inferSelect;
