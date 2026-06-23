import * as React from "react";
import { cn } from "@/lib/utils";

// StatReadout — the atomic metric unit of the BH Studio design system.
// Eyebrow label (Archivo) over an instrument-readout value (JetBrains Mono,
// tabular), with an optional Inter unit suffix and an optional delta chip.
// The mono value is the SIGNATURE move — every metric renders through this.

type DeltaTone = "success" | "neutral" | "destructive";

export interface StatReadoutProps {
  label: string;
  value: string | number;
  unit?: string;
  delta?: { value: string; tone?: DeltaTone };
  tone?: "accent" | "foreground";
  align?: "left" | "center";
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
  className,
}: StatReadoutProps) {
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
            "font-mono text-2xl font-semibold leading-none tabular-nums tracking-[-0.01em]",
            tone === "accent" ? "text-primary" : "text-foreground",
          )}
        >
          {value}
        </span>
        {unit ? (
          <span className="text-[13px] font-medium text-muted-foreground">{unit}</span>
        ) : null}
        {delta ? (
          <span
            className={cn(
              "ml-1 inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums",
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
