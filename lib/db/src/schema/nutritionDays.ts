import { pgTable, date, integer, timestamp } from "drizzle-orm/pg-core";

// One row per calendar day of food-tracker intake, pushed in from an Apple
// Shortcut that reads Dietary Energy (calories) + Dietary Protein out of
// Apple Health — which MyNetDiary (or any tracker the runner uses) syncs
// into. Keyed by `date` (YYYY-MM-DD) so the nightly push is an idempotent
// upsert: re-sending the same day overwrites rather than duplicating.
// Personal single-user app, so no user id — mirrors the measurements table.
export const nutritionDaysTable = pgTable("nutrition_days", {
  date: date("date").primaryKey(),
  // Total dietary energy for the day in kcal. Null until the day's first
  // push lands, or if a push only carried protein.
  calories: integer("calories"),
  // Total dietary protein for the day in grams — the headline metric the
  // runner cares about most while cutting from 281 lb → 210 lb.
  proteinG: integer("protein_g"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type NutritionDayRow = typeof nutritionDaysTable.$inferSelect;
