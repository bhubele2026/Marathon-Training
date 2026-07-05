import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// PageHeader — the one shared page title block, so every route reads the same:
// an optional colored kicker eyebrow, a big Plus-Jakarta display title (with an
// opt-in summer-gradient for the primary daily surfaces), a muted subtitle, and
// a right-aligned action slot (toggle / button / link). Replaces the per-page
// hand-rolled h1/h2 soup. Layout mirrors the dashboard header:
// stacks on mobile, title-left / action-right and baseline-aligned on desktop.
export interface PageHeaderProps {
  /** The page title (e.g. "Plan", "Body"). Rendered in the display face. */
  title: string;
  /** Optional colored kicker eyebrow above the title. */
  eyebrow?: string;
  /** CSS color for the eyebrow kicker + label (fixed metric palette). */
  eyebrowAccent?: string;
  /** Muted line under the title. */
  subtitle?: ReactNode;
  /** Right-aligned controls (SegmentedControl, button, link…). */
  action?: ReactNode;
  /** Opt-in summer-gradient title — reserved for the primary daily surfaces. */
  gradient?: boolean;
  className?: string;
  /** Override the title's test id (defaults to "page-header-title"). */
  titleTestId?: string;
  /** Test id for the subtitle line, when a page's tests target it. */
  subtitleTestId?: string;
  /** Extra data-* attributes spread onto the title (e.g. `data-race-kind`). */
  titleData?: Record<string, string | undefined>;
}

export function PageHeader({
  title,
  eyebrow,
  eyebrowAccent = "hsl(var(--chart-1))",
  subtitle,
  action,
  gradient = false,
  className,
  titleTestId = "page-header-title",
  subtitleTestId,
  titleData,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 md:flex-row md:items-end md:justify-between",
        className,
      )}
      data-testid="page-header"
    >
      <div className="flex min-w-0 flex-col gap-1">
        {eyebrow != null && (
          <span className="flex items-center gap-2">
            <span
              aria-hidden
              className="h-3.5 w-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: eyebrowAccent }}
            />
            <span
              className="font-display text-[12px] font-bold uppercase tracking-[0.09em]"
              style={{ color: eyebrowAccent }}
            >
              {eyebrow}
            </span>
          </span>
        )}
        <h1
          className={cn(
            "font-display text-3xl font-extrabold tracking-tight sm:text-4xl",
            gradient ? "text-summer-gradient" : "text-foreground",
          )}
          data-testid={titleTestId}
          {...titleData}
        >
          {title}
        </h1>
        {subtitle != null && (
          <p
            className="text-sm font-medium text-muted-foreground"
            data-testid={subtitleTestId}
          >
            {subtitle}
          </p>
        )}
      </div>
      {action != null && <div className="shrink-0">{action}</div>}
    </div>
  );
}
