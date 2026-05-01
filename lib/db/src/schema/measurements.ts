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
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type MeasurementRow = typeof measurementsTable.$inferSelect;
