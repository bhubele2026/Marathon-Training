import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip as RTooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Scale, Dumbbell, Flame, Beef, Activity, CheckCircle2, TrendingDown } from "lucide-react";
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
  progress: {
    weeks: number;
    weightSeries: { date: string; lb: number }[];
    targetCurve: { date: string; lb: number }[];
    inchesSeries: { date: string; totalIn: number }[];
    weightStatus: {
      currentWeekTargetLb: number;
      varianceLb: number | null;
      onTrack: boolean | null;
      rateLb: number;
      goalWeightLb: number | null;
    } | null;
    adherence: {
      caloriePct: number | null;
      proteinPct: number | null;
      consistencyPct: number | null;
    };
  };
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
      <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
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

export function DashboardTracking() {
  const [weeks, setWeeks] = useState(8);
  const { data, isLoading } = useQuery({
    queryKey: ["/api/dashboard/tracking", "weeks", weeks],
    queryFn: () => getJson<Tracking>(`/api/dashboard/tracking?weeks=${weeks}`),
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
    { label: "Nailed", count: c.verdicts.complete, tone: "bg-success/15 text-success" },
    { label: "Over", count: c.verdicts.over, tone: "bg-success/15 text-success" },
    { label: "Close", count: c.verdicts.close, tone: "bg-warning/15 text-warning" },
    { label: "Short", count: c.verdicts.short, tone: "bg-destructive/15 text-destructive" },
    { label: "Skipped", count: c.verdicts.skipped, tone: "bg-destructive/15 text-destructive" },
    { label: "Bonus", count: c.verdicts.bonus, tone: "bg-primary/15 text-primary" },
  ].filter((v) => v.count > 0);

  const p = data.progress;
  // Merge the actual weight trend and the target-weight curve onto one date axis
  // so they overlay in a single chart (recharts connects across the gaps).
  const byDate = new Map<string, { date: string; weight?: number; target?: number }>();
  for (const w of p.weightSeries)
    byDate.set(w.date, { ...(byDate.get(w.date) ?? { date: w.date }), weight: w.lb });
  for (const t of p.targetCurve)
    byDate.set(t.date, { ...(byDate.get(t.date) ?? { date: t.date }), target: t.lb });
  const weightChart = [...byDate.values()].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  const inchesFirst = p.inchesSeries[0]?.totalIn ?? null;
  const inchesLast = p.inchesSeries[p.inchesSeries.length - 1]?.totalIn ?? null;
  const inchesChange =
    inchesFirst != null && inchesLast != null
      ? Math.round((inchesLast - inchesFirst) * 10) / 10
      : null;
  const ws = p.weightStatus;
  const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);

  return (
    <section className="space-y-3" data-testid="dashboard-tracking">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-bold uppercase tracking-[0.08em] text-primary">
          Tracking
        </h2>
        <div className="flex items-center gap-1" data-testid="tracking-window-toggle">
          {[4, 8, 12].map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setWeeks(w)}
              className={cn(
                "text-xs font-bold px-2 py-1 rounded tracking-wider transition-colors",
                weeks === w
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
              data-testid={`tracking-window-${w}w`}
              aria-pressed={weeks === w}
            >
              {w}w
            </button>
          ))}
        </div>
      </div>

      {/* Progress picture — weight vs the goal curve, the inches/strength recomp
          signals, and adherence over the window. */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" data-testid="tracking-weight-curve">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold uppercase tracking-[0.08em] flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-primary" /> Weight vs goal curve
            </CardTitle>
          </CardHeader>
          <CardContent>
            {weightChart.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Log a few weigh-ins to see your trend against the goal.
              </p>
            ) : (
              <>
                {ws && (
                  <p
                    className={cn(
                      "text-xs font-bold mb-2",
                      ws.onTrack === false
                        ? "text-warning"
                        : "text-success",
                    )}
                    data-testid="tracking-weight-status"
                  >
                    {ws.varianceLb == null
                      ? "Set a weigh-in to compare to your curve"
                      : ws.onTrack
                        ? `On track — ${Math.abs(ws.varianceLb)} lb ${ws.varianceLb <= 0 ? "ahead of" : "from"} this week's target`
                        : `${Math.abs(ws.varianceLb)} lb ${ws.varianceLb > 0 ? "above" : "below"} this week's target (${ws.currentWeekTargetLb} lb)`}
                  </p>
                )}
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={weightChart} margin={{ top: 5, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(d: string) => d.slice(5)}
                      tick={{ fontSize: 10 }}
                      minTickGap={24}
                    />
                    <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10 }} width={40} />
                    <RTooltip />
                    <Line
                      type="monotone"
                      dataKey="target"
                      name="Target"
                      stroke="hsl(var(--muted-foreground))"
                      strokeDasharray="4 4"
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                    />
                    <Line
                      type="monotone"
                      dataKey="weight"
                      name="Actual"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2.5}
                      dot={{ r: 2 }}
                      connectNulls
                    />
                  </LineChart>
                </ResponsiveContainer>
              </>
            )}
          </CardContent>
        </Card>

        <Card data-testid="tracking-recomp-signals">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold uppercase tracking-[0.08em] flex items-center gap-2">
              <Dumbbell className="h-4 w-4 text-primary" /> Recomp signals
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Stat
              label="Inches (sum)"
              value={inchesLast != null ? `${inchesLast} in` : "—"}
              sub={
                inchesChange != null
                  ? `${inchesChange <= 0 ? "" : "+"}${inchesChange} in over window`
                  : "log circumferences to track"
              }
            />
            <Stat
              label="Strength Score"
              value={
                r.strengthCurrent != null
                  ? `${r.strengthCurrent}${r.strengthGoal != null ? ` / ${r.strengthGoal}` : ""}`
                  : "—"
              }
              sub="flat scale + inches down + strength up = winning"
            />
            <div className="space-y-1.5 pt-1">
              <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                Adherence
              </p>
              <div className="flex flex-wrap gap-1.5 text-[10px] font-bold tracking-wider">
                <span className="px-2 py-1 rounded bg-primary/10 text-primary" data-testid="tracking-adherence-cal">
                  {pct(p.adherence.caloriePct)} cals
                </span>
                <span className="px-2 py-1 rounded bg-primary/10 text-primary" data-testid="tracking-adherence-protein">
                  {pct(p.adherence.proteinPct)} protein
                </span>
                <span className="px-2 py-1 rounded bg-primary/10 text-primary" data-testid="tracking-adherence-consistency">
                  {pct(p.adherence.consistencyPct)} sessions
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {/* Recomp */}
        <Card data-testid="tracking-recomp">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold uppercase tracking-[0.08em] flex items-center gap-2">
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
                  r.changeLb < 0 ? "text-success" : "text-muted-foreground",
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
            <CardTitle className="text-sm font-bold uppercase tracking-[0.08em] flex items-center gap-2">
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
            <CardTitle className="text-sm font-bold uppercase tracking-[0.08em] flex items-center gap-2">
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
                <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground flex items-center gap-1">
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
                <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
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
            <CardTitle className="text-sm font-bold uppercase tracking-[0.08em] flex items-center gap-2">
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
