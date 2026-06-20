import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Scale, Dumbbell, Flame, Beef, Activity, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

// The dashboard "keep track" hub — recomp progress, training consistency,
// nutrition adherence, and machine mix over a rolling window. One hand-fetched
// query (the tracking slice isn't in openapi.yaml), matching eat-today.tsx.

type Mix = { equipment: string; minutes: number; sessions: number };

type Tracking = {
  window: { from: string; to: string; days: number };
  recomp: {
    currentWeightLb: number | null;
    startWeightLb: number | null;
    goalWeightLb: number | null;
    changeLb: number | null;
    toGoalLb: number | null;
    strengthCurrent: number | null;
    strengthGoal: number | null;
  };
  consistency: {
    sessionsDone: number;
    plannedSessions: number;
    daysTrained: number;
    minutesDone: number;
    loadTotal: number;
    verdicts: {
      over: number;
      complete: number;
      close: number;
      short: number;
      skipped: number;
      bonus: number;
    };
  };
  nutrition: {
    daysLogged: number;
    avgCalories: number | null;
    avgProtein: number | null;
    target: { calories: number | null; protein: number | null };
    daysOverCalories: number;
    daysUnderCalories: number;
    proteinHitRate: number | null;
  };
  machineMix: Mix[];
};

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

function fmt(n: number | null | undefined, unit = ""): string {
  if (n == null) return "—";
  return `${n.toLocaleString()}${unit}`;
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <p className="text-2xl font-extrabold tabular-nums leading-tight">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function ProgressBar({ pct, tone = "bg-primary" }: { pct: number; tone?: string }) {
  return (
    <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
      <div
        className={cn("h-full rounded-full", tone)}
        style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
      />
    </div>
  );
}

export function DashboardTracking({ days = 28 }: { days?: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ["/api/dashboard/tracking", days],
    queryFn: () => getJson<Tracking>(`/api/dashboard/tracking?days=${days}`),
  });

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="tracking-loading">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-44" />
        ))}
      </div>
    );
  }
  if (!data) return null;

  const r = data.recomp;
  const c = data.consistency;
  const n = data.nutrition;
  const maxMix = Math.max(1, ...data.machineMix.map((m) => m.minutes));

  // Strength-score progress toward goal (0..100).
  const strengthPct =
    r.strengthCurrent != null && r.strengthGoal != null && r.strengthGoal > 0
      ? Math.round((r.strengthCurrent / r.strengthGoal) * 100)
      : null;

  // Verdict chips, only the buckets that occurred.
  const verdictChips: { label: string; count: number; tone: string }[] = [
    { label: "Nailed", count: c.verdicts.complete, tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
    { label: "Over", count: c.verdicts.over, tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
    { label: "Close", count: c.verdicts.close, tone: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
    { label: "Short", count: c.verdicts.short, tone: "bg-destructive/15 text-destructive" },
    { label: "Skipped", count: c.verdicts.skipped, tone: "bg-destructive/15 text-destructive" },
    { label: "Bonus", count: c.verdicts.bonus, tone: "bg-primary/15 text-primary" },
  ].filter((v) => v.count > 0);

  return (
    <section className="space-y-3" data-testid="dashboard-tracking">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-primary">
          Tracking
        </h2>
        <span className="text-xs text-muted-foreground">last {data.window.days} days</span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {/* Recomp */}
        <Card data-testid="tracking-recomp">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold uppercase tracking-[0.12em] flex items-center gap-2">
              <Scale className="h-4 w-4 text-primary" /> Recomp
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Stat
              label="Weight"
              value={fmt(r.currentWeightLb, " lb")}
              sub={
                r.goalWeightLb != null
                  ? `goal ${fmt(r.goalWeightLb)} · ${
                      r.toGoalLb != null ? `${r.toGoalLb > 0 ? "+" : ""}${r.toGoalLb} to go` : ""
                    }`
                  : "set a goal weight"
              }
            />
            {r.changeLb != null && (
              <p
                className={cn(
                  "text-xs font-bold",
                  r.changeLb < 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground",
                )}
              >
                {r.changeLb > 0 ? "+" : ""}
                {r.changeLb} lb this window
              </p>
            )}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground flex items-center gap-1">
                  <Dumbbell className="h-3.5 w-3.5" /> Strength Score
                </span>
                <span className="font-bold tabular-nums">
                  {fmt(r.strengthCurrent)}
                  {r.strengthGoal != null ? ` / ${r.strengthGoal}` : ""}
                </span>
              </div>
              {strengthPct != null && <ProgressBar pct={strengthPct} />}
            </div>
          </CardContent>
        </Card>

        {/* Consistency */}
        <Card data-testid="tracking-consistency">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold uppercase tracking-[0.12em] flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-primary" /> Consistency
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Stat
              label="Sessions done"
              value={`${c.sessionsDone}${c.plannedSessions ? ` / ${c.plannedSessions}` : ""}`}
              sub={`${c.daysTrained} days trained · load ${c.loadTotal}`}
            />
            {verdictChips.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {verdictChips.map((v) => (
                  <span
                    key={v.label}
                    className={cn(
                      "text-[10px] font-bold px-2 py-1 rounded tracking-wider",
                      v.tone,
                    )}
                    data-testid={`tracking-verdict-${v.label.toLowerCase()}`}
                  >
                    {v.count} {v.label}
                  </span>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Nutrition adherence */}
        <Card data-testid="tracking-nutrition">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold uppercase tracking-[0.12em] flex items-center gap-2">
              <Flame className="h-4 w-4 text-primary" /> Nutrition
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Stat
              label="Avg calories"
              value={fmt(n.avgCalories)}
              sub={n.target.calories != null ? `target ${fmt(n.target.calories)}` : `${n.daysLogged} days logged`}
            />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground flex items-center gap-1">
                  <Beef className="h-3 w-3" /> Protein
                </p>
                <p className="text-lg font-extrabold tabular-nums">
                  {fmt(n.avgProtein, " g")}
                </p>
                {n.proteinHitRate != null && (
                  <p className="text-xs text-muted-foreground">
                    hit {Math.round(n.proteinHitRate * 100)}% of days
                  </p>
                )}
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                  Cal days
                </p>
                <p className="text-lg font-extrabold tabular-nums">
                  {n.daysUnderCalories}↓ {n.daysOverCalories}↑
                </p>
                <p className="text-xs text-muted-foreground">under / over target</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Machine mix */}
        <Card data-testid="tracking-machine-mix">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold uppercase tracking-[0.12em] flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" /> Machine mix
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.machineMix.length === 0 && (
              <p className="text-sm text-muted-foreground">No sessions logged yet.</p>
            )}
            {data.machineMix.map((m) => (
              <div key={m.equipment} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium truncate">{m.equipment}</span>
                  <span className="text-muted-foreground tabular-nums shrink-0 ml-2">
                    {m.minutes} min · {m.sessions}×
                  </span>
                </div>
                <ProgressBar pct={(m.minutes / maxMix) * 100} />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
