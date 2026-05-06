import { useEffect, useState } from "react";
import {
  useGetPlanWeek,
  getGetPlanWeekQueryKey,
  useListWorkouts,
  getListWorkoutsQueryKey,
  useResetPlanDay,
  useResetPlanWeek,
  useUndoPlanReset,
  Workout,
  PlanDay,
  PlanDayWithSuggestions,
} from "@workspace/api-client-react";
import { useParams, useLocation, useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
import { invalidateMissionRelatedQueries } from "@/lib/invalidate-mission-queries";
import { formatDistance, formatLoad, formatDate } from "@/lib/format";
import {
  ChevronLeft,
  ChevronRight,
  Activity,
  Play,
  Edit,
  Trash2,
  CheckCircle2,
  Zap,
  XCircle,
  Pencil,
  AlertTriangle,
  Settings2,
  ArrowLeftRight,
  Undo2,
  Sparkles,
  Trophy,
} from "lucide-react";
import { useMissionActions } from "@/hooks/use-mission-actions";
import { cn } from "@/lib/utils";
import { phaseColor } from "@/lib/phase-colors";
import { adherenceStatus, adherenceTextClass } from "@/lib/adherence";
import { raceDayLabel } from "@/lib/race-day-label";
import type { RaceDayKind } from "@/lib/race-day-label";
import { PlanDayForm } from "@/components/plan-day-form";
import { MoveDayPicker } from "@/components/move-day-picker";
import { sortWorkoutsByTimeOfDay } from "@/lib/time-of-day";
import { TimeOfDayBadge } from "@/components/time-of-day-badge";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { UndoCountdownAction } from "@/components/undo-countdown-action";
import { PlannedBreakdown } from "@/components/planned-breakdown";
import { ActualBreakdown } from "@/components/actual-breakdown";
import { PrimaryMetricDisplay } from "@/components/primary-metric-display";
import { SessionDetailDisclosure } from "@/components/session-detail-disclosure";
import {
  getPrimaryMetric,
  getPrimaryMetricCompare,
} from "@/lib/primary-metric";
import { RunTargetLine } from "@/components/run-target-line";
import { customizedFieldLabel, formatDiffValue } from "@/lib/customized-diff";
import { EmptyPlanState } from "@/components/empty-plan-state";
import { useFirstRunRedirect } from "@/hooks/use-first-run-redirect";
import {
  useGetPlanOverview,
  useListPlannerConfigs,
} from "@workspace/api-client-react";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function CustomizedBadge({ day }: { day: PlanDay }) {
  if (!day.isCustomized) return null;
  const diff = day.customizedDiff ?? [];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="text-[10px] bg-amber-500/15 text-amber-600 dark:text-amber-400 px-2 py-1 rounded font-bold uppercase tracking-wider flex items-center gap-1 cursor-pointer hover:bg-amber-500/25 transition-colors"
          data-testid={`badge-customized-${day.date}`}
          aria-label="Show what changed"
        >
          <Sparkles className="h-3 w-3" />
          Edited
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-72 p-3"
        data-testid={`popover-customized-${day.date}`}
      >
        <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
          Edited from original
        </div>
        {diff.length === 0 ? (
          <div className="text-xs text-muted-foreground">No field-level diff available.</div>
        ) : (
          <ul className="space-y-1.5">
            {diff.map((entry) => {
              const label = customizedFieldLabel(entry.field);
              return (
                <li
                  key={entry.field}
                  className="text-xs flex flex-col gap-0.5"
                  data-testid={`diff-row-${entry.field}`}
                >
                  <span className="font-semibold text-foreground">{label}</span>
                  <span className="font-mono text-muted-foreground">
                    <span data-testid={`diff-before-${entry.field}`}>
                      {formatDiffValue(entry.field, entry.before)}
                    </span>
                    <span className="mx-1.5">→</span>
                    <span
                      className="text-amber-600 dark:text-amber-400"
                      data-testid={`diff-after-${entry.field}`}
                    >
                      {formatDiffValue(entry.field, entry.after)}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

export default function WeekDetail() {
  const params = useParams();
  const weekNum = parseInt(params.week || "1", 10);
  const [, setLocation] = useLocation();
  // Task #33: when arriving from the /plan "Next Missed" deep link,
  // pull the target plan_day.id (preferred — survives concurrent
  // overlapping programs sharing a date) and the date fallback out of
  // the query string so we can scroll the matching card into view and
  // pulse a destructive ring around it.
  const search = useSearch();
  const params2 = new URLSearchParams(search);
  const missedDate = params2.get("missed");
  const missedIdRaw = params2.get("missedId");
  const missedId = missedIdRaw != null ? Number(missedIdRaw) : null;
  const missedIdValid = missedId != null && Number.isFinite(missedId) ? missedId : null;
  const [highlightedPlanDayId, setHighlightedPlanDayId] = useState<number | null>(missedIdValid);
  const [highlightedDate, setHighlightedDate] = useState<string | null>(
    missedIdValid != null ? null : missedDate,
  );
  const { openLog, openEdit, requestDelete, requestSkip, crushIt, isDeleting, isCrushing, dialogs } =
    useMissionActions();

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const resetPlanDay = useResetPlanDay();
  const resetPlanWeek = useResetPlanWeek();
  const undoPlanReset = useUndoPlanReset();
  const [editPlanDay, setEditPlanDay] = useState<PlanDay | null>(null);
  const [movePlanDay, setMovePlanDay] = useState<PlanDay | null>(null);
  const [resetPlanDayCtx, setResetPlanDayCtx] = useState<PlanDay | null>(null);
  const [resetWeekOpen, setResetWeekOpen] = useState(false);

  const { data: week, isLoading } = useGetPlanWeek(weekNum, {
    query: {
      enabled: !!weekNum && !isNaN(weekNum),
      queryKey: getGetPlanWeekQueryKey(weekNum),
    }
  });

  // Task #308: use the campaign-level overview as the authoritative
  // hasPlan signal so a transient 5xx on the per-week endpoint can't
  // be mis-read as "no plan exists" and yank the runner away from a
  // legitimately broken page.
  const overviewQuery = useGetPlanOverview();
  const plannerConfigsQuery = useListPlannerConfigs();
  useFirstRunRedirect({
    hasPlan: overviewQuery.data?.hasPlan ?? false,
    hasDrafts: (plannerConfigsQuery.data?.configs?.length ?? 0) > 0,
    ready:
      overviewQuery.data !== undefined &&
      !overviewQuery.isError &&
      plannerConfigsQuery.data !== undefined &&
      !plannerConfigsQuery.isError,
  });

  const workoutsParams = week ? { from: week.startDate, to: week.endDate } : {};
  const { data: workouts } = useListWorkouts(workoutsParams, {
    query: {
      enabled: !!week,
      queryKey: getListWorkoutsQueryKey(workoutsParams),
    },
  });

  // Task #33: trigger the scroll-into-view + ring pulse only AFTER the
  // week's days have actually mounted, otherwise scrollIntoView on a
  // freshly navigated route would no-op against an empty page. Effect
  // is keyed on the deep-link target + the loaded week so a slow
  // network or a route change between weeks both work.
  useEffect(() => {
    if (missedIdValid == null && !missedDate) return;
    if (!week) return;
    setHighlightedPlanDayId(missedIdValid);
    setHighlightedDate(missedIdValid != null ? null : missedDate);
    const raf = window.requestAnimationFrame(() => {
      // Use attribute-based lookup with safe values: missedIdValid is
      // a finite number, and the date-fallback path validates the
      // string against an ISO yyyy-mm-dd shape so a malformed
      // hand-typed URL can't sneak a CSS-selector fragment through to
      // querySelector.
      let el: Element | null = null;
      if (missedIdValid != null) {
        el = document.querySelector(`[data-plan-day-anchor="${missedIdValid}"]`);
      } else if (missedDate && /^\d{4}-\d{2}-\d{2}$/.test(missedDate)) {
        el = document.querySelector(`[data-day-anchor="${missedDate}"]`);
      }
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    const fade = window.setTimeout(() => {
      setHighlightedPlanDayId(null);
      setHighlightedDate(null);
    }, 4000);
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(fade);
    };
  }, [missedIdValid, missedDate, week]);

  if (isLoading) {
    return <div className="space-y-6 max-w-4xl mx-auto"><Skeleton className="h-32 w-full" /><Skeleton className="h-96 w-full" /></div>;
  }

  // Task #307: when no plan has been applied the week endpoint 404s.
  // Render the shared empty-state CTA so the runner gets a useful next
  // step instead of a dead "Week not found" string.
  if (!week) {
    return (
      <div className="space-y-6 max-w-4xl mx-auto">
        <EmptyPlanState
          title="Week not found"
          description="This week is not part of any applied plan. Open the Phase Planner to build a plan and populate your weekly schedule."
          testId="week-empty-plan"
        />
      </div>
    );
  }

  // Task #242: per-kind campaign framing for the week-detail eyebrow
  // mirrors the dashboard header (Task #209) and the /plan overview
  // (Task #204). `week.raceKind` echoes /plan/overview's same trailing-
  // Sunday detection so half / 10K / 5K plans get the per-kind label
  // ("5K Campaign", "10K Campaign", "Half Marathon Campaign") instead
  // of the generic "Marathon" framing the page used to fall back to,
  // and tonal-first / non-race plans render no eyebrow at all instead
  // of presupposing a race day.
  //
  // Race-week and post-race weeks override that "<Kind> Campaign"
  // baseline with the same per-kind copy the dashboard banner uses
  // ("5K · Race Week" / "5K Complete"), so a runner navigating
  // dashboard → plan → week-detail sees consistent framing on the
  // race week itself. Marathon collapses to the existing flagship
  // "Race Week" / "Race Complete" / "Race Campaign" copy unchanged.
  // Detection is local to the rendered week's days so we don't need a
  // separate /race-week round-trip:
  //   - isRaceWeek: any non-rest day in the week is a recognised race
  //     row (delegates to the shared `raceDayLabel` helper that the
  //     per-day badge already uses).
  //   - isPostRace: that race day is strictly in the past.
  const todayDate = todayISO();
  const raceKind: RaceDayKind | null = (week.raceKind ?? null) as RaceDayKind | null;
  const raceDayInWeek = week.days.find(
    (d) => raceDayLabel(d.distanceMi, d.description, d.sessionType) != null,
  );
  const isRaceWeek = raceDayInWeek != null;
  const isPostRace = isRaceWeek && raceDayInWeek!.date < todayDate;
  const RACE_KIND_LABELS: Record<RaceDayKind, string> = {
    marathon: "Marathon",
    half: "Half Marathon",
    "10k": "10K",
    "5k": "5K",
  };
  let weekEyebrow: string | null = null;
  if (raceKind != null) {
    const label = RACE_KIND_LABELS[raceKind];
    if (isPostRace) {
      weekEyebrow =
        raceKind === "marathon" ? "Race Complete" : `${label} Complete`;
    } else if (isRaceWeek) {
      weekEyebrow =
        raceKind === "marathon" ? "Race Week" : `${label} · Race Week`;
    } else {
      weekEyebrow =
        raceKind === "marathon" ? "Race Campaign" : `${label} Campaign`;
    }
  }

  // Task #143: group logged workouts by the plan_day they were logged
  // against so concurrent programs each get their own attributed
  // sessions, completion badge and missed-day status. Workouts that
  // pre-date plan_day attribution (planDayId == null) fall back to the
  // primary (lowest-index) card on that date so legacy single-program
  // history still shows up where the runner expects it. Within each
  // bucket sessions are ordered by time-of-day tag (AM, PM, Other,
  // then untagged) and then createdAt ascending so an AM strength
  // session logged in the evening still surfaces above an earlier PM
  // run.
  const workoutsByPlanDayId = new Map<number, Workout[]>();
  const unattributedByDate = new Map<string, Workout[]>();
  for (const w of workouts ?? []) {
    if (w.planDayId != null) {
      const list = workoutsByPlanDayId.get(w.planDayId);
      if (list) list.push(w);
      else workoutsByPlanDayId.set(w.planDayId, [w]);
    } else {
      const list = unattributedByDate.get(w.date);
      if (list) list.push(w);
      else unattributedByDate.set(w.date, [w]);
    }
  }
  for (const list of workoutsByPlanDayId.values()) sortWorkoutsByTimeOfDay(list);
  for (const list of unattributedByDate.values()) sortWorkoutsByTimeOfDay(list);

  // Task #135: with concurrent overlapping programs, the same calendar
  // date may have multiple plan_days (one per TemplateEntry). Track
  // which is the primary (lowest-index) card per date so it can absorb
  // any unattributed legacy workouts. Server orders rows by
  // (date, sourceEntryIndex) so the first row in iteration order is
  // always the lowest-index program.
  const planDayCountByDate = new Map<string, number>();
  for (const d of week.days) {
    planDayCountByDate.set(d.date, (planDayCountByDate.get(d.date) ?? 0) + 1);
  }
  const renderedPrimaryDates = new Set<string>();
  const isPrimaryAtDate = (day: PlanDayWithSuggestions) => {
    if (renderedPrimaryDates.has(day.date)) return false;
    renderedPrimaryDates.add(day.date);
    return true;
  };

  // Per-card sessions = workouts attributed to this plan_day, plus any
  // unattributed workouts on the same date if this is the primary card.
  // Used to drive the per-card hasSessions / missed-day badges so each
  // concurrent program reflects its own completion state.
  const sessionsForCard = (day: PlanDayWithSuggestions, primary: boolean): Workout[] => {
    const own = workoutsByPlanDayId.get(day.id) ?? [];
    if (!primary) return own;
    const legacy = unattributedByDate.get(day.date) ?? [];
    if (legacy.length === 0) return own;
    const merged = [...own, ...legacy];
    sortWorkoutsByTimeOfDay(merged);
    return merged;
  };

  const today = todayISO();
  const isMissedDay = (day: PlanDayWithSuggestions, sessions: Workout[]) =>
    !day.isRest && day.date < today && sessions.length === 0;

  const ctxFor = (day: PlanDayWithSuggestions, loggedWorkout: Workout | null) => ({
    date: day.date,
    plan: day,
    loggedWorkout,
    suggestions: day.suggestions ?? null,
  });

  const confirmReset = () => {
    if (!resetPlanDayCtx) return;
    const target = resetPlanDayCtx;
    resetPlanDay.mutate(
      { id: target.id },
      {
        onSuccess: () => {
          toast({
            title: "Plan reset",
            description: `${target.day} restored to original prescription.`,
          });
          invalidateMissionRelatedQueries(queryClient);
          setResetPlanDayCtx(null);
        },
        onError: () => {
          toast({ title: "Failed to reset plan", variant: "destructive" });
        },
      },
    );
  };

  const handleUndoReset = (undoToken: string, scopeLabel: string) => {
    undoPlanReset.mutate(
      { data: { undoToken } },
      {
        onSuccess: (data) => {
          toast({
            title: "Reset undone",
            description: `${data.daysRestored} day${data.daysRestored === 1 ? "" : "s"} of ${scopeLabel} restored.`,
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

  const confirmResetWeek = () => {
    resetPlanWeek.mutate(
      { week: weekNum },
      {
        onSuccess: (data) => {
          if (data.daysReset === 0) {
            toast({
              title: "Nothing to reset",
              description: `Week ${weekNum} hasn't been customized yet.`,
            });
          } else {
            const undoToken = data.undoToken;
            const undoSeconds = data.undoExpiresInSeconds ?? 30;
            toast({
              title: "Week reset",
              description: `${data.daysReset} day${data.daysReset === 1 ? "" : "s"} in week ${weekNum} restored to the original plan. Undo available for ${undoSeconds}s.`,
              duration: undoToken ? undoSeconds * 1000 : undefined,
              action: undoToken ? (
                <UndoCountdownAction
                  altText="Undo week reset"
                  expiresInSeconds={undoSeconds}
                  onUndo={() =>
                    handleUndoReset(undoToken, `week ${weekNum}`)
                  }
                  testId="button-undo-reset-week"
                />
              ) : undefined,
            });
          }
          invalidateMissionRelatedQueries(queryClient);
          setResetWeekOpen(false);
        },
        onError: () => {
          toast({ title: "Failed to reset week", variant: "destructive" });
        },
      },
    );
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-4xl mx-auto">
      
      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" onClick={() => setLocation(`/plan/${weekNum - 1}`)} disabled={weekNum <= 1}>
          <ChevronLeft className="h-4 w-4 mr-1" /> Prev Week
        </Button>
        <div className="text-center">
          {weekEyebrow && (
            <p
              className="text-[10px] uppercase tracking-[0.2em] font-bold text-primary mb-1"
              data-testid="week-detail-eyebrow"
              data-race-kind={raceKind ?? ""}
              data-race-week={isRaceWeek ? "true" : undefined}
              data-post-race={isPostRace ? "true" : undefined}
            >
              {weekEyebrow}
            </p>
          )}
          <h2 className="text-2xl font-black uppercase tracking-tight text-primary">Week {week.week}</h2>
          <p className="text-xs text-muted-foreground uppercase font-bold tracking-widest mt-1">{formatDate(week.startDate)} - {formatDate(week.endDate)}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setLocation(`/plan/${weekNum + 1}`)}>
          Next Week <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>

      <div
        className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-card border border-border border-l-4 rounded-lg p-4"
        style={{ borderLeftColor: phaseColor(week.phase) }}
      >
        <div>
          <p className="text-[10px] uppercase font-bold text-muted-foreground">Phase</p>
          <p
            className="font-black text-lg flex items-center gap-2"
            data-testid="week-phase-label"
          >
            <span
              className="h-3 w-3 rounded-sm shrink-0"
              style={{ backgroundColor: phaseColor(week.phase) }}
              aria-hidden
            />
            {week.phase}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase font-bold text-muted-foreground">Volume</p>
          {/*
            Bike-only / Row-only weeks (task #107): if the prescription is
            entirely cardio-bucket time (planned_miles 0, planned_cardio
            > 0) the legacy "0 mi / 0 mi" headline made the week look
            empty. Lead with the planned cardio minutes and the dominant
            machine chip so the runner sees the substantial Peloton Bike
            or Row block at a glance. Anything with planned miles keeps
            the original mileage headline.
          */}
          {week.plannedMiles === 0 && (week.plannedCardio ?? 0) > 0 ? (
            <div className="space-y-1" data-testid="week-volume-cardio">
              {/*
                Task #109: show actual cardio minutes alongside planned
                so bike/row weeks get the same plan-vs-actual framing run
                weeks already get from "actualMiles / plannedMiles".
                actualCardio sums workouts.cardio_min for the week,
                excluding Skipped sessions.
              */}
              {/*
                Task #112: tint the actual/planned cardio headline by
                adherence — green when met or exceeded, amber while still
                in progress, neutral otherwise so future weeks at 0
                actual don't masquerade as completed.
              */}
              <p
                className={cn(
                  "font-black text-lg",
                  adherenceTextClass(
                    adherenceStatus(week.actualCardio, week.plannedCardio),
                  ),
                )}
                data-testid="week-volume-cardio-actual"
                data-adherence={adherenceStatus(week.actualCardio, week.plannedCardio)}
              >
                {Math.round(week.actualCardio ?? 0)} / {Math.round(week.plannedCardio ?? 0)} min cardio
              </p>
              {week.dominantCardioEquipment && (
                <span
                  className="inline-block text-[10px] bg-secondary text-secondary-foreground px-2 py-0.5 rounded font-bold uppercase tracking-wider"
                  data-testid="week-volume-cardio-chip"
                >
                  {week.dominantCardioEquipment}
                </span>
              )}
            </div>
          ) : (
            <p
              className={cn(
                "font-black text-lg",
                adherenceTextClass(
                  adherenceStatus(week.actualMiles, week.plannedMiles),
                ),
              )}
              data-testid="week-volume-miles"
              data-adherence={adherenceStatus(week.actualMiles, week.plannedMiles)}
            >
              {formatDistance(week.actualMiles)} / {formatDistance(week.plannedMiles)}
            </p>
          )}
        </div>
        <div>
          <p className="text-[10px] uppercase font-bold text-muted-foreground">Long Run</p>
          <p className="font-black text-lg">{formatDistance(week.longRunMi)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase font-bold text-muted-foreground">Sessions</p>
          <p
            className={cn(
              "font-black text-lg",
              adherenceTextClass(
                adherenceStatus(week.completedSessions, week.totalSessions),
              ),
            )}
            data-adherence={adherenceStatus(week.completedSessions, week.totalSessions)}
            data-testid="text-sessions-adherence"
          >
            {week.completedSessions || 0} / {week.totalSessions || 0}
          </p>
          {week.programs && week.programs.length > 1 && (
            <div
              className="mt-1 flex flex-col gap-0.5 text-[10px] uppercase font-bold tracking-wider text-muted-foreground"
              data-testid="week-program-breakdown"
            >
              {week.programs.map((p) => (
                <span
                  key={p.sourceEntryIndex}
                  data-testid={`week-program-${p.sourceEntryIndex}`}
                >
                  <span className="text-foreground/80">{p.label}</span>{" "}
                  <span>
                    {p.completedSessions}/{p.totalSessions}
                  </span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Bulk reset for the whole week. Per-day reset still lives on each day
          card; this button is the shortcut for "wipe every customization in
          this week and start over". Logged workouts are not affected. */}
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          className="text-xs uppercase font-bold tracking-wider"
          onClick={() => setResetWeekOpen(true)}
          data-testid="button-reset-week"
        >
          <Undo2 className="h-3 w-3 mr-1.5" /> Reset Week
        </Button>
      </div>

      <div className="space-y-4">
        {week.days.map((day) => {
          // Concurrent programs (Tasks #135 + #143): each program's
          // card owns its own logged-workout sessions (workouts attributed
          // via planDayId) and its own Crushed/Log/Skip buttons that link
          // back to that specific plan_day. The primary (lowest-index)
          // card additionally absorbs any unattributed legacy workouts on
          // the same date so single-program history still surfaces in the
          // expected place. Test ids on supplementary cards are
          // disambiguated with the sourceEntryIndex suffix so tests can
          // target the correct concurrent program.
          const primary = isPrimaryAtDate(day);
          const concurrentCount = planDayCountByDate.get(day.date) ?? 1;
          const showProgramBadge = concurrentCount > 1 && day.sourceEntryLabel != null;
          const sessions = sessionsForCard(day, primary);
          const cardTestId = primary
            ? `day-card-${day.date}`
            : `day-card-${day.date}-${day.sourceEntryIndex}`;
          const chipTestIdSuffix = primary
            ? `${day.date}`
            : `${day.date}-${day.sourceEntryIndex}`;
          const programBadge = showProgramBadge ? (
            <span
              className="text-[10px] bg-primary/10 text-primary px-2 py-1 rounded font-bold uppercase tracking-wider"
              data-testid={`badge-program-${day.date}-${day.sourceEntryIndex}`}
            >
              {day.sourceEntryLabel}
            </span>
          ) : null;
          // Plan-edit actions are rendered on every day card (rest or not) so
          // the runner can edit / swap / reset the prescription regardless of
          // whether anything has been logged yet.
          const planActions = (
            <div className="flex items-center gap-1 text-muted-foreground">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[10px] uppercase font-bold tracking-wider hover:text-foreground"
                onClick={() => setEditPlanDay(day)}
                data-testid={`button-edit-plan-${chipTestIdSuffix}`}
                title="Edit planned session"
              >
                <Settings2 className="h-3 w-3 mr-1" /> Edit Plan
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[10px] uppercase font-bold tracking-wider hover:text-foreground"
                onClick={() => setMovePlanDay(day)}
                data-testid={`button-move-plan-${chipTestIdSuffix}`}
                title="Swap with another day"
              >
                <ArrowLeftRight className="h-3 w-3 mr-1" /> Move Day
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[10px] uppercase font-bold tracking-wider hover:text-foreground"
                onClick={() => setResetPlanDayCtx(day)}
                data-testid={`button-reset-plan-${chipTestIdSuffix}`}
                title="Reset to original prescription"
              >
                <Undo2 className="h-3 w-3 mr-1" /> Reset
              </Button>
            </div>
          );

          // Task #33: highlight by plan_day.id when the deep link
          // included one (handles concurrent overlapping programs that
          // share a calendar date — the missed row may NOT be the
          // primary card). Fall back to date+primary when only
          // ?missed=YYYY-MM-DD is present (legacy / hand-typed URLs).
          const isHighlighted =
            highlightedPlanDayId != null
              ? highlightedPlanDayId === day.id
              : highlightedDate === day.date && primary;

          if (day.isRest) {
            return (
              <Card
                key={day.id}
                className={cn(
                  "border-dashed border-2 bg-muted/20 scroll-mt-24 transition-shadow",
                  isHighlighted && "ring-2 ring-destructive ring-offset-2 ring-offset-background animate-pulse",
                )}
                data-testid={cardTestId}
                data-day-anchor={primary ? day.date : undefined}
                data-plan-day-anchor={day.id}
              >
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div>
                        <div className="text-sm font-bold uppercase tracking-wider">{day.day}</div>
                        <div className="text-xs text-muted-foreground">{formatDate(day.date)}</div>
                      </div>
                      {/* Task #133: equipment chips moved into the
                          disclosure below so the rest-day card surface
                          stays slim. CustomizedBadge stays as a status
                          marker (not a metric/equipment chip). Task #135
                          program-name badge is shown here when multiple
                          concurrent programs share the same date. */}
                      {programBadge}
                      <CustomizedBadge day={day} />
                    </div>
                    <div className="text-sm text-muted-foreground font-medium uppercase tracking-wider flex items-center gap-2">
                      <Activity className="h-4 w-4 opacity-50" />
                      Rest / Recovery
                    </div>
                    <div className="ml-auto">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs uppercase font-bold"
                        onClick={() => openLog({ date: day.date, plan: day })}
                        data-testid={`button-log-${chipTestIdSuffix}`}
                      >
                        <Play className="h-3 w-3 mr-1" /> Log
                      </Button>
                    </div>
                  </div>
                  <SessionDetailDisclosure testId={`toggle-day-plan-detail-${chipTestIdSuffix}`}>
                    <div className="flex flex-wrap gap-2">
                      {(day.equipmentList ?? [day.equipment]).map((eq, idx) => (
                        <span
                          key={`${day.date}-eq-${idx}`}
                          className="text-[10px] bg-secondary text-secondary-foreground px-2 py-1 rounded font-bold uppercase tracking-wider"
                          data-testid={`chip-equipment-${chipTestIdSuffix}-${idx}`}
                        >
                          {eq}
                        </span>
                      ))}
                    </div>
                  </SessionDetailDisclosure>
                  {sessions.length > 0 && (
                    <div className="space-y-2 pl-1">
                      {sessions.map((session) => (
                        <div
                          key={session.id}
                          className="flex items-center justify-between gap-3 bg-background/60 border border-border rounded px-3 py-2"
                          data-testid={`session-${day.date}-${session.id}`}
                        >
                          {/* Slim collapsed row (Task #133): just title +
                              the one headline number. The per-bucket
                              ActualBreakdown moves into the disclosure
                              below alongside the rest of the detail. */}
                          <div className="flex flex-col gap-1 min-w-0 flex-1">
                            <div className="text-xs font-mono flex flex-wrap items-center gap-x-3 gap-y-1">
                              <TimeOfDayBadge
                                value={session.timeOfDay}
                                testId={`badge-time-of-day-week-${session.id}`}
                              />
                              <span className="font-bold uppercase tracking-wider">{session.sessionType}</span>
                              <PrimaryMetricDisplay
                                metric={getPrimaryMetricCompare(session, null)}
                                variant="compact"
                                testIdPrefix={`session-${day.date}-${session.id}`}
                                className="ml-auto"
                              />
                            </div>
                            <SessionDetailDisclosure
                              testId={`toggle-session-detail-${session.id}`}
                            >
                              <ActualBreakdown
                                totalMin={session.totalMin}
                                strengthMin={session.strengthMin}
                                cardioMin={session.cardioMin}
                                runMin={session.runMin}
                                durationMin={session.durationMin}
                                variant="compact"
                                testIdPrefix={`session-${day.date}-${session.id}`}
                              />
                            </SessionDetailDisclosure>
                          </div>
                          <div className="flex gap-1">
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-xs uppercase font-bold"
                              onClick={() => openEdit({ date: day.date, plan: day, loggedWorkout: session })}
                              data-testid={`button-edit-${day.date}-${session.id}`}
                            >
                              <Edit className="h-3 w-3 mr-1" /> Edit
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-xs uppercase font-bold text-destructive hover:text-destructive"
                              onClick={() => requestDelete({ date: day.date, plan: day, loggedWorkout: session })}
                              disabled={isDeleting}
                              data-testid={`button-delete-${day.date}-${session.id}`}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex justify-end pt-2 border-t border-dashed border-border/60">
                    {planActions}
                  </div>
                </CardContent>
              </Card>
            );
          }

          const hasSessions = sessions.length > 0;
          const missed = isMissedDay(day, sessions);
          // Task #199: race-day badge + amber accent on the trailing
          // marathon Sunday. Both hybrid (Task #192) and non-hybrid
          // marathon plans emit `session_type: "Race"` on the campaign-
          // final Sunday — keying the visual treatment off that string
          // means the badge fires uniformly for Pfitz / Higdon / hybrid
          // plans without any plan-shape branching here.
          const isRaceDay = day.sessionType === "Race";

          return (
            <Card
              key={day.id}
              className={cn(
                "transition-colors scroll-mt-24",
                missed
                  ? "border-destructive/40 bg-destructive/5 hover:border-destructive/60"
                  : isRaceDay
                    ? "border-amber-500/60 bg-amber-500/5 hover:border-amber-500/80 ring-1 ring-amber-500/30"
                    : "border-border hover:border-primary/30",
                isHighlighted && "ring-2 ring-destructive ring-offset-2 ring-offset-background animate-pulse",
              )}
              data-testid={cardTestId}
              data-race-day={isRaceDay ? "true" : undefined}
              data-day-anchor={primary ? day.date : undefined}
              data-plan-day-anchor={day.id}
            >
              <CardContent className="p-0">
                <div className="flex flex-col md:flex-row">
                  <div
                    className={cn(
                      "w-full md:w-48 p-4 border-b md:border-b-0 md:border-r flex flex-col justify-center",
                      missed
                        ? "bg-destructive/10 border-destructive/30"
                        : isRaceDay
                          ? "bg-amber-500/10 border-amber-500/30"
                          : "bg-muted/30 border-border",
                    )}
                  >
                    <div className="text-sm font-black uppercase tracking-wider">{day.day}</div>
                    <div className="text-xs text-muted-foreground mb-3">{formatDate(day.date)}</div>
                    {/* Task #133: equipment chips moved into the
                        right-column disclosure so the always-visible
                        left rail stays at title + status only. */}
                    <div className="mt-auto flex flex-wrap items-center gap-2">
                      {/* Task #135: program-name badge in the rail when
                          multiple concurrent programs share the same date.
                          Equipment chips are intentionally NOT in the rail —
                          Task #133 moved them into the right-column
                          disclosure to keep the rail at title + status. */}
                      {programBadge}
                      <CustomizedBadge day={day} />
                      {/* Task #199 originally added a generic "Race Day"
                          pill here keyed off sessionType === "Race".
                          Task #201 supersedes that pill with a per-kind
                          badge ("5K Day" / "10K Day" / "Half Marathon
                          Day" / "Marathon Day") rendered from
                          raceDayLabel below. The amber Card accent +
                          data-race-day attribute (set on the Card
                          above) still owns the visual "this is the
                          race" treatment, so half / 10K / 5K race-day
                          Sundays light up the same way without a
                          duplicate testid here. */}
                      {hasSessions && (
                        <span className="text-[10px] bg-primary/10 text-primary px-2 py-1 rounded font-bold uppercase tracking-wider flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3" />
                          {sessions.length > 1 ? `${sessions.length} Logged` : "Logged"}
                        </span>
                      )}
                      {missed && (
                        <span
                          className="text-[10px] bg-destructive/15 text-destructive px-2 py-1 rounded font-bold uppercase tracking-wider flex items-center gap-1"
                          data-testid={`badge-missed-${day.date}`}
                        >
                          <AlertTriangle className="h-3 w-3" /> Missed
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex-1 p-6 space-y-4">
                    <div className="space-y-3">
                      {/* Task #201: per-kind race-day badge derived
                          from Sunday's distance_mi / description
                          prefix so 5K / 10K / Half / Marathon Sundays
                          each get the right runner-facing headline
                          ("5K Day", "Marathon Day", etc.) instead of
                          the generic "Race" session type alone. This
                          chip ALSO subsumes Task #199's old "Race Day"
                          pill (same data-testid) — the Card amber
                          accent + data-race-day attribute above still
                          carry the visual treatment. raceDayLabel
                          returns null on non-race-day rows so the
                          chip stays absent on Long Run / Easy Run. */}
                      {(() => {
                        const race = raceDayLabel(day.distanceMi, day.description, day.sessionType);
                        if (!race) return null;
                        // Task #228: small "Personalized" / "From catalog"
                        // chip rendered alongside the per-kind race-day
                        // badge. Tooltip explains where the pace came
                        // from so a runner who hasn't logged enough
                        // quality work yet understands WHY the chip is
                        // showing the catalog default — and what to do
                        // about it. The pace itself is overlaid into
                        // RunTargetLine below via the `pace` prop.
                        const prp = day.personalizedRacePace ?? null;
                        return (
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className="inline-flex items-center gap-1 text-[10px] bg-primary/15 text-primary px-2 py-1 rounded font-bold uppercase tracking-wider w-fit"
                              data-testid={`badge-race-day-${day.date}`}
                              data-race-kind={race.kind}
                            >
                              <Activity className="h-3 w-3" />
                              {race.label}
                            </span>
                            {prp && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span
                                    className={cn(
                                      "inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded font-bold uppercase tracking-wider w-fit cursor-help",
                                      prp.source === "personalized"
                                        ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                                        : "bg-muted text-muted-foreground",
                                    )}
                                    data-testid={`badge-race-pace-source-${day.date}`}
                                    data-pace-source={prp.source}
                                    data-personalized-pace={prp.pace}
                                  >
                                    <Sparkles className="h-3 w-3" />
                                    {prp.source === "personalized"
                                      ? `${prp.pace}/mi · Personalized`
                                      : `${prp.pace}/mi · From catalog`}
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent
                                  side="top"
                                  align="start"
                                  className="max-w-xs text-xs"
                                >
                                  {prp.source === "personalized" && prp.basisPaceSeconds != null ? (
                                    <span>
                                      Personalized from {prp.sampleSize} quality run
                                      {prp.sampleSize === 1 ? "" : "s"} (tempo / threshold /
                                      interval / VO2 / race) in the last {prp.lookbackWeeks} weeks.
                                      Avg training pace{" "}
                                      <span className="font-mono font-bold">
                                        {Math.floor(prp.basisPaceSeconds / 60)}:
                                        {String(prp.basisPaceSeconds % 60).padStart(2, "0")}
                                      </span>
                                      /mi → race-day target{" "}
                                      <span className="font-mono font-bold">{prp.pace}</span>/mi.
                                    </span>
                                  ) : (
                                    <span>
                                      Showing the catalog {race.label.toLowerCase()} pace —
                                      not enough recent quality runs in the last{" "}
                                      {prp.lookbackWeeks} weeks to personalize. Log a few
                                      tempo / threshold / interval workouts and this chip
                                      will retune to your training.
                                    </span>
                                  )}
                                </TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        );
                      })()}
                      {/* Task #236: same "Personalized" / "From
                          catalog" chip rendered alongside the Wed
                          steady (Z3) and Fri tempo / threshold /
                          race-pace rows. The server only populates
                          `day.personalizedPace` on rows that match
                          `isPersonalizableQualityPlanDay` AND carry
                          a non-null catalog `pace`, so this block
                          stays absent on every other card. Race-day
                          Sun and Wed/Fri quality rows never overlap,
                          so this chip and the race-day chip above
                          can never both render on the same card. */}
                      {/* Task #239: long-run counterpart of the
                          Wed/Fri quality chip above. Server only
                          populates `day.personalizedLongRunPace` on
                          Sun "Long Run" rows that carry a non-null
                          catalog `pace`, so this block stays absent
                          on every other card. Race-day Sun is owned
                          by the race-day chip above, never by this
                          one — `personalizedRacePace` and
                          `personalizedLongRunPace` are mutually
                          exclusive on any given Sun row. Tooltip copy
                          is tuned for easy-aerobic work (long run /
                          aerobic base / recovery) rather than the
                          quality wording above. */}
                      {(() => {
                        const lp = day.personalizedLongRunPace ?? null;
                        if (!lp) return null;
                        return (
                          <div className="flex flex-wrap items-center gap-2">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span
                                  className={cn(
                                    "inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded font-bold uppercase tracking-wider w-fit cursor-help",
                                    lp.source === "personalized"
                                      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                                      : "bg-muted text-muted-foreground",
                                  )}
                                  data-testid={`badge-long-run-pace-source-${day.date}`}
                                  data-pace-source={lp.source}
                                  data-personalized-pace={lp.pace}
                                >
                                  <Sparkles className="h-3 w-3" />
                                  {lp.source === "personalized"
                                    ? `${lp.pace}/mi · Personalized`
                                    : `${lp.pace}/mi · From catalog`}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent
                                side="top"
                                align="start"
                                className="max-w-xs text-xs"
                              >
                                {lp.source === "personalized" && lp.basisPaceSeconds != null ? (
                                  <span>
                                    Personalized from {lp.sampleSize} easy aerobic run
                                    {lp.sampleSize === 1 ? "" : "s"} (long run / aerobic
                                    base / recovery) in the last {lp.lookbackWeeks} weeks.
                                    Avg training pace{" "}
                                    <span className="font-mono font-bold">
                                      {Math.floor(lp.basisPaceSeconds / 60)}:
                                      {String(lp.basisPaceSeconds % 60).padStart(2, "0")}
                                    </span>
                                    /mi → today's long-run target{" "}
                                    <span className="font-mono font-bold">{lp.pace}</span>/mi.
                                  </span>
                                ) : (
                                  <span>
                                    Showing the catalog long-run pace —
                                    not enough recent easy aerobic runs in the last{" "}
                                    {lp.lookbackWeeks} weeks to personalize. Log a few
                                    long runs / aerobic base sessions and this chip
                                    will retune to your training.
                                  </span>
                                )}
                              </TooltipContent>
                            </Tooltip>
                          </div>
                        );
                      })()}
                      {(() => {
                        const pp = day.personalizedPace ?? null;
                        if (!pp) return null;
                        const lowerSession = day.sessionType.toLowerCase();
                        return (
                          <div className="flex flex-wrap items-center gap-2">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span
                                  className={cn(
                                    "inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded font-bold uppercase tracking-wider w-fit cursor-help",
                                    pp.source === "personalized"
                                      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                                      : "bg-muted text-muted-foreground",
                                  )}
                                  data-testid={`badge-quality-pace-source-${day.date}`}
                                  data-pace-source={pp.source}
                                  data-personalized-pace={pp.pace}
                                >
                                  <Sparkles className="h-3 w-3" />
                                  {pp.source === "personalized"
                                    ? `${pp.pace}/mi · Personalized`
                                    : `${pp.pace}/mi · From catalog`}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent
                                side="top"
                                align="start"
                                className="max-w-xs text-xs"
                              >
                                {pp.source === "personalized" && pp.basisPaceSeconds != null ? (
                                  <span>
                                    Personalized from {pp.sampleSize} quality run
                                    {pp.sampleSize === 1 ? "" : "s"} (tempo / threshold /
                                    interval / VO2 / race) in the last {pp.lookbackWeeks} weeks.
                                    Avg training pace{" "}
                                    <span className="font-mono font-bold">
                                      {Math.floor(pp.basisPaceSeconds / 60)}:
                                      {String(pp.basisPaceSeconds % 60).padStart(2, "0")}
                                    </span>
                                    /mi → today's {lowerSession} target{" "}
                                    <span className="font-mono font-bold">{pp.pace}</span>/mi.
                                  </span>
                                ) : (
                                  <span>
                                    Showing the catalog {lowerSession} pace —
                                    not enough recent quality runs in the last{" "}
                                    {pp.lookbackWeeks} weeks to personalize. Log a few
                                    tempo / threshold / interval workouts and this chip
                                    will retune to your training.
                                  </span>
                                )}
                              </TooltipContent>
                            </Tooltip>
                          </div>
                        );
                      })()}
                      <h4 className="text-xl font-black uppercase tracking-tight">{day.sessionType}</h4>
                      <p className="text-sm text-muted-foreground line-clamp-2">{day.description}</p>
                      {/* Slim day card (Task #133): show just the one
                          headline number for the planned session.
                          PlannedBreakdown, distance and total load tiles
                          all move into the "Show details" disclosure. */}
                      <PrimaryMetricDisplay
                        metric={getPrimaryMetric(day)}
                        variant="compact"
                        testIdPrefix={`day-${day.date}`}
                      />
                      <SessionDetailDisclosure testId={`toggle-day-plan-detail-${chipTestIdSuffix}`}>
                        <div className="space-y-3">
                          <div className="flex flex-wrap gap-2">
                            {(day.equipmentList ?? [day.equipment]).map((eq, idx) => (
                              <span
                                key={`${day.date}-eq-${idx}`}
                                className="text-[10px] bg-secondary text-secondary-foreground px-2 py-1 rounded font-bold uppercase tracking-wider"
                                data-testid={`chip-equipment-${chipTestIdSuffix}-${idx}`}
                              >
                                {eq}
                              </span>
                            ))}
                          </div>
                          <div className="flex flex-wrap gap-4 text-sm">
                            {day.distanceMi != null && (
                              <div>
                                <span className="text-[10px] uppercase font-bold text-muted-foreground block">Distance</span>
                                <span className="font-mono font-medium">{formatDistance(day.distanceMi)}</span>
                              </div>
                            )}
                            {day.totalLoad != null && day.totalLoad > 0 && (
                              <div>
                                <span className="text-[10px] uppercase font-bold text-muted-foreground block">Load</span>
                                <span className="font-mono font-medium">{formatLoad(day.totalLoad)}</span>
                              </div>
                            )}
                            <PlannedBreakdown
                              totalMin={day.totalMin}
                              strengthMin={day.strengthMin}
                              cardioMin={day.cardioMin}
                              runMin={day.runMin}
                              runDistanceMi={day.distanceMi}
                              variant="compact"
                              testIdPrefix={`day-${day.date}`}
                            />
                          </div>
                          <RunTargetLine
                            sessionType={day.sessionType}
                            week={day.week}
                            runMin={day.runMin}
                            distanceMi={day.distanceMi}
                            // Task #228: when a personalized race-day
                            // pace is available, it overrides the
                            // seeded `day.pace` so the headline number
                            // reflects the live recommendation derived
                            // from the runner's training rather than
                            // the catalog default. Falls back to
                            // `day.pace` on every non-race day (and on
                            // race days where the runner doesn't yet
                            // have enough quality history to
                            // personalize, in which case
                            // `personalizedRacePace.pace` IS the
                            // catalog value anyway).
                            // Task #236 extends Task #228: the
                            // personalized prescribed-pace overlay
                            // (Wed steady, Fri tempo / threshold /
                            // race-pace) likewise overrides the
                            // seeded `day.pace`.
                            // race-pace > quality-pace > catalog
                            // ordering is safe — race-day Sun and
                            // Wed/Fri quality rows never overlap, so
                            // at most one of these two overlays is
                            // populated on any given row.
                            // Task #239 extends Tasks #228 / #236: also
                            // override with the long-run overlay on Sun
                            // long-run rows. The three overlays are
                            // mutually exclusive on any given row (race-
                            // day Sun / Wed-Fri quality / Sun long run
                            // never co-occur), so the precedence order
                            // doesn't matter in practice — at most one
                            // is populated.
                            pace={
                              day.personalizedRacePace?.pace ??
                              day.personalizedPace?.pace ??
                              day.personalizedLongRunPace?.pace ??
                              day.pace
                            }
                            variant="prominent"
                            testId={`day-${day.date}-run-target`}
                            // Task #227: dress the race-week pace chip
                            // in the runner's actual race-kind zone
                            // tone (5K → VO2 red, 10K → threshold
                            // orange, marathon-pace → steady amber)
                            // so the day card communicates the
                            // intended effort instead of leaving the
                            // generic primary tone read identically
                            // for "10:30" 5K pace and "11:30"
                            // marathon pace. Returns undefined for
                            // non-race rows.
                            zoneBucket={
                              raceDayLabel(
                                day.distanceMi,
                                day.description,
                                day.sessionType,
                              )?.zoneBucket
                            }
                          />
                        </div>
                      </SessionDetailDisclosure>
                    </div>

                    {hasSessions && (
                      <div className="space-y-2 pt-2 border-t border-border">
                        {sessions.map((session) => {
                          const sessionCtx = ctxFor(day, session);
                          return (
                            <div
                              key={session.id}
                              className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 bg-muted/30 border border-border rounded p-3"
                              data-testid={`session-${day.date}-${session.id}`}
                            >
                              {/* Slim collapsed row (Task #133): only
                                  title + the one headline number (actual
                                  vs planned). The per-bucket
                                  ActualBreakdown, distance, pace, RPE
                                  and load tiles all move into the
                                  disclosure below. */}
                              <div className="flex flex-col gap-2 min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-mono">
                                  <TimeOfDayBadge
                                    value={session.timeOfDay}
                                    testId={`badge-time-of-day-week-${session.id}`}
                                  />
                                  <span className="font-bold uppercase tracking-wider">{session.sessionType}</span>
                                  <PrimaryMetricDisplay
                                    metric={getPrimaryMetricCompare(session, day)}
                                    variant="compact"
                                    testIdPrefix={`session-${day.date}-${session.id}`}
                                    className="ml-auto"
                                  />
                                </div>
                                <SessionDetailDisclosure
                                  testId={`toggle-session-detail-${session.id}`}
                                >
                                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-mono">
                                    {session.distanceMi != null && (
                                      <span><span className="text-muted-foreground">Dist</span> {formatDistance(session.distanceMi)}</span>
                                    )}
                                    <ActualBreakdown
                                      totalMin={session.totalMin}
                                      strengthMin={session.strengthMin}
                                      cardioMin={session.cardioMin}
                                      runMin={session.runMin}
                                      durationMin={session.durationMin}
                                      plannedTotalMin={day.totalMin}
                                      plannedStrengthMin={day.strengthMin}
                                      plannedCardioMin={day.cardioMin}
                                      plannedRunMin={day.runMin}
                                      variant="compact"
                                      testIdPrefix={`session-${day.date}-${session.id}`}
                                    />
                                    {session.pace && (
                                      <span><span className="text-muted-foreground">Pace</span> {session.pace}/mi</span>
                                    )}
                                    {session.rpe != null && (
                                      <span><span className="text-muted-foreground">RPE</span> {session.rpe}/10</span>
                                    )}
                                    {session.totalLoad != null && (
                                      <span><span className="text-muted-foreground">Load</span> {formatLoad(session.totalLoad)}</span>
                                    )}
                                  </div>
                                </SessionDetailDisclosure>
                              </div>
                              <div className="flex gap-2 shrink-0">
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  className="uppercase font-bold text-xs"
                                  onClick={() => openEdit(sessionCtx)}
                                  data-testid={`button-edit-${day.date}-${session.id}`}
                                >
                                  <Edit className="h-3 w-3 mr-1" /> Edit
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="uppercase font-bold text-xs text-destructive hover:text-destructive border-destructive/30"
                                  onClick={() => requestDelete(sessionCtx)}
                                  disabled={isDeleting}
                                  data-testid={`button-delete-${day.date}-${session.id}`}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2 pt-2">
                      <Button
                        className="uppercase font-black text-xs bg-primary hover:bg-primary/90"
                        onClick={() => crushIt(ctxFor(day, null))}
                        disabled={isCrushing}
                        data-testid={`button-crush-${chipTestIdSuffix}`}
                      >
                        <Zap className="h-3 w-3 mr-2" />
                        {hasSessions ? "Crushed Another" : "Crushed It"}
                      </Button>
                      <Button
                        variant="secondary"
                        className="uppercase font-bold text-xs"
                        onClick={() => openLog(ctxFor(day, null))}
                        disabled={isCrushing}
                        data-testid={`button-log-${chipTestIdSuffix}`}
                      >
                        <Pencil className="h-3 w-3 mr-2" />
                        {hasSessions ? "Log Another" : "Log Actual"}
                      </Button>
                      {!hasSessions && (
                        <Button
                          variant="outline"
                          className="uppercase font-bold text-xs text-destructive hover:text-destructive border-destructive/30"
                          onClick={() => requestSkip(ctxFor(day, null))}
                          disabled={isCrushing}
                          data-testid={`button-skip-${chipTestIdSuffix}`}
                        >
                          <XCircle className="h-3 w-3 mr-2" /> Skipped
                        </Button>
                      )}
                    </div>

                    {/* Plan-edit row sits below the logged-workout actions so the
                        two concerns are visually separated and can't be confused. */}
                    <div className="flex justify-end pt-3 border-t border-border/60">
                      {planActions}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {editPlanDay && (
        <PlanDayForm
          open={!!editPlanDay}
          onOpenChange={(open) => !open && setEditPlanDay(null)}
          planDay={editPlanDay}
        />
      )}
      {movePlanDay && (
        <MoveDayPicker
          open={!!movePlanDay}
          onOpenChange={(open) => !open && setMovePlanDay(null)}
          day={movePlanDay}
        />
      )}
      <AlertDialog
        open={!!resetPlanDayCtx}
        onOpenChange={(open) => !open && setResetPlanDayCtx(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset to original prescription?</AlertDialogTitle>
            <AlertDialogDescription>
              This will revert {resetPlanDayCtx?.day} ({resetPlanDayCtx?.date}) back to the seeded plan, undoing any edits or swaps applied to this day. Logged workouts are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resetPlanDay.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={resetPlanDay.isPending}
              onClick={(e) => {
                e.preventDefault();
                confirmReset();
              }}
              data-testid="button-confirm-reset-plan"
            >
              {resetPlanDay.isPending ? "Resetting..." : "Reset Plan"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={resetWeekOpen}
        onOpenChange={(open) => !resetPlanWeek.isPending && setResetWeekOpen(open)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset all of Week {weekNum}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will undo every edit and swap you've made to Week {weekNum} and restore the original prescription for all {week.days.length} days. Logged workouts are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resetPlanWeek.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={resetPlanWeek.isPending}
              onClick={(e) => {
                e.preventDefault();
                confirmResetWeek();
              }}
              data-testid="button-confirm-reset-week"
            >
              {resetPlanWeek.isPending ? "Resetting..." : "Reset Week"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {dialogs}
    </div>
  );
}
