import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// PageContainer — the one shared page wrapper, so every route centers at the
// same width, carries the same gutters + vertical rhythm, and gets the same
// gentle mount-in. Replaces the ad-hoc `space-y-*` / `max-w-[…]` mix each page
// hand-rolled. `content` (1440) is the default; `wide` (1600) is for the dense
// multi-column grids (plan, equipment, week-detail) — a deliberate choice, not
// an accident. The app shell already caps at 1920 and adds outer gutters; this
// sits inside it, matching the landing/insights/history reference container.
export interface PageContainerProps {
  children: ReactNode;
  width?: "content" | "wide";
  className?: string;
}

export function PageContainer({
  children,
  width = "content",
  className,
}: PageContainerProps) {
  return (
    <div
      className={cn(
        "mx-auto px-4 py-4 md:px-8",
        "space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500 motion-reduce:animate-none",
        width === "wide" ? "max-w-[1600px]" : "max-w-[1440px]",
        className,
      )}
    >
      {children}
    </div>
  );
}
