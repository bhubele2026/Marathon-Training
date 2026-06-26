import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { GAUGE_TRACK, statusGaugeColor, tonedSurface, type InsightStatus } from "./types";

// BandBar — the mockup's fuelling/calories viz: a big mono "actual / target unit"
// readout over a horizontal track that carries a success-toned "good zone" band
// (floor..target, or floor..ceiling), a target tick, and a status-coloured actual
// marker that animates into place on mount. Every colour resolves from a theme
// token, so the bar reads on a white card and on dark. Pure presentation.

const W = 320;
const BAR_Y = 13;
const BAR_H = 8;

export interface BandBarProps {
  actual: number | null;
  target: number | null;
  floor?: number | null;
  ceiling?: number | null;
  status: InsightStatus;
  unit?: string;
  className?: string;
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString();
}

export function BandBar({
  actual,
  target,
  floor,
  ceiling,
  status,
  unit = "kcal",
  className,
}: BandBarProps) {
  const reduced = useReducedMotion();

  // Domain: 0 .. the widest reference number, with headroom so the actual marker
  // never pins to the right edge.
  const refs = [actual, target, ceiling, floor].filter(
    (v): v is number => v != null,
  );
  const domainMax = refs.length > 0 ? Math.max(...refs) * 1.15 : 1;
  const scaleX = (v: number) =>
    Math.max(0, Math.min(1, v / domainMax)) * W;

  // The "good zone" band: floor..target, or floor..ceiling when a ceiling exists.
  const bandStartVal = floor ?? 0;
  const bandEndVal = ceiling ?? target ?? domainMax;
  const bandX = scaleX(bandStartVal);
  const bandW = Math.max(0, scaleX(bandEndVal) - bandX);

  const markerColor = statusGaugeColor(status);
  const faint = "hsl(var(--muted-foreground))";

  return (
    <div className={cn("w-full", className)} data-testid="band-bar">
      <div className="flex items-baseline gap-2">
        <span
          className="font-mono font-bold leading-none text-foreground"
          style={{ fontSize: 38 }}
        >
          {actual != null ? fmt(actual) : "—"}
        </span>
        <span className="font-mono text-muted-foreground">
          / {target != null ? fmt(target) : "—"} {unit}
        </span>
      </div>

      {actual == null ? (
        <div className="mt-2 text-[13px] text-muted-foreground">
          Not logged yet — close a day and I’ll plot it.
        </div>
      ) : null}

      <svg
        viewBox={`0 0 ${W} 34`}
        className="mt-3 h-[34px] w-full"
        role="img"
        aria-label={
          actual != null
            ? `${fmt(actual)} of ${target != null ? fmt(target) : "—"} ${unit}`
            : "Not logged yet"
        }
      >
        {/* Track */}
        <rect x={0} y={BAR_Y} width={W} height={BAR_H} rx={4} fill={GAUGE_TRACK} />

        {/* Good-zone band (token-tinted, visible on white + dark) */}
        {bandW > 0 ? (
          <rect
            x={bandX}
            y={BAR_Y}
            width={bandW}
            height={BAR_H}
            rx={4}
            fill={tonedSurface("success", 35)}
          />
        ) : null}

        {/* Target tick */}
        {target != null ? (
          <line
            x1={scaleX(target)}
            y1={8}
            x2={scaleX(target)}
            y2={26}
            stroke="hsl(var(--success))"
            strokeWidth={2}
          />
        ) : null}

        {/* Actual marker (status-coloured) */}
        {actual != null ? (
          <motion.circle
            cy={17}
            r={6.5}
            fill={markerColor}
            stroke="var(--card)"
            strokeWidth={2}
            initial={{ cx: reduced ? scaleX(actual) : 0 }}
            animate={{ cx: scaleX(actual) }}
            transition={
              reduced ? { duration: 0 } : { duration: 0.9, ease: [0.22, 1, 0.36, 1] }
            }
            data-testid="band-bar-marker"
          />
        ) : null}

        {/* Faint endpoint labels */}
        {floor != null ? (
          <text x={2} y={33} fill={faint} fontSize={10} className="font-mono">
            {fmt(floor)} floor
          </text>
        ) : null}
        {(ceiling ?? target) != null ? (
          <text
            x={W - 2}
            y={33}
            fill={faint}
            fontSize={10}
            textAnchor="end"
            className="font-mono"
          >
            {fmt((ceiling ?? target) as number)} {ceiling != null ? "ceiling" : "target"}
          </text>
        ) : null}
      </svg>
    </div>
  );
}
