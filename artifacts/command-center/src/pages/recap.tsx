// "This week" recap — the coach's end-of-week verdict in persona, over the
// numbers it's based on, with prev/next week navigation (browsable history).

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  PageContainer,
  PageHeader,
  SectionHeader,
  StatReadout,
  EmptyState,
} from "@/components/studio";
import { format, parseISO } from "date-fns";

type WeekReview = {
  weekStart: string;
  weekEnd: string;
  food: {
    daysLogged: number;
    avgCalories: number | null;
    avgProtein: number | null;
    target: { calories: number | null; protein: number | null };
    proteinHitRate: number | null;
  };
  workouts: {
    planned: number;
    done: number;
    skipped: number;
    minutesPlanned: number;
    minutesDone: number;
    liftingPlanned: number;
    liftingDone: number;
  };
  weight: {
    startLb: number | null;
    endLb: number | null;
    actualChangeLb: number | null;
    goalChangeLb: number | null;
    onTrack: boolean | null;
  };
};

type SummaryResponse = { weekStart: string; review: WeekReview; summary: string | null };

// Monday of the week containing the given ISO date (UTC).
function mondayOf(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7; // 0 = Mon
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}
function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export default function Recap() {
  const todayMonday = mondayOf(new Date().toISOString().slice(0, 10));
  const [weekStart, setWeekStart] = useState(todayMonday);
  const isCurrent = weekStart === todayMonday;

  const { data, isLoading, isError } = useQuery({
    queryKey: ["/api/week-review/summary", weekStart],
    queryFn: async (): Promise<SummaryResponse> => {
      const r = await fetch(`/api/week-review/${weekStart}/summary`, {
        headers: { accept: "application/json" },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<SummaryResponse>;
    },
  });

  const review = data?.review;
  const summary = data?.summary;
  const weekEnd = review?.weekEnd ?? addDays(weekStart, 6);

  const nav = (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setWeekStart(addDays(weekStart, -7))}
        data-testid="recap-prev"
        aria-label="Previous week"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={isCurrent}
        onClick={() => setWeekStart(addDays(weekStart, 7))}
        data-testid="recap-next"
        aria-label="Next week"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );

  const dash = (v: string | number | null | undefined, unit?: string) =>
    v == null || v === "" ? "—" : `${v}${unit ?? ""}`;

  return (
    <PageContainer className="max-w-[1000px]" motif="dumbbell">
      <PageHeader
        title={isCurrent ? "This week" : "Week recap"}
        subtitle={`${format(parseISO(weekStart), "MMM d")} – ${format(parseISO(weekEnd), "MMM d")}`}
        action={nav}
      />

      {/* The coach's verdict — the hero of this screen. */}
      {isLoading ? (
        <div className="space-y-5">
          <Skeleton className="h-20 w-full rounded-lg" />
          <Card>
            <CardContent className="grid grid-cols-2 gap-x-8 gap-y-6 p-6 sm:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-14 rounded-md" />
              ))}
            </CardContent>
          </Card>
        </div>
      ) : isError ? (
        <EmptyState
          icon={MessageSquare}
          title="Couldn't load this week's recap"
          hint="Something hiccuped fetching the numbers — try again in a moment."
        />
      ) : (
        <>
          {summary ? (
            <div
              className="flex items-start gap-3 border-l-2 border-primary py-1 pl-4"
              data-testid="recap-summary"
            >
              <MessageSquare className="mt-1 h-5 w-5 shrink-0 text-primary" />
              <p className="whitespace-pre-line text-lg leading-relaxed text-foreground">
                {summary}
              </p>
            </div>
          ) : (
            <EmptyState
              icon={MessageSquare}
              title="No recap yet for this week"
              hint="Log some food and workouts and the coach will have plenty to say."
            />
          )}

          {/* The numbers behind the verdict. */}
          {review && (
            <Card>
              <CardContent className="space-y-5 p-6">
                <SectionHeader eyebrow="The numbers" />
                <div className="grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-4">
                  <StatReadout
                    label="Sessions"
                    value={`${review.workouts.done}/${review.workouts.planned}`}
                    unit="done"
                  />
                  <StatReadout
                    label="Lifting days"
                    value={`${review.workouts.liftingDone}/${review.workouts.liftingPlanned}`}
                    unit="days"
                  />
                  <StatReadout
                    label="Minutes"
                    value={review.workouts.minutesDone}
                    unit={`/ ${review.workouts.minutesPlanned} min`}
                  />
                  <StatReadout
                    label="Days logged"
                    value={`${review.food.daysLogged}/7`}
                    unit="logged"
                  />
                  <StatReadout
                    label="Avg calories"
                    value={dash(review.food.avgCalories)}
                    unit={
                      review.food.target.calories
                        ? `/ ${review.food.target.calories}`
                        : "kcal"
                    }
                  />
                  <StatReadout
                    label="Avg protein"
                    value={dash(review.food.avgProtein)}
                    unit="g"
                  />
                  <StatReadout
                    label="Weight"
                    value={dash(review.weight.endLb)}
                    unit="lb"
                    delta={
                      review.weight.actualChangeLb != null
                        ? {
                            value: `${review.weight.actualChangeLb > 0 ? "+" : ""}${review.weight.actualChangeLb} lb`,
                            tone:
                              review.weight.onTrack == null
                                ? "neutral"
                                : review.weight.onTrack
                                  ? "success"
                                  : "neutral",
                          }
                        : undefined
                    }
                  />
                </div>
                {review.weight.onTrack != null && (
                  <p
                    className={
                      "text-sm font-semibold " +
                      (review.weight.onTrack ? "text-success" : "text-warning")
                    }
                  >
                    {review.weight.onTrack ? "On pace" : "Behind pace"}
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </PageContainer>
  );
}
