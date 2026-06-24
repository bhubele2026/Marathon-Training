// Renders the per-bucket actual minute breakdown for a *logged* workout
// (TOTAL · LIFT · CARDIO · RUN), the actuals counterpart to PlannedBreakdown.
//
// This component exists because the workout card on /today and the
// per-session row on /plan/:week previously only had a single "Duration"
// tile sourced from `workout.durationMin`. With per-bucket actual columns
// (Task #76) we can now show the user how the prescribed lift / cardio /
// run minutes actually broke out and compare them tile-by-tile against
// the planned breakdown ("ran 28 min vs planned 36 min, lifted 40 min vs
// planned 45 min").
//
// Rendering policy:
//   * If the workout has any per-bucket actuals (totalMin != null), we
//     render TOTAL plus only the buckets that have a positive value on
//     EITHER the actual OR the planned side. That way:
//       - a strength-only day shows TOTAL · LIFT and never a "0 min"
//         placeholder for cardio / run buckets the plan doesn't even
//         prescribe;
//       - a day where the plan prescribes 25 min lift but the user did 0
//         still surfaces a LIFT tile with "0 / 25" so the gap is obvious.
//   * If the workout has no per-bucket breakdown but does have a legacy
//     `durationMin`, we fall back to a single Duration tile so old rows
//     (and quick-logged Lifestyle activities) still render something.
//   * If neither side has any minutes, the whole component renders
//     nothing.
//
// Task #137: typography unified with PrimaryMetricDisplay's compare
// branch — actual is rendered in the primary accent (font-black) and
// the planned annotation is its inline muted/mono trailing piece, so
// the expanded "actual vs planned" tile reads like a more detailed
// version of the slim card's headline number rather than a separate
// design.

import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface ActualBreakdownProps {
  // Actuals from the logged workout. The generated OpenAPI types model
  // nullable optional fields as `number | null | undefined`, so accept
  // all three shapes here.
  totalMin: number | null | undefined;
  strengthMin: number | null | undefined;
  cardioMin: number | null | undefined;
  runMin: number | null | undefined;
  // Legacy total duration field, used as a fallback when none of the
  // per-bucket actuals are populated (e.g. workouts logged before the
  // breakdown columns existed, or quick-logged Lifestyle activities).
  durationMin?: number | null | undefined;
  // Optional planned breakdown for the matching plan day. When provided,
  // each rendered tile annotates the actual value with "/ planned" so
  // the user can eyeball the delta without flipping back to the brief.
  plannedTotalMin?: number | null | undefined;
  plannedStrengthMin?: number | null | undefined;
  plannedCardioMin?: number | null | undefined;
  plannedRunMin?: number | null | undefined;
  variant?: "compact" | "prominent";
  testIdPrefix?: string;
}

interface Cell {
  key: "total" | "lift" | "cardio" | "run";
  label: string;
  value: number;
  planned: number | null;
}

function shouldShow(actual: number, planned: number | null): boolean {
  // Render the tile if either side has minutes; suppress when both are
  // zero so an "all-strength" day doesn't show empty cardio / run cells.
  return actual > 0 || (planned ?? 0) > 0;
}

