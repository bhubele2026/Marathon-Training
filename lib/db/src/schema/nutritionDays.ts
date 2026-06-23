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
  // Total dietary carbohydrate for the day in grams. Null until a push
  // carries it — older protein-only/calorie-only pushes leave it null, and
  // historical rows predating macro tracking stay null (= not tracked).
  carbsG: integer("carbs_g"),
  // Total dietary fat for the day in grams. Same null semantics as carbsG.
  fatG: integer("fat_g"),
  // Total dietary sodium for the day in milligrams. Tracked against a daily
  // limit (the runner over-eats sodium) rather than a macro target. Same null
  // semantics as carbsG/fatG — older or macros-only pushes leave it null, so a
  // protein-only Apple Shortcut keeps working unchanged.
  sodiumMg: integer("sodium_mg"),
  // Total water intake for the day in MILLILITRES (Apple Health's native unit
  // for Dietary Water; the Shortcut can also send oz/L and the ingest converts).
  // Hydration supports satiety on a deficit, recovery, and protein metabolism,
  // so the AI nutritionist factors it in. Same null semantics as the macros.
  waterMl: integer("water_ml"),
  // When the runner taps "Close the day", marking the day's eating DONE. Null =
  // still open / in progress. The coach + nutritionist treat an OPEN current day
  // as partial (judge by pace toward target, never warn it's "too low") and only
  // judge it as a finished day once closed. Past days (date < today) are always
  // treated as final regardless, so this only gates TODAY.
  closedAt: timestamp("closed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type NutritionDayRow = typeof nutritionDaysTable.$inferSelect;
