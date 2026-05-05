import { pgTable, text, integer, date, timestamp } from "drizzle-orm/pg-core";

export const raceResultsTable = pgTable("race_results", {
  raceDate: date("race_date").primaryKey(),
  finishTime: text("finish_time"),
  placementOverall: integer("placement_overall"),
  placementTotal: integer("placement_total"),
  feltRating: integer("felt_rating"),
  notes: text("notes"),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RaceResultRow = typeof raceResultsTable.$inferSelect;
