import { pgTable, serial, date, integer, text, timestamp } from "drizzle-orm/pg-core";

// Phase 13 — timestamped, source-aware food entries. This is now the SOURCE OF
// TRUTH for nutrition intake; `nutrition_days` becomes a derived rollup cache
// (sum of a date's entries) so every existing read path keeps working.
//
// `source` distinguishes a row the runner logged in the app (`manual`) from the
// single row the Apple-Shortcut push collapses each day's synced Apple-Health
// totals into (`health_sync`). Re-pushing a day REPLACES that day's health_sync
// entry rather than duplicating; manual entries are independent rows. The day
// total = sum of ALL entries for `date`, so manual + synced never double-count.
//
// Macro columns are nullable with the same "null = not tracked" semantics as
// nutrition_days, so a protein-only push / a calories-only manual snack are both
// representable.
export const nutritionEntriesTable = pgTable("nutrition_entries", {
  id: serial("id").primaryKey(),
  // Local calendar day (YYYY-MM-DD) the entry counts toward, in the runner's
  // own timezone (Phase 9). The rollup + history queries key on this.
  date: date("date").notNull(),
  // The wall-clock instant the entry was logged/eaten — drives day/week/month
  // ordering and the history browser timeline.
  loggedAt: timestamp("logged_at", { withTimezone: true }).notNull().defaultNow(),
  // Free-text label for a manual entry ("Chicken & rice"). Null for sync rows.
  label: text("label"),
  calories: integer("calories"),
  proteinG: integer("protein_g"),
  carbsG: integer("carbs_g"),
  fatG: integer("fat_g"),
  sodiumMg: integer("sodium_mg"),
  // 'manual' | 'health_sync'. Stored as text (no DB enum) to match the rest of
  // this schema and keep migrations additive.
  source: text("source").notNull().default("manual"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type NutritionEntryRow = typeof nutritionEntriesTable.$inferSelect;
