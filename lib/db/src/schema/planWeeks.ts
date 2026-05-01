import { pgTable, integer, text, date, doublePrecision } from "drizzle-orm/pg-core";

export const planWeeksTable = pgTable("plan_weeks", {
  week: integer("week").primaryKey(),
  phase: text("phase").notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  plannedStrength: doublePrecision("planned_strength"),
  plannedCardio: doublePrecision("planned_cardio"),
  plannedTotalLoad: doublePrecision("planned_total_load").notNull(),
  plannedMiles: doublePrecision("planned_miles").notNull(),
  longRunMi: doublePrecision("long_run_mi").notNull(),
});

export type PlanWeekRow = typeof planWeeksTable.$inferSelect;
