import { pgTable, serial, text, date, doublePrecision, timestamp } from "drizzle-orm/pg-core";

export const measurementsTable = pgTable("measurements", {
  id: serial("id").primaryKey(),
  date: date("date").notNull(),
  weight: doublePrecision("weight"),
  lArm: doublePrecision("l_arm"),
  rArm: doublePrecision("r_arm"),
  lLeg: doublePrecision("l_leg"),
  rLeg: doublePrecision("r_leg"),
  belly: doublePrecision("belly"),
  chest: doublePrecision("chest"),
  // Body-fat percentage (e.g. 22.5 = 22.5%). Optional, logged from a smart
  // scale / DEXA / calipers. This is what turns a flat scale into a real recomp
  // read: lean-mass = weight * (1 - bodyFatPct/100), fat-mass = the rest. The
  // AI nutritionist uses the lean/fat-mass trajectory (not just bodyweight) to
  // judge whether the recomp is actually working.
  bodyFatPct: doublePrecision("body_fat_pct"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type MeasurementRow = typeof measurementsTable.$inferSelect;
