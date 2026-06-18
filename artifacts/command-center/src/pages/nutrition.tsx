import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Beef, Droplet, Flame, RefreshCw, Wheat } from "lucide-react";
import type { LucideIcon } from "lucide-react";

// These routes are intentionally hand-fetched rather than going through the
// generated api-client: the nutrition slice isn't in openapi.yaml, so we hit
// the same-origin /api path the generated client resolves to anyway. Keeps
// the feature self-contained with no codegen step.
type NutritionDay = {
  date: string;
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  updatedAt: string | null;
};
type RecentResponse = { days: number; entries: NutritionDay[] };
// Targets come from the AI calculation on the Goals page. Any of them may be
// null until the runner computes them — the rings degrade to a bare value.
type GoalsTargets = {
  calorieTarget: number | null;
  proteinTargetG: number | null;
  carbsTargetG: number | null;
  fatTargetG: number | null;
};

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

function formatUpdated(iso: string | null): string {
  if (!iso) return "Not synced yet today";
  const d = new Date(iso);
  return `Synced ${d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

function formatDayLabel(date: string): string {
  // date is YYYY-MM-DD; render without TZ drift by anchoring at noon UTC.
  const d = new Date(`${date}T12:00:00Z`);
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric" });
}

// A single macro ring. Monochrome-accent: the progress arc is the teal accent
// (primary), the track is neutral (muted). When `target` is null we show the
// value with no goal ring (a full neutral circle), never a hardcoded goal.
function MacroRing({
  label,
  Icon,
  value,
  target,
  unit,
}: {
  label: string;
  Icon: LucideIcon;
  value: number | null;
  target: number | null;
  unit: string;
}) {
  const size = 116;
  const stroke = 11;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const hasGoal = target != null && target > 0;
  const pct =
    value != null && hasGoal ? Math.min(1, value / (target as number)) : 0;
  const hit = hasGoal && value != null && value >= (target as number);
  const remaining =
    hasGoal && value != null ? Math.max(0, (target as number) - value) : null;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={stroke}
            className="stroke-muted"
          />
          {hasGoal && (
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              strokeWidth={stroke}
              strokeLinecap="round"
              className="stroke-primary transition-[stroke-dashoffset]"
              strokeDasharray={circ}
              strokeDashoffset={circ * (1 - pct)}
            />
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-extrabold tabular-nums text-primary leading-none">
            {value ?? "—"}
          </span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">{unit}</span>
        </div>
      </div>
      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
        <Icon className="h-3.5 w-3.5 text-primary" />
        {label}
      </div>
      <p className="h-4 text-[11px] text-muted-foreground tabular-nums">
        {value == null
          ? "Waiting on sync"
          : hasGoal
            ? hit
              ? "Goal hit"
              : `${remaining} ${unit} to go`
            : "No goal set"}
      </p>
    </div>
  );
}

export default function Nutrition() {
  const todayQuery = useQuery({
    queryKey: ["/api/nutrition/today"],
    queryFn: () => getJson<NutritionDay>("/api/nutrition/today"),
  });
  const recentQuery = useQuery({
    queryKey: ["/api/nutrition/recent", 14],
    queryFn: () => getJson<RecentResponse>("/api/nutrition/recent?days=14"),
  });
  // AI-calculated targets from the Goals page drive the rings; each is null
  // until the runner computes them, and the ring degrades gracefully.
  const goalsQuery = useQuery({
    queryKey: ["/api/goals"],
    queryFn: () => getJson<GoalsTargets>("/api/goals"),
  });

  const t = goalsQuery.data;
  const today = todayQuery.data;

  const macros: Array<{
    label: string;
    Icon: LucideIcon;
    value: number | null;
    target: number | null;
    unit: string;
  }> = [
    {
      label: "Calories",
      Icon: Flame,
      value: today?.calories ?? null,
      target: t?.calorieTarget ?? null,
      unit: "kcal",
    },
    {
      label: "Protein",
      Icon: Beef,
      value: today?.proteinG ?? null,
      target: t?.proteinTargetG ?? null,
      unit: "g",
    },
    {
      label: "Carbs",
      Icon: Wheat,
      value: today?.carbsG ?? null,
      target: t?.carbsTargetG ?? null,
      unit: "g",
    },
    {
      label: "Fat",
      Icon: Droplet,
      value: today?.fatG ?? null,
      target: t?.fatTargetG ?? null,
      unit: "g",
    },
  ];

  // 14-day protein trend. Peak scales the bars; the protein target (when set)
  // is the goal threshold that fills a bar to full accent.
  const entries = recentQuery.data?.entries ?? [];
  const proteinGoal = t?.proteinTargetG ?? null;
  const peakProtein = Math.max(
    proteinGoal ?? 0,
    1,
    ...entries.map((e) => e.proteinG ?? 0),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-4xl font-extrabold tracking-tight text-primary">
          Nutrition
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Calories and macros synced from your food tracker via Apple Health.
        </p>
      </div>

      {/* Today's four macros vs target */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-sm tracking-wider text-muted-foreground">
            <span>Today</span>
            <span className="flex items-center gap-1.5 text-xs font-normal normal-case">
              <RefreshCw className="h-3 w-3" />
              {formatUpdated(today?.updatedAt ?? null)}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {todayQuery.isLoading || goalsQuery.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
                {macros.map((m) => (
                  <MacroRing key={m.label} {...m} />
                ))}
              </div>
              {t != null &&
                t.calorieTarget == null &&
                t.proteinTargetG == null &&
                t.carbsTargetG == null &&
                t.fatTargetG == null && (
                  <p className="mt-4 text-xs text-muted-foreground">
                    No targets set yet. Calculate them on the Goals page to see
                    progress rings.
                  </p>
                )}
            </>
          )}
        </CardContent>
      </Card>

      {/* 14-day protein trend */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm tracking-wider text-muted-foreground">
            Last 14 days · protein
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recentQuery.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No nutrition synced yet. Once your Apple Shortcut runs, the days
              will fill in here.
            </p>
          ) : (
            <div className="space-y-2">
              {entries.map((e) => {
                const g = e.proteinG ?? 0;
                const pct = peakProtein > 0 ? (g / peakProtein) * 100 : 0;
                const hitGoal = proteinGoal != null && g >= proteinGoal;
                return (
                  <div key={e.date} className="flex items-center gap-3">
                    <span className="w-16 shrink-0 text-xs text-muted-foreground tabular-nums">
                      {formatDayLabel(e.date)}
                    </span>
                    <div className="h-6 flex-1 overflow-hidden bg-muted">
                      <div
                        className={
                          hitGoal ? "h-full bg-primary" : "h-full bg-primary/50"
                        }
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-28 shrink-0 text-right text-xs tabular-nums">
                      <span className="font-bold text-foreground">{e.proteinG ?? "—"}</span> g
                      {e.calories != null && (
                        <span className="text-muted-foreground">
                          {" "}
                          · {e.calories} kcal
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
