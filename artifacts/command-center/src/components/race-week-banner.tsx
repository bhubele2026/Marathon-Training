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
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider font-bold text-muted-foreground">
            <ListChecks className="h-4 w-4" />
            Taper Checklist
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

function RaceDayHero({ data }: { data: RaceWeekStatus }) {
  const plan = data.racePlan;
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
            <p className="text-xs uppercase tracking-[0.2em] font-bold text-primary">
              Race Day
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
