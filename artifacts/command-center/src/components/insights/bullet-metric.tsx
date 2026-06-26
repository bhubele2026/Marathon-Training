import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  type NutritionInsight,
  statusTone,
  toneColor,
} from "@/components/insights/types";

// BulletMetric — the "is vs should" workhorse. A horizontal track with the
// floor/ceiling band shaded behind, the target as a vertical tick, and the
// actual as a filled bar in the status colour, plus a label + `actual / target
// unit` readout and a tiny delta. Handles higher_better / lower_better / band.
// Pure presentation; the engine owns every number it draws.

export interface BulletMetricProps {
  insight: NutritionInsight;
  /** Hide the label/value header (e.g. when InsightCard already shows it). */
  showHeader?: boolean;
  className?: string;
}

function fmt(n: number): string {
  return Math.abs(n) >= 100 ? `${Math.round(n)}` : `${Math.round(n * 10) / 10}`;
}

export function BulletMetric({ insight, showHeader = true, className }: BulletMetricProps) {
  const reduced = useReducedMotion();
  const { actual, target, floor, ceiling, unit, status } = insight;

  // Nothing to plot yet — keep a calm placeholder rather than an empty bar.
  if (actual == null) {
    return (
      <div className={cn("space-y-1.5", className)} data-testid={`bullet-${insight.id}`}>
        {showHeader && <Header insight={insight} />}
        <div className="h-2.5 w-full rounded-full bg-muted" />
        <p className="text-[11px] text-muted-foreground">Not logged yet.</p>
      </div>
    );
  }

  // Shared domain so the bar, band and tick are on one scale (a little headroom).
  const domainMax =
    Math.max(actual, target ?? 0, ceiling ?? 0, floor ?? 0, 1) * 1.15;
  const frac = (v: number) => Math.max(0, Math.min(1, v / domainMax));

  // The shaded "good" band: floor..ceiling, else floor..target where it makes sense.
  let band: { lo: number; hi: number } | null = null;
  if (floor != null && ceiling != null) band = { lo: floor, hi: ceiling };
  else if (floor != null && target != null) band = { lo: floor, hi: target };

  const tone = statusTone(status);
  const barColor = toneColor(tone);
  const barW = `${frac(actual) * 100}%`;
  const delta = target != null ? actual - target : null;

  return (
    <div className={cn("space-y-1.5", className)} data-testid={`bullet-${insight.id}`}>
      {showHeader && <Header insight={insight} delta={delta} />}

      <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-muted">
        {/* floor/ceiling band */}
        {band && (
          <div
            className="absolute inset-y-0 rounded-full"
            style={{
              left: `${frac(band.lo) * 100}%`,
              width: `${(frac(band.hi) - frac(band.lo)) * 100}%`,
              backgroundColor: barColor,
              opacity: 0.16,
            }}
            aria-hidden="true"
          />
        )}
        {/* actual fill */}
        <motion.div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ backgroundColor: barColor }}
          initial={{ width: reduced ? barW : 0 }}
          animate={{ width: barW }}
          transition={reduced ? { duration: 0 } : { duration: 0.6, ease: "easeOut" }}
        />
        {/* target tick */}
        {target != null && (
          <div
            className="absolute inset-y-[-2px] w-[2px] rounded-full bg-foreground/70"
            style={{ left: `calc(${frac(target) * 100}% - 1px)` }}
            aria-hidden="true"
          />
        )}
      </div>

      {target != null && (
        <p className="text-[11px] text-muted-foreground">
          target {fmt(target)} {unit}
          {floor != null ? ` · floor ${fmt(floor)}` : ""}
          {ceiling != null && ceiling !== target ? ` · ceiling ${fmt(ceiling)}` : ""}
        </p>
      )}
    </div>
  );
}

function Header({ insight, delta }: { insight: NutritionInsight; delta?: number | null }) {
  const { label, actual, target, unit } = insight;
  const deltaTone =
    delta == null || delta === 0
      ? "text-muted-foreground"
      : delta > 0
        ? "text-[hsl(var(--success))]"
        : "text-[hsl(var(--destructive))]";
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="font-display text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </span>
      <span className="tabular-nums text-[13px] text-foreground">
        <span className="font-semibold">{actual != null ? fmt(actual) : "—"}</span>
        {target != null ? <span className="text-muted-foreground"> / {fmt(target)}</span> : null}
        <span className="ml-0.5 text-muted-foreground">{unit}</span>
        {delta != null && delta !== 0 && (
          <span className={cn("ml-1.5 text-[11px] font-medium", deltaTone)}>
            {delta > 0 ? "+" : ""}
            {fmt(delta)}
          </span>
        )}
      </span>
    </div>
  );
}
