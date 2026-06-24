import * as React from "react";
import { cn } from "@/lib/utils";

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
            "font-display text-2xl font-extrabold leading-none tabular-nums tracking-tight",
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
