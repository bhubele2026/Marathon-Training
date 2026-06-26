import * as React from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceArea,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { EmptyState, SegmentedControl } from "@/components/studio";
import {
  toneColor,
  type BodyTrajectoryPoint,
  type SemanticTone,
} from "@/components/insights/types";
import { cn } from "@/lib/utils";

// RecompTrajectory — the body-composition chart. Defaults to body-fat % over
// time with the engine's expected downward "should-be" recomp BAND shaded
// behind the actual line; a SegmentedControl re-keys the chart between Body-fat
// / Weight / Lean / Fat. The band only shows for body-fat (the only metric the
// engine prescribes a zone for). Sparse metrics (<2 non-null points) get a calm
// EmptyState. The four stat tiles live in a sibling — this is just the chart +
// toggle. Built on the same recharts primitives as studio/trend-area.tsx. Pure.

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export type RecompMetric = "bodyfat" | "weight" | "lean" | "fat";

type MetricSpec = {
  value: RecompMetric;
  label: string;
  key: keyof Omit<BodyTrajectoryPoint, "date">;
  unit: string;
};

const METRICS: MetricSpec[] = [
  { value: "bodyfat", label: "Body-fat", key: "bodyFatPct", unit: "%" },
  { value: "weight", label: "Weight", key: "weightLb", unit: "lb" },
  { value: "lean", label: "Lean", key: "leanLb", unit: "lb" },
  { value: "fat", label: "Fat", key: "fatLb", unit: "lb" },
];

export type RecompTrajectoryProps = {
  trajectory?: BodyTrajectoryPoint[];
  expectedBand?: { lo: number; hi: number } | null;
  /** Tone of the actual line; default azure (primary). */
  tone?: SemanticTone;
  height?: number;
  className?: string;
};

const CHART_CONFIG = {
  value: { label: "Logged", color: "hsl(var(--primary))" },
} satisfies ChartConfig;

export function RecompTrajectory({
  trajectory,
  expectedBand,
  tone,
  height = 220,
  className,
}: RecompTrajectoryProps) {
  // Hooks must run before any early return.
  const rawId = React.useId();
  const gradientId = `recomp-${rawId.replace(/:/g, "")}`;
  const [metric, setMetric] = React.useState<RecompMetric>("bodyfat");

  const spec = METRICS.find((m) => m.value === metric) ?? METRICS[0];
  const color = tone ? toneColor(tone) : "hsl(var(--primary))";

  const points = trajectory ?? [];
  // Re-key the chart to the chosen metric, dropping null points.
  const data = points
    .map((p) => ({ date: p.date, value: p[spec.key] }))
    .filter((p) => p.value != null && Number.isFinite(p.value as number)) as Array<{
    date: string;
    value: number;
  }>;

  // The band is only meaningful for body-fat (the prescribed recomp zone).
  const showBand = metric === "bodyfat" && expectedBand != null;

  const toggle = (
    <SegmentedControl<RecompMetric>
      ariaLabel="Body metric"
      value={metric}
      onChange={setMetric}
      size="sm"
      options={METRICS.map((m) => ({ value: m.value, label: m.label }))}
    />
  );

  // Sparse / empty state — never render a lone dot in an empty grid.
  if (data.length < 2) {
    return (
      <div
        data-testid="recomp-trajectory"
        className={cn("flex w-full flex-col gap-3", className)}
      >
        <div className="flex justify-end">{toggle}</div>
        <EmptyState
          title="Log weight + body-fat % to see your recomp trend"
          hint="A couple more logged days and your body-composition curve fills in here."
        />
      </div>
    );
  }

  const values = data.map((d) => d.value);
  const spread = [
    ...values,
    ...(showBand && expectedBand ? [expectedBand.lo, expectedBand.hi] : []),
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
    <div
      data-testid="recomp-trajectory"
      className={cn("flex w-full flex-col gap-3", className)}
    >
      <div className="flex justify-end">{toggle}</div>
      <ChartContainer
        config={CHART_CONFIG}
        className="aspect-auto w-full"
        style={{ height }}
      >
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
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
                formatter={(value) => `${fmt(Number(value))} ${spec.unit}`}
              />
            }
          />
          {/* The expected "should-be" recomp zone, only for body-fat. */}
          {showBand && expectedBand && (
            <ReferenceArea
              y1={expectedBand.lo}
              y2={expectedBand.hi}
              fill="hsl(var(--success))"
              fillOpacity={0.1}
              stroke="none"
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
    </div>
  );
}
