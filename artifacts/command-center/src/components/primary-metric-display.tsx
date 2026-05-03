// Renders the single "headline" number for a slimmed session card
// (Task #133). Two variants:
//   * `prominent` — used on full-width cards (Today's Mission Brief,
//     Mission Accomplished, pre-launch First Scheduled Session). Big
//     number, small label.
//   * `compact` — used inline on dense cards (Week Detail day cards,
//     dashboard logged-session row).
//
// For logged sessions a `planned` value can be supplied; we render it
// after the actual as "5.20 / 6.00 mi" so the user sees the gap on the
// collapsed card without expanding.
import { cn } from "@/lib/utils";
import type {
  PrimaryMetric,
  PrimaryMetricCompare,
} from "@/lib/primary-metric";

interface Props {
  metric: PrimaryMetric | PrimaryMetricCompare | null;
  variant?: "prominent" | "compact";
  /** Stable id used to namespace nested data-testids. */
  testIdPrefix?: string;
  className?: string;
}

function isCompare(
  m: PrimaryMetric | PrimaryMetricCompare,
): m is PrimaryMetricCompare {
  return (m as PrimaryMetricCompare).actual !== undefined;
}

export function PrimaryMetricDisplay({
  metric,
  variant = "prominent",
  testIdPrefix,
  className,
}: Props) {
  if (!metric) return null;

  const tid = (suffix: string) =>
    testIdPrefix ? `${testIdPrefix}-${suffix}` : undefined;

  if (isCompare(metric)) {
    const { actual, planned } = metric;
    return (
      <div className={className} data-testid={tid("primary-metric")}>
        <p
          className={cn(
            "text-muted-foreground uppercase font-bold tracking-wider",
            variant === "prominent" ? "text-xs" : "text-[10px]",
          )}
        >
          {actual.label}
        </p>
        <p
          className={cn(
            "font-black",
            variant === "prominent" ? "text-3xl" : "text-lg",
          )}
        >
          <span
            className="text-primary"
            data-testid={tid("primary-metric-actual")}
          >
            {actual.formatted}
          </span>
          {planned && (
            <span
              className="text-muted-foreground font-mono font-bold ml-2 text-base"
              data-testid={tid("primary-metric-planned")}
            >
              / {planned.formatted}
            </span>
          )}
        </p>
      </div>
    );
  }

  return (
    <div className={className} data-testid={tid("primary-metric")}>
      <p
        className={cn(
          "text-muted-foreground uppercase font-bold tracking-wider",
          variant === "prominent" ? "text-xs" : "text-[10px]",
        )}
      >
        {metric.label}
      </p>
      <p
        className={cn(
          "font-black text-primary",
          variant === "prominent" ? "text-3xl" : "text-lg",
        )}
        data-testid={tid("primary-metric-value")}
      >
        {metric.formatted}
      </p>
    </div>
  );
}
