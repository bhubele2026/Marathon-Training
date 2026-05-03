export type AdherenceStatus = "met" | "in-progress" | "neutral";

export function adherenceStatus(
  actual: number | null | undefined,
  planned: number | null | undefined,
): AdherenceStatus {
  const a = actual ?? 0;
  const p = planned ?? 0;
  if (p <= 0) return "neutral";
  if (a >= p) return "met";
  if (a > 0) return "in-progress";
  return "neutral";
}

export function adherenceTextClass(status: AdherenceStatus): string {
  switch (status) {
    case "met":
      return "text-emerald-600 dark:text-emerald-400";
    case "in-progress":
      return "text-amber-600 dark:text-amber-400";
    default:
      return "";
  }
}

// Background tint for the adherence progress bar's filled indicator. Mirrors
// adherenceTextClass so the bar reads in the same color family as the
// planned-vs-actual headline above it. Returns empty for "neutral" so the
// default Progress styling applies (and a 0% bar simply has nothing to color).
export function adherenceBarClass(status: AdherenceStatus): string {
  switch (status) {
    case "met":
      return "bg-emerald-500 dark:bg-emerald-400";
    case "in-progress":
      return "bg-amber-500 dark:bg-amber-400";
    default:
      return "";
  }
}
