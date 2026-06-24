// Phase 9 — local-day boundary + day-state for the time-aware coach.
//
// The app historically computed "today" as `new Date().toISOString().slice(0,10)`
// (UTC). In the US that rolls a late-evening log into the next UTC day and, worse,
// makes the coach see a brand-new (empty) day at, say, 7pm local — then grade the
// half-finished day as a failure. These helpers compute the day boundary in the
// runner's OWN IANA timezone (stored on user_preferences.timezone), so "today" and
// the coach's notion of how much of the day is left are local, not UTC.
//
// No new deps — uses the built-in Intl timezone database.

export interface DayState {
  /** Local calendar date (YYYY-MM-DD) in the given timezone, right now. */
  localDate: string;
  /** Local hour 0–23 right now. */
  localHour: number;
  /** 0..1 fraction of the local day elapsed (00:00 → 0, 24:00 → 1). */
  fractionOfDayElapsed: number;
  /** True when the date under consideration IS the current local day. */
  isToday: boolean;
  /**
   * True when the day under consideration is no longer open for logging:
   * the runner explicitly closed it, OR it is a calendar date before today.
   * The current, in-progress local day is open (false) unless explicitly
   * closed. Verdicts ("you fell short") belong on a closed day; an open day
   * gets pace talk, never a failure grade.
   */
  isClosed: boolean;
}

// Extract local Y/M/D/H/M/S parts for `now` in the given timezone. Falls back
// to UTC when tz is null/empty/invalid (Intl throws on a bad tz → we catch).
function localParts(
  tz: string | null | undefined,
  now: Date,
): { year: string; month: string; day: string; hour: number; minute: number; second: number } {
  const tryFormat = (timeZone: string) => {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const p: Record<string, string> = {};
    for (const part of fmt.formatToParts(now)) {
      if (part.type !== "literal") p[part.type] = part.value;
    }
    // `hour12:false` can emit "24" at midnight in some engines — normalize.
    const hour = Number(p.hour) % 24;
    return {
      year: p.year!,
      month: p.month!,
      day: p.day!,
      hour,
      minute: Number(p.minute),
      second: Number(p.second),
    };
  };
  try {
    return tryFormat(tz && tz.trim() ? tz : "UTC");
  } catch {
    return tryFormat("UTC");
  }
}

/** "Today" as YYYY-MM-DD in the runner's local timezone (UTC fallback). */
export function localToday(tz: string | null | undefined, now: Date = new Date()): string {
  const p = localParts(tz, now);
  return `${p.year}-${p.month}-${p.day}`;
}

/**
 * Day-state for the coach. Pass the date being analyzed (defaults to "today")
 * and its explicit closedAt to get a correct `isClosed`/`isToday`.
 */
export function dayState(
  tz: string | null | undefined,
  opts: { date?: string; closedAt?: Date | string | null } = {},
  now: Date = new Date(),
): DayState {
  const p = localParts(tz, now);
  const localDate = `${p.year}-${p.month}-${p.day}`;
  const fractionOfDayElapsed =
    (p.hour * 3600 + p.minute * 60 + p.second) / 86400;
  const date = opts.date ?? localDate;
  const isToday = date === localDate;
  const explicitlyClosed = opts.closedAt != null;
  const isPast = date < localDate;
  return {
    localDate,
    localHour: p.hour,
    fractionOfDayElapsed,
    isToday,
    isClosed: explicitlyClosed || isPast,
  };
}
