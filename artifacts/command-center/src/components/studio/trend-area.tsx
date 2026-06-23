import * as React from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { cn } from "@/lib/utils";

// Studio chart primitive (DESIGN LAW §8 "charts must never look broken").
// A gradient area trend with a FIXED y-domain that hugs the data (no single
// dot floating in a giant grid), hairline dashed horizontal gridlines, mono
// axis ticks, a card-surface tooltip, and a real sparse fallback when there
// aren't enough points. Wraps the repo's ChartContainer/ChartTooltip.

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export type TrendAreaProps = {
  data: Array<Record<string, unknown>>;
  /** Key for the x (category/date) axis. */
  xKey: string;
  /** Key for the y (numeric) value. */
  yKey: string;
  /** Unit suffix shown in the tooltip (e.g. "lb", "in"). */
  unit?: string;
  /** Override the auto y-domain padding (in data units). */
  domainPad?: number;
  /** Rendered instead of the chart when there are <2 numeric points. */
  sparseFallback?: React.ReactNode;
  height?: number;
  className?: string;
  /** Formats the numeric value for the y-axis ticks + tooltip. */
  valueFormatter?: (n: number) => string;
  /** Formats the x-axis tick label. */
  xTickFormatter?: (v: unknown) => string;
};

const CHART_CONFIG = {
  value: { label: "Value", color: "hsl(var(--primary))" },
} satisfies ChartConfig;

export function TrendArea({
  data,
  xKey,
  yKey,
  unit,
  domainPad,
  sparseFallback,
  height = 220,
  className,
  valueFormatter,
  xTickFormatter,
}: TrendAreaProps) {
  // Hooks must run before any early return.
  const rawId = React.useId();
  const gradientId = `trend-${rawId.replace(/:/g, "")}`;

  const values = data
    .map((d) => Number(d[yKey]))
    .filter((n) => Number.isFinite(n));

  // Sparse / empty state — never render a lone dot in an empty grid.
  if (values.length < 2) {
    if (sparseFallback) return <>{sparseFallback}</>;
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border text-center",
          className,
        )}
        style={{ height }}
      >
        <div className="h-px w-2/3 bg-border" />
        <p className="text-sm text-muted-foreground">Not enough points yet.</p>
      </div>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  const pad = domainPad ?? (range === 0 ? Math.max(1, Math.abs(max) * 0.02) : range * 0.15);
  const domain: [number, number] = [
    Math.floor((min - pad) * 10) / 10,
    Math.ceil((max + pad) * 10) / 10,
  ];

  const fmt = valueFormatter ?? ((n: number) => `${n}`);
  const animate = !prefersReducedMotion();

  return (
    <ChartContainer
      config={CHART_CONFIG}
      className={cn("aspect-auto w-full", className)}
      style={{ height }}
    >
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.25} />
            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
          </linearGradient>
        </defs>
        {/* Hairline dashed horizontal gridlines only. */}
        <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
        <XAxis
          dataKey={xKey}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={24}
          tickFormatter={xTickFormatter}
          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          className="font-mono"
        />
        <YAxis
          domain={domain}
          width={40}
          tickLine={false}
          axisLine={false}
          tickMargin={6}
          tickFormatter={(v) => fmt(Number(v))}
          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          className="font-mono"
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
        <Area
          type="monotone"
          dataKey={yKey}
          stroke="hsl(var(--primary))"
          strokeWidth={2}
          fill={`url(#${gradientId})`}
          isAnimationActive={animate}
          dot={false}
          activeDot={{ r: 3, fill: "hsl(var(--primary))" }}
        />
      </AreaChart>
    </ChartContainer>
  );
}
