import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { GAUGE_TRACK } from "./types";

// RadialGauge — a full-circle progress ring with a big mono value in the middle
// (the mockup's protein/carbs/fat/consistency gauge). Stroke colour is passed in
// (status colour for macro rings, an identity token for the consistency donut).
// Track is GAUGE_TRACK so it stays visible on a white card and on dark. The fill
// animates on mount; reduced motion renders it at rest.

export interface RadialGaugeProps {
  /** 0..1 fill. */
  pct: number;
  /** Stroke colour, e.g. statusGaugeColor(status) or hsl(var(--chart-1)). */
  color: string;
  size?: number;
  stroke?: number;
  centerMain: string;
  centerSub?: string;
  className?: string;
}

export function RadialGauge({
  pct,
  color,
  size = 104,
  stroke = 11,
  centerMain,
  centerSub,
  className,
}: RadialGaugeProps) {
  const reduced = useReducedMotion();
  const p = Math.max(0, Math.min(1, pct));
  const r = Math.round(size * 0.404);
  const c = size / 2;
  const circ = 2 * Math.PI * r;

  return (
    <div
      className={cn("relative flex-none", className)}
      style={{ width: size, height: size }}
      data-testid="radial-gauge"
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle cx={c} cy={c} r={r} fill="none" stroke={GAUGE_TRACK} strokeWidth={stroke} />
        <motion.circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          initial={{ strokeDashoffset: reduced ? circ * (1 - p) : circ }}
          animate={{ strokeDashoffset: circ * (1 - p) }}
          transition={reduced ? { duration: 0 } : { duration: 1.0, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className="font-mono font-bold leading-none text-foreground"
          style={{ fontSize: Math.round(size * 0.23) }}
        >
          {centerMain}
        </span>
        {centerSub && (
          <span
            className="mt-0.5 font-display uppercase tracking-[0.06em] text-muted-foreground"
            style={{ fontSize: Math.round(size * 0.1) }}
          >
            {centerSub}
          </span>
        )}
      </div>
    </div>
  );
}