export function ActualBreakdown({
  totalMin,
  strengthMin,
  cardioMin,
  runMin,
  durationMin,
  plannedTotalMin,
  plannedStrengthMin,
  plannedCardioMin,
  plannedRunMin,
  variant = "compact",
  testIdPrefix,
}: ActualBreakdownProps) {
  const hasBreakdown =
    totalMin != null ||
    strengthMin != null ||
    cardioMin != null ||
    runMin != null;

  // Legacy fallback: no per-bucket actuals on this workout. Render a
  // single Duration tile so the layout still has something to show, and
  // bail out entirely when even the legacy duration is missing.
  if (!hasBreakdown) {
    if (durationMin == null) return null;
    return (
      <Tiles
        variant={variant}
        testIdPrefix={testIdPrefix}
        cells={[
          {
            key: "total",
            label: "Duration",
            value: durationMin,
            planned: plannedTotalMin ?? null,
          },
        ]}
      />
    );
  }

  const total = totalMin ?? 0;
  const lift = strengthMin ?? 0;
  const cardio = cardioMin ?? 0;
  const run = runMin ?? 0;
  const plannedTotal = plannedTotalMin ?? null;
  const plannedLift = plannedStrengthMin ?? null;
  const plannedCardio = plannedCardioMin ?? null;
  const plannedRun = plannedRunMin ?? null;

  const cells: Cell[] = [];
  if (shouldShow(total, plannedTotal)) {
    cells.push({ key: "total", label: "Total", value: total, planned: plannedTotal });
  }
  if (shouldShow(lift, plannedLift)) {
    cells.push({ key: "lift", label: "Lift", value: lift, planned: plannedLift });
  }
  if (shouldShow(cardio, plannedCardio)) {
    cells.push({ key: "cardio", label: "Cardio", value: cardio, planned: plannedCardio });
  }
  if (shouldShow(run, plannedRun)) {
    cells.push({ key: "run", label: "Run", value: run, planned: plannedRun });
  }

  if (cells.length === 0) return null;

  return <Tiles variant={variant} testIdPrefix={testIdPrefix} cells={cells} />;
}

interface TilesProps {
  cells: Cell[];
  variant: "compact" | "prominent";
  testIdPrefix?: string;
}

function Tiles({ cells, variant, testIdPrefix }: TilesProps) {
  const tid = (suffix: string) =>
    testIdPrefix ? `${testIdPrefix}-${suffix}` : undefined;

  if (variant === "prominent") {
    // Prominent: today.tsx logged-workout card. Mirrors
    // PlannedBreakdown's prominent sizing so when the two stack inside
    // the disclosure they line up tile-for-tile. The planned annotation
    // sits as its own muted line under the value so the actual / planned
    // delta reads at a glance — same compare style as PrimaryMetricDisplay.
    return (
      <div
        className="flex flex-wrap gap-x-7 gap-y-3"
        data-testid={tid("actual-breakdown")}
      >
        {cells.map((c) => (
          <div key={c.key}>
            <p className="text-[10px] text-muted-foreground font-bold tracking-wider">
              {c.label}
            </p>
            <p
              className={cn(
                "font-black leading-tight",
                c.key === "total"
                  ? "text-2xl text-primary"
                  : "text-xl tabular-nums",
              )}
              data-testid={tid(`actual-breakdown-${c.key}`)}
            >
              {formatDuration(c.value)}
            </p>
            {c.planned != null && (
              <p
                className="text-[10px] text-muted-foreground tabular-nums mt-0.5 tracking-wider"
                data-testid={tid(`actual-breakdown-${c.key}-planned`)}
              >
                / {c.planned} planned
              </p>
            )}
          </div>
        ))}
      </div>
    );
  }

  // Compact: week-detail.tsx + dashboard per-session row. Inline tile
  // matched to the PrimaryMetricDisplay compare style — actual in the
  // primary accent, planned trailing in muted/mono so the gap reads
  // like the headline "5.20 / 6.00 mi" comparison the slim card uses.
  return (
    <div
      className="flex flex-wrap gap-x-5 gap-y-2 text-xs"
      data-testid={tid("actual-breakdown")}
    >
      {cells.map((c) => (
        <div key={c.key}>
          <span className="text-[10px] font-bold tracking-wider text-muted-foreground block">
            {c.label}
          </span>
          <span className="leading-tight block">
            <span
              className={cn(
                c.key === "total"
                  ? "text-base font-black text-primary"
                  : "text-sm tabular-nums font-semibold",
              )}
              data-testid={tid(`actual-breakdown-${c.key}`)}
            >
              {formatDuration(c.value)}
            </span>
            {c.planned != null && (
              <span
                className="text-[10px] text-muted-foreground tabular-nums ml-1"
                data-testid={tid(`actual-breakdown-${c.key}-planned`)}
              >
                / {c.planned}
              </span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
