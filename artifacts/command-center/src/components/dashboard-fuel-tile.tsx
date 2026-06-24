import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Flame } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { MetricRing } from "@/components/studio";
import { EmptyState } from "@/components/studio";

// Self-contained calorie + macro ring for the Dashboard hub. Owns its own
// `/api/nutrition/day/{today}` read (same query key + shape as <EatToday>, so
// the cache is shared) rather than threading nutrition through the dashboard
// bootstrap — which keeps dashboard.tsx free of useQuery and lets the page test
// stub this tile the way it stubs the other self-fetching tiles. The hero is
// calories in azure; protein/carbs/fat ride as concentric pastel arcs in the
// fixed metric palette (violet/teal/amber).
type Macros = { cal: number; protein: number; carbs: number; fat: number };
type DayTarget = {
  date: string;
  adjusted: Macros | null;
  actual: Macros | null;
  needsBaseline?: boolean;
};

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

function localTodayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function DashboardFuelTile({ className }: { className?: string }) {
  const date = localTodayStr();
  const { data, isLoading } = useQuery({
    queryKey: ["/api/nutrition/day", date],
    queryFn: () => getJson<DayTarget>(`/api/nutrition/day/${date}`),
  });

  return (
    <Card className={className} data-testid="dashboard-fuel-tile">
      <CardContent className="p-6">
        <div className="flex items-center justify-between mb-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            Today's fuel
          </p>
          <Link
            href="/nutrition"
            className="text-xs font-semibold text-primary hover:underline"
          >
            Nutrition →
          </Link>
        </div>

        {isLoading ? (
          <Skeleton className="h-40 w-full rounded-2xl" />
        ) : !data || data.needsBaseline || !data.adjusted ? (
          <EmptyState
            icon={Flame}
            title="No fuel targets yet"
            hint="Set your calorie + macro baseline on Goals to light up the ring."
          />
        ) : (
          <MetricRing
            hero
            label="Calories"
            unit="kcal"
            value={data.actual?.cal ?? 0}
            goal={data.adjusted.cal}
            macros={[
              {
                label: "Protein",
                value: data.actual?.protein ?? 0,
                goal: data.adjusted.protein,
                color: "hsl(var(--chart-2))",
              },
              {
                label: "Carbs",
                value: data.actual?.carbs ?? 0,
                goal: data.adjusted.carbs,
                color: "hsl(var(--chart-3))",
              },
              {
                label: "Fat",
                value: data.actual?.fat ?? 0,
                goal: data.adjusted.fat,
                color: "hsl(var(--chart-4))",
              },
            ]}
          />
        )}
      </CardContent>
    </Card>
  );
}
