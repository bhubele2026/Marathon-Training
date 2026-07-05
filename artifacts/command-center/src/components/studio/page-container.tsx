import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { PageBackdrop } from "./page-backdrop";
import type { MotifName } from "./motifs";

// PageContainer — the one shared page wrapper, so every route centers at the
// same width, carries the same gutters + vertical rhythm, and gets the same
// gentle mount-in. Replaces the ad-hoc `space-y-*` / `max-w-[…]` mix each page
// hand-rolled. `content` (1440) is the default; `wide` (1600) is for the dense
// multi-column grids (plan, equipment, week-detail). Pass a `motif` to lay the
// BH STUDIO brand backsplash + that page's strength watermark behind the
// content — so no page reads empty.
export interface PageContainerProps {
  children: ReactNode;
  width?: "content" | "wide";
  /** Per-page strength watermark (barbell, plate, protein, …). */
  motif?: MotifName;
  className?: string;
}

export function PageContainer({
  children,
  width = "content",
  motif,
  className,
}: PageContainerProps) {
  return (
    <div
      className={cn(
        "relative mx-auto px-4 py-4 md:px-8",
        "animate-in fade-in slide-in-from-bottom-4 duration-500 motion-reduce:animate-none",
        width === "wide" ? "max-w-[1600px]" : "max-w-[1440px]",
        className,
      )}
    >
      <PageBackdrop motif={motif} />
      <div className="relative z-10 space-y-5">{children}</div>
    </div>
  );
}
