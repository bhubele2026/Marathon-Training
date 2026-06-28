import type { LucideIcon } from "lucide-react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

// FeatureTile — a big soft-rounded nav tile (the SportTracks-launcher feel):
// a navy→azure gradient panel with a leading icon, a label, an optional
// glanceable stat, and a chevron affordance. Renders as a <button> (onClick)
// or a plain panel; wrap with the router's <Link> for navigation. Lifted with
// the diffuse --shadow-tile and a gentle hover/press, reduced-motion-safe.

export interface FeatureTileProps {
  icon: LucideIcon;
  label: string;
  /** A short glanceable value, e.g. "1,820 kcal" or "Day 12". */
  stat?: string;
  /** Secondary caption under the stat. */
  caption?: string;
  onClick?: () => void;
  className?: string;
  /** Quiet variant: white tile with an azure icon chip instead of the gradient. */
  tone?: "gradient" | "soft";
  testId?: string;
}

export function FeatureTile({
  icon: Icon,
  label,
  stat,
  caption,
  onClick,
  className,
  tone = "gradient",
  testId,
}: FeatureTileProps) {
  const interactive = typeof onClick === "function";
  const Tag = interactive ? "button" : "div";
  const gradient = tone === "gradient";

  return (
    <Tag
      type={interactive ? "button" : undefined}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        "group relative flex w-full flex-col justify-between gap-6 overflow-hidden rounded-3xl p-6 text-left shadow-tile transition-transform duration-150 motion-reduce:transition-none",
        interactive &&
          "hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-0",
        gradient
          ? "bg-gradient-to-br from-navy to-primary text-primary-foreground"
          : "border border-card-border bg-card text-card-foreground",
        className,
      )}
    >
      <div className="flex items-start justify-between">
        <span
          className={cn(
            "flex h-12 w-12 items-center justify-center rounded-2xl",
            gradient ? "bg-white/15 text-primary-foreground" : "bg-primary/10 text-primary",
          )}
        >
          <Icon className="h-6 w-6" />
        </span>
        <ChevronRight
          className={cn(
            "h-5 w-5 transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transition-none",
            gradient ? "text-primary-foreground/70" : "text-muted-foreground",
          )}
        />
      </div>
      <div className="min-w-0">
        <p
          className={cn(
            "font-display text-[15px] font-bold uppercase tracking-wide",
            gradient ? "text-primary-foreground/90" : "text-foreground",
          )}
        >
          {label}
        </p>
        {stat != null && (
          <p
            className={cn(
              "mt-1 font-display text-4xl font-extrabold tabular-nums tracking-tight",
              gradient ? "text-primary-foreground" : "text-foreground",
            )}
          >
            {stat}
          </p>
        )}
        {caption != null && (
          <p
            className={cn(
              "mt-0.5 text-xs",
              gradient ? "text-primary-foreground/75" : "text-muted-foreground",
            )}
          >
            {caption}
          </p>
        )}
      </div>
    </Tag>
  );
}
