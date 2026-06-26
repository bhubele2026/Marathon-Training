import { useId } from "react";
import { cn } from "@/lib/utils";
import { type BodyStat, type BodyTrajectoryPoint } from "./types";

// RecompHero — the wide body-composition hero CONTENT (the mockup `.row`): a big
// mono body-fat %, a hand-rolled SVG sparkline of the body-fat series (azure
// area + line + end dot) with the engine's expected downward "should-be" band/
// line overlaid, and a mini Weight / Lean / Fat stat strip with trend deltas.
// Token-driven (no hex) so it reads on white AND dark; renders the inner row
// only — the parent InsightTile provides the card/border. Static + pure.

const VB_W = 320;
const VB_H = 84;
const PAD_TOP = 14;
const PAD_BOTTOM = 14;
const BAND_HALF = 6; // expected-band half-thickness, viewBox units

// Map a body-fat value into the sparkline's vertical space. Higher body-fat
// plots higher (smaller y), so a falling series reads as a downward curve.
function makeScaleY(min: number, max: number) {
  const span = max - min || 1;
  const usable = VB_H - PAD_TOP - PAD_BOTTOM;
  return (v: number) => PAD_TOP + ((max - v) / span) * usable;
}

function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

// Colour a stat's delta by whether the change moved in the good direction.
function trendColor(stat: BodyStat): string {
  const { change, goodDirection } = stat;
  if (change == null || change === 0 || goodDirection === "either") {
    return "hsl(var(--muted-foreground))";
  }
  const good = goodDirection === "down" ? change < 0 : change > 0;
  return good ? "hsl(var(--success))" : "hsl(var(--destructive))";
}

function trendGlyph(change: number | null): string {
  if (change == null || change === 0) return "—";
  return change > 0 ? "▲" : "▼";
}

export interface RecompHeroProps {
  bodyFatPct: number | null;
  bodyFatSub?: string;
  trajectory?: BodyTrajectoryPoint[];
  expectedBand?: { lo: number; hi: number } | null;
  bodyStats?: BodyStat[];
  className?: string;
}

export function RecompHero({
  bodyFatPct,
  bodyFatSub,
  trajectory,
  expectedBand,
  bodyStats,
  className,
}: RecompHeroProps) {
  const rawId = useId();
  const gradientId = `recomp-hero-${rawId.replace(/:/g, "")}`;

  // The body-fat series, nulls dropped.
  const series = (trajectory ?? [])
    .map((p) => p.bodyFatPct)
    .filter((v): v is number => v != null && Number.isFinite(v));

  const hasSpark = series.length >= 2;

  // Build the sparkline geometry only when there's a real series.
  let areaPath = "";
  let linePoints = "";
  let endX = 0;
  let endY = 0;
  let bandFillPath = "";
  let bandLine: { x1: number; y1: number; x2: number; y2: number } | null = null;

  if (hasSpark) {
    const spread = [
      ...series,
      ...(expectedBand ? [expectedBand.lo, expectedBand.hi] : []),
    ];
    const min = Math.min(...spread);
    const max = Math.max(...spread);
    const scaleY = makeScaleY(min, max);
    const stepX = VB_W / (series.length - 1);

    const pts = series.map((v, i) => ({ x: i * stepX, y: scaleY(v) }));
    linePoints = pts.map((p) => `${p.x},${p.y}`).join(" ");
    const last = pts[pts.length - 1];
    endX = last.x;
    endY = last.y;
    areaPath =
      `M ${pts.map((p) => `${p.x},${p.y}`).join(" L ")}` +
      ` L ${VB_W},${VB_H} L 0,${VB_H} Z`;

    if (expectedBand) {
      // The expected "should-be" line trends downward: starts at hi (left,
      // earlier) and falls to lo (right, target).
      const yHi = scaleY(expectedBand.hi);
      const yLo = scaleY(expectedBand.lo);
      bandLine = { x1: 0, y1: yHi, x2: VB_W, y2: yLo };
      bandFillPath =
        `M 0,${yHi - BAND_HALF} L ${VB_W},${yLo - BAND_HALF}` +
        ` L ${VB_W},${yLo + BAND_HALF} L 0,${yHi + BAND_HALF} Z`;
    }
  }

  const stats = bodyStats ?? [];

  return (
    <div
      data-testid="recomp-hero"
      className={cn("flex flex-wrap items-center gap-[22px]", className)}
    >
      {/* Big body-fat % */}
      <div className="flex flex-col gap-0.5">
        <span className="text-[11px] font-display uppercase tracking-[0.08em] text-muted-foreground">
          Body fat
        </span>
        <span className="font-mono text-[46px] font-bold leading-none text-foreground">
          {bodyFatPct == null ? "—" : fmtNum(bodyFatPct)}
          {bodyFatPct != null && (
            <small className="ml-0.5 text-[18px] text-muted-foreground">%</small>
          )}
        </span>
        {bodyFatSub && (
          <span className="text-[11.5px] text-muted-foreground">{bodyFatSub}</span>
        )}
      </div>

      {/* Sparkline (hand-rolled) or a calm placeholder when sparse. */}
      {hasSpark ? (
        <svg
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          preserveAspectRatio="none"
          className="h-[84px] min-w-[220px] flex-1"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--chart-1))" stopOpacity={0.22} />
              <stop offset="100%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
            </linearGradient>
          </defs>

          {/* Expected downward band + dashed line. */}
          {bandFillPath && (
            <path
              d={bandFillPath}
              fill="color-mix(in oklab, hsl(var(--success)) 12%, var(--card))"
            />
          )}
          {bandLine && (
            <line
              x1={bandLine.x1}
              y1={bandLine.y1}
              x2={bandLine.x2}
              y2={bandLine.y2}
              stroke="hsl(var(--success))"
              strokeWidth={1.5}
              strokeDasharray="4 5"
              opacity={0.6}
            />
          )}

          {/* Actual body-fat series: area + line + end dot, in azure. */}
          <path d={areaPath} fill={`url(#${gradientId})`} />
          <polyline
            points={linePoints}
            fill="none"
            stroke="hsl(var(--chart-1))"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx={endX} cy={endY} r={3.5} fill="hsl(var(--chart-1))" />
        </svg>
      ) : (
        <div className="flex h-[84px] min-w-[220px] flex-1 items-center">
          <span className="text-[12px] text-muted-foreground">
            Log weight + body-fat % to see your recomp curve
          </span>
        </div>
      )}

      {/* Mini Weight / Lean / Fat strip. */}
      {stats.length > 0 && (
        <div className="flex flex-wrap gap-[26px]">
          {stats.map((s) => (
            <div key={s.key} className="flex flex-col gap-0.5">
              <span className="text-[10.5px] font-display uppercase tracking-[0.06em] text-muted-foreground">
                {s.label}
              </span>
              <span className="font-mono text-[20px] font-bold leading-none text-foreground">
                {s.value == null ? "—" : fmtNum(s.value)}
                {s.change != null && (
                  <span
                    className="ml-1.5 text-[12px] font-semibold"
                    style={{ color: trendColor(s) }}
                  >
                    {trendGlyph(s.change)}{" "}
                    {s.change === 0 ? "0" : fmtNum(Math.abs(s.change))}
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
