import { cn } from "@/lib/utils";
import type { InsightPerDay, AdherenceHit } from "@/components/insights/types";

// AdherenceDots — a glanceable streak: one dot per logged day from `perDay`.
//   hit = success · close = warning · miss = destructive · none = muted.
// Pure presentation; reduced-motion-safe (no animation).

export interface AdherenceDotsProps {
  perDay?: InsightPerDay[];
  /** Cap to the most recent N days (default 21) to stay glanceable. */
  max?: number;
  className?: string;
}

const DOT_COLOR: Record<AdherenceHit, string> = {
  hit: "hsl(var(--success))",
  close: "hsl(var(--warning))",
  miss: "hsl(var(--destructive))",
  none: "hsl(var(--muted-foreground) / 0.3)",
};

const DOT_LABEL: Record<AdherenceHit, string> = {
  hit: "on target",
  close: "close",
  miss: "missed",
  none: "not logged",
};

export function AdherenceDots({ perDay, max = 21, className }: AdherenceDotsProps) {
  const days = (perDay ?? []).slice(-max);
  if (days.length === 0) return null;
  return (
    <div
      className={cn("flex flex-wrap items-center gap-1", className)}
      data-testid="adherence-dots"
      role="img"
      aria-label={`Adherence over the last ${days.length} logged days`}
    >
      {days.map((d, i) => (
        <span
          key={`${d.date}-${i}`}
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: DOT_COLOR[d.hit] }}
          title={`${d.date}: ${DOT_LABEL[d.hit]}`}
        />
      ))}
    </div>
  );
}
