import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { CountUp } from "./count-up";

// MetricRing — a refined progress ring with a big friendly center value.
// `hero` enlarges it and uses the azure arc on a muted track; non-hero rings
// are smaller with a neutral track and a THIN azure arc. Numerals are the
// display face (Plus Jakarta Sans, tabular) — the bright signature, NOT mono.
// Optional `macros` render concentric pastel arcs inside the azure hero arc
// (e.g. protein/carbs/fat over a calorie ring), each in its fixed metric color.
// Phase 12 layers the fill-on-mount motion; this is the reduced-motion-safe base.

export interface MetricRingArc {
  value: number | null;
  goal: number | null;
  /** A CSS color, typically `hsl(var(--chart-2))` etc. */
  color: string;
  label?: string;
}

export interface MetricRingProps {
  value: number | null;
  goal: number | null;
  unit?: string;
  label: string;
  hero?: boolean;
  /** Concentric pastel arcs drawn inside the primary arc (macros over calories). */
  macros?: MetricRingArc[];
  /**
   * Optional "expected by now" pace tick on the outer track, as a 0..1 fraction
   * of the sweep (e.g. share of the eating window elapsed). Purely additive —
   * when undefined/null the ring renders exactly as before. Static + aria-hidden.
   */
  paceMarker?: number | null;
  className?: string;
}

function clamp01(value: number | null, goal: number | null): number {
  if (value == null || goal == null || goal <= 0) return 0;
  return Math.max(0, Math.min(1, value / goal));
}

export function MetricRing({
  value,
  goal,
  unit,
  label,
  hero = false,
  macros,
  paceMarker,
  className,
}: MetricRingProps) {
  const size = hero ? 168 : 108;
  const stroke = hero ? 11 : 7;
  const reduced = useReducedMotion();

  const outerR = (size - stroke) / 2;
  const outerC = 2 * Math.PI * outerR;
  const progress = clamp01(value, goal);

  // Optional pace tick — same center/radius/start-angle as the progress arc so
  // it lines up. The SVG starts the arc at 3 o'clock then is `-rotate-90`'d to
  // 12 o'clock; placing the tick inside the same <svg> inherits that rotation,
  // so the angle is just `2π · fraction` from the arc's start (clockwise).
  const markerFrac = paceMarker == null ? null : Math.max(0, Math.min(1, paceMarker));
  const marker =
    markerFrac == null
      ? null
      : (() => {
          const a = 2 * Math.PI * markerFrac;
          const cos = Math.cos(a);
          const sin = Math.sin(a);
          const inner = outerR - (stroke / 2 + 1);
          const outer = outerR + (stroke / 2 + 1);
          const c = size / 2;
          return { x1: c + inner * cos, y1: c + inner * sin, x2: c + outer * cos, y2: c + outer * sin };
        })();

  // Macro arcs step inward from the primary arc by a fixed gap.
  const macroStroke = hero ? 6 : 4;
  const macroGap = hero ? 5 : 3;
  const arcs = macros ?? [];

  return (
    <div
      className={cn("relative inline-flex items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
        aria-hidden="true"
      >
        {/* primary track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={outerR}
          fill="none"
          stroke={hero ? "hsl(var(--muted))" : "hsl(var(--border))"}
          strokeWidth={stroke}
        />
        {progress > 0 ? (
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={outerR}
            fill="none"
            stroke="hsl(var(--primary))"
            strokeWidth={hero ? stroke : stroke - 1}
            strokeLinecap="round"
            strokeDasharray={outerC}
            initial={{ strokeDashoffset: reduced ? outerC * (1 - progress) : outerC }}
            animate={{ strokeDashoffset: outerC * (1 - progress) }}
            transition={reduced ? { duration: 0 } : { duration: 0.7, ease: "easeOut" }}
          />
        ) : null}

        {/* "expected by now" pace tick — a static, subtle foreground/70 radial
            mark crossing the outer track (decorative). */}
        {marker ? (
          <line
            x1={marker.x1}
            y1={marker.y1}
            x2={marker.x2}
            y2={marker.y2}
            stroke="hsl(var(--foreground))"
            strokeWidth={2}
            strokeLinecap="round"
            opacity={0.7}
            aria-hidden="true"
            data-testid="metric-ring-pace-marker"
          />
        ) : null}

        {/* concentric macro arcs */}
        {arcs.map((arc, i) => {
          const r = outerR - (stroke / 2 + macroGap + macroStroke / 2) - i * (macroStroke + macroGap);
          if (r <= macroStroke) return null;
          const circ = 2 * Math.PI * r;
          const p = clamp01(arc.value, arc.goal);
          return (
            <React.Fragment key={arc.label ?? i}>
              <circle
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke="hsl(var(--muted))"
                strokeWidth={macroStroke}
                opacity={0.5}
              />
              {p > 0 ? (
                <motion.circle
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  fill="none"
                  stroke={arc.color}
                  strokeWidth={macroStroke}
                  strokeLinecap="round"
                  strokeDasharray={circ}
                  initial={{ strokeDashoffset: reduced ? circ * (1 - p) : circ }}
                  animate={{ strokeDashoffset: circ * (1 - p) }}
                  transition={reduced ? { duration: 0 } : { duration: 0.7, ease: "easeOut", delay: 0.05 * (i + 1) }}
                />
              ) : null}
            </React.Fragment>
          );
        })}
      </svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 px-2 text-center">
        <span
          className={cn(
            "font-display font-extrabold leading-none tabular-nums tracking-tight",
            hero ? "text-5xl text-summer-gradient" : "text-xl text-foreground",
          )}
        >
          {value == null ? (
            ""
          ) : Number.isInteger(value) ? (
            // Count up whole numbers; integer format keeps the resting text
            // identical to the static value (no locale-comma drift).
            <CountUp value={value} format={(n) => String(Math.round(n))} />
          ) : (
            value
          )}
        </span>
        {unit ? (
          <span className="text-[11px] font-medium leading-none text-muted-foreground">{unit}</span>
        ) : null}
        <span className="mt-0.5 font-display text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {label}
        </span>
      </div>
    </div>
  );
}
