import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionHeader } from "@/components/studio/section-header";
import { ScorecardTile, TargetGauge } from "@/components/insights";
import type { NutritionistReport } from "@/components/insights/types";
import { nutritionistQueryKey } from "@/components/nutritionist-panel";

// Dashboard "should vs is" band — surfaces the top few significance-ranked
// nutrition insights as the same visual-first InsightCards used on the Nutrition
// page (engine numbers, AI captions), led by a protein-consistency gauge. Owns
// its own data and shares the panel's query cache (same key), so it never
// disagrees with the deep-dive.

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export function DashboardNutritionInsights({ weeks = 8 }: { weeks?: number }) {
  const { data, isLoading } = useQuery({
    queryKey: nutritionistQueryKey(weeks),
    queryFn: () => getJson<NutritionistReport>(`/api/nutritionist/analysis?weeks=${weeks}`),
    // Shares the cache + key with NutritionistPanel. The server only
    // regenerates on a real input change, so cache for 5 minutes and keep the
    // previous report on screen while any refetch runs in the background.
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
  });

  // Loader only on the very first load (nothing cached); otherwise render
  // immediately from cache and refresh in the background.
  if (isLoading && !data) {
    return (
      <Card data-testid="dashboard-nutrition-insights-loading">
        <CardContent className="p-6">
          <Skeleton className="h-40 w-full" />
        </CardContent>
      </Card>
    );
  }
  const insights = data?.insights ?? [];
  if (insights.length === 0) return null;

  const top = insights.slice(0, 3);
  const protein = insights.find((i) => i.id === "protein");

  return (
    <section className="space-y-4" data-testid="dashboard-nutrition-insights">
      <SectionHeader
        eyebrow="Nutrition — should vs is"
        action={
          <Link
            href="/nutrition"
            className="inline-flex items-center gap-1 text-xs font-semibold tracking-wide text-primary hover:underline"
            data-testid="link-dashboard-nutrition"
          >
            Full analysis <ArrowRight className="h-3 w-3" />
          </Link>
        }
      />

      {/* Lead with the headline + a protein-consistency gauge. */}
      <Card>
        <CardContent className="flex flex-col items-center gap-4 p-6 sm:flex-row sm:items-center">
          {protein && (protein.daysLogged ?? 0) > 0 && (
            <TargetGauge
              daysHit={protein.daysHit}
              daysLogged={protein.daysLogged}
              label="protein days"
              size={120}
            />
          )}
          <p className="min-w-0 text-sm leading-relaxed text-foreground">{data?.headline}</p>
        </CardContent>
      </Card>

      <div className="grid gap-3.5 md:grid-cols-2 lg:grid-cols-3">
        {top.map((ins) => (
          <ScorecardTile key={ins.id} insight={ins} />
        ))}
      </div>
    </section>
  );
}
