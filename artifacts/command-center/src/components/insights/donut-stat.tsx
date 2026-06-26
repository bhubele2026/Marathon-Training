import { cn } from "@/lib/utils";
import { RadialGauge } from "./radial-gauge";
import { StreakDots } from "./streak-dots";
import { type InsightPerDay } from "./types";

// DonutStat — the consistency viz: the shared RadialGauge as an azure donut of
// "% on target", paired with a meta block (sessions tally, a nudge line, and a
// wrapping StreakDots day strip). Identity-coloured donut (--chart-1), so it
// reads as the consistency signal rather than a status. Token-driven + pure;
// the gauge handles its own reduced-motion behaviour.

export interface DonutStatProps {
  /** 0..1 fill (share of days on target). */
  pct: number;
  /** Donut centre value; defaults to the rounded percentage. */
  centerMain?: string;
  centerSub?: string;
  /** Bold tally line, e.g. "7 sessions / 2 wk". */
  statText?: string;
  /** Muted nudge line under the tally. */
  sub?: string;
  perDay?: InsightPerDay[];
  className?: string;
}

export function DonutStat({
  pct,
  centerMain,
  centerSub = "on target",
  statText,
  sub,
  perDay,
  className,
}: DonutStatProps) {
  const p = Math.max(0, Math.min(1, pct));
  const main = centerMain ?? `${Math.round(p * 100)}%`;

  return (
    <div
      data-testid="donut-stat"
      className={cn("flex items-center gap-[14px]", className)}
    >
      <RadialGauge
        pct={p}
        color="hsl(var(--chart-1))"
        centerMain={main}
        centerSub={centerSub}
      />
      <div className="flex flex-col gap-1.5">
        {statText && (
          <div className="font-mono text-[17px] font-bold leading-none text-foreground">
            {statText}
          </div>
        )}
        {sub && <div className="text-[11.5px] text-muted-foreground">{sub}</div>}
        <StreakDots perDay={perDay} wrap />
      </div>
    </div>
  );
}
