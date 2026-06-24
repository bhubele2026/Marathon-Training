import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

// GoalArc — a soft 270° pastel arc gauge (the "Goal Progress" reference): a
// rounded azure arc on a muted track sweeping from lower-left to lower-right,
// with a big display percentage and an optional caption in the gap. Fill animates
// on mount; reduced-motion renders it at rest. Pure presentation.

export interface GoalArcProps {
  /** 0..1 progress. */
  value: number;
  label?: string;
  caption?: string;
  size?: number;
  className?: string;
}

// 270° sweep: start at 135deg, end at 45deg (leaving the bottom open).
const SWEEP = 270;
const GAP = 90;

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number) {
  const start = polar(cx, cy, r, startDeg);
  const end = polar(cx, cy, r, endDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${large} 1 ${end.x} ${end.y}`;
}

export function GoalArc({ value, label, caption, size = 160, className }: GoalArcProps) {
  const reduced = useReducedMotion();
  const p = Math.max(0, Math.min(1, value));
  const stroke = Math.round(size * 0.08);
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const startDeg = GAP / 2 + 90; // 135
  const endDeg = startDeg + SWEEP; // 405 -> wraps, fine for path math

  const trackPath = arcPath(cx, cy, r, startDeg, endDeg);
  const arcLen = (SWEEP / 360) * (2 * Math.PI * r);

  const pct = Math.round(p * 100);

  return (
    <div
      className={cn("relative inline-flex items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <defs>
          <linearGradient id={`goalarc-${size}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="hsl(var(--primary))" />
            <stop offset="100%" stopColor="hsl(var(--chart-5))" />
          </linearGradient>
        </defs>
        <path
          d={trackPath}
          fill="none"
          stroke="hsl(var(--muted))"
          strokeWidth={stroke}
          strokeLinecap="round"
        />
        <motion.path
          d={trackPath}
          fill="none"
          stroke={`url(#goalarc-${size})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={arcLen}
          initial={{ strokeDashoffset: reduced ? arcLen * (1 - p) : arcLen }}
          animate={{ strokeDashoffset: arcLen * (1 - p) }}
          transition={reduced ? { duration: 0 } : { duration: 0.8, ease: "easeOut" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="font-display text-3xl font-extrabold tabular-nums tracking-tight text-foreground">
          {pct}%
        </span>
        {label != null && (
          <span className="mt-0.5 font-display text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {label}
          </span>
        )}
        {caption != null && (
          <span className="mt-1 max-w-[80%] text-[11px] leading-tight text-muted-foreground">
            {caption}
          </span>
        )}
      </div>
    </div>
  );
}
