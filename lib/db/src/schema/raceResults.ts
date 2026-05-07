import { pgTable, text, integer, date, timestamp } from "drizzle-orm/pg-core";

export const raceResultsTable = pgTable("race_results", {
  raceDate: date("race_date").primaryKey(),
  finishTime: text("finish_time"),
  placementOverall: integer("placement_overall"),
  placementTotal: integer("placement_total"),
  feltRating: integer("felt_rating"),
  notes: text("notes"),
  // Task #265. Captured at write time so PR comparisons across past
  // campaigns survive Phase Planner re-applies (which wipe plan_days
  // but leave race_results intact). Nullable for legacy rows / cases
  // where the active plan_day at the race date can't be classified by
  // `detectRaceKind`. Values are constrained to the four canonical
  // race kinds the rest of the app already speaks.
  raceKind: text("race_kind"),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RaceResultRow = typeof raceResultsTable.$inferSelect;
