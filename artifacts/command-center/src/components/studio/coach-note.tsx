import type { ReactNode } from "react";
import { Sparkles, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type CoachTone = "accent" | "success" | "neutral" | "destructive";

// Pill colors per tone. The status Badge is composed off the `secondary` base
// and recolored via className, so this works regardless of which named Badge
// variants exist. Pill shape (rounded-full) per the design law.
const TONE_PILL: Record<CoachTone, string> = {
  accent: "border-transparent bg-primary text-primary-foreground",
  success: "border-transparent bg-success text-success-foreground",
  neutral: "border-transparent bg-secondary text-secondary-foreground",
  destructive: "border-transparent bg-destructive text-destructive-foreground",
};

// The one consistent surface for the coach's voice: a subtly warm-tinted block
// with a 2px accent left-rule and a small leading icon — never a whole card
// flooded orange. The line is `children`; an optional status pill sits trailing.
export function CoachNote({
  children,
  icon: Icon = Sparkles,
  status,
  tone = "accent",
  className,
}: {
  children: ReactNode;
  icon?: LucideIcon;
  status?: string;
  tone?: CoachTone;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-lg border-l-2 border-primary bg-[hsl(var(--chart-3)/0.10)] p-3.5 dark:bg-[hsl(var(--chart-3)/0.10)]",
        className,
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
        <p className="min-w-0 text-sm leading-relaxed text-foreground">{children}</p>
        {status != null && (
          <Badge
            variant="secondary"
            className={cn(
              "mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
              TONE_PILL[tone],
            )}
          >
            {status}
          </Badge>
        )}
      </div>
    </div>
  );
}
