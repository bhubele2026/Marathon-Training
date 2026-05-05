import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const raceWeekChecklistTable = pgTable("race_week_checklist", {
  itemId: text("item_id").primaryKey(),
  checked: boolean("checked").notNull().default(false),
  isCustom: boolean("is_custom").notNull().default(false),
  label: text("label"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RaceWeekChecklistRow = typeof raceWeekChecklistTable.$inferSelect;
