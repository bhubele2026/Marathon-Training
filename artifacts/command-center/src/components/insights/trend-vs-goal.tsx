import * as React from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceArea,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { EmptyState } from "@/components/studio";
import {
  toneColor,
  type InsightGoal,
  type InsightSeriesPoint,
  type SemanticTone,
} from "@/components/insights/types";
import { cn } from "@/lib/utils";

// TrendVsGoal — an insight's logged `series` drawn as a soft gradient area with
// the engine's "should-be" GOAL overlaid, so the gap between what happened and
// what should have happened is always visible. A plain number goal becomes a
// dashed ReferenceLine; a {lo,hi} goal becomes a shaded band. The y-domain hugs
// BOTH the series and the goal so the overlay never falls off-canvas, and a
// sparse run (0–1 points) renders a calm EmptyState instead of a lone dot.
// Built on the same recharts primitives as studio/trend-area.tsx. Pure.

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export type TrendVsGoalProps = {
  series?: InsightSeriesPoint[];
  goal?: InsightGoal | null;
  /** Unit suffix shown in the tooltip (e.g. "g", "oz"). */
  unit?: string;
  /** Tone of the actual area; default azure (primary). */
  tone?: SemanticTone;
  height?: number;
  className?: string;
};

const CHART_CONFIG = {
  value: { label: "Logged", color: "hsl(var(--primary))" },
} satisfies ChartConfig;

export function TrendVsGoal({
  series,
  goal,
  unit,
  tone,
  height = 220,
  className,
}: TrendVsGoalProps) {
  // Hooks must run before any early return.
  const rawId = React.useId();
  const gradientId = `trendgoal-${rawId.replace(/:/g, "")}`;

  const points = series ?? [];
  // Default to azure; a semantic tone overrides it.
  const color = tone ? toneColor(tone) : "hsl(var(--primary))";

  // Sparse / empty state — never render a lone dot in an empty grid.
  if (points.length < 2) {
    return (
      <div
        data-testid="trend-vs-goal"
        className={cn("w-full", className)}
        style={{ minHeight: height }}
      >
        <EmptyState
          title="Not enough logged days yet"
          hint="Log a couple more days and your trend against goal shows up here."
        />
      </div>
    );
  }

  const values = points.map((p) => p.value).filter((n) => Number.isFinite(n));

  // The goal contributes to the domain so the overlay is always on-canvas.
  const goalLo = goal == null ? null : typeof goal === "number" ? goal : goal.lo;
  const goalHi = goal == null ? null : typeof goal === "number" ? goal : goal.hi;

  const spread = [
    ...values,
    ...(goalLo != null ? [goalLo] : []),
    ...(goalHi != null ? [goalHi] : []),
  ];
  const min = Math.min(...spread);
  const max = Math.max(...spread);
  const range = max - min;
  const pad = range === 0 ? Math.max(1, Math.abs(max) * 0.02) : range * 0.15;
  const domain: [number, number] = [
    Math.floor((min - pad) * 10) / 10,
    Math.ceil((max + pad) * 10) / 10,
  ];

  const fmt = (n: number) => `${Math.round(n * 10) / 10}`;
  const animate = !prefersReducedMotion();

  return (
    <ChartContainer
      data-testid="trend-vs-goal"
      config={CHART_CONFIG}
      className={cn("aspect-auto w-full", className)}
      style={{ height }}
    >
      <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.25} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        {/* Hairline dashed horizontal gridlines only. */}
        <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={24}
          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          className="tabular-nums"
        />
        <YAxis
          domain={domain}
          width={40}
          tickLine={false}
          axisLine={false}
          tickMargin={6}
          tickFormatter={(v) => fmt(Number(v))}
          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          className="tabular-nums"
        />
        <ChartTooltip
          cursor={{ stroke: "hsl(var(--border))" }}
          content={
            <ChartTooltipContent
              indicator="line"
              formatter={(value) => `${fmt(Number(value))}${unit ? ` ${unit}` : ""}`}
            />
          }
        />
        {/* The "should-be" overlay: a band for {lo,hi}, a dashed line for a number. */}
        {goalLo != null && goalHi != null && goalLo !== goalHi && (
          <ReferenceArea
            y1={goalLo}
            y2={goalHi}
            fill="hsl(var(--muted-foreground))"
            fillOpacity={0.1}
            stroke="none"
            ifOverflow="extendDomain"
          />
        )}
        {goalLo != null && goalHi != null && goalLo === goalHi && (
          <ReferenceLine
            y={goalLo}
            stroke="hsl(var(--muted-foreground))"
            strokeDasharray="6 4"
            strokeOpacity={0.7}
            ifOverflow="extendDomain"
          />
        )}
        <Area
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={2}
          fill={`url(#${gradientId})`}
          isAnimationActive={animate}
          dot={false}
          activeDot={{ r: 3, fill: color }}
        />
      </AreaChart>
    </ChartContainer>
  );
}
