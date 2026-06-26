import { pgTable, serial, date, doublePrecision, text, timestamp } from "drizzle-orm/pg-core";

// Alcohol logging — timestamped, source-aware drink entries, mirroring the
// water/nutrition entries model. A day's total = sum of its entries'
// `standardDrinks` (1.0 = one standard drink). This is a REDUCTION / awareness
// tool: dry days (a past local day with zero drinks) are the positive metric,
// tracked toward a weekly DRY_DAYS_TARGET.
//
// `source` is 'manual' (in-app +1 drink / custom) or 'shortcut' (the tap-to-log
// Apple Shortcut, authed by ALCOHOL_TOKEN — Apple Health has no native alcohol
// metric, so this is a tap, not a passive sensor).
//
// An explicit "mark dry" is stored as a standardDrinks = 0 entry (source
// 'manual'): it lets the owner mark TODAY intentionally dry before the day is
// past. A day is dry when it's past with no drinks, OR carries a 0 entry.
export const alcoholEntriesTable = pgTable("alcohol_entries", {
  id: serial("id").primaryKey(),
  date: date("date").notNull(),
  loggedAt: timestamp("logged_at", { withTimezone: true }).notNull().defaultNow(),
  // 1.0 = one standard drink; 0 = an explicit "dry" mark.
  standardDrinks: doublePrecision("standard_drinks").notNull(),
  // beer | wine | spirit | other (free text, optional).
  kind: text("kind"),
  source: text("source").notNull().default("manual"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AlcoholEntryRow = typeof alcoholEntriesTable.$inferSelect;
