import { useId } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

// DropletGauge — the mockup's hydration droplet: an outline drop whose interior
// fills from the bottom to `pct` (0..1) with an identity colour (default the
// hydration token --chart-5), a big mono value centred on the drop. The fill rises
// on mount; reduced motion renders it at rest. The clip path id is unique per
// instance (useId) so multiple droplets never collide. Pure presentation.

const DROP_PATH =
  "M48 6 C 70 38, 86 54, 86 70 a38 38 0 1 1 -76 0 C 10 54, 26 38, 48 6 Z";
const H = 104;

export interface DropletGaugeProps {
  /** 0..1 fill level. */
  pct: number;
  value: number | null;
  /** Identity fill colour; defaults to the hydration token. */
  color?: string;
  className?: string;
}

export function DropletGauge({
  pct,
  value,
  color = "hsl(var(--chart-5))",
  className,
}: DropletGaugeProps) {
  const reduced = useReducedMotion();
  // Unique, selector-safe clip id per instance.
  const clipId = `dropclip-${useId().replace(/:/g, "")}`;
  const p = Math.max(0, Math.min(1, pct));
  const fillY = H - H * p;

  return (
    <div className={cn("flex-none", className)} data-testid="droplet-gauge">
      <svg viewBox="0 0 96 104" width={96} height={104} aria-hidden="true">
        <defs>
          <clipPath id={clipId}>
            <path d={DROP_PATH} />
          </clipPath>
        </defs>

        {/* Outline drop — token-mixed so it reads on white + dark */}
        <path
          d={DROP_PATH}
          fill={`color-mix(in oklab, ${color} 10%, var(--card))`}
          stroke={`color-mix(in oklab, ${color} 40%, var(--card))`}
          strokeWidth={2}
        />

        {/* Rising fill (omitted when nothing is logged) */}
        {value != null ? (
          <g clipPath={`url(#${clipId})`}>
            <motion.rect
              x={0}
              width={96}
              height={H}
              fill={color}
              opacity={0.85}
              initial={{ y: reduced ? fillY : H }}
              animate={{ y: fillY }}
              transition={
                reduced ? { duration: 0 } : { duration: 1.0, ease: [0.22, 1, 0.36, 1] }
              }
            />
          </g>
        ) : null}

        <text
          x={48}
          y={78}
          textAnchor="middle"
          fill="hsl(var(--foreground))"
          fontWeight={700}
          fontSize={18}
          className="font-mono"
        >
          {value != null ? value : "—"}
        </text>
      </svg>
    </div>
  );
}
