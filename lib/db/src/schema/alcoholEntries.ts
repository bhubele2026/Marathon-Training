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

// --- Alcohol analytics (the deterministic engine's output) -----------------
// A reduction/awareness read computed server-side from the entries + training +
// nutrition. Shared shape: it rides on the two alcohol NutritionInsight tiles
// (caption/detail written by the coach) AND is served raw to the dashboard
// alcohol box via GET /api/alcohol/summary, so the weekly dry-days goal and the
// "what drinking costs" read agree wherever they appear.

// One day on the 7-day strip. `logged` distinguishes a real entry (drank or an
// explicit dry mark) from a past day inferred dry (no entry since tracking began).
export type AlcoholDay = {
  date: string;
  drinks: number;
  isDry: boolean;
  logged: boolean;
};

// One ISO (Mon-start) week of the week-over-week trend.
export type AlcoholWeek = {
  weekStart: string; // YYYY-MM-DD (Monday)
  dryDays: number;
  drinkingDays: number;
  drinks: number;
  hitTarget: boolean;
  inProgress: boolean; // the current, not-yet-complete week
};

// One impact comparison row: a recovery/training/eating metric averaged across
// drinking days vs dry days, with the delta. `betterWhenDry` orients the arrow;
// honest small-sample reads set the averages null and lean on `note`.
export type AlcoholImpact = {
  key: "trainingLoad" | "sessionAdherence" | "protein" | "calories" | "hydration";
  label: string;
  drinkingAvg: number | null;
  dryAvg: number | null;
  deltaPct: number | null; // signed % (drinking vs dry), null when not comparable
  betterWhenDry: boolean;
  note: string;
};

export type AlcoholStats = {
  active: boolean; // any entry exists → tracking has started
  seedState: boolean; // < ~2 weeks of tracking → show an early read, not false precision
  daysTracked: number; // days from the first entry through today
  dryDaysTarget: number; // the single configurable weekly goal (DRY_DAYS_TARGET)
  // This (current) week
  weekDrinks: number;
  drinkingDaysThisWeek: number;
  drinkingBudget: number; // 7 − dryDaysTarget
  dryDaysThisWeek: number;
  // Streaks (dry days)
  currentDryStreak: number;
  longestDryStreak: number;
  // Last 7 calendar days, oldest → newest, for the intake bar strip
  dailyStrip: AlcoholDay[];
  // Week over week, oldest → newest
  weeklyTrend: AlcoholWeek[];
  avgDryPerWeek: number | null; // over completed tracked weeks
  weeksOnTarget: number; // completed weeks that hit target
  weeksTracked: number; // completed tracked weeks
  weeksOnTargetStreak: number; // consecutive most-recent completed weeks on target
  // What drinking costs (empty until there's enough to compare)
  impact: AlcoholImpact[];
};
