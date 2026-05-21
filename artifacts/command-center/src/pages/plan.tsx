import { useEffect, useState } from "react";
import {
  getGetPlanOverviewQueryKey,
  getGetPlanWeekQueryKey,
  getListPlanWeeksQueryKey,
  useActivatePlannerConfig,
  useApplyPlannerConfig,
  useFullResetPlan,
  useGetPlanOverview,
  useGetPlanWeek,
  useListPlanWeeks,
  useResetPlan,
  useUndoPlanReset,
  useUpdateAppliedStartingPace,
} from "@workspace/api-client-react";
import { invalidateMissionRelatedQueries } from "@/lib/invalidate-mission-queries";
import { useQueryClient } from "@tanstack/react-query";
import { UndoCountdownAction } from "@/components/undo-countdown-action";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { FullResetDialog } from "@/components/full-reset-dialog";
import { EmptyPlanState } from "@/components/empty-plan-state";
import { useFirstRunRedirect } from "@/hooks/use-first-run-redirect";
import { useListPlannerConfigs } from "@workspace/api-client-react";
import { formatDistance, formatDate } from "@/lib/format";
import { format, parseISO } from "date-fns";
import { useLocation } from "wouter";
import {
  CalendarDays,
  Target,
  Activity,
  AlertTriangle,
  RotateCcw,
  Flame,
  Sparkles,
  ChevronRight,
  Wand2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { phaseColor } from "@/lib/phase-colors";
import { adherenceBarClass, adherenceStatus, adherenceTextClass } from "@/lib/adherence";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { customizedFieldLabel, formatDiffValue } from "@/lib/customized-diff";

// Lazy-loaded popover for the per-week "Edited" badge on the plan overview.
// Fetches the week's days only when the popover opens (so a campaign with
// dozens of weeks doesn't pay the cost up front), then groups field-level
// before/after diffs by day so the runner sees exactly what changed without
// having to drill into the week page. Stops click propagation so opening
// the popover doesn't also navigate into the week.
function WeekCustomizedBadge({
  week,
  customizedDays,
}: {
  week: number;
  customizedDays: number;
}) {
  const [open, setOpen] = useState(false);
  const { data: weekDetail, isLoading } = useGetPlanWeek(week, {
    query: {
      enabled: open,
      queryKey: getGetPlanWeekQueryKey(week),
    },
  });
  const editedDays = (weekDetail?.days ?? []).filter((d) => d.isCustomized);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className="flex items-center gap-1 text-[10px] bg-amber-500/15 text-amber-600 dark:text-amber-400 hover:bg-amber-500/25 transition-colors px-1.5 py-0.5 rounded font-bold uppercase tracking-wider cursor-pointer"
          data-testid={`badge-customized-week-${week}`}
          aria-label="Show what changed this week"
        >
          <Sparkles className="h-2.5 w-2.5" />
          {customizedDays} Edited
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 p-3 max-h-96 overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        data-testid={`popover-customized-week-${week}`}
      >
        <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
          Edited from original — Week {week}
        </div>
        {isLoading && !weekDetail ? (
          <div className="text-xs text-muted-foreground">Loading…</div>
        ) : editedDays.length === 0 ? (
          <div className="text-xs text-muted-foreground">No edited days.</div>
        ) : (
          <ul className="space-y-3">
            {editedDays.map((day) => (
              <li
                key={day.id}
                className="space-y-1.5"
                data-testid={`popover-customized-week-${week}-day-${day.date}`}
              >
                <div className="text-[11px] font-bold uppercase tracking-wider text-foreground">
                  {day.day} · {day.date}
                </div>
                {(day.customizedDiff ?? []).length === 0 ? (
                  <div className="text-xs text-muted-foreground pl-2">
                    No field-level diff available.
                  </div>
                ) : (
                  <ul className="space-y-1 pl-2 border-l-2 border-amber-500/30">
                    {(day.customizedDiff ?? []).map((entry) => (
                      <li
                        key={`${day.id}-${entry.field}`}
                        className="text-xs flex flex-col gap-0.5"
                        data-testid={`diff-row-week-${week}-${day.date}-${entry.field}`}
                      >
                        <span className="font-semibold text-foreground">
                          {customizedFieldLabel(entry.field)}
                        </span>
                        <span className="font-mono text-muted-foreground">
                          <span>{formatDiffValue(entry.field, entry.before)}</span>
                          <span className="mx-1.5">→</span>
                          <span className="text-amber-600 dark:text-amber-400">
                            {formatDiffValue(entry.field, entry.after)}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

const RESET_PLAN_CONFIRM_PHRASE = "RESET PLAN";

// Task #354. localStorage key for dismissing the coach-upgrade banner.
// The dismissal is keyed by the server's scienceVersion stamp so the
// banner re-arms automatically the next time the science is bumped —
// dismissing once doesn't silence future upgrades.
const COACH_UPGRADE_DISMISS_KEY = "plan.coachUpgradeDismissedVersion";

export default function Plan() {
  const { data: overview, isLoading: loadingOverview } = useGetPlanOverview();
  const { data: weeks, isLoading: loadingWeeks } = useListPlanWeeks();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const resetPlan = useResetPlan();
  const undoPlanReset = useUndoPlanReset();
  const fullResetPlan = useFullResetPlan();
  const activatePlannerConfig = useActivatePlannerConfig();
  const applyPlannerConfig = useApplyPlannerConfig();
  const [resetPlanOpen, setResetPlanOpen] = useState(false);
  const [resetPlanConfirmText, setResetPlanConfirmText] = useState("");
  const [fullResetOpen, setFullResetOpen] = useState(false);
  const [repaceOpen, setRepaceOpen] = useState(false);
  const [repaceInput, setRepaceInput] = useState("");
  const updateStartingPace = useUpdateAppliedStartingPace();

  // Task #370: /today's "Adjust Pace" button deep-links here with
  // ?repace=1 to auto-open the dialog (and then strip the param so a
  // back/refresh doesn't keep reopening it).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("repace") === "1" && overview?.hasPlan) {
      setRepaceInput(
        overview.startingPaceSec != null
          ? `${Math.floor(overview.startingPaceSec / 60)}:${String(
              overview.startingPaceSec % 60,
            ).padStart(2, "0")}`
          : "",
      );
      setRepaceOpen(true);
      params.delete("repace");
      const next = params.toString();
      window.history.replaceState(
        null,
        "",
        window.location.pathname + (next ? `?${next}` : ""),
      );
    }
  }, [overview?.hasPlan, overview?.startingPaceSec]);
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(
    () => {
      if (typeof window === "undefined") return null;
      try {
        return window.localStorage.getItem(COACH_UPGRADE_DISMISS_KEY);
      } catch {
        return null;
      }
    },
  );

  // Task #308: bounce the runner straight into the Phase Planner on
  // first visit when no plan has ever been applied AND no planner
  // drafts exist. Also re-arms after a Full Reset (which flips
  // overview.hasPlan back to false).
  const plannerConfigsQuery = useListPlannerConfigs();
  useFirstRunRedirect({
    hasPlan: overview?.hasPlan ?? false,
    hasDrafts: (plannerConfigsQuery.data?.configs?.length ?? 0) > 0,
    ready:
      overview !== undefined &&
      plannerConfigsQuery.data !== undefined &&
      !plannerConfigsQuery.isError,
  });

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
            description: `${data.daysRestored} day${data.daysRestored === 1 ? "" : "s"} across ${data.weeksAffected.length} week${data.weeksAffected.length === 1 ? "" : "s"} restored. Your plan and applied config are back.`,
          });
          // The undo restored every plan_weeks/plan_days row plus the
          // applied planner_configs snapshot, so hasPlan flips back to
          // true and every plan-driven view needs a fresh read.
          queryClient.invalidateQueries();
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
            description: "The plan is already empty.",
          });
        } else {
          const undoToken = data.undoToken;
          const undoSeconds = data.undoExpiresInSeconds ?? 30;
          toast({
            title: "Plan cleared",
            description: `${data.daysReset} day${data.daysReset === 1 ? "" : "s"} across ${data.weeksReset} week${data.weeksReset === 1 ? "" : "s"} cleared. Apply a Phase Planner config to build a new plan.${undoToken ? ` Undo available for ${undoSeconds}s.` : ""}`,
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
        // Invalidate everything: hasPlan flips, every plan-driven view
        // (/, /today, /plan, /plan/:n, /equipment) needs to re-fetch
        // and surface the EmptyPlanState CTA.
        queryClient.invalidateQueries();
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
          description: `${data.workoutsWiped} workout${data.workoutsWiped === 1 ? "" : "s"} and ${data.measurementsWiped} measurement${data.measurementsWiped === 1 ? "" : "s"} wiped. Plan tables are empty and every applied Phase Planner config has been demoted to draft — re-apply one from /planner to rebuild the plan.`,
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

  // Task #307: when no Phase Planner config has ever been applied the
  // server reports `hasPlan: false` and `weeks` is empty. Replace the
  // entire planner UI with the shared empty-state CTA, but keep the
  // Danger Zone Full Reset visible at the bottom so the runner can
  // still nuke residual state if needed. The Reset Entire Plan button
  // is hidden because there's nothing to reset.
  if (!overview.hasPlan || weeks.length === 0) {
    return (
      <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-5xl mx-auto">
        <div>
          <h2
            className="text-3xl font-black uppercase tracking-tight text-primary"
            data-testid="plan-header-title"
            data-race-kind=""
          >
            {overview.activeConfigName?.trim() || "Workout Plan"}
          </h2>
          <p
            className="text-muted-foreground uppercase font-medium tracking-widest mt-1"
            data-testid="plan-header-subtitle"
          >
            No plan applied yet
          </p>
        </div>
        <EmptyPlanState testId="plan-empty-plan" />
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
                  race-week checklist, every plan customization, and demotes
                  every applied Phase Planner config back to draft. The plan
                  stays empty until you re-apply a config from the Phase
                  Planner. This cannot be undone.
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
        <FullResetDialog
          open={fullResetOpen}
          onOpenChange={setFullResetOpen}
          onConfirm={confirmFullReset}
          isPending={fullResetPlan.isPending}
        />
      </div>
    );
  }

  const groupedWeeks = weeks.reduce((acc, week) => {
    if (!acc[week.phase]) acc[week.phase] = [];
    acc[week.phase].push(week);
    return acc;
  }, {} as Record<string, typeof weeks>);

  // Task #204: a "race" plan is any campaign whose trailing plan_day
  // Sunday is a recognised race row — surfaced server-side as
  // overview.raceKind ("marathon" | "half" | "10k" | "5k") so half /
  // 10K / 5K entries-mode plans get the same race-campaign framing
  // marathon plans do. The legacy phase-based fallback (presence of
  // the auto-pinned "Marathon-Specific" tail) keeps marathon plans
  // labelled correctly on a stale cached overview that pre-dates the
  // raceKind field. Tonal-first / non-race plans (lift_primary blocks,
  // ad-hoc Custom blocks, etc.) produce neither signal so headers and
  // copy fall back to the generic "workout plan" framing instead of
  // presupposing a race.
  const raceKind = overview.raceKind ?? null;
  const hasRace = raceKind !== null || weeks.some((w) => w.phase === "Marathon-Specific");
  // Task #244: the header title is now driven by the active planner
  // config's `name` (server-side `overview.activeConfigName`) so the
  // /plan header reads whatever the runner named their plan instead of
  // a hardcoded "Race Campaign" / "Workout Plan" pair. `raceKind` still
  // gates the subtitle ("Weeks to Race Day" vs "Weeks Remaining") so
  // race-anchored campaigns keep their countdown framing.
  const headerTitle = overview.activeConfigName?.trim() || "Workout Plan";
  const totalMissed = weeks.reduce((sum, w) => sum + (w.missedSessions ?? 0), 0);
  const totalCustomized = weeks.reduce((sum, w) => sum + (w.customizedDays ?? 0), 0);
  const nextMissedWeek = weeks.find((w) => (w.missedSessions ?? 0) > 0);
  // Task #33: server-resolved earliest missed plan_day. We prefer this
  // over deriving from `nextMissedWeek` so the deep link jumps straight
  // to the specific day card to back-fill, not just the week. We pass
  // the plan_day.id (not just the date) so concurrent overlapping
  // programs that share a calendar date highlight the EXACT missed
  // card rather than always defaulting to the primary one.
  const nextMissedDate = overview.nextMissedDate ?? null;
  const nextMissedDateWeek = overview.nextMissedWeek ?? null;
  const nextMissedPlanDayId = overview.nextMissedPlanDayId ?? null;

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-5xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2
            className="text-3xl font-black uppercase tracking-tight text-primary"
            data-testid="plan-header-title"
            data-race-kind={raceKind ?? ""}
          >
            {headerTitle}
          </h2>
          <p
            className="text-muted-foreground uppercase font-medium tracking-widest mt-1"
            data-testid="plan-header-subtitle"
          >
            {hasRace
              ? `${overview.weeksRemaining} Weeks to Race Day · ${formatDate(overview.raceDate)}`
              : `${overview.weeksRemaining} Weeks Remaining · Ends ${formatDate(overview.raceDate)}`}
          </p>
          <div className="flex flex-wrap items-center gap-3 mt-2">
            {/* Task #33: deep-link straight to the earliest un-logged
                non-rest plan_day so a runner who's fallen behind can
                back-fill without scrubbing week by week. Hidden when
                the server reports no missed sessions. */}
            {nextMissedDate && nextMissedDateWeek != null && (
              <button
                type="button"
                className="flex items-center gap-1.5 text-xs bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors px-3 py-1 rounded font-bold uppercase tracking-wider"
                onClick={() => {
                  const idParam =
                    nextMissedPlanDayId != null
                      ? `&missedId=${nextMissedPlanDayId}`
                      : "";
                  setLocation(
                    `/plan/${nextMissedDateWeek}?missed=${nextMissedDate}${idParam}`,
                  );
                }}
                title={`Jump to ${nextMissedDate} (W${nextMissedDateWeek})`}
                data-testid="button-next-missed"
                data-next-missed-date={nextMissedDate}
                data-next-missed-week={nextMissedDateWeek}
                data-next-missed-plan-day-id={nextMissedPlanDayId ?? ""}
              >
                <AlertTriangle className="h-3 w-3" />
                Next Missed
                <ChevronRight className="h-3 w-3 -mr-0.5" />
              </button>
            )}
            {totalMissed > 0 && (
              nextMissedWeek ? (
                <button
                  type="button"
                  className="flex items-center gap-1 text-xs bg-destructive/15 text-destructive hover:bg-destructive/25 transition-colors px-2 py-1 rounded font-bold uppercase tracking-wider"
                  onClick={() => {
                    const el = document.querySelector(
                      `[data-week-card="${nextMissedWeek.week}"]`,
                    );
                    if (el) {
                      el.scrollIntoView({ behavior: "smooth", block: "center" });
                    }
                  }}
                  title={`Scroll to first missed week (W${nextMissedWeek.week})`}
                  data-testid="badge-total-missed"
                >
                  <AlertTriangle className="h-3 w-3" />
                  {totalMissed} Missed Session{totalMissed === 1 ? "" : "s"}
                  <ChevronRight className="h-3 w-3 ml-0.5" />
                </button>
              ) : (
                <span
                  className="flex items-center gap-1 text-xs bg-destructive/15 text-destructive px-2 py-1 rounded font-bold uppercase tracking-wider"
                  data-testid="badge-total-missed"
                >
                  <AlertTriangle className="h-3 w-3" />
                  {totalMissed} Missed Session{totalMissed === 1 ? "" : "s"}
                </span>
              )
            )}
            {totalCustomized > 0 && (
              <span
                className="flex items-center gap-1 text-xs bg-amber-500/15 text-amber-600 dark:text-amber-400 px-2 py-1 rounded font-bold uppercase tracking-wider"
                data-testid="badge-total-customized"
              >
                <Sparkles className="h-3 w-3" />
                {totalCustomized} Edited
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 self-start md:self-auto">
        <Button
          variant="outline"
          size="sm"
          className="text-xs uppercase font-bold tracking-wider"
          onClick={() => {
            setRepaceInput(
              overview.startingPaceSec != null
                ? `${Math.floor(overview.startingPaceSec / 60)}:${String(
                    overview.startingPaceSec % 60,
                  ).padStart(2, "0")}`
                : "",
            );
            setRepaceOpen(true);
          }}
          disabled={!overview.hasPlan}
          data-testid="button-update-starting-pace"
        >
          Update Starting Pace
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="text-xs uppercase font-bold tracking-wider text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
          onClick={() => setResetPlanOpen(true)}
          data-testid="button-reset-plan"
        >
          <RotateCcw className="h-3 w-3 mr-1.5" /> Reset Entire Plan
        </Button>
        </div>
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

      {/* Task #135: parallel-tracks Programs panel. Renders one bar per
          concurrent program (TemplateEntry) with its date range so a
          runner stacking a Tonal lift program alongside a 5K running
          program can see at a glance how the two campaigns overlap. The
          bar's left/width are positioned proportionally across the
          overall campaign span so true overlap is visible. Hidden when
          there's only one program (the legacy single-program campaign)
          to avoid noise. */}
      {overview.programs && overview.programs.length > 1 && (() => {
        const startMs = Date.parse(`${overview.startDate}T00:00:00Z`);
        const endMs = Date.parse(`${overview.raceDate}T00:00:00Z`);
        const span = Math.max(1, endMs - startMs);
        return (
          <Card data-testid="card-programs">
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
                  Programs ({overview.programs.length})
                </h3>
                <span className="text-xs font-mono text-muted-foreground">
                  {overview.startDate} → {overview.raceDate}
                </span>
              </div>
              <div className="space-y-3">
                {overview.programs.map((p) => {
                  const pStart = Date.parse(`${p.startDate}T00:00:00Z`);
                  const pEnd = Date.parse(`${p.endDate}T00:00:00Z`);
                  const leftPct = Math.max(0, ((pStart - startMs) / span) * 100);
                  const widthPct = Math.max(
                    2,
                    ((pEnd - pStart) / span) * 100,
                  );
                  return (
                    <div
                      key={`program-${p.sourceEntryIndex}`}
                      className="space-y-1"
                      data-testid={`row-program-${p.sourceEntryIndex}`}
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold uppercase tracking-wider">
                          {p.label}
                        </span>
                        <span className="font-mono text-muted-foreground">
                          {p.startDate} → {p.endDate} · {p.weeks} wk
                        </span>
                      </div>
                      <div className="relative h-3 bg-muted rounded-sm overflow-hidden">
                        <div
                          className="absolute top-0 bottom-0 bg-primary/70 rounded-sm"
                          style={{
                            left: `${leftPct}%`,
                            width: `${widthPct}%`,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* Task #354. Coach-upgrade nudge. When the server reports the
          applied snapshot predates the current science version (and
          the runner hasn't dismissed THIS version) surface a banner
          with a one-click Re-Apply. The button activates the
          most-recently-applied config + re-runs the apply flow, then
          invalidates every mission query so the new numbers paint
          everywhere. */}
      {overview.coachUpgradeAvailable &&
        overview.scienceVersion !== dismissedVersion &&
        overview.lastAppliedConfigId != null && (() => {
          const reapplyPending =
            activatePlannerConfig.isPending || applyPlannerConfig.isPending;
          const handleReapply = () => {
            const configId = overview.lastAppliedConfigId;
            if (configId == null) return;
            activatePlannerConfig.mutate(
              { id: configId },
              {
                onSuccess: () => {
                  applyPlannerConfig.mutate(undefined, {
                    onSuccess: (resp) => {
                      toast({
                        title: "Plan refreshed with the latest coach upgrades",
                        description: `${resp.weeksSeeded} weeks · ${resp.daysSeeded} days · ${resp.workoutsPreserved} workouts kept`,
                      });
                      invalidateMissionRelatedQueries(queryClient);
                    },
                    onError: () => {
                      toast({
                        title: "Re-Apply failed",
                        description:
                          "Open the Phase Planner and apply your config from there.",
                        variant: "destructive",
                      });
                    },
                  });
                },
                onError: () => {
                  toast({
                    title: "Re-Apply failed",
                    description:
                      "Couldn't reactivate your config. Open the Phase Planner and apply from there.",
                    variant: "destructive",
                  });
                },
              },
            );
          };
          const handleDismiss = () => {
            setDismissedVersion(overview.scienceVersion);
            try {
              window.localStorage.setItem(
                COACH_UPGRADE_DISMISS_KEY,
                overview.scienceVersion,
              );
            } catch {
              /* localStorage unavailable — in-memory state still hides
                 the banner for the rest of the session. */
            }
          };
          return (
            <Card
              className="border-2 border-primary/40 bg-primary/5"
              data-testid="banner-coach-upgrade"
              data-science-version={overview.scienceVersion}
            >
              <CardContent className="p-5">
                <div className="flex flex-col md:flex-row md:items-center gap-4">
                  <div className="flex items-start gap-3 flex-1">
                    <Wand2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <p className="text-sm font-bold uppercase tracking-wider text-primary">
                        Coach upgrades available
                      </p>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        The training science has been updated since you
                        last applied this plan. Re-Apply to refresh this
                        week's targets — logged workouts and measurements
                        stay put.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 self-start md:self-auto">
                    <Button
                      size="sm"
                      className="text-xs uppercase font-bold tracking-wider"
                      onClick={handleReapply}
                      disabled={reapplyPending}
                      data-testid="button-coach-upgrade-reapply"
                    >
                      <Wand2 className="h-3 w-3 mr-1.5" />
                      {reapplyPending ? "Re-Applying…" : "Re-Apply"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs uppercase font-bold tracking-wider"
                      onClick={handleDismiss}
                      disabled={reapplyPending}
                      data-testid="button-coach-upgrade-dismiss"
                      aria-label="Dismiss coach upgrade banner"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })()}

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
                    data-week-card={week.week}
                    className={cn(
                      "cursor-pointer transition-all hover:shadow-md border-l-4 scroll-mt-24",
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
                            {/*
                              Task #175: amber Z3 "Steady" chip on weeks
                              whose Wednesday is a Steady Run + Accessory
                              session. Mirrors the same week→intensity
                              rule the generator uses (Marathon-Specific
                              recipe, non-cutback, non-race-week) and the
                              amber-400 swatch HR_ZONE_COLORS[3] uses for
                              the Run Target chip on Today / Week Detail
                              so Z3 reads the same everywhere. Sourced
                              from `wedSteady` on /plan/weeks (computed
                              from plan_days.session_type) so any user
                              swap that takes Wed off Steady drops the
                              chip immediately.
                            */}
                            {week.wedSteady && (
                              <span
                                className="flex items-center gap-1 bg-amber-400/15 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider"
                                data-testid={`badge-steady-week-${week.week}`}
                                title="Wednesday is a Steady (Z3) run this week"
                              >
                                <span
                                  className="h-1.5 w-1.5 rounded-full bg-amber-400"
                                  aria-hidden
                                />
                                Steady
                              </span>
                            )}
                            {(week.customizedDays ?? 0) > 0 && (
                              <WeekCustomizedBadge
                                week={week.week}
                                customizedDays={week.customizedDays!}
                              />
                            )}
                            {week.scheduledRaces?.map((sr) => {
                              const kindLabel =
                                sr.raceKind === "5k"
                                  ? "5K"
                                  : sr.raceKind === "10k"
                                    ? "10K"
                                    : sr.raceKind === "half"
                                      ? "HALF"
                                      : "MARATHON";
                              const dow = format(
                                parseISO(sr.raceDate),
                                "EEE",
                              );
                              return (
                                <span
                                  key={sr.raceDate}
                                  className="flex items-center gap-1 bg-primary/15 text-primary px-1.5 py-0.5 rounded font-bold uppercase tracking-wider"
                                  data-testid={`badge-scheduled-race-week-${week.week}-${sr.raceDate}`}
                                  data-race-kind={sr.raceKind}
                                  data-race-dow={dow}
                                  title={`${kindLabel} · ${sr.raceDate}${sr.name ? ` · ${sr.name}` : ""}`}
                                >
                                  {kindLabel} · {dow}
                                </span>
                              );
                            })}
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
                        <Progress
                          value={completedPct}
                          className="h-1.5 bg-muted"
                          indicatorClassName={adherenceBarClass(
                            adherenceStatus(week.completedSessions, week.totalSessions),
                          )}
                          data-adherence={adherenceStatus(week.completedSessions, week.totalSessions)}
                          data-testid={`progress-adherence-week-${week.week}`}
                        />
                        {week.programs && week.programs.length > 1 && (
                          <div
                            className="flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] uppercase tracking-wider text-muted-foreground"
                            data-testid={`week-program-breakdown-${week.week}`}
                          >
                            {week.programs.map((p, i) => (
                              <span
                                key={p.sourceEntryIndex}
                                className="font-bold"
                                data-testid={`week-program-${week.week}-${p.sourceEntryIndex}`}
                              >
                                {i > 0 && (
                                  <span className="text-muted-foreground/50 mr-2">·</span>
                                )}
                                <span className="text-foreground/80">{p.label}</span>{" "}
                                <span className="text-muted-foreground">
                                  {p.completedSessions}/{p.totalSessions}
                                </span>
                              </span>
                            ))}
                          </div>
                        )}
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
                race-week checklist, every plan customization, and demotes
                every applied Phase Planner config back to draft. The plan
                stays empty until you re-apply a config from the Phase
                Planner. This cannot be undone.
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
              This clears every plan week and day back to empty and demotes
              every applied Phase Planner config back to draft. The plan
              stays empty until you apply a config from the Phase Planner.
              Your logged workouts, body measurements, and race results
              are not touched. You can undo this for ~30 seconds from the
              success toast. To confirm, type{" "}
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

      <Dialog
        open={repaceOpen}
        onOpenChange={(open) => {
          if (updateStartingPace.isPending) return;
          setRepaceOpen(open);
        }}
      >
        <DialogContent data-testid="dialog-update-starting-pace">
          <DialogHeader>
            <DialogTitle>Update starting pace</DialogTitle>
            <DialogDescription>
              Re-paces every future easy/long run in your applied plan
              from this starting point. The new pace ramps from here as
              the campaign progresses. Your logged workouts, body
              measurements, race results, and any day cards you've
              edited on /plan are preserved. Leave the field blank to
              clear the override and fall back to the recipe default.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label
              htmlFor="repace-input"
              className="text-xs uppercase tracking-wider"
            >
              Starting easy pace (mm:ss per mile)
            </Label>
            <Input
              id="repace-input"
              autoFocus
              value={repaceInput}
              onChange={(e) => setRepaceInput(e.target.value)}
              placeholder="14:30"
              disabled={updateStartingPace.isPending}
              data-testid="input-starting-pace"
            />
            <p className="text-xs text-muted-foreground">
              Must be between 6:00 and 25:00 per mile.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRepaceOpen(false)}
              disabled={updateStartingPace.isPending}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={updateStartingPace.isPending}
              onClick={() => {
                const trimmed = repaceInput.trim();
                let startingPaceSec: number | null;
                if (trimmed === "") {
                  startingPaceSec = null;
                } else {
                  const m = trimmed.match(/^(\d{1,2}):(\d{2})$/);
                  if (!m) {
                    toast({
                      title: "Couldn't parse pace",
                      description:
                        "Use mm:ss format, e.g. 14:30. Leave blank to clear the override.",
                      variant: "destructive",
                    });
                    return;
                  }
                  const min = Number(m[1]);
                  const sec = Number(m[2]);
                  if (sec >= 60) {
                    toast({
                      title: "Couldn't parse pace",
                      description: "Seconds must be 0-59.",
                      variant: "destructive",
                    });
                    return;
                  }
                  startingPaceSec = min * 60 + sec;
                  if (startingPaceSec < 360 || startingPaceSec > 1500) {
                    toast({
                      title: "Pace out of range",
                      description:
                        "Starting pace must be between 6:00 and 25:00 per mile.",
                      variant: "destructive",
                    });
                    return;
                  }
                }
                updateStartingPace.mutate(
                  { data: { startingPaceSec } },
                  {
                    onSuccess: (data) => {
                      toast({
                        title: "Starting pace updated",
                        description:
                          data.runtimeUpdated > 0
                            ? `Re-paced ${data.runtimeUpdated} run card${
                                data.runtimeUpdated === 1 ? "" : "s"
                              }${
                                data.customizedSkipped > 0
                                  ? ` · ${data.customizedSkipped} customized day${data.customizedSkipped === 1 ? "" : "s"} preserved`
                                  : ""
                              }.`
                            : "No run cards needed updating.",
                      });
                      setRepaceOpen(false);
                      queryClient.invalidateQueries({
                        queryKey: getGetPlanOverviewQueryKey(),
                      });
                      queryClient.invalidateQueries({
                        queryKey: getListPlanWeeksQueryKey(),
                      });
                      invalidateMissionRelatedQueries(queryClient);
                    },
                    onError: () => {
                      toast({
                        title: "Couldn't update starting pace",
                        description:
                          "Apply a Phase Planner config first, then try again.",
                        variant: "destructive",
                      });
                    },
                  },
                );
              }}
              data-testid="button-confirm-update-starting-pace"
            >
              {updateStartingPace.isPending ? "Updating…" : "Update"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <FullResetDialog
        open={fullResetOpen}
        onOpenChange={setFullResetOpen}
        onConfirm={confirmFullReset}
        isPending={fullResetPlan.isPending}
      />
    </div>
  );
}
