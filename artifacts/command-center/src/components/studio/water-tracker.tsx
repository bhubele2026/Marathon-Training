import * as React from "react";
import { Droplet } from "lucide-react";
import { cn } from "@/lib/utils";
import { SegmentedControl } from "./segmented-control";

// WaterTracker — the hydration tile (modelled on the cup-grid reference).
// Daily: a grid of cups that fill as intake accrues (filled = cyan, empty =
// muted outline), the day total (L + oz) against the goal, and an
// encouragement line that turns success-green at/over goal. Weekly/Monthly:
// the average against goal. Replaces the old "Awaiting sync · —" orphan line.

type Range = "D" | "W" | "M";

export interface WaterTrackerProps {
  /** Today's intake, ounces. */
  oz: number;
  /** Daily goal, ounces (≈ ½ oz per lb bodyweight, more on training days). */
  goalOz: number;
  /** Ounces per cup cell. */
  cupOz?: number;
  /** 7-day average intake (oz) for the Weekly view. */
  weeklyAvgOz?: number | null;
  /** 30-day average intake (oz) for the Monthly view. */
  monthlyAvgOz?: number | null;
  className?: string;
}

const OZ_PER_L = 33.814;

function liters(oz: number): string {
  return `${(oz / OZ_PER_L).toFixed(2)} L`;
}

export function WaterTracker({
  oz,
  goalOz,
  cupOz = 8,
  weeklyAvgOz,
  monthlyAvgOz,
  className,
}: WaterTrackerProps) {
  const [range, setRange] = React.useState<Range>("D");

  const totalCups = Math.max(1, Math.ceil(goalOz / cupOz));
  const filledCups = Math.min(totalCups, Math.round(oz / cupOz));
  const metGoal = oz >= goalOz && goalOz > 0;

  const avg = range === "W" ? weeklyAvgOz : monthlyAvgOz;
  const showAvg = range !== "D";

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div className="flex items-center justify-between gap-3">
        <span className="font-display text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Water
        </span>
        <SegmentedControl
          size="sm"
          ariaLabel="Water range"
          value={range}
          onChange={(r) => setRange(r as Range)}
          options={[
            { value: "D", label: "D" },
            { value: "W", label: "W" },
            { value: "M", label: "M" },
          ]}
        />
      </div>

      {showAvg ? (
        <div className="flex flex-col gap-1">
          <span className="font-display text-3xl font-extrabold tabular-nums tracking-tight text-foreground">
            {avg == null ? "—" : liters(avg)}
          </span>
          <span className="text-xs text-muted-foreground">
            {range === "W" ? "7-day average" : "30-day average"} · goal {liters(goalOz)}
          </span>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5" aria-hidden="true">
            {Array.from({ length: totalCups }).map((_, i) => (
              <span
                key={i}
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-lg",
                  i < filledCups
                    ? "bg-[hsl(var(--chart-5)/0.15)] text-[hsl(var(--chart-5))]"
                    : "border border-border text-muted-foreground/40",
                )}
              >
                <Droplet
                  className="h-3.5 w-3.5"
                  fill={i < filledCups ? "currentColor" : "none"}
                />
              </span>
            ))}
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <div className="flex flex-col">
              <span className="font-display text-3xl font-extrabold tabular-nums tracking-tight text-foreground">
                {liters(oz)}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {Math.round(oz)} oz · goal {Math.round(goalOz)} oz
              </span>
            </div>
            <span
              className={cn(
                "text-sm font-semibold",
                metGoal ? "text-success" : "text-muted-foreground",
              )}
            >
              {metGoal ? "Well done" : `${Math.max(0, Math.round(goalOz - oz))} oz to go`}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
