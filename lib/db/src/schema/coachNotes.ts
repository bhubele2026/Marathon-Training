import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Coach voice cache (Phases 4-5). The daily reaction and the weekly summary are
// AI-generated and EXPENSIVE, so each is cached and only regenerated when its
// inputs change — detected by comparing a content hash of the day's/week's data
// (`inputHash`) on read. No explicit per-mutation invalidation needed: a stale
// hash on GET triggers a regenerate.

// Daily coach reaction, keyed by date (single-user).
export const coachDailyNotesTable = pgTable("coach_daily_notes", {
  date: text("date").primaryKey(), // YYYY-MM-DD
  note: text("note").notNull(),
  // Hash of the day's inputs (targets + actuals + planned/logged session). When
  // the live hash differs, the note is stale and regenerated.
  inputHash: text("input_hash").notNull(),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CoachDailyNoteRow = typeof coachDailyNotesTable.$inferSelect;

// Weekly summary, keyed by the week-start Monday (single-user). Persisted so
// prior weeks are stable + browsable (Phase 5).
export const coachWeeklySummariesTable = pgTable("coach_weekly_summaries", {
  weekStart: text("week_start").primaryKey(), // YYYY-MM-DD (Monday)
  summary: text("summary").notNull(),
  inputHash: text("input_hash").notNull(),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CoachWeeklySummaryRow = typeof coachWeeklySummariesTable.$inferSelect;
