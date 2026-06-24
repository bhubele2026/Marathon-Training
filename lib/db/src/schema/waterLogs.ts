import { pgTable, serial, date, integer, text, timestamp } from "drizzle-orm/pg-core";

// Phase 13 — timestamped, source-aware water logs (in fluid ounces). Water now
// has its own first-class store instead of a single scalar on nutrition_days.
// A day's water total = sum of its logs; `recomputeDay` derives
// nutrition_days.water_ml from these so the existing reads keep working.
//
// `source` is 'manual' (a tap-to-add cup / custom oz in the app) or
// 'health_sync' (the Apple-Shortcut push collapses the day's synced water into
// a single health_sync log, replaced on re-push — no double-count).
export const waterLogsTable = pgTable("water_logs", {
  id: serial("id").primaryKey(),
  date: date("date").notNull(),
  loggedAt: timestamp("logged_at", { withTimezone: true }).notNull().defaultNow(),
  // Volume in fluid ounces (the unit the WaterTracker UI works in).
  oz: integer("oz").notNull(),
  source: text("source").notNull().default("manual"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type WaterLogRow = typeof waterLogsTable.$inferSelect;
