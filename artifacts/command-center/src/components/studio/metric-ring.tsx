import * as React from "react";
import { cn } from "@/lib/utils";

// MetricRing — a refined progress ring with an instrument-readout center value.
// `hero` enlarges it and uses the accent arc on a muted track; non-hero rings
// are smaller with a neutral track and a THIN accent arc. All numerals are
// JetBrains Mono (tabular). Phase 8 layers the fill-on-mount motion; this is the
// static, reduced-motion-safe base.

export interface MetricRingProps {
  value: number | null;
  goal: number | null;
  unit?: string;
  label: string;
  hero?: boolean;
  className?: string;
}

export function MetricRing({
  value,
  goal,
  unit,
  label,
  hero = false,
  className,
}: MetricRingProps) {
  const size = hero ? 168 : 108;
  const stroke = hero ? 11 : 7;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const hasData = value != null && goal != null && goal > 0;
  const progress = hasData ? Math.max(0, Math.min(1, (value as number) / (goal as number))) : 0;
  const dashoffset = c * (1 - progress);

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
        {/* track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={hero ? "hsl(var(--muted))" : "hsl(var(--border))"}
          strokeWidth={stroke}
        />
        {/* accent arc */}
        {progress > 0 ? (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="hsl(var(--primary))"
            strokeWidth={hero ? stroke : stroke - 1}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={dashoffset}
            className="transition-[stroke-dashoffset] duration-700 ease-out motion-reduce:transition-none"
          />
        ) : null}
      </svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 px-2 text-center">
        <span
          className={cn(
            "font-mono font-semibold leading-none tabular-nums tracking-[-0.01em] text-foreground",
            hero ? "text-3xl" : "text-xl",
          )}
        >
          {value != null ? value : ""}
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
