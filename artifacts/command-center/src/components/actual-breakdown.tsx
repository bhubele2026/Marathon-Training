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

import { formatDuration } from "@/lib/format";

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
    // Prominent: today.tsx logged-workout card. Same sizing as the
    // PlannedBreakdown prominent variant so the planned and actual rows
    // line up visually when stacked together.
    return (
      <div className="flex flex-wrap gap-x-8 gap-y-4" data-testid={tid("actual-breakdown")}>
        {cells.map((c) => (
          <div key={c.key}>
            <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">
              {c.label}
            </p>
            <p
              className={`text-xl font-black ${c.key === "total" ? "text-primary" : ""}`}
              data-testid={tid(`actual-breakdown-${c.key}`)}
            >
              {formatDuration(c.value)}
            </p>
            {c.planned != null && (
              <p
                className="text-xs text-muted-foreground font-mono"
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

  // Compact: week-detail.tsx per-session row. Inline pill-sized stats
  // matching the surrounding Dist / Pace / RPE / Load tiles.
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs font-mono" data-testid={tid("actual-breakdown")}>
      {cells.map((c) => (
        <span key={c.key}>
          <span className="text-muted-foreground">{c.label}</span>{" "}
          <span
            className={c.key === "total" ? "font-bold text-primary" : ""}
            data-testid={tid(`actual-breakdown-${c.key}`)}
          >
            {formatDuration(c.value)}
          </span>
          {c.planned != null && (
            <span
              className="text-[10px] text-muted-foreground ml-1"
              data-testid={tid(`actual-breakdown-${c.key}-planned`)}
            >
              / {c.planned}
            </span>
          )}
        </span>
      ))}
    </div>
  );
}
