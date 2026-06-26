import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// ActivityCalendar — a compact, GitHub-contributions-style 30-day heatmap. Small
// rounded-square tiles laid out in real weekday columns (Sun→Sat) with a weekday
// axis and a less→more legend, so the colours read as a heatmap instead of a
// sparse field of dots. A footer leads with Active days, then Streak + the
// signed delta vs the prior 30. Active days reveal that day's workout(s) on
// hover / keyboard focus / tap.

// A compact summary of one logged workout on a given day.
export interface ActivityWorkout {
  /** e.g. "Lower Strength" or "Long Run". */
  label: string;
  /** e.g. "Tonal · 42 min" or "Treadmill · 6.2 mi". */
  detail?: string;
}

export interface ActivityDay {
  /** ISO yyyy-mm-dd (used as key + title). */
  date: string;
  /** 0 = rest, 1 = light/partial, 2 = full. */
  level: 0 | 1 | 2;
  /** That day's workout(s), shown on hover/tap. Empty/absent on rest days. */
  workouts?: ActivityWorkout[];
}

export interface ActivityCalendarProps {
  days: ActivityDay[];
  stats?: {
    activeDays: number;
    /** Signed delta vs the prior comparable window. */
    vsLast30?: number;
    streak: number;
  };
  className?: string;
}

// 3-level ramp. Level 0 is a faint TRACK (visible on white AND dark, never an
// empty hole); levels 1–2 use the brand navy so active days clearly stand out.
const LEVEL_CLASS: Record<0 | 1 | 2, string> = {
  0: "bg-muted-foreground/15",
  1: "bg-navy/45",
  2: "bg-navy",
};

const TILE = "h-3.5 w-3.5 rounded-[3px]";

// Weekday axis (Sun→Sat); show M / W / F so the rows have meaning without clutter.
const WEEKDAY_AXIS = ["", "M", "", "W", "", "F", ""];

const levelWord = (l: 0 | 1 | 2) => (l === 0 ? "rest" : l === 1 ? "light" : "active");

// UTC-noon to dodge DST shifts.
const weekdayOf = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();

// A nicely formatted date for the tooltip header.
function prettyDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// One day cell. Rest days (and any day with no workout detail) are a plain tile.
// Active days become a focusable button whose tooltip lists the workout(s);
// controlled open so it reveals on hover, keyboard focus, AND tap.
function DayCell({ day }: { day: ActivityDay }) {
  const [open, setOpen] = useState(false);
  const workouts = day.workouts ?? [];
  const hasDetail = day.level > 0 && workouts.length > 0;
  const tile = cn(TILE, LEVEL_CLASS[day.level]);

  if (!hasDetail) {
    return (
      <div key={day.date} title={day.date} aria-label={`${day.date}: ${levelWord(day.level)}`} className={tile} />
    );
  }

  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={`${day.date}: ${workouts.map((w) => w.label).join(", ")}`}
          className={cn(
            tile,
            "cursor-pointer transition-transform hover:scale-125 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
          data-testid={`activity-day-${day.date}`}
        />
      </TooltipTrigger>
      <TooltipContent className="max-w-[15rem] bg-card text-foreground border border-card-border shadow-card">
        <p className="mb-1 font-display text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          {prettyDate(day.date)}
        </p>
        <ul className="space-y-0.5">
          {workouts.map((w, i) => (
            <li key={i} className="text-[12.5px] leading-snug">
              <span className="font-semibold text-foreground">{w.label}</span>
              {w.detail && <span className="text-muted-foreground"> · {w.detail}</span>}
            </li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}

// A small footer stat — mono numeral + uppercase eyebrow, shared shape with the
// Alcohol card so the two read as siblings.
function FootStat({ value, label, tone }: { value: string; label: string; tone?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span
        className="font-mono text-[15px] font-bold leading-none tabular-nums tracking-tight text-foreground"
        style={tone ? { color: tone } : undefined}
      >
        {value}
      </span>
      <span className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

export function ActivityCalendar({ days, stats, className }: ActivityCalendarProps) {
  // Lay the days out column-by-week with leading blanks, so every column maps to
  // a real weekday (Sun→Sat) instead of wrapping arbitrarily. grid-flow-col with
  // grid-rows-7 fills each week top-to-bottom, then moves to the next column.
  const lead = days.length ? weekdayOf(days[0]!.date) : 0;
  const cells: Array<{ day: ActivityDay } | null> = [
    ...Array.from({ length: lead }, () => null),
    ...days.map((day) => ({ day })),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const vs = stats?.vsLast30;
  const vsTone =
    vs == null || vs === 0
      ? undefined
      : vs > 0
        ? "hsl(var(--success))"
        : "hsl(var(--warning))";

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {/* Period label + a tiny less→more legend so the colours mean something. */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">Last 30 days</span>
        <div className="flex items-center gap-1 text-[9px] uppercase tracking-wide text-muted-foreground/80">
          <span>Less</span>
          <span className={cn("h-2.5 w-2.5 rounded-[2px]", LEVEL_CLASS[0])} />
          <span className={cn("h-2.5 w-2.5 rounded-[2px]", LEVEL_CLASS[1])} />
          <span className={cn("h-2.5 w-2.5 rounded-[2px]", LEVEL_CLASS[2])} />
          <span>More</span>
        </div>
      </div>

      {/* Heatmap: weekday axis + week columns. */}
      <TooltipProvider delayDuration={150}>
        <div className="flex justify-center gap-1.5">
          <div className="grid grid-rows-7 gap-1">
            {WEEKDAY_AXIS.map((l, i) => (
              <span
                key={i}
                aria-hidden="true"
                className="flex h-3.5 items-center text-[9px] font-medium leading-none text-muted-foreground/70"
              >
                {l}
              </span>
            ))}
          </div>
          <div className="grid grid-flow-col grid-rows-7 gap-1">
            {cells.map((c, i) =>
              c ? (
                <DayCell key={c.day.date} day={c.day} />
              ) : (
                <div key={`blank-${i}`} aria-hidden="true" className={cn(TILE, "bg-transparent")} />
              ),
            )}
          </div>
        </div>
      </TooltipProvider>

      {/* Footer: Active days is the hero; Streak + the signed delta are secondary. */}
      {stats != null && (
        <div className="flex items-end justify-between border-t border-card-border pt-3">
          <div className="flex flex-col gap-0.5">
            <span className="flex items-baseline gap-0.5 leading-none">
              <span className="font-mono text-2xl font-extrabold tabular-nums tracking-tight text-foreground">
                {stats.activeDays}
              </span>
              <span className="font-mono text-sm font-bold tabular-nums text-muted-foreground">/30</span>
            </span>
            <span className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Active days
            </span>
          </div>
          <div className="flex items-end gap-4">
            <FootStat value={String(stats.streak)} label="Streak" />
            <FootStat
              value={vs == null ? "—" : `${vs > 0 ? "+" : ""}${vs}`}
              label="vs prev 30"
              tone={vsTone}
            />
          </div>
        </div>
      )}
    </div>
  );
}
