import { cn } from "@/lib/utils";

// Compact pill that surfaces a workout's AM/PM/Other tag. Renders nothing
// for untagged sessions so legacy rows (and quick-logs that opt out) stay
// uncluttered.
export function TimeOfDayBadge({
  value,
  className,
  testId,
}: {
  value: string | null | undefined;
  className?: string;
  testId?: string;
}) {
  if (!value) return null;
  const normalized = value === "AM" || value === "PM" || value === "Other" ? value : null;
  if (!normalized) return null;

  const tone =
    normalized === "AM"
      ? "bg-warning/15 text-warning"
      : normalized === "PM"
      ? "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400"
      : "bg-muted text-muted-foreground";

  return (
    <span
      className={cn(
        "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider",
        tone,
        className,
      )}
      data-testid={testId}
    >
      {normalized}
    </span>
  );
}
