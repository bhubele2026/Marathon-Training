import { pgTable, text, date, timestamp } from "drizzle-orm/pg-core";

// Task #345. Supplemental B-races scheduled by the runner outside the
// active Phase Planner config (e.g. a 5K mid-campaign while training for
// a half). Independent of `plan_days` so they survive Phase Planner
// re-applies AND Full Reset, and independent of the active
// `marathonDate` so the A-race / race-week math is unaffected. Logging
// a finish on race day still writes to `race_results` keyed by the same
// date (with the captured `raceKind`), so PR detection (Task #318) and
// the /races history listing both work without a second store.
export const scheduledRacesTable = pgTable("scheduled_races", {
  raceDate: date("race_date").primaryKey(),
  // Constrained at the route layer to the same four canonical kinds
  // (`marathon` | `half` | `10k` | `5k`) that `race_results.race_kind`
  // and the `raceDayLabel` helper already speak.
  raceKind: text("race_kind").notNull(),
  name: text("name"),
  notes: text("notes"),
  recordedAt: timestamp("recorded_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ScheduledRaceRow = typeof scheduledRacesTable.$inferSelect;
