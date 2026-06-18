import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Beef, Flame, RefreshCw } from "lucide-react";

// Fallback protein target (g) used only until the AI-calculated target on the
// Goals page is set. Once /api/goals returns a proteinTargetG it wins.
const PROTEIN_GOAL_FALLBACK = 200;

// These routes are intentionally hand-fetched rather than going through the
// generated api-client: the nutrition slice isn't in openapi.yaml, so we hit
// the same-origin /api path the generated client resolves to anyway. Keeps
// the feature self-contained with no codegen step.
type NutritionDay = {
  date: string;
  calories: number | null;
  proteinG: number | null;
  updatedAt: string | null;
};
type RecentResponse = { days: number; entries: NutritionDay[] };
type GoalsTargets = { proteinTargetG: number | null; calorieTarget: number | null };

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

export default function Nutrition() {
  const todayQuery = useQuery({
    queryKey: ["/api/nutrition/today"],
    queryFn: () => getJson<NutritionDay>("/api/nutrition/today"),
  });
  const recentQuery = useQuery({
    queryKey: ["/api/nutrition/recent", 14],
    queryFn: () => getJson<RecentResponse>("/api/nutrition/recent?days=14"),
  });
  // AI-calculated targets from the Goals page drive the bars; fall back to the
  // constant until the runner computes them.
  const goalsQuery = useQuery({
    queryKey: ["/api/goals"],
    queryFn: () => getJson<GoalsTargets>("/api/goals"),
  });

  const proteinGoal = goalsQuery.data?.proteinTargetG ?? PROTEIN_GOAL_FALLBACK;
  const calorieTarget = goalsQuery.data?.calorieTarget ?? null;

  const today = todayQuery.data;
  const protein = today?.proteinG ?? null;
  const calories = today?.calories ?? null;
  const proteinPct =
    protein != null ? Math.min(100, (protein / proteinGoal) * 100) : 0;
  const proteinLeft =
    protein != null ? Math.max(0, proteinGoal - protein) : proteinGoal;

  const entries = recentQuery.data?.entries ?? [];
  const peakProtein = Math.max(
    proteinGoal,
    ...entries.map((e) => e.proteinG ?? 0),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-primary uppercase">
          Nutrition
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Calories and protein synced from your food tracker via Apple Health.
        </p>
      </div>

      {/* Today's headline tiles */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm uppercase tracking-wider text-muted-foreground">
              <Beef className="h-4 w-4 text-primary" />
              Protein Today
            </CardTitle>
          </CardHeader>
          <CardContent>
            {todayQuery.isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : (
              <>
                <div className="flex items-baseline gap-2">
                  <span className="text-5xl font-bold text-primary tabular-nums">
                    {protein ?? "—"}
                  </span>
                  <span className="text-lg text-muted-foreground">
                    / {proteinGoal} g
                  </span>
                </div>
                <Progress value={proteinPct} className="mt-3 h-2" />
                <p className="mt-2 text-xs text-muted-foreground">
                  {protein == null
                    ? "Waiting on today's sync"
                    : proteinLeft > 0
                      ? `${proteinLeft} g to go`
                      : "Goal hit"}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm uppercase tracking-wider text-muted-foreground">
              <Flame className="h-4 w-4 text-primary" />
              Calories Today
            </CardTitle>
          </CardHeader>
          <CardContent>
            {todayQuery.isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : (
              <>
                <div className="flex items-baseline gap-2">
                  <span className="text-5xl font-bold tabular-nums">
                    {calories ?? "—"}
                  </span>
                  <span className="text-lg text-muted-foreground">
                    {calorieTarget != null ? `/ ${calorieTarget}` : "kcal"}
                  </span>
                </div>
                <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <RefreshCw className="h-3 w-3" />
                  {formatUpdated(today?.updatedAt ?? null)}
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 14-day protein trend */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm uppercase tracking-wider text-muted-foreground">
            Last 14 Days · Protein
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
                const hitGoal = g >= proteinGoal;
                return (
                  <div key={e.date} className="flex items-center gap-3">
                    <span className="w-16 shrink-0 text-xs text-muted-foreground tabular-nums">
                      {formatDayLabel(e.date)}
                    </span>
                    <div className="h-5 flex-1 overflow-hidden rounded bg-muted">
                      <div
                        className={
                          hitGoal
                            ? "h-full bg-primary"
                            : "h-full bg-primary/50"
                        }
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-20 shrink-0 text-right text-xs tabular-nums">
                      {e.proteinG ?? "—"} g
                      {e.calories != null && (
                        <span className="text-muted-foreground">
                          {" "}
                          · {e.calories}
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
