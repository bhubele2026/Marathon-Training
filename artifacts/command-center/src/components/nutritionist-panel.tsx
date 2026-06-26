import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionHeader } from "@/components/studio/section-header";
import { StatReadout } from "@/components/studio/stat-readout";
import { CoachNote } from "@/components/studio/coach-note";
import {
  InsightCard,
  StatusPill,
  BulletMetric,
  TrendVsGoal,
  RecompTrajectory,
  statusTone,
} from "@/components/insights";
import type {
  NutritionistReport,
  NutritionInsight,
} from "@/components/insights/types";
import { Clock, Stethoscope, ArrowRight } from "lucide-react";

// The AI Nutritionist surface — visual-first. One component, two variants:
//   - variant="today": a compact daily verdict (headline + a hero protein
//     BulletMetric + the coach's one-liner) with a link into the full read.
//   - variant="full":  the deep-dive on the Nutrition page — one InsightCard per
//     structured insight (a target-vs-actual chart + a one-line caption, the
//     longer reasoning behind a "Why"), plus the key moves.
//
// Hand-fetched like the rest of the nutrition slice (not in openapi.yaml). The
// ENGINE owns every number the charts draw; the AI owns only caption/detail.

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export function nutritionistQueryKey(weeks: number): [string, number] {
  return ["/api/nutritionist/analysis", weeks];
}

// The right visual for an insight: body-comp gets the recomp trajectory + four
// stat tiles; every other read gets the bullet (+ a trend when there's a window).
function InsightVisual({ insight: ins }: { insight: NutritionInsight }) {
  if (ins.id === "bodycomp") {
    return (
      <div className="space-y-4">
        <RecompTrajectory
          trajectory={ins.bodyTrajectory}
          expectedBand={ins.expectedBand}
          tone={statusTone(ins.status)}
        />
        {ins.bodyStats && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4">
            {ins.bodyStats.map((s) => {
              const good =
                s.change == null || s.change === 0 || s.goodDirection === "either"
                  ? "neutral"
                  : (s.goodDirection === "down" ? s.change < 0 : s.change > 0)
                    ? "success"
                    : "neutral";
              return (
                <StatReadout
                  key={s.key}
                  label={s.label}
                  value={s.value != null ? s.value : "—"}
                  unit={s.value != null ? s.unit : undefined}
                  delta={
                    s.change != null && s.change !== 0
                      ? { value: `${s.change > 0 ? "+" : ""}${s.change}`, tone: good as "success" | "neutral" }
                      : undefined
                  }
                />
              );
            })}
          </div>
        )}
      </div>
    );
  }

  const hasWindow = (ins.series?.length ?? 0) >= 2;
  return (
    <div className="space-y-3">
      <BulletMetric insight={ins} />
      {hasWindow && (
        <TrendVsGoal
          series={ins.series}
          goal={ins.goal}
          unit={ins.unit}
          tone={statusTone(ins.status)}
        />
      )}
    </div>
  );
}

export function NutritionistPanel({
  variant = "full",
  weeks = 8,
}: {
  variant?: "today" | "full";
  weeks?: number;
}) {
  const { data, isLoading } = useQuery({
    queryKey: nutritionistQueryKey(weeks),
    queryFn: () => getJson<NutritionistReport>(`/api/nutritionist/analysis?weeks=${weeks}`),
    // Shortish so the read refreshes as the day's food logs in (the server
    // re-runs the analysis only when the inputs actually changed, so refetching
    // is cheap when nothing's new). Also refetch when the tab regains focus.
    staleTime: 45_000,
    refetchOnWindowFocus: true,
  });

  if (isLoading) {
    return (
      <Card data-testid={`card-nutritionist-${variant}-loading`}>
        <CardContent className="p-6">
          <Skeleton className={variant === "today" ? "h-14 w-full" : "h-48 w-full"} />
        </CardContent>
      </Card>
    );
  }
  if (!data) return null;

  const insights = data.insights ?? [];
  const protein = insights.find((i) => i.id === "protein");

  // --- Compact daily verdict (Today page) ---------------------------------
  if (variant === "today") {
    return (
      <Card
        variant="flush"
        className="border-l-2 border-l-primary bg-[hsl(var(--accent)/0.05)]"
        data-testid="card-nutritionist-today"
      >
        <CardContent className="p-5 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex min-w-0 items-center gap-2">
              <Stethoscope className="h-5 w-5 shrink-0 text-primary" />
              <span className="font-display text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Nutritionist
              </span>
              {protein && <StatusPill status={protein.status} />}
            </div>
            <Link
              href="/nutrition"
              className="inline-flex shrink-0 items-center gap-1 rounded-md text-xs font-semibold tracking-wide text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              data-testid="link-nutritionist-full"
            >
              Full analysis <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <p className="text-sm font-medium text-foreground">{data.headline}</p>
          {/* Hero protein read — the one bar that matters most day to day. */}
          {protein && <BulletMetric insight={protein} />}
          {data.today ? (
            <p className="min-w-0 text-sm leading-relaxed text-muted-foreground">{data.today}</p>
          ) : (
            data.narrative && (
              <p className="min-w-0 text-sm leading-relaxed text-muted-foreground">{data.narrative}</p>
            )
          )}
        </CardContent>
      </Card>
    );
  }

  // --- Full deep-dive (Nutrition page) ------------------------------------
  return (
    <div className="space-y-4" data-testid="card-nutritionist-full">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Stethoscope className="h-5 w-5 text-primary" />
          <span className="font-display text-base font-semibold tracking-tight text-foreground">
            AI Nutritionist
          </span>
        </div>
        <span className="font-display text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          last {data.weeksElapsed || data.weeks} wk · confidence {data.confidence}
        </span>
      </div>

      {/* Headline in the coach's voice. */}
      <CoachNote icon={Stethoscope}>{data.headline}</CoachNote>

      {/* TODAY (in progress) — pace coaching, shown only while the day is open. */}
      {data.today && (
        <CoachNote icon={Clock} tone="neutral">
          {data.today}
        </CoachNote>
      )}

      {/* INSIGHTS — one visual-first card per structured read. */}
      {insights.map((ins) => (
        <InsightCard key={ins.id} insight={ins}>
          <InsightVisual insight={ins} />
        </InsightCard>
      ))}

      {/* DO THIS NEXT */}
      {data.keyMoves.length > 0 && (
        <section className="rounded-2xl border border-border bg-card p-5 space-y-2" data-testid="section-nutritionist-moves">
          <SectionHeader eyebrow="Do this next" />
          <ul className="space-y-1.5">
            {data.keyMoves.map((m, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-foreground">
                <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-primary" />
                <span className="min-w-0 leading-relaxed">{m}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.dataGaps.length > 0 && (
        <p className="min-w-0 text-[13px] leading-relaxed text-muted-foreground/80">
          <span className="font-semibold">Sharpen this read: </span>
          {data.dataGaps.join(" · ")}
        </p>
      )}
    </div>
  );
}
