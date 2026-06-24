import { cn } from "@/lib/utils";

// ActivityCalendar — a 30-day (or month) dot grid. Active days are filled navy
// circles; partial/light days a lighter hatched navy; rest days a faint muted
// dot. A footer carries three stats: Active Days · vs last 30 · Streak. Pure
// presentation — the caller supplies the day cells and the computed stats.

export interface ActivityDay {
  /** ISO yyyy-mm-dd (used as key + title). */
  date: string;
  /** 0 = rest, 1 = light/partial, 2 = full. */
  level: 0 | 1 | 2;
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
      <div className="grid grid-cols-7 gap-1.5">
        {days.map((d) => (
          <div
            key={d.date}
            title={d.date}
            aria-label={`${d.date}: ${d.level === 0 ? "rest" : d.level === 1 ? "light" : "active"}`}
            className={cn(
              "aspect-square w-full rounded-full",
              LEVEL_CLASS[d.level],
            )}
          />
        ))}
      </div>
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
