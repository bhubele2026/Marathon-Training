import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import {
  useSwapPlanDay,
  useGetPlanWeek,
  useListPlanWeeks,
  getGetPlanWeekQueryKey,
  PlanDay,
} from "@workspace/api-client-react";
import { invalidateMissionRelatedQueries } from "@/lib/invalidate-mission-queries";
import { formatDate } from "@/lib/format";
import { ArrowLeftRight, ChevronLeft, ChevronRight, Sparkles, ShieldAlert } from "lucide-react";
import { UndoCountdownAction } from "@/components/undo-countdown-action";
import { useUndoPlanReset, useGetPlanOverview } from "@workspace/api-client-react";

interface MoveDayPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  day: PlanDay;
}

export function MoveDayPicker({ open, onOpenChange, day }: MoveDayPickerProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const swapPlanDay = useSwapPlanDay();
  const undoPlanReset = useUndoPlanReset();
  const { data: overview } = useGetPlanOverview();

  // Lets the runner navigate week by week from inside the picker. Defaults
  // back to the source day's own week each time the dialog opens so the
  // picker always starts in a familiar place.
  const [targetWeek, setTargetWeek] = useState<number>(day.week);
  useEffect(() => {
    if (open) setTargetWeek(day.week);
  }, [open, day.week, day.id]);

  const { data: weeks } = useListPlanWeeks();
  const { data: targetWeekDetail, isLoading: loadingWeek } = useGetPlanWeek(
    targetWeek,
    {
      query: {
        enabled: open,
        queryKey: getGetPlanWeekQueryKey(targetWeek),
      },
    },
  );

  const minWeek = weeks?.length ? weeks[0]!.week : day.week;
  const maxWeek = weeks?.length ? weeks[weeks.length - 1]!.week : day.week;
  const targetWeekMeta = weeks?.find((w) => w.week === targetWeek);
  const sameWeek = targetWeek === day.week;

  // Task #58: identify the race week (the week containing race day) so
  // the picker can block moves *into* race week or later. Foundation /
  // build sessions shouldn't displace anything in the taper-and-race
  // window. Computed from the weeks summary + overview.raceDate so it
  // works for any plan length, not just the 52-week marathon campaign.
  const raceDate = overview?.raceDate ?? null;
  const raceWeekNumber =
    raceDate && weeks
      ? (weeks.find((w) => w.startDate <= raceDate && raceDate <= w.endDate)
          ?.week ?? null)
      : null;
  const targetIsRaceOrLater =
    raceWeekNumber != null && targetWeek >= raceWeekNumber;

  // The runner shouldn't be offered themselves as a swap partner, but every
  // other day in the visible week (rest days included) is fair game.
  const candidates = (targetWeekDetail?.days ?? []).filter(
    (d) => d.id !== day.id,
  );

  const handleUndoSwap = (undoToken: string) => {
    undoPlanReset.mutate(
      { data: { undoToken } },
      {
        onSuccess: (data) => {
          toast({
            title: "Swap undone",
            description: `${data.daysRestored} day${data.daysRestored === 1 ? "" : "s"} restored.`,
          });
          invalidateMissionRelatedQueries(queryClient);
        },
        onError: () => {
          toast({ title: "Couldn't undo", description: "The undo window has expired.", variant: "destructive" });
        },
      },
    );
  };

  const handleSwap = (other: PlanDay) => {
    swapPlanDay.mutate(
      { id: day.id, data: { withDayId: other.id } },
      {
        onSuccess: (response) => {
          const description = response.phaseChanged
            ? `${day.day} (${day.phase}) traded places with ${other.day} (${other.phase}). Phase changed — review intensity.`
            : sameWeek
              ? `${day.day} (${day.sessionType}) traded places with ${other.day} (${other.sessionType}).`
              : `${day.day} (W${day.week}) traded places with ${other.day} (W${other.week}).`;
          const undoToken = response.undoToken;
          const undoSeconds = response.undoExpiresInSeconds ?? 30;
          toast({
            title: response.phaseChanged ? "Days swapped — phase changed" : "Days swapped",
            description,
            duration: undoToken ? undoSeconds * 1000 : undefined,
            action: undoToken ? (
              <UndoCountdownAction
                altText="Undo swap"
                expiresInSeconds={undoSeconds}
                onUndo={() => handleUndoSwap(undoToken)}
                testId="button-undo-swap"
              />
            ) : undefined,
          });
          invalidateMissionRelatedQueries(queryClient);
          onOpenChange(false);
        },
        onError: () => {
          toast({ title: "Failed to swap days", variant: "destructive" });
        },
      },
    );
  };

  const phaseChanging =
    targetWeekMeta != null && targetWeekMeta.phase !== day.phase;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Move {day.day}'s session</DialogTitle>
          <DialogDescription>
            Pick any day — same week or another week — to swap session content with. Calendar dates stay put; only the sessions trade places.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={targetWeek <= minWeek || swapPlanDay.isPending}
            onClick={() => setTargetWeek((w) => Math.max(minWeek, w - 1))}
            data-testid="button-move-prev-week"
            className="text-xs uppercase font-bold tracking-wider"
          >
            <ChevronLeft className="h-4 w-4 mr-1" /> Prev
          </Button>
          <div className="text-center min-w-0">
            <div className="text-xs font-black uppercase tracking-wider">
              Week {targetWeek}
              {sameWeek && (
                <span className="ml-2 text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded font-bold uppercase tracking-wider">
                  This Week
                </span>
              )}
            </div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground truncate">
              {targetWeekMeta?.phase ?? "—"}
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            disabled={targetWeek >= maxWeek || swapPlanDay.isPending}
            onClick={() => setTargetWeek((w) => Math.min(maxWeek, w + 1))}
            data-testid="button-move-next-week"
            className="text-xs uppercase font-bold tracking-wider"
          >
            Next <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>

        {phaseChanging && (
          <div
            className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary"
            data-testid="alert-phase-change"
          >
            <Sparkles className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              Heads up — this week is in <span className="font-bold uppercase tracking-wider">{targetWeekMeta?.phase}</span>, while {day.day} is in <span className="font-bold uppercase tracking-wider">{day.phase}</span>. Swapping here moves a session across a phase boundary.
            </span>
          </div>
        )}

        {targetIsRaceOrLater && raceDate && (
          <div
            className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
            data-testid="alert-past-race"
          >
            <ShieldAlert className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              Race week (W{raceWeekNumber}, race day {formatDate(raceDate)}) is locked. Moving a session into the taper-and-race window would derail race-day readiness — pick an earlier week instead.
            </span>
          </div>
        )}

        <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
          {loadingWeek && (
            <>
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </>
          )}
          {!loadingWeek && candidates.length === 0 && (
            <p className="text-sm text-muted-foreground">No other days available in this week.</p>
          )}
          {!loadingWeek && candidates.map((c) => (
            <button
              key={c.id}
              type="button"
              disabled={swapPlanDay.isPending || targetIsRaceOrLater}
              onClick={() => handleSwap(c)}
              title={
                targetIsRaceOrLater
                  ? "Race week is locked — pick an earlier week."
                  : undefined
              }
              aria-disabled={targetIsRaceOrLater || undefined}
              className="w-full flex items-center justify-between gap-3 rounded-md border border-border bg-card p-3 text-left transition-colors hover:border-primary/50 hover:bg-muted/50 disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid={`button-swap-with-${c.date}`}
            >
              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-bold uppercase tracking-wider text-xs">{c.day}</span>
                  <span className="text-xs text-muted-foreground">{formatDate(c.date)}</span>
                  {!sameWeek && (
                    <span className="text-[10px] bg-secondary text-secondary-foreground px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">
                      W{c.week}
                    </span>
                  )}
                </div>
                <div className="text-sm font-medium truncate">
                  {c.isRest ? "Rest / Recovery" : c.sessionType}
                </div>
                {!c.isRest && (
                  <div className="text-xs text-muted-foreground truncate">{c.equipment}</div>
                )}
              </div>
              <ArrowLeftRight className="h-4 w-4 text-muted-foreground shrink-0" />
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
