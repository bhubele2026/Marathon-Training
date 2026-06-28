import * as React from "react";
import { cn } from "@/lib/utils";
import { CountUp } from "./count-up";

// StatReadout — the atomic metric unit of the BH Studio design system.
// Eyebrow label over a big friendly display number (Plus Jakarta Sans, 700–800,
// tabular figures, tight tracking — the bright-design signature, NOT monospace),
// with an optional Inter unit suffix and an optional delta chip.

type DeltaTone = "success" | "neutral" | "destructive";

export interface StatReadoutProps {
  label: string;
  value: string | number;
  unit?: string;
  delta?: { value: string; tone?: DeltaTone };
  tone?: "accent" | "foreground";
  align?: "left" | "center";
  /** Gentle count-up on mount for the value. Only applies to whole-number
   * values (so the resting text is byte-identical to the static render — no
   * locale-comma or rounding drift); decimals/strings render statically.
   * prefers-reduced-motion renders the final value instantly. Opt-in so only
   * hero numbers animate, keeping the restraint. */
  countUp?: boolean;
  className?: string;
}

const DELTA_TONE: Record<DeltaTone, string> = {
  success: "text-success",
  neutral: "text-muted-foreground",
  destructive: "text-destructive",
};

export function StatReadout({
  label,
  value,
  unit,
  delta,
  tone = "foreground",
  align = "left",
  countUp = false,
  className,
}: StatReadoutProps) {
  const animatable =
    countUp && typeof value === "number" && Number.isInteger(value);
  return (
    <div
      className={cn(
        "flex flex-col gap-1",
        align === "center" && "items-center text-center",
        className,
      )}
    >
      <span className="font-display text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </span>
      <div className="flex items-baseline gap-1.5">
        <span
          className={cn(
            "font-display text-3xl font-extrabold leading-none tabular-nums tracking-tighter",
            tone === "accent" ? "text-primary" : "text-foreground",
          )}
        >
          {animatable ? (
            <CountUp
              value={value as number}
              format={(n) => String(Math.round(n))}
            />
          ) : (
            value
          )}
        </span>
        {unit ? (
          <span className="text-[13px] font-medium text-muted-foreground">{unit}</span>
        ) : null}
        {delta ? (
          <span
            className={cn(
              "ml-1 inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 font-display text-[11px] font-bold tabular-nums",
              DELTA_TONE[delta.tone ?? "neutral"],
            )}
          >
            {delta.value}
          </span>
        ) : null}
      </div>
    </div>
  );
}
