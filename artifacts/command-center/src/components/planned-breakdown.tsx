// Renders the TOTAL · LIFT · CARDIO · RUN minute breakdown for a prescribed
// workout. Replaces the old single "Planned Duration" tile that displayed
// plan_day.cardio_min, which was misleading because cardio_min was overloaded
// as "run minutes" on run days. Each tile is now sourced from its own column
// on the PlanDay payload, and TOTAL is computed server-side
// (toPlanDay -> totalMin) so the value is consistent across /today and
// /plan/:week.
//
// Rendering policy (per the task spec):
//   * TOTAL is always shown when totalMin > 0.
//   * LIFT, CARDIO, and RUN are only rendered when their bucket has a
//     positive value. Zero / null buckets are dropped entirely so a long
//     run only day shows TOTAL · RUN, a strength + cardio day shows
//     TOTAL · LIFT · CARDIO, etc. — no placeholder dashes for empty
//     buckets.
//   * If totalMin is 0 (or null), the whole component renders nothing so
//     true rest days don't leave an empty placeholder in the surrounding
//     flex/grid layout.
//
// Sized for two contexts:
//   * `compact` — week-detail.tsx: small inline tile alongside Distance /
//     Load. Uses the same font sizing as the other small stats.
//   * `prominent` — today.tsx mission brief and pre-launch countdown:
//     larger numbers to match the other big-stat tiles in those cards.
//
// Task #137: typography aligned with PrimaryMetricDisplay so the slim
// card header and the expanded breakdown read as one design system —
// uppercase tracking-wider muted labels, font-black primary-tone TOTAL,
// font-mono semibold values for the secondary buckets. Tile gaps were
// tightened (gap-x-5 compact, gap-x-7 prominent) to keep the row
// scannable inside the disclosure gutter.

import { formatDistance, formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface PlannedBreakdownProps {
  // The generated OpenAPI types model nullable optional fields as
  // `number | null | undefined`, so accept all three shapes here and
  // normalize to 0 internally.
  totalMin: number | null | undefined;
  strengthMin: number | null | undefined;
  cardioMin: number | null | undefined;
  runMin: number | null | undefined;
  // When set and the RUN bucket is rendered, we also show the run mileage
  // inside the RUN tile (e.g. "32 min · 2.00 mi") so the breakdown is
  // self-contained rather than depending on a sibling DISTANCE tile.
  runDistanceMi?: number | null | undefined;
  variant?: "compact" | "prominent";
  testIdPrefix?: string;
}

interface Cell {
  key: "total" | "lift" | "cardio" | "run";
  label: string;
  value: number;
  // Optional sub-line, used today for RUN to show mileage under the
  // minutes value.
  detail?: string;
}

export function PlannedBreakdown({
  totalMin,
  strengthMin,
  cardioMin,
  runMin,
  runDistanceMi,
  variant = "compact",
  testIdPrefix,
}: PlannedBreakdownProps) {
  const total = totalMin ?? 0;
  if (total <= 0) return null;

  // Always include TOTAL; only include the per-bucket cells when they
  // actually have minutes. Empty buckets are dropped, never shown as "—".
  const cells: Cell[] = [{ key: "total", label: "Total", value: total }];
  const lift = strengthMin ?? 0;
  const cardio = cardioMin ?? 0;
  const run = runMin ?? 0;
  if (lift > 0) cells.push({ key: "lift", label: "Lift", value: lift });
  if (cardio > 0) cells.push({ key: "cardio", label: "Cardio", value: cardio });
  if (run > 0) {
    cells.push({
      key: "run",
      label: "Run",
      value: run,
      detail:
        runDistanceMi != null && runDistanceMi > 0
          ? formatDistance(runDistanceMi)
          : undefined,
    });
  }

  const tid = (suffix: string) =>
    testIdPrefix ? `${testIdPrefix}-${suffix}` : undefined;

  if (variant === "prominent") {
    // Prominent: today.tsx mission brief / pre-launch countdown. Tighter
    // tile gap (gap-x-7) than the original gap-x-8 so the row sits
    // anchored inside the disclosure gutter; TOTAL keeps the primary
    // accent so it visually echoes the headline number above.
    return (
      <div
        className="flex flex-wrap gap-x-7 gap-y-3"
        data-testid={tid("breakdown")}
      >
        {cells.map((c) => (
          <div key={c.key}>
            <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">
              {c.label}
            </p>
            <p
              className={cn(
                "font-black leading-tight",
                c.key === "total"
                  ? "text-2xl text-primary"
                  : "text-xl font-mono",
              )}
              data-testid={tid(`breakdown-${c.key}`)}
            >
              {formatDuration(c.value)}
            </p>
            {c.detail && (
              <p
                className="text-[10px] text-muted-foreground font-mono mt-0.5 uppercase tracking-wider"
                data-testid={tid(`breakdown-${c.key}-detail`)}
              >
                {c.detail}
              </p>
            )}
          </div>
        ))}
      </div>
    );
  }

  // Compact: matches the inline Distance / Load tiles in week-detail.tsx
  // and the dashboard mini brief. Tighter gap-x-5 keeps the row dense
  // inside the disclosure gutter.
  return (
    <div
      className="flex flex-wrap gap-x-5 gap-y-2"
      data-testid={tid("breakdown")}
    >
      {cells.map((c) => (
        <div key={c.key}>
          <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground block">
            {c.label}
          </span>
          <span
            className={cn(
              "leading-tight block",
              c.key === "total"
                ? "text-base font-black text-primary"
                : "text-sm font-mono font-semibold",
            )}
            data-testid={tid(`breakdown-${c.key}`)}
          >
            {formatDuration(c.value)}
            {c.detail && (
              <span
                className="text-[10px] text-muted-foreground font-mono ml-1 font-normal"
                data-testid={tid(`breakdown-${c.key}-detail`)}
              >
                · {c.detail}
              </span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
