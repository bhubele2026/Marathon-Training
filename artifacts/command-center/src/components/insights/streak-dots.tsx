import { cn } from "@/lib/utils";
import { type InsightPerDay, type AdherenceHit } from "./types";

// StreakDots — the mockup's per-day adherence row: hit (success) · close
// (warning) · miss (destructive) · none (muted slot), with an optional inline
// "N/M on target" tally. Token-driven; static (reduced-motion-safe).

const DOT_BG: Record<AdherenceHit, string> = {
  hit: "hsl(var(--success))",
  close: "hsl(var(--warning))",
  miss: "hsl(var(--destructive))",
  none: "color-mix(in oklab, var(--muted-foreground) 30%, var(--card))",
};

const DOT_TITLE: Record<AdherenceHit, string> = {
  hit: "on target",
  close: "close",
  miss: "missed",
  none: "not logged",
};

export interface StreakDotsProps {
  perDay?: InsightPerDay[];
  daysHit?: number | null;
  daysLogged?: number | null;
  /** Append a muted "N/M on target" tally after the dots. */
  tally?: boolean;
  /** Dot diameter in px. */
  size?: number;
  /** Cap to the most recent N days. */
  max?: number;
  wrap?: boolean;
  className?: string;
}

export function StreakDots({
  perDay,
  daysHit,
  daysLogged,
  tally = false,
  size = 11,
  max = 14,
  wrap = false,
  className,
}: StreakDotsProps) {
  const days = (perDay ?? []).slice(-max);
  if (days.length === 0 && !tally) return null;
  return (
    <div
      className={cn("flex items-center gap-1.5", wrap && "flex-wrap", className)}
      data-testid="streak-dots"
      role="img"
      aria-label={`Adherence over ${days.length} logged days`}
    >
      {days.map((d, i) => (
        <span
          key={`${d.date}-${i}`}
          className="rounded-full"
          style={{ width: size, height: size, background: DOT_BG[d.hit] }}
          title={`${d.date}: ${DOT_TITLE[d.hit]}`}
        />
      ))}
      {tally && daysHit != null && daysLogged ? (
        <span className="ml-1 text-[11.5px] text-muted-foreground">
          {daysHit}/{daysLogged} on target
        </span>
      ) : null}
    </div>
  );
}
