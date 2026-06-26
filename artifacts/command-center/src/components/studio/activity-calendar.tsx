import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// ActivityCalendar — a 30-day (or month) dot grid. Active days are filled navy
// circles; partial/light days a lighter hatched navy; rest days a faint muted
// dot. A footer carries three stats: Active Days · vs last 30 · Streak. Active
// days reveal that day's workout(s) on hover, keyboard focus, or tap.

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

const LEVEL_CLASS: Record<0 | 1 | 2, string> = {
  0: "bg-muted",
  1: "bg-navy/40",
  2: "bg-navy",
};

const levelWord = (l: 0 | 1 | 2) => (l === 0 ? "rest" : l === 1 ? "light" : "active");

// A nicely formatted date for the tooltip header (UTC-noon to dodge DST shifts).
function prettyDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// One day cell. Rest days (and any day with no workout detail) are a plain dot.
// Active days become a focusable button whose tooltip lists the workout(s);
// controlled open so it reveals on hover, keyboard focus, AND tap.
function DayCell({ day }: { day: ActivityDay }) {
  const [open, setOpen] = useState(false);
  const workouts = day.workouts ?? [];
  const hasDetail = day.level > 0 && workouts.length > 0;
  const dot = cn("aspect-square w-full rounded-full", LEVEL_CLASS[day.level]);

  if (!hasDetail) {
    return (
      <div key={day.date} title={day.date} aria-label={`${day.date}: ${levelWord(day.level)}`} className={dot} />
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
            dot,
            "cursor-pointer transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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

function FootStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="font-display text-lg font-extrabold tabular-nums tracking-tight text-foreground">
        {value}
      </span>
      <span className="font-display text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

export function ActivityCalendar({ days, stats, className }: ActivityCalendarProps) {
  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <TooltipProvider delayDuration={150}>
        <div className="grid grid-cols-7 gap-1.5">
          {days.map((d) => (
            <DayCell key={d.date} day={d} />
          ))}
        </div>
      </TooltipProvider>
      {stats != null && (
        <div className="grid grid-cols-3 gap-2 border-t border-card-border pt-3">
          <FootStat label="Active days" value={String(stats.activeDays)} />
          <FootStat
            label="vs last 30"
            value={
              stats.vsLast30 == null
                ? "—"
                : `${stats.vsLast30 > 0 ? "+" : ""}${stats.vsLast30}`
            }
          />
          <FootStat label="Streak" value={String(stats.streak)} />
        </div>
      )}
    </div>
  );
}
