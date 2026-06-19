// "This week" recap — the coach's end-of-week verdict in persona, over the
// numbers it's based on, with prev/next week navigation (browsable history).

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, MessageSquare, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <p className="text-lg font-semibold tabular-nums mt-0.5">{value}</p>
    </div>
  );
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

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-[1000px] mx-auto">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-4xl font-extrabold tracking-tight text-foreground">
            {isCurrent ? "This week" : "Week recap"}
          </h2>
          <p className="text-muted-foreground font-medium tracking-widest mt-1">
            {format(parseISO(weekStart), "MMM d")} – {format(parseISO(weekEnd), "MMM d")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setWeekStart(addDays(weekStart, -7))}
            data-testid="recap-prev"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={isCurrent}
            onClick={() => setWeekStart(addDays(weekStart, 7))}
            data-testid="recap-next"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* The coach's verdict — the hero of this screen. */}
      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Writing your recap…
        </div>
      ) : isError ? (
        <p className="text-sm text-muted-foreground">Couldn't load this week's recap.</p>
      ) : (
        <>
          {summary ? (
            <div
              className="flex items-start gap-3 border-l-2 border-primary pl-4 py-1"
              data-testid="recap-summary"
            >
              <MessageSquare className="h-5 w-5 text-primary mt-1 shrink-0" />
              <p className="text-lg leading-relaxed text-foreground whitespace-pre-line">
                {summary}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No recap yet for this week — log some food and workouts and the coach
              will have something to say.
            </p>
          )}

          {/* The numbers behind the verdict. */}
          {review && (
            <section className="border-t border-border pt-5 grid grid-cols-2 sm:grid-cols-3 gap-x-8 gap-y-5">
              <Stat
                label="Sessions"
                value={`${review.workouts.done}/${review.workouts.planned} done`}
              />
              <Stat
                label="Lifting days"
                value={`${review.workouts.liftingDone}/${review.workouts.liftingPlanned}`}
              />
              <Stat
                label="Minutes"
                value={`${review.workouts.minutesDone}/${review.workouts.minutesPlanned}`}
              />
              <Stat
                label="Avg calories"
                value={
                  review.food.avgCalories != null
                    ? `${review.food.avgCalories}${review.food.target.calories ? ` / ${review.food.target.calories}` : ""}`
                    : "—"
                }
              />
              <Stat
                label="Avg protein"
                value={
                  review.food.avgProtein != null
                    ? `${review.food.avgProtein} g`
                    : "—"
                }
              />
              <Stat
                label="Days logged"
                value={`${review.food.daysLogged}/7`}
              />
              <Stat
                label="Weight"
                value={
                  review.weight.startLb != null && review.weight.endLb != null
                    ? `${review.weight.startLb} → ${review.weight.endLb} lb`
                    : "—"
                }
              />
              <Stat
                label="Change"
                value={
                  review.weight.actualChangeLb != null
                    ? `${review.weight.actualChangeLb > 0 ? "+" : ""}${review.weight.actualChangeLb} lb`
                    : "—"
                }
              />
              {review.weight.onTrack != null && (
                <div className="self-center">
                  <span
                    className={
                      "text-sm font-bold " +
                      (review.weight.onTrack
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-amber-600 dark:text-amber-400")
                    }
                  >
                    {review.weight.onTrack ? "On pace" : "Behind pace"}
                  </span>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
