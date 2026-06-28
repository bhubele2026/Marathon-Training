import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// The standard section eyebrow: an Archivo uppercase label on the left with an
// optional right-aligned action (a link, toggle, or button). Used to head a
// section instead of a boxed CardHeader + divider rule. Vibrant Summer: the
// eyebrow carries a colored kicker bar + tinted label (ocean by default; pass
// `accent` from the fixed metric palette to key a section to its metric color).
export function SectionHeader({
  eyebrow,
  action,
  className,
  accent = "hsl(var(--chart-1))",
}: {
  eyebrow: string;
  action?: ReactNode;
  className?: string;
  /** CSS color for the kicker bar + eyebrow label. Defaults to the ocean brand. */
  accent?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      <span className="flex items-center gap-2">
        <span
          aria-hidden
          className="h-4 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: accent }}
        />
        <span
          className="font-display text-[13px] font-bold uppercase tracking-[0.09em]"
          style={{ color: accent }}
        >
          {eyebrow}
        </span>
      </span>
      {action != null && <div className="shrink-0">{action}</div>}
    </div>
  );
}
