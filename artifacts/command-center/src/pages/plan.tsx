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

const RESET_PLAN_CONFIRM_PHRASE = "RESET PLAN";
const FULL_RESET_CONFIRM_PHRASE = "WIPE EVERYTHING";

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
  const [fullResetConfirmText, setFullResetConfirmText] = useState("");

  const closeResetPlanDialog = (open: boolean) => {
    if (resetPlan.isPending) return;
    setResetPlanOpen(open);
    if (!open) setResetPlanConfirmText("");
  };

  // Lock the dialog open while the reset is in flight so the user can't
  // half-cancel a destructive operation that's already running on the server.
  const closeFullResetDialog = (open: boolean) => {
    if (fullResetPlan.isPending) return;
    setFullResetOpen(open);
    if (!open) setFullResetConfirmText("");
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
        invalidateMissionRelatedQueries(queryClient);
        setFullResetOpen(false);
        setFullResetConfirmText("");
      },
      onError: () => {
        toast({
          title: "Full reset failed",
          description: "Nothing was changed. Try again or check the server logs.",
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

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-5xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-black uppercase tracking-tight text-primary">52-Week Half Marathon Campaign</h2>
          <p className="text-muted-foreground uppercase font-medium tracking-widest mt-1">
            {overview.weeksRemaining} Weeks to Race Day · 13.1 mi · {formatDate(overview.raceDate)}
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
                          <p className="font-mono font-medium">{formatDistance(week.plannedMiles)}</p>
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
                the canonical 52-week plan and the seeded baseline weight
                from scratch. This cannot be undone.
              </p>
            </div>
            <Button
              variant="destructive"
              size="sm"
              className="text-xs uppercase font-bold tracking-wider self-start md:self-auto shrink-0"
              onClick={() => setFullResetOpen(true)}
              data-testid="button-full-reset"
            >
              <Flame className="h-3 w-3 mr-1.5" /> Full Reset
            </Button>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={resetPlanOpen} onOpenChange={closeResetPlanDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset the entire 52-week plan?</AlertDialogTitle>
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

      <AlertDialog open={fullResetOpen} onOpenChange={closeFullResetDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Wipe everything and start over?</AlertDialogTitle>
            <AlertDialogDescription>
              This is a nuclear reset. It permanently deletes every logged
              workout, every body measurement, the race-week checklist, every
              plan customization, then reseeds the canonical 52-week plan
              from scratch and reinserts only the seeded baseline weight.
              There is no undo. Type{" "}
              <span className="font-mono font-bold">{FULL_RESET_CONFIRM_PHRASE}</span> below to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="full-reset-confirm" className="text-xs uppercase tracking-wider">
              Confirmation
            </Label>
            <Input
              id="full-reset-confirm"
              autoFocus
              value={fullResetConfirmText}
              onChange={(e) => setFullResetConfirmText(e.target.value)}
              placeholder={FULL_RESET_CONFIRM_PHRASE}
              disabled={fullResetPlan.isPending}
              data-testid="input-confirm-full-reset"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={fullResetPlan.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={
                fullResetPlan.isPending ||
                fullResetConfirmText.trim().toUpperCase() !== FULL_RESET_CONFIRM_PHRASE
              }
              onClick={(e) => {
                e.preventDefault();
                confirmFullReset();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-full-reset"
            >
              {fullResetPlan.isPending ? "Wiping..." : "Wipe Everything"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
