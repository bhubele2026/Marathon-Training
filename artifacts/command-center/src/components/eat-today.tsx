import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Beef, Flame, Sparkles, Wheat, Droplet } from "lucide-react";

// R6. The reactive "Eat today" block on the Today page. Surfaces the AI's
// per-day ADJUSTED calorie + macro target (which reacts to the day's planned
// or logged training), the one-line rationale, and progress against the
// actual intake synced so far. Lives in its own component so the heavy
// /api/nutrition/day query stays isolated from the rest of the Today page
// (and is trivially mockable in today.test.tsx, which renders Today without
// a QueryClientProvider).
//
// These routes are hand-fetched (the nutrition slice isn't in openapi.yaml),
// matching the convention in nutrition.tsx / goals.tsx.

export type DayTarget = {
  date: string;
  baseline: Macros | null;
  adjusted: Macros | null;
  delta: Macros | null;
  rationale: string | null;
  actual: Macros | null;
  source: "planned" | "actual";
  needsBaseline?: boolean;
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

function MacroLine({
  Icon,
  label,
  target,
  actual,
  unit,
}: {
  Icon: typeof Flame;
  label: string;
  target: number;
  actual: number | null;
  unit: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
        <Icon className="h-3.5 w-3.5 text-primary" />
        {label}
      </div>
      <div className="text-2xl font-extrabold tabular-nums leading-none">
        {actual != null ? (
          <>
            <span className="text-primary">{fmt(actual)}</span>
            <span className="text-muted-foreground"> / {fmt(target)}</span>
          </>
        ) : (
          <span className="text-primary">{fmt(target)}</span>
        )}
        <span className="ml-1 text-sm font-bold text-muted-foreground">{unit}</span>
      </div>
    </div>
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
      <Card
        className="border-dashed border-2 bg-muted/40"
        data-testid="card-eat-today-needs-baseline"
      >
        <CardContent className="p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Flame className="h-6 w-6 text-primary" />
            <div>
              <p className="text-sm font-bold tracking-wider text-primary">
                Eat today
              </p>
              <p className="text-xs text-muted-foreground">
                Set up nutrition to see today's reactive calorie + macro target.
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            className="font-bold tracking-wider"
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
    <Card
      className="border-primary/20 bg-primary/5 border-l-4 border-l-primary"
      data-testid="card-eat-today"
    >
      <CardContent className="p-6 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Flame className="h-5 w-5 text-primary" />
            <p className="text-sm font-bold tracking-wider text-primary">
              Eat today
            </p>
          </div>
          {/* baseline → adjusted readout makes the reactivity visible */}
          {baseline && calDelta !== 0 && (
            <p
              className="text-xs text-muted-foreground tabular-nums"
              data-testid="text-eat-today-recomp"
            >
              baseline {fmt(baseline.cal)} → today{" "}
              <span className="font-bold text-foreground">{fmt(adjusted.cal)}</span> kcal
              {data.source === "actual" ? " · from logged session" : ""}
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          <MacroLine
            Icon={Flame}
            label="Calories"
            target={adjusted.cal}
            actual={actual?.cal ?? null}
            unit="kcal"
          />
          <MacroLine
            Icon={Beef}
            label="Protein"
            target={adjusted.protein}
            actual={actual?.protein ?? null}
            unit="g"
          />
          <MacroLine
            Icon={Wheat}
            label="Carbs"
            target={adjusted.carbs}
            actual={actual?.carbs ?? null}
            unit="g"
          />
          <MacroLine
            Icon={Droplet}
            label="Fat"
            target={adjusted.fat}
            actual={actual?.fat ?? null}
            unit="g"
          />
        </div>

        {data.rationale && (
          <p
            className="text-sm text-muted-foreground border-l-2 border-primary/40 pl-3 flex items-start gap-2"
            data-testid="text-eat-today-rationale"
          >
            <Sparkles className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
            <span>{data.rationale}</span>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
