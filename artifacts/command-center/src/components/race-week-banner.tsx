import {
  useGetRaceWeek,
  useSetRaceWeekChecklistItem,
  getGetRaceWeekQueryKey,
  type RaceWeekStatus,
  type RaceWeekChecklistItem,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Trophy, Flag, ListChecks } from "lucide-react";
import { formatDistance } from "@/lib/format";
import { raceDayLabel } from "@/lib/race-day-label";

export function RaceWeekBanner() {
  const { data, isLoading } = useGetRaceWeek({
    query: {
      queryKey: getGetRaceWeekQueryKey(),
      refetchOnWindowFocus: true,
      refetchInterval: 60_000,
    },
  });

  if (isLoading) {
    return <Skeleton className="h-48 w-full" />;
  }
  if (!data || !data.inWindow) return null;

  if (data.racePassed) {
    return <PostRaceRecovery data={data} />;
  }
  if (data.isRaceDay) {
    return <RaceDayHero data={data} />;
  }
  return <RaceWeekCountdown data={data} />;
}

function RaceWeekCountdown({ data }: { data: RaceWeekStatus }) {
  const showHours = data.daysToRace <= 7;
  return (
    <Card
      className="border-primary/40 bg-gradient-to-br from-primary/15 via-primary/5 to-background overflow-hidden"
      data-testid="race-week-banner"
    >
      <CardContent className="p-6 space-y-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="rounded-md bg-primary/20 p-2">
              <Flag className="h-6 w-6 text-primary" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] font-bold text-primary">
                Race Week
              </p>
              <h2 className="text-xl md:text-2xl font-black uppercase tracking-wider">
                Final Approach
              </h2>
            </div>
          </div>
          <div className="flex items-baseline gap-3 md:gap-4 flex-wrap">
            <div className="flex items-baseline gap-1.5">
              <span
                className="text-4xl md:text-5xl font-black text-primary tabular-nums leading-none"
                data-testid="race-week-days"
              >
                {data.daysToRace}
              </span>
              <span className="text-xs uppercase tracking-wider font-bold text-muted-foreground">
                day{data.daysToRace === 1 ? "" : "s"}
              </span>
            </div>
            {showHours && (
              <div className="flex items-baseline gap-1.5" data-testid="race-week-hours">
                <span className="text-2xl md:text-3xl font-black tabular-nums leading-none">
                  {data.hoursToRace}
                </span>
                <span className="text-xs uppercase tracking-wider font-bold text-muted-foreground">
                  hr
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider font-bold text-muted-foreground">
              <ListChecks className="h-4 w-4" />
              Taper Checklist
            </div>
            {(() => {
              const done = data.checklist.filter((c) => c.checked).length;
              const total = data.checklist.length;
              const remaining = total - done;
              if (remaining === 0) return (
                <span className="text-[10px] uppercase tracking-wider font-bold text-emerald-600 dark:text-emerald-400">
                  All done
                </span>
              );
              if (data.daysToRace <= 2 && remaining > 0) return (
                <span className="text-[10px] uppercase tracking-wider font-bold text-amber-600 dark:text-amber-400" data-testid="checklist-nudge">
                  {remaining} item{remaining === 1 ? "" : "s"} left — race is close!
                </span>
              );
              return (
                <span className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">
                  {done}/{total} complete
                </span>
              );
            })()}
          </div>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {data.checklist.map((item) => (
              <ChecklistRow key={item.itemId} item={item} />
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

function PostRaceRecovery({ data }: { data: RaceWeekStatus }) {
  return (
    <Card
      className="border-emerald-500/40 bg-gradient-to-br from-emerald-500/15 via-emerald-500/5 to-background overflow-hidden"
      data-testid="post-race-banner"
    >
      <CardContent className="p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="rounded-md bg-emerald-500/20 p-2">
            <Trophy className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.2em] font-bold text-emerald-600 dark:text-emerald-400">
              Recovery Mode
            </p>
            <h2 className="text-xl md:text-2xl font-black uppercase tracking-wider">
              Race Complete — Day {data.daysAfterRace ?? 0} Recovery
            </h2>
          </div>
        </div>
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>Focus on gentle movement, hydration, and nutrition. Your body earned this rest.</p>
          {(data.daysAfterRace ?? 0) <= 3 && (
            <p className="text-emerald-600 dark:text-emerald-400 font-bold uppercase text-xs tracking-wider">
              Days 1-3: Walk only. Ice sore spots. Eat well. Sleep extra.
            </p>
          )}
          {(data.daysAfterRace ?? 0) > 3 && (data.daysAfterRace ?? 0) <= 7 && (
            <p className="text-emerald-600 dark:text-emerald-400 font-bold uppercase text-xs tracking-wider">
              Days 4-7: Light movement OK. No intensity. Listen to your body.
            </p>
          )}
          {(data.daysAfterRace ?? 0) > 7 && (
            <p className="text-emerald-600 dark:text-emerald-400 font-bold uppercase text-xs tracking-wider">
              Week 2+: Gradually return to easy efforts. No racing for 2-4 weeks.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function RaceDayHero({ data }: { data: RaceWeekStatus }) {
  const plan = data.racePlan;
  // Task #201: surface the per-kind label ("5K Day" / "10K Day" /
  // "Half Marathon Day" / "Marathon Day") in the eyebrow above the
  // race-day headline so the dashboard hero matches the actual
  // distance the runner is racing today, not a hardcoded "Race Day".
  // Falls back to the generic "Race Day" eyebrow only when the plan
  // row is missing or its distance doesn't match a real race kind.
  const race = plan ? raceDayLabel(plan.distanceMi, plan.description) : null;
  const eyebrow = race ? race.label : "Race Day";
  return (
    <Card
      className="border-primary bg-gradient-to-br from-primary/30 via-primary/10 to-background overflow-hidden"
      data-testid="race-day-hero"
    >
      <CardContent className="p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="rounded-md bg-primary/30 p-2">
            <Trophy className="h-6 w-6 text-primary" />
          </div>
          <div>
            <p
              className="text-xs uppercase tracking-[0.2em] font-bold text-primary"
              data-testid="race-day-hero-eyebrow"
              data-race-kind={race?.kind ?? "unknown"}
            >
              {eyebrow}
            </p>
            <h2 className="text-2xl md:text-3xl font-black uppercase tracking-wider">
              Today is the day. Execute.
            </h2>
          </div>
        </div>

        {plan ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <PlanStat label="Distance" value={formatDistance(plan.distanceMi)} />
            <PlanStat
              label="Target Pace"
              value={plan.targetPace ? `${plan.targetPace}/mi` : "Run by feel"}
            />
            <PlanStat
              label="Fueling"
              value={plan.fuelingNote ?? "Per plan"}
            />
          </div>
        ) : null}

        {plan?.description && (
          <p className="text-sm text-muted-foreground italic border-t border-border pt-4">
            {plan.description}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function PlanStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-background/60 rounded-md border border-border p-4">
      <p className="text-xs uppercase tracking-wider font-bold text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-lg font-black">{value}</p>
    </div>
  );
}

function ChecklistRow({ item }: { item: RaceWeekChecklistItem }) {
  const queryClient = useQueryClient();
  const queryKey = getGetRaceWeekQueryKey();
  const mutation = useSetRaceWeekChecklistItem({
    mutation: {
      onMutate: async ({ itemId, data }) => {
        await queryClient.cancelQueries({ queryKey });
        const prev = queryClient.getQueryData<RaceWeekStatus>(queryKey);
        if (prev) {
          queryClient.setQueryData<RaceWeekStatus>(queryKey, {
            ...prev,
            checklist: prev.checklist.map((c) =>
              c.itemId === itemId
                ? {
                    ...c,
                    checked: data.checked,
                    checkedAt: data.checked ? new Date().toISOString() : null,
                  }
                : c,
            ),
          });
        }
        return { prev };
      },
      onError: (_err, _vars, ctx) => {
        if (ctx?.prev) queryClient.setQueryData(queryKey, ctx.prev);
      },
      onSettled: () => {
        queryClient.invalidateQueries({ queryKey });
      },
    },
  });

  const toggle = () => {
    mutation.mutate({ itemId: item.itemId, data: { checked: !item.checked } });
  };

  return (
    <li>
      <label
        className="flex items-start gap-3 cursor-pointer rounded-md border border-border bg-background/60 hover:bg-background hover:border-primary/40 transition-colors px-3 py-2.5"
        data-testid={`race-week-checklist-${item.itemId}`}
      >
        <Checkbox
          checked={item.checked}
          onCheckedChange={toggle}
          className="mt-0.5"
          data-testid={`race-week-checklist-checkbox-${item.itemId}`}
        />
        <span
          className={
            "text-sm leading-tight " +
            (item.checked
              ? "line-through text-muted-foreground"
              : "text-foreground")
          }
        >
          {item.label}
        </span>
      </label>
    </li>
  );
}
