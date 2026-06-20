import { pgTable, integer, text, jsonb, timestamp } from "drizzle-orm/pg-core";

// Shape of one stored finding (kept local so the db package has no dependency on
// the api-server analyzer; the route casts to its richer Finding type).
export type StoredFinding = {
  id: string;
  rank: number;
  tone: string;
  title: string;
  cause: string;
  fix: string;
};

// Latest "what's happening" diagnosis (single-user → singleton id=1). The
// analyzer + coach narration are expensive, so the latest result is persisted
// and only regenerated when the underlying metrics change (inputHash mismatch),
// matching the coach-note caching pattern. Stable so the dashboard panel and the
// weekly summary read the same finding.
export const progressDiagnosisTable = pgTable("progress_diagnosis", {
  id: integer("id").primaryKey(), // always 1
  weeks: integer("weeks").notNull(),
  headline: text("headline").notNull(),
  findings: jsonb("findings").$type<StoredFinding[]>().notNull(),
  // Coach-voice narration of the top findings (persona). Null if AI unavailable.
  narrative: text("narrative"),
  inputHash: text("input_hash").notNull(),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ProgressDiagnosisRow = typeof progressDiagnosisTable.$inferSelect;
