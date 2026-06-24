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
      return "text-success";
    case "in-progress":
      return "text-warning";
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
      return "bg-success dark:bg-success";
    case "in-progress":
      return "bg-warning dark:bg-warning";
    default:
      return "";
  }
}
