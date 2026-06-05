// Minimal ISO (yyyy-mm-dd) date math. We avoid date-fns here so the package
// stays dependency-free and shareable between the api-server and any caller.
// All math is done in UTC to dodge DST / local-offset drift — the rest of the
// app already computes "today" in UTC (see replit.md → Deployment notes).

const DAY_MS = 24 * 60 * 60 * 1000;

/** Day-of-week labels in the app's Mon→Sun week order. */
export const DAY_ORDER = [
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
  "Sun",
] as const;

export type DayName = (typeof DAY_ORDER)[number];

function parseISO(iso: string): number {
  // Expect "yyyy-mm-dd". Date.parse treats this as UTC midnight.
  const ms = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(ms)) {
    throw new Error(`Invalid ISO date: ${iso}`);
  }
  return ms;
}

function formatISO(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Add `n` whole days to an ISO date, returning a new ISO date. */
export function addDaysISO(iso: string, n: number): string {
  return formatISO(parseISO(iso) + n * DAY_MS);
}

/** 0 = Monday … 6 = Sunday (matches DAY_ORDER). */
export function weekdayIndex(iso: string): number {
  // JS getUTCDay: 0 = Sunday … 6 = Saturday. Shift so Monday = 0.
  const jsDay = new Date(parseISO(iso)).getUTCDay();
  return (jsDay + 6) % 7;
}

/** True when the ISO date falls on a Monday. */
export function isMonday(iso: string): boolean {
  return weekdayIndex(iso) === 0;
}

/** True when the ISO date falls on a Sunday. */
export function isSunday(iso: string): boolean {
  return weekdayIndex(iso) === 6;
}
