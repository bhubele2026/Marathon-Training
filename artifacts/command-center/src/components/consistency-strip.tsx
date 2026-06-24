import { cn } from "@/lib/utils";
import { Flame } from "lucide-react";

// A compact "logging telemetry" strip: a current logging STREAK + a clickable
// mini-calendar of the last N days (one bar per day, accent when that day has
// intake logged, muted when not). Clicking a bar jumps the day navigator to
// that day. Pure presentation off the recent feed the page already holds.

type DayEntry = {
  date: string;
  calories: number | null;
  proteinG: number | null;
};

const DAY_MS = 86_400_000;
const ymd = (t: number): string => new Date(t).toISOString().slice(0, 10);

function shortLabel(dateStr: string): string {
  return new Date(`${dateStr}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function ConsistencyStrip({
  entries,
  selectedDate,
  todayStr,
  onSelect,
  days = 14,
}: {
  entries: DayEntry[];
  selectedDate: string;
  todayStr: string;
  onSelect: (date: string) => void;
  days?: number;
}) {
  const byDate = new Map(entries.map((e) => [e.date, e]));
  const isLogged = (d: string) => {
    const e = byDate.get(d);
    return e != null && (e.calories != null || e.proteinG != null);
  };

  const todayNoon = new Date(`${todayStr}T12:00:00Z`).getTime();

  // Last `days` calendar days, oldest -> newest.
  const list = Array.from({ length: days }, (_, i) => {
    const date = ymd(todayNoon - (days - 1 - i) * DAY_MS);
    return { date, logged: isLogged(date) };
  });

  // Current streak: consecutive logged days ending today (a not-yet-logged
  // today is forgiven — we then count back from yesterday).
  let streak = 0;
  for (let i = 0; i < 400; i++) {
    const date = ymd(todayNoon - i * DAY_MS);
    if (isLogged(date)) {
      streak++;
    } else if (i === 0) {
      continue; // today not logged yet — don't break the streak
    } else {
      break;
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-card-border bg-card px-4 py-3 shadow-card">
      <div className="flex items-baseline gap-2">
        <Flame
          className={cn(
            "h-4 w-4 self-center",
            streak > 0 ? "text-primary" : "text-muted-foreground",
          )}
        />
        <span className="font-mono text-xl font-semibold tabular-nums leading-none text-foreground">
          {streak}
        </span>
        <span className="text-xs text-muted-foreground">
          day{streak === 1 ? "" : "s"} logged in a row
        </span>
      </div>
      <div className="flex items-end gap-1" role="group" aria-label="Logging history, last days">
        {list.map((d) => (
          <button
            key={d.date}
            type="button"
            onClick={() => onSelect(d.date)}
            title={`${shortLabel(d.date)}${d.logged ? " · logged" : " · not logged"}`}
            aria-label={`${shortLabel(d.date)}${d.logged ? ", logged" : ", not logged"}`}
            className={cn(
              "h-6 w-2.5 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
              d.logged ? "bg-primary hover:bg-primary/80" : "bg-muted hover:bg-muted-foreground/30",
              d.date === selectedDate && "ring-2 ring-ring ring-offset-1 ring-offset-background",
            )}
            data-testid={`day-dot-${d.date}`}
          />
        ))}
      </div>
    </div>
  );
}
