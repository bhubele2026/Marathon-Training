// Renders a thin horizontal bar that visualizes the FIXED-cadence daily
// time-budget contract (cadence overhaul 2026-06: Mon = 0 / hard rest;
// Tue-Thu SHORT days ∈ [30, 50] min inclusive; Fri-Sun LONG days ∈
// [60, 90] min, with the actual long run open-ended above the floor).
// The plan generator already enforces the contract — this component just
// makes it legible to the runner so they can see at a glance whether a
// day is at the cap, has headroom, or has been pushed over budget by a
// longer logged actual.
//
// Behavior:
//   * Mon (dayOfWeek === 1) — bar is hidden entirely. The PlannedBreakdown
//     parent already returns null on Mon since totalMin = 0 there, so this
//     is mostly a belt-and-suspenders guard.
//   * Tue-Thu (dayOfWeek 2..4) — SHORT days, capped at 50 min. Bar shows
//     planned fill against a 50-min track; the cap label reads
//     "/ 50 MIN BUDGET". A logged actual is overlaid as a thinner inner
//     bar; if actual > 50 the overflow segment renders past the cap in the
//     destructive tone and the label flips to "OVER BUDGET".
//   * Fri-Sun (dayOfWeek 5, 6, 0) — LONG days, anchored to the 60-min
//     floor and open-ended (the long run can run well past 90). No cap
//     warning; label reads "/ 60+ MIN" so the runner still sees the floor.
//     Actual overlay still renders but never colors as "over budget".
//
// Day-of-week is derived from the YYYY-MM-DD date string in local time
// (mirrors how the rest of the UI parses plan_day.date) so a 2026-05-04
// Monday stays a Monday regardless of the user's timezone offset.

import { cn } from "@/lib/utils";

export interface TimeBudgetBarProps {
  date: string;
  plannedMin: number;
  actualMin?: number | null;
  variant?: "compact" | "prominent";
  testIdPrefix?: string;
}

const SHORT_DAY_CAP_MIN = 50;
const LONG_DAY_FLOOR_MIN = 60;

function dayOfWeekFromDate(date: string): number {
  // YYYY-MM-DD parsed as local midnight so the day-of-week matches the
  // calendar day the runner sees in the UI rather than UTC.
  const [y, m, d] = date.split("-").map((s) => Number.parseInt(s, 10));
  if (
    !Number.isFinite(y) ||
    !Number.isFinite(m) ||
    !Number.isFinite(d)
  ) {
    return Number.NaN;
  }
  return new Date(y, m - 1, d).getDay();
}

export function TimeBudgetBar({
  date,
  plannedMin,
  actualMin,
  variant = "compact",
  testIdPrefix,
}: TimeBudgetBarProps) {
  const dow = dayOfWeekFromDate(date);
  // Mon: hidden. NaN (malformed date) also bails out so we never render
  // a meaningless bar.
  if (!Number.isFinite(dow) || dow === 1) return null;
  if (plannedMin <= 0 && (actualMin ?? 0) <= 0) return null;

  // Fri/Sat/Sun (dow 5, 6, 0) are LONG days, anchored to the 60-min floor
  // and open-ended (the long run runs past 90). Tue/Wed/Thu (dow 2, 3, 4)
  // are SHORT days, capped at 50.
  const isLongDay = dow === 0 || dow === 5 || dow === 6;
  const actual = actualMin ?? 0;

  // Track width: short days are anchored to the 50-min cap (with overflow
  // bleeding past it); long days have no upper cap so the track stretches
  // to fit whichever side is largest, but never collapses below the 60-min
  // floor so a 70-min long-run day still reads as "comfortably above the
  // floor".
  const cap = isLongDay
    ? Math.max(LONG_DAY_FLOOR_MIN, plannedMin, actual)
    : SHORT_DAY_CAP_MIN;
  const trackMax = isLongDay
    ? cap
    : Math.max(SHORT_DAY_CAP_MIN, plannedMin, actual);

  const pct = (n: number) => `${Math.min(100, (n / trackMax) * 100)}%`;
  const plannedPct = pct(Math.min(plannedMin, trackMax));
  const actualWithinCapPct = pct(Math.min(actual, cap));
  const actualOverCap = !isLongDay && actual > cap;
  const overCapPct = actualOverCap
    ? `${Math.min(100, ((actual - cap) / trackMax) * 100)}%`
    : "0%";
  // Position of the cap marker on the track (only meaningful when the
  // track extends past the cap — i.e. short day with overflow).
  const capMarkerLeft = pct(cap);

  const overBudget = !isLongDay && actual > SHORT_DAY_CAP_MIN;
  const atCap = !isLongDay && plannedMin >= SHORT_DAY_CAP_MIN;

  const tid = (suffix: string) =>
    testIdPrefix ? `${testIdPrefix}-${suffix}` : undefined;

  const trackHeight = variant === "prominent" ? "h-2" : "h-1.5";
  const labelSize = variant === "prominent" ? "text-[10px]" : "text-[9px]";

  let label: string;
  if (overBudget) {
    label = `${actual} / ${SHORT_DAY_CAP_MIN} min · over budget`;
  } else if (isLongDay) {
    label = `${plannedMin} / ${LONG_DAY_FLOOR_MIN}+ min`;
  } else {
    label = `${plannedMin} / ${SHORT_DAY_CAP_MIN} min budget`;
  }

  // Tone: short-day at-cap reads in the primary accent (we hit the
  // budget — good); over-budget reads destructive; everything else
  // is the neutral primary/40 fill.
  const plannedFillTone = overBudget
    ? "bg-destructive/30"
    : atCap
      ? "bg-primary"
      : "bg-primary/40";
  const actualFillTone = overBudget ? "bg-destructive" : "bg-primary";

  return (
    <div
      className="flex flex-col gap-1"
      data-testid={tid("time-budget")}
    >
      <div
        className={cn(
          "relative w-full rounded-full bg-muted overflow-hidden",
          trackHeight,
        )}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={cap}
        aria-valuenow={Math.min(plannedMin, cap)}
        aria-label={`Planned ${plannedMin} of ${isLongDay ? `${LONG_DAY_FLOOR_MIN}+` : SHORT_DAY_CAP_MIN} minute budget`}
      >
        <div
          className={cn("absolute inset-y-0 left-0", plannedFillTone)}
          style={{ width: plannedPct }}
          data-testid={tid("time-budget-planned")}
        />
        {actual > 0 && (
          <>
            <div
              className={cn(
                "absolute inset-x-0 top-1/2 -translate-y-1/2 h-[2px]",
                actualFillTone,
              )}
              style={{ width: actualWithinCapPct, left: 0, right: "auto" }}
              data-testid={tid("time-budget-actual")}
            />
            {actualOverCap && (
              <div
                className="absolute inset-y-0 bg-destructive"
                style={{ left: capMarkerLeft, width: overCapPct }}
                data-testid={tid("time-budget-overflow")}
              />
            )}
          </>
        )}
        {!isLongDay && trackMax > cap && (
          <div
            className="absolute inset-y-0 w-px bg-foreground/40"
            style={{ left: capMarkerLeft }}
            data-testid={tid("time-budget-cap-marker")}
          />
        )}
      </div>
      <p
        className={cn(
          "tracking-wider font-bold",
          labelSize,
          overBudget ? "text-destructive" : "text-muted-foreground",
        )}
        data-testid={tid("time-budget-label")}
      >
        {label}
      </p>
    </div>
  );
}
