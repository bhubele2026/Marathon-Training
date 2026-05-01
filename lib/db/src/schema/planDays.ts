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
}, (t) => ({
  weekIdx: index("plan_days_week_idx").on(t.week),
  dateIdx: index("plan_days_date_idx").on(t.date),
}));

export type PlanDayRow = typeof planDaysTable.$inferSelect;
