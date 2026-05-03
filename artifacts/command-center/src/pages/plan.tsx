import { useState } from "react";
import {
  useFullResetPlan,
  useGetPlanOverview,
  useListPlanWeeks,
  useResetPlan,
  useUndoPlanReset,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { UndoCountdownAction } from "@/components/undo-countdown-action";
import { FullResetDialog } from "@/components/full-reset-dialog";
import { invalidateMissionRelatedQueries } from "@/lib/invalidate-mission-queries";
import { formatDistance, formatDate } from "@/lib/format";
import { useLocation } from "wouter";
import {
  CalendarDays,
  Target,
  Activity,
  AlertTriangle,
  RotateCcw,
  Flame,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { phaseColor } from "@/lib/phase-colors";
import { adherenceStatus, adherenceTextClass } from "@/lib/adherence";

const RESET_PLAN_CONFIRM_PHRASE = "RESET PLAN";

export default function Plan() {
  const { data: overview, isLoading: loadingOverview } = useGetPlanOverview();
  const { data: weeks, isLoading: loadingWeeks } = useListPlanWeeks();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const resetPlan = useResetPlan();
  const undoPlanReset = useUndoPlanReset();
  const fullResetPlan = useFullResetPlan();
  const [resetPlanOpen, setResetPlanOpen] = useState(false);
  const [resetPlanConfirmText, setResetPlanConfirmText] = useState("");
  const [fullResetOpen, setFullResetOpen] = useState(false);

  const closeResetPlanDialog = (open: boolean) => {
    if (resetPlan.isPending) return;
    setResetPlanOpen(open);
    if (!open) setResetPlanConfirmText("");
  };

  const handleUndoReset = (undoToken: string) => {
    undoPlanReset.mutate(
      { data: { undoToken } },
      {
        onSuccess: (data) => {
          toast({
            title: "Reset undone",
            description: `${data.daysRestored} day${data.daysRestored === 1 ? "" : "s"} of customizations restored.`,
          });
          invalidateMissionRelatedQueries(queryClient);
        },
        onError: () => {
          toast({
            title: "Couldn't undo",
            description: "The undo window has expired.",
            variant: "destructive",
          });
        },
      },
    );
  };

  const confirmResetPlan = () => {
    resetPlan.mutate(undefined, {
      onSuccess: (data) => {
        if (data.daysReset === 0) {
          toast({
            title: "Nothing to reset",
            description: "The plan hasn't been customized yet.",
          });
        } else {
          const undoToken = data.undoToken;
          const undoSeconds = data.undoExpiresInSeconds ?? 30;
          toast({
            title: "Plan reset",
            description: `${data.daysReset} day${data.daysReset === 1 ? "" : "s"} across ${data.weeksReset} week${data.weeksReset === 1 ? "" : "s"} restored to the original campaign. Undo available for ${undoSeconds}s.`,
            duration: undoToken ? undoSeconds * 1000 : undefined,
            action: undoToken ? (
              <UndoCountdownAction
                altText="Undo plan reset"
                expiresInSeconds={undoSeconds}
                onUndo={() => handleUndoReset(undoToken)}
                testId="button-undo-reset-plan"
              />
            ) : undefined,
          });
        }
        invalidateMissionRelatedQueries(queryClient);
        setResetPlanOpen(false);
        setResetPlanConfirmText("");
      },
      onError: () => {
        toast({ title: "Failed to reset plan", variant: "destructive" });
      },
    });
  };

  const confirmFullReset = () => {
    fullResetPlan.mutate(undefined, {
      onSuccess: (data) => {
        // Spell out exactly what got nuked so the runner knows the operation
        // succeeded end-to-end (and they can spot any unexpectedly-zero
        // counts if they thought there was data here).
        toast({
          title: "Campaign reset to day one",
          description: `${data.workoutsWiped} workout${data.workoutsWiped === 1 ? "" : "s"} and ${data.measurementsWiped} measurement${data.measurementsWiped === 1 ? "" : "s"} wiped. Reseeded ${data.weeksSeeded} weeks / ${data.daysSeeded} days from scratch.`,
        });
        // A full reset touches EVERY mutable table, so invalidate the
        // entire react-query cache instead of the curated mission-only
        // set. This guarantees /measurements, /equipment, /log, /plan/:n,
        // and any other view backed by an api hook re-fetches against
        // the freshly reseeded state — anything narrower risks showing
        // stale data after the wipe.
        queryClient.invalidateQueries();
        setFullResetOpen(false);
      },
      onError: (err: unknown) => {
        // Surface the server-provided message when present so the runner
        // knows what went wrong (e.g. lock contention or a generator
        // failure) instead of seeing a generic "try again" wall. The
        // transactional route guarantees nothing was committed on error.
        const detail =
          (err as { data?: { error?: { message?: unknown } } })?.data?.error?.message;
        const fallback = "Nothing was changed. Try again or check the server logs.";
        toast({
          title: "Full reset failed",
          description:
            typeof detail === "string" && detail.trim().length > 0
              ? `${detail} Nothing was changed.`
              : fallback,
          variant: "destructive",
        });
      },
    });
  };

  if (loadingOverview || loadingWeeks) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  if (!overview || !weeks) return <div>Failed to load plan</div>;

  const groupedWeeks = weeks.reduce((acc, week) => {
    if (!acc[week.phase]) acc[week.phase] = [];
    acc[week.phase].push(week);
    return acc;
  }, {} as Record<string, typeof weeks>);

  // Heuristic: a "race" plan is one whose phase ladder includes the
  // auto-pinned Marathon-Specific tail. Tonal-first / non-race plans
  // (lift_primary blocks, ad-hoc Custom blocks, etc.) never produce that
  // phase, so headers and copy fall back to a generic "workout plan"
  // framing instead of presupposing a race.
  const hasRace = weeks.some((w) => w.phase === "Marathon-Specific");

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-5xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-black uppercase tracking-tight text-primary">
            {hasRace ? "Race Campaign" : "Workout Plan"}
          </h2>
          <p className="text-muted-foreground uppercase font-medium tracking-widest mt-1">
            {hasRace
              ? `${overview.weeksRemaining} Weeks to Race Day · ${formatDate(overview.raceDate)}`
              : `${overview.weeksRemaining} Weeks Remaining · Ends ${formatDate(overview.raceDate)}`}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="text-xs uppercase font-bold tracking-wider text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive self-start md:self-auto"
          onClick={() => setResetPlanOpen(true)}
          data-testid="button-reset-plan"
        >
          <RotateCcw className="h-3 w-3 mr-1.5" /> Reset Entire Plan
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="p-6 flex items-center gap-4">
            <CalendarDays className="h-8 w-8 text-primary" />
            <div>
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Current Week</p>
              <div className="text-2xl font-black">Week {overview.currentWeek}</div>
            </div>
          </CardContent>
        </Card>
        <Card
          className="border-l-4"
          style={{ borderLeftColor: phaseColor(overview.currentPhase) }}
        >
          <CardContent className="p-6 flex items-center gap-4">
            <Activity
              className="h-8 w-8"
              style={{ color: phaseColor(overview.currentPhase) }}
            />
            <div>
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Phase</p>
              <div className="text-2xl font-black">{overview.currentPhase}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6 flex items-center gap-4">
            <Target className="h-8 w-8 text-muted-foreground" />
            <div>
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Target Miles</p>
              <div className="text-2xl font-black">{overview.weeklyMilesTarget ? formatDistance(overview.weeklyMilesTarget) : '-'}</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-12">
        {Object.entries(groupedWeeks).map(([phase, phaseWeeks]) => {
          const color = phaseColor(phase);
          return (
          <div key={phase} className="space-y-4">
            <h3
              className="text-xl font-bold uppercase tracking-wider border-b-2 pb-2 sticky top-0 bg-background/95 backdrop-blur z-10 flex items-center gap-3"
              style={{ borderBottomColor: color }}
              data-testid={`phase-header-${phase}`}
            >
              <span
                className="h-4 w-1.5 rounded-sm shrink-0"
                style={{ backgroundColor: color }}
                aria-hidden
              />
              {phase}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {phaseWeeks.map(week => {
                const isCurrent = week.week === overview.currentWeek;
                const completedPct = week.totalSessions 
                  ? ((week.completedSessions || 0) / week.totalSessions) * 100 
                  : 0;

                return (
                  <Card 
                    key={week.week} 
                    className={cn(
                      "cursor-pointer transition-all hover:shadow-md border-l-4",
                      isCurrent
                        ? "ring-2 ring-primary shadow-sm bg-primary/5"
                        : "hover:border-primary/30"
                    )}
                    style={{ borderLeftColor: color }}
                    onClick={() => setLocation(`/plan/${week.week}`)}
                  >
                    <CardContent className="p-5">
                      <div className="flex justify-between items-start mb-4">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-black text-lg">W{week.week}</span>
                            {isCurrent && <span className="text-[10px] bg-primary text-primary-foreground px-2 py-0.5 rounded font-bold uppercase tracking-wider">Active</span>}
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">{formatDate(week.startDate)} - {formatDate(week.endDate)}</p>
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-y-4 gap-x-2 text-sm mb-4">
                        <div>
                          <p className="text-[10px] uppercase font-bold text-muted-foreground">Volume</p>
                          {/*
                            Bike-only / Row-only weeks (task #107): when the
                            generator emits 0 planned miles but routes the
                            equivalent zone-controlled work into the cardio
                            bucket, leading with "0 mi" makes the card look
                            empty. Lead with "X min cardio" + the dominant
                            machine chip instead so a Peloton Bike or Row
                            block reads as the substantial session it is.
                            Run-based weeks (anything with planned miles)
                            keep the original mileage headline.
                          */}
                          {week.plannedMiles === 0 && (week.plannedCardio ?? 0) > 0 ? (
                            <div className="space-y-1" data-testid={`week-volume-cardio-${week.week}`}>
                              {/*
                                Task #109: mirror the run-week
                                "actualMiles / plannedMiles" framing on
                                bike/row weeks so the runner can see
                                plan-vs-actual cardio time at a glance.
                                actualCardio sums workouts.cardio_min for
                                the week (excluding Skipped sessions).
                                Task #112: tint the headline by adherence
                                so met = green, partial = amber, otherwise
                                neutral (so future weeks at 0 stay quiet).
                              */}
                              <p
                                className={cn(
                                  "font-mono font-medium",
                                  adherenceTextClass(
                                    adherenceStatus(week.actualCardio, week.plannedCardio),
                                  ),
                                )}
                                data-testid={`week-volume-cardio-actual-${week.week}`}
                                data-adherence={adherenceStatus(week.actualCardio, week.plannedCardio)}
                              >
                                {Math.round(week.actualCardio ?? 0)} / {Math.round(week.plannedCardio ?? 0)} min cardio
                              </p>
                              {week.dominantCardioEquipment && (
                                <span
                                  className="inline-block text-[10px] bg-secondary text-secondary-foreground px-2 py-0.5 rounded font-bold uppercase tracking-wider"
                                  data-testid={`week-volume-cardio-chip-${week.week}`}
                                >
                                  {week.dominantCardioEquipment}
                                </span>
                              )}
                            </div>
                          ) : (
                            <div className="space-y-1">
                              <p
                                className={cn(
                                  "font-mono font-medium",
                                  adherenceTextClass(
                                    adherenceStatus(week.actualMiles, week.plannedMiles),
                                  ),
                                )}
                                data-testid={`week-volume-miles-${week.week}`}
                                data-adherence={adherenceStatus(week.actualMiles, week.plannedMiles)}
                              >
                                {formatDistance(week.actualMiles)} / {formatDistance(week.plannedMiles)}
                              </p>
                              {/*
                                Task #115: mirror the bike/row dominant-machine
                                chip on run-week cards so both card variants
                                share the same headline + chip rhythm. Lead
                                with the long run distance when present (the
                                signature run of the week), and fall back to
                                a session count so the chip is never blank
                                on edge-case weeks where longRunMi = 0.
                              */}
                              <span
                                className="inline-block text-[10px] bg-secondary text-secondary-foreground px-2 py-0.5 rounded font-bold uppercase tracking-wider"
                                data-testid={`week-volume-miles-chip-${week.week}`}
                              >
                                {(week.longRunMi ?? 0) > 0
                                  ? `Long Run ${formatDistance(week.longRunMi)}`
                                  : `${week.totalSessions || 0} Session${(week.totalSessions || 0) === 1 ? "" : "s"}`}
                              </span>
                            </div>
                          )}
                        </div>
                        <div>
                          <p className="text-[10px] uppercase font-bold text-muted-foreground">Long Run</p>
                          <p className="font-mono font-medium">{formatDistance(week.longRunMi)}</p>
                        </div>
                      </div>

                      <div className="space-y-1.5 mt-4 pt-4 border-t border-border">
                        <div className="flex justify-between items-center text-[10px] uppercase font-bold text-muted-foreground">
                          <span>Adherence</span>
                          <div className="flex items-center gap-2">
                            {(week.missedSessions ?? 0) > 0 && (
                              <span
                                className="flex items-center gap-1 bg-destructive/15 text-destructive px-1.5 py-0.5 rounded font-bold uppercase tracking-wider"
                                data-testid={`badge-missed-week-${week.week}`}
                              >
                                <AlertTriangle className="h-2.5 w-2.5" />
                                {week.missedSessions} Missed
                              </span>
                            )}
                            <span>{week.completedSessions || 0}/{week.totalSessions || 0}</span>
                          </div>
                        </div>
                        <Progress value={completedPct} className="h-1.5 bg-muted" />
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
          );
        })}
      </div>

      <Card
        className="border-2 border-destructive/40 bg-destructive/5"
        data-testid="card-danger-zone"
      >
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <Flame className="h-5 w-5 text-destructive" />
            <h3 className="text-sm font-black uppercase tracking-widest text-destructive">
              Danger Zone
            </h3>
          </div>
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="space-y-1 max-w-2xl">
              <p className="text-sm font-bold">Full reset — start over from day one</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Wipes every logged workout, every body measurement, the
                race-week checklist, every plan customization, then reseeds
                the canonical plan and the seeded baseline weight from
                scratch. This cannot be undone.
              </p>
            </div>
            <Button
              variant="destructive"
              size="sm"
              className="text-xs uppercase font-bold tracking-wider self-start md:self-auto shrink-0"
              onClick={() => setFullResetOpen(true)}
              data-testid="button-full-reset"
            >
              <Flame className="h-3 w-3 mr-1.5" /> Full Reset to Day One
            </Button>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={resetPlanOpen} onOpenChange={closeResetPlanDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset the entire plan?</AlertDialogTitle>
            <AlertDialogDescription>
              This wipes every edit and swap you've ever made across all weeks
              and restores the original campaign prescription. Logged workouts
              are not affected, but any customized session, distance, or
              equipment choice will be lost. To confirm, type{" "}
              <span className="font-mono font-bold">{RESET_PLAN_CONFIRM_PHRASE}</span> below.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="reset-plan-confirm" className="text-xs uppercase tracking-wider">
              Confirmation
            </Label>
            <Input
              id="reset-plan-confirm"
              autoFocus
              value={resetPlanConfirmText}
              onChange={(e) => setResetPlanConfirmText(e.target.value)}
              placeholder={RESET_PLAN_CONFIRM_PHRASE}
              disabled={resetPlan.isPending}
              data-testid="input-confirm-reset-plan"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resetPlan.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={
                resetPlan.isPending ||
                resetPlanConfirmText.trim().toUpperCase() !== RESET_PLAN_CONFIRM_PHRASE
              }
              onClick={(e) => {
                e.preventDefault();
                confirmResetPlan();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-reset-plan"
            >
              {resetPlan.isPending ? "Resetting..." : "Reset Entire Plan"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <FullResetDialog
        open={fullResetOpen}
        onOpenChange={setFullResetOpen}
        onConfirm={confirmFullReset}
        isPending={fullResetPlan.isPending}
      />
    </div>
  );
}
