import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// The standard section eyebrow: an Archivo uppercase label on the left with an
// optional right-aligned action (a link, toggle, or button). Used to head a
// section instead of a boxed CardHeader + divider rule.
export function SectionHeader({
  eyebrow,
  action,
  className,
}: {
  eyebrow: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      <span className="font-display text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {eyebrow}
      </span>
      {action != null && <div className="shrink-0">{action}</div>}
    </div>
  );
}
