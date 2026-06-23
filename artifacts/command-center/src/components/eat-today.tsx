import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, Flame, Sparkles } from "lucide-react";
import { SectionHeader } from "@/components/studio/section-header";
import { StatReadout } from "@/components/studio/stat-readout";
import { CoachNote } from "@/components/studio/coach-note";

// R6. The reactive "Eat today" block on the Today page. Surfaces the AI's
// per-day ADJUSTED calorie + macro target (which reacts to the day's planned
// or logged training), the one-line rationale, and progress against the
// actual intake synced so far. Lives in its own component so the heavy
// /api/nutrition/day query stays isolated from the rest of the Today page
// (and is trivially mockable in today.test.tsx, which renders Today without
// a QueryClientProvider).
//
// Score-first (Phase 3): calories is the single hero readout in accent; the
// macros are quiet neutral StatReadouts; the rationale + training notes ride
// the CoachNote surface. One orange job per card — the calories number.

export type DayTarget = {
  date: string;
  baseline: Macros | null;
  adjusted: Macros | null;
  delta: Macros | null;
  rationale: string | null;
  actual: Macros | null;
  source: "planned" | "actual";
  needsBaseline?: boolean;
  trainingLoad?: number;
  training?: {
    source: "planned" | "actual";
    load: number;
    skipped: boolean;
    summary: string | null;
  } | null;
};

type Macros = { cal: number; protein: number; carbs: number; fat: number };

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

// Query key kept here so the mission-action hook can invalidate the exact
// same key after Done / Log Actual / Skipped without re-deriving the date
// shape. The runner's "today" is UTC, matching the server's day math.
export function dayTargetQueryKey(date: string): [string, string] {
  return ["/api/nutrition/day", date];
}

function fmt(n: number): string {
  return n.toLocaleString();
}

// A quiet supporting macro readout: mono value, "/ target unit" suffix.
function MacroStat({
  label,
  target,
  actual,
  unit,
}: {
  label: string;
  target: number;
  actual: number | null;
  unit: string;
}) {
  return (
    <StatReadout
      label={label}
      value={fmt(actual != null ? actual : target)}
      unit={actual != null ? `/ ${fmt(target)} ${unit}` : unit}
    />
  );
}

export function EatToday({ date }: { date: string }) {
  const { data, isLoading } = useQuery({
    queryKey: dayTargetQueryKey(date),
    queryFn: () => getJson<DayTarget>(`/api/nutrition/day/${date}`),
  });

  if (isLoading) {
    return (
      <Card data-testid="card-eat-today-loading">
        <CardContent className="p-6">
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  // No baseline yet (a stat is missing) — prompt to set up nutrition rather
  // than render a wrong/empty number.
  if (data.needsBaseline || !data.adjusted) {
    return (
      <Card variant="flush" className="border-2 border-dashed border-card-border" data-testid="card-eat-today-needs-baseline">
        <CardContent className="p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Flame className="h-6 w-6 text-primary" />
            <div>
              <p className="font-display text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Eat today
              </p>
              <p className="text-[13px] text-muted-foreground">
                Set up nutrition to see today's reactive calorie + macro target.
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            onClick={() => window.location.assign("/goals")}
            data-testid="button-eat-today-setup"
          >
            Set up nutrition
          </Button>
        </CardContent>
      </Card>
    );
  }

  const adjusted = data.adjusted;
  const actual = data.actual;
  const baseline = data.baseline;
  const calDelta = data.delta?.cal ?? 0;

  return (
    <Card data-testid="card-eat-today">
      <CardContent className="p-6 space-y-5">
        <SectionHeader
          eyebrow="Eat today"
          action={
            baseline && calDelta !== 0 ? (
              <span
                className="font-mono text-[12px] tabular-nums text-muted-foreground"
                data-testid="text-eat-today-recomp"
              >
                baseline {fmt(baseline.cal)} → today{" "}
                <span className="font-semibold text-foreground">{fmt(adjusted.cal)}</span> kcal
                {data.source === "actual" ? " · from logged session" : ""}
              </span>
            ) : undefined
          }
        />

        {/* Score-first: calories is the hero, in the accent + instrument font. */}
        <div className="flex flex-col gap-1">
          <span className="font-display text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            Calories
          </span>
          <div className="flex items-baseline gap-2">
            <span className="glow-primary font-mono text-4xl font-semibold leading-none tabular-nums tracking-[-0.02em] text-primary sm:text-5xl">
              {fmt(actual != null ? actual.cal : adjusted.cal)}
            </span>
            <span className="text-sm font-medium text-muted-foreground">
              {actual != null ? `/ ${fmt(adjusted.cal)} kcal` : "kcal"}
            </span>
          </div>
        </div>

        {/* Supporting macros — quiet, neutral. */}
        <div className="grid grid-cols-3 gap-x-6 gap-y-4">
          <MacroStat label="Protein" target={adjusted.protein} actual={actual?.protein ?? null} unit="g" />
          <MacroStat label="Carbs" target={adjusted.carbs} actual={actual?.carbs ?? null} unit="g" />
          <MacroStat label="Fat" target={adjusted.fat} actual={actual?.fat ?? null} unit="g" />
        </div>

        {data.rationale && (
          <div data-testid="text-eat-today-rationale">
            <CoachNote icon={Sparkles}>{data.rationale}</CoachNote>
          </div>
        )}

        {/* What drove today's target — the logged session + load, plus the
            reassurance that the bump tracks training load, NOT device-estimated
            calories burned. */}
        {data.training && data.training.summary && data.training.load > 0 && (
          <p
            className="flex items-start gap-2 text-[13px] text-muted-foreground"
            data-testid="text-eat-today-training"
          >
            <Activity className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span>
              Today's training: {data.training.summary} ·{" "}
              <span className="font-mono font-semibold tabular-nums text-foreground">
                load {data.training.load}
              </span>
              .{" "}
              {calDelta > 0 && (
                <span>
                  This bump fuels the work — based on training load, not the
                  calories you burned (device estimates run high).
                </span>
              )}
            </span>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
