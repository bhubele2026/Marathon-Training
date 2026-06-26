import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { GAUGE_TRACK, statusGaugeColor, type InsightStatus } from "./types";

// DialGauge — the mockup's sodium half-circle: a 180° track with a success-toned
// "healthy band" arc (bandLo..bandHi fractions of the sweep) and a status-coloured
// needle that pivots at (85,96). The needle rests pointing straight up and rotates
// by (pct - 0.5) * 180° so pct=0 → left, 0.5 → up, 1 → right; it swings in from the
// left on mount (reduced motion → static). Every colour is a theme token.

const CX = 85;
const CY = 96;
const R = 70;

export interface DialGaugeProps {
  /** 0..1 position along the 180° scale. */
  pct: number;
  /** Healthy-band start as a 0..1 fraction of the sweep. */
  bandLo: number;
  /** Healthy-band end as a 0..1 fraction of the sweep. */
  bandHi: number;
  status: InsightStatus;
  lowLabel?: string;
  highLabel?: string;
  className?: string;
}

// Point on the upper semicircle for a 0..1 fraction (0 = left @ 15,96 → 1 = right
// @ 155,96), going over the top. SVG y grows downward, so "up" subtracts.
function polar(frac: number): { x: number; y: number } {
  const f = Math.max(0, Math.min(1, frac));
  const a = (Math.PI * (1 - f)); // radians: f=0 → π (left), f=1 → 0 (right)
  return { x: CX + R * Math.cos(a), y: CY - R * Math.sin(a) };
}

export function DialGauge({
  pct,
  bandLo,
  bandHi,
  status,
  lowLabel = "low",
  highLabel = "high",
  className,
}: DialGaugeProps) {
  const reduced = useReducedMotion();
  const p = Math.max(0, Math.min(1, pct));
  const deg = (p - 0.5) * 180;

  const bs = polar(Math.min(bandLo, bandHi));
  const be = polar(Math.max(bandLo, bandHi));
  const needleColor = statusGaugeColor(status);
  const faint = "hsl(var(--muted-foreground))";

  return (
    <div className={cn("flex-none", className)} data-testid="dial-gauge">
      <svg viewBox="0 0 170 104" width={170} height={104} aria-hidden="true">
        {/* Track */}
        <path
          d="M15 96 A70 70 0 0 1 155 96"
          fill="none"
          stroke={GAUGE_TRACK}
          strokeWidth={12}
          strokeLinecap="round"
        />

        {/* Healthy band */}
        {bandHi > bandLo ? (
          <path
            d={`M${bs.x} ${bs.y} A70 70 0 0 1 ${be.x} ${be.y}`}
            fill="none"
            stroke="hsl(var(--success))"
            strokeWidth={12}
            strokeLinecap="round"
            opacity={0.8}
          />
        ) : null}

        {/* Needle (pivots at 85,96; rests pointing up) */}
        <motion.g
          style={{ transformOrigin: `${CX}px ${CY}px` }}
          initial={{ rotate: reduced ? deg : -90 }}
          animate={{ rotate: deg }}
          transition={
            reduced ? { duration: 0 } : { duration: 0.9, ease: [0.22, 1, 0.36, 1] }
          }
          data-testid="dial-gauge-needle"
        >
          <line
            x1={CX}
            y1={CY}
            x2={CX}
            y2={40}
            stroke={needleColor}
            strokeWidth={3.5}
            strokeLinecap="round"
          />
          <circle cx={CX} cy={CY} r={5} fill={needleColor} />
        </motion.g>

        <text x={15} y={100} fill={faint} fontSize={9} className="font-mono">
          {lowLabel}
        </text>
        <text
          x={155}
          y={100}
          fill={faint}
          fontSize={9}
          textAnchor="end"
          className="font-mono"
        >
          {highLabel}
        </text>
      </svg>
    </div>
  );
}
