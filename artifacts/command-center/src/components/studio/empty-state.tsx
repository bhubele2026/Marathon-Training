import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// An empty/sparse state rendered as an invitation, never a bare "—". Says what
// to do and why, in the coach's calm register, with an optional control to act.
// The hint MUST wrap fully (no truncation/clamp) so guidance is never clipped.
export function EmptyState({
  title,
  hint,
  action,
  icon: Icon,
  className,
}: {
  title: string;
  hint: string;
  action?: ReactNode;
  icon?: LucideIcon;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-start gap-2 p-6 text-left",
        className,
      )}
    >
      {Icon != null && <Icon className="h-5 w-5 text-muted-foreground" />}
      <p className="text-[15px] font-medium text-foreground">{title}</p>
      <p className="max-w-prose text-[13px] leading-relaxed text-muted-foreground">
        {hint}
      </p>
      {action != null && <div className="pt-1">{action}</div>}
    </div>
  );
}
