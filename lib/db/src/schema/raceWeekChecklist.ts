import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const raceWeekChecklistTable = pgTable("race_week_checklist", {
  itemId: text("item_id").primaryKey(),
  checked: boolean("checked").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RaceWeekChecklistRow = typeof raceWeekChecklistTable.$inferSelect;
