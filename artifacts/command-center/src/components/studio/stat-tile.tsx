import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { StatReadout, type StatReadoutProps } from "./stat-readout";

// StatTile — a white tile wrapping a StatReadout: an eyebrow label, a big
// display number, an optional delta chip, with an optional leading icon chip
// and a footer slot (e.g. a sparkline or caption). The tiled form of the
// atomic StatReadout, for dashboard/body grids.

export interface StatTileProps extends StatReadoutProps {
  icon?: LucideIcon;
  footer?: ReactNode;
  tileClassName?: string;
  /**
   * Vibrant Summer: a CSS color (from the fixed metric palette) that tints the
   * leading icon chip and adds a thin left accent rule keyed to the metric.
   * Optional — when omitted the tile keeps its neutral white look.
   */
  accent?: string;
}

export function StatTile({
  icon: Icon,
  footer,
  tileClassName,
  className,
  accent,
  ...readout
}: StatTileProps) {
  return (
    <Card
      className={cn(
        "flex flex-col gap-3 p-6 transition-shadow duration-150 hover:shadow-[var(--shadow-tile)] motion-reduce:transition-none",
        accent != null && "border-l-2",
        tileClassName,
      )}
      style={accent != null ? { borderLeftColor: accent } : undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <StatReadout {...readout} className={className} />
        {Icon != null && (
          <span
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
              accent == null && "bg-primary/10 text-primary",
            )}
            style={
              accent != null
                ? {
                    backgroundColor: `color-mix(in srgb, ${accent} 14%, transparent)`,
                    color: accent,
                  }
                : undefined
            }
          >
            <Icon className="h-4 w-4" />
          </span>
        )}
      </div>
      {footer != null && <div className="min-w-0">{footer}</div>}
    </Card>
  );
}
