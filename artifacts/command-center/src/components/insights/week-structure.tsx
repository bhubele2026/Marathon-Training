import { type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { AlcoholDay } from "./types";

// The owner's plan week is the visual spine of BOTH alcohol tiles: Mon–Thu are
// the dry-target days, Fri–Sun are free (no pressure). `buildWeek` reconstructs
// the current Mon–Sun week from the rolling 7-day strip the tiles already
// receive — this week's past days always fall inside that window; future days
// render as quiet upcoming cells.
//
// NOTE: the engine provides a rolling 7-day strip, not a fixed calendar week, so
// we derive the week from it here rather than add a fetch (presentation only).

export type WeekCell = {
  date: string | null;
  index: number; // 0 = Mon … 6 = Sun
  label: string; // M T W T F S S
  isTarget: boolean; // Mon–Thu = the dry-target days
  drinks: number;
  isDry: boolean;
  logged: boolean;
  state: "past" | "today" | "upcoming";
};

const LABELS = ["M", "T", "W", "T", "F", "S", "S"];
const DAY_MS = 86_400_000;
const parse = (d: string) => new Date(`${d}T12:00:00Z`);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function buildWeek(strip: AlcoholDay[]): WeekCell[] {
  if (strip.length === 0) {
    return LABELS.map((label, i) => ({
      date: null,
      index: i,
      label,
      isTarget: i < 4,
      drinks: 0,
      isDry: false,
      logged: false,
      state: "upcoming" as const,
    }));
  }
  const todayStr = strip[strip.length - 1]!.date;
  const todayMs = parse(todayStr).getTime();
  const todayIdx = (parse(todayStr).getUTCDay() + 6) % 7; // Mon = 0
  const mondayMs = todayMs - todayIdx * DAY_MS;
  const byDate = new Map(strip.map((d) => [d.date, d]));
  return LABELS.map((label, i) => {
    const ds = iso(mondayMs + i * DAY_MS);
    const e = byDate.get(ds);
    const state: WeekCell["state"] = ds === todayStr ? "today" : ds < todayStr ? "past" : "upcoming";
    return {
      date: ds,
      index: i,
      label,
      isTarget: i < 4,
      drinks: e?.drinks ?? 0,
      isDry: e?.isDry ?? false,
      logged: e?.logged ?? false,
      state,
    };
  });
}

// The 7-column scaffold: target days (Mon–Thu) carry full-weight labels, free
// days (Fri–Sun) are de-emphasised. The caller fills each cell (a dry-streak dot
// here; the Alcohol tile drives a recharts strip off the same `buildWeek`).
export function WeekStructure({
  week,
  renderCell,
  className,
  testId = "week-structure",
}: {
  week: WeekCell[];
  renderCell: (cell: WeekCell) => ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <div className={cn("grid grid-cols-7 gap-1.5", className)} data-testid={testId}>
      {week.map((cell) => (
        <div key={cell.index} className="flex flex-col items-center gap-1.5">
          <div className="flex h-7 w-full items-center justify-center">{renderCell(cell)}</div>
          <span
            className={cn(
              "font-display text-[10px] font-semibold uppercase tabular-nums",
              cell.isTarget ? "text-muted-foreground" : "text-muted-foreground/45",
            )}
          >
            {cell.label}
          </span>
        </div>
      ))}
    </div>
  );
}
