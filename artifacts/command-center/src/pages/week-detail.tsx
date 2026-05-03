import { useState } from "react";
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
import { useParams, useLocation } from "wouter";
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
} from "lucide-react";
import { useMissionActions } from "@/hooks/use-mission-actions";
import { cn } from "@/lib/utils";
import { phaseColor } from "@/lib/phase-colors";
import { adherenceStatus, adherenceTextClass } from "@/lib/adherence";
import { PlanDayForm } from "@/components/plan-day-form";
import { MoveDayPicker } from "@/components/move-day-picker";
import { sortWorkoutsByTimeOfDay } from "@/lib/time-of-day";
import { TimeOfDayBadge } from "@/components/time-of-day-badge";
import { UndoCountdownAction } from "@/components/undo-countdown-action";
import { PlannedBreakdown } from "@/components/planned-breakdown";
import { ActualBreakdown } from "@/components/actual-breakdown";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

// Human-readable labels for the camelCase field names returned by the API in
// PlanDay.customizedFields. Keep keys aligned with planDayCustomizedFields()
// in the api-server transforms.
const CUSTOMIZED_FIELD_LABELS: Record<string, string> = {
  sessionType: "Session type",
  equipment: "Equipment",
  description: "Description",
  distanceMi: "Distance",
  strengthMin: "Lift minutes",
  cardioMin: "Cardio minutes",
  runMin: "Run minutes",
  pace: "Pace",
  strengthLoad: "Strength load",
  totalLoad: "Total load",
  isRest: "Rest day",
};

function CustomizedBadge({ day }: { day: PlanDay }) {
  if (!day.isCustomized) return null;
  const labels = day.customizedFields
    .map((f) => CUSTOMIZED_FIELD_LABELS[f] ?? f)
    .filter((v, i, arr) => arr.indexOf(v) === i);
  const tooltipText =
    labels.length > 0
      ? `Edited from original: ${labels.join(", ")}`
      : "Edited from original";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="text-[10px] bg-amber-500/15 text-amber-600 dark:text-amber-400 px-2 py-1 rounded font-bold uppercase tracking-wider flex items-center gap-1 cursor-help"
          data-testid={`badge-customized-${day.date}`}
        >
          <Sparkles className="h-3 w-3" />
          Edited
        </span>
      </TooltipTrigger>
      <TooltipContent>{tooltipText}</TooltipContent>
    </Tooltip>
  );
}

export default function WeekDetail() {
  const params = useParams();
  const weekNum = parseInt(params.week || "1", 10);
  const [, setLocation] = useLocation();
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

  const workoutsParams = week ? { from: week.startDate, to: week.endDate } : {};
  const { data: workouts } = useListWorkouts(workoutsParams, {
    query: {
      enabled: !!week,
      queryKey: getListWorkoutsQueryKey(workoutsParams),
    },
  });

  if (isLoading) {
    return <div className="space-y-6 max-w-4xl mx-auto"><Skeleton className="h-32 w-full" /><Skeleton className="h-96 w-full" /></div>;
  }

  if (!week) return <div>Week not found</div>;

  // Map: date -> all workouts logged for that date, ordered by time-of-day
  // tag (AM, PM, Other, then untagged) and then createdAt ascending so an AM
  // strength session logged in the evening still surfaces above an earlier
  // PM run.
  const workoutsByDate = new Map<string, Workout[]>();
  for (const w of workouts ?? []) {
    const list = workoutsByDate.get(w.date);
    if (list) list.push(w);
    else workoutsByDate.set(w.date, [w]);
  }
  for (const list of workoutsByDate.values()) {
    sortWorkoutsByTimeOfDay(list);
  }

  const today = todayISO();
  const isMissedDay = (day: PlanDayWithSuggestions) =>
    !day.isRest && day.date < today && (workoutsByDate.get(day.date)?.length ?? 0) === 0;

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
          const sessions = workoutsByDate.get(day.date) ?? [];
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
                data-testid={`button-edit-plan-${day.date}`}
                title="Edit planned session"
              >
                <Settings2 className="h-3 w-3 mr-1" /> Edit Plan
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[10px] uppercase font-bold tracking-wider hover:text-foreground"
                onClick={() => setMovePlanDay(day)}
                data-testid={`button-move-plan-${day.date}`}
                title="Swap with another day"
              >
                <ArrowLeftRight className="h-3 w-3 mr-1" /> Move Day
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[10px] uppercase font-bold tracking-wider hover:text-foreground"
                onClick={() => setResetPlanDayCtx(day)}
                data-testid={`button-reset-plan-${day.date}`}
                title="Reset to original prescription"
              >
                <Undo2 className="h-3 w-3 mr-1" /> Reset
              </Button>
            </div>
          );

          if (day.isRest) {
            return (
              <Card
                key={day.id}
                className="border-dashed border-2 bg-muted/20"
                data-testid={`day-card-${day.date}`}
              >
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div>
                        <div className="text-sm font-bold uppercase tracking-wider">{day.day}</div>
                        <div className="text-xs text-muted-foreground">{formatDate(day.date)}</div>
                      </div>
                      {/* Task #77: rest days still get a single-chip rail
                          (e.g. "Off / Rest") so every day card in the
                          week view has a consistent equipment rail and
                          the eye can scan straight down the column. */}
                      {(day.equipmentList ?? [day.equipment]).map((eq, idx) => (
                        <span
                          key={`${day.date}-eq-${idx}`}
                          className="text-[10px] bg-secondary text-secondary-foreground px-2 py-1 rounded font-bold uppercase tracking-wider"
                          data-testid={`chip-equipment-${day.date}-${idx}`}
                        >
                          {eq}
                        </span>
                      ))}
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
                        data-testid={`button-log-${day.date}`}
                      >
                        <Play className="h-3 w-3 mr-1" /> Log
                      </Button>
                    </div>
                  </div>
                  {sessions.length > 0 && (
                    <div className="space-y-2 pl-1">
                      {sessions.map((session) => (
                        <div
                          key={session.id}
                          className="flex items-center justify-between gap-3 bg-background/60 border border-border rounded px-3 py-2"
                          data-testid={`session-${day.date}-${session.id}`}
                        >
                          <div className="text-xs font-mono flex flex-wrap items-center gap-x-3 gap-y-1">
                            <TimeOfDayBadge
                              value={session.timeOfDay}
                              testId={`badge-time-of-day-week-${session.id}`}
                            />
                            <span className="font-bold uppercase tracking-wider">{session.sessionType}</span>
                            {session.distanceMi != null && <span>{formatDistance(session.distanceMi)}</span>}
                            {/* Per-bucket actual minutes (Task #76). For
                                rest days the planned bucket values are
                                all zero, so this collapses to a single
                                Total tile (or the legacy Duration tile
                                for older logs). */}
                            <ActualBreakdown
                              totalMin={session.totalMin}
                              strengthMin={session.strengthMin}
                              cardioMin={session.cardioMin}
                              runMin={session.runMin}
                              durationMin={session.durationMin}
                              variant="compact"
                              testIdPrefix={`session-${day.date}-${session.id}`}
                            />
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
          const missed = isMissedDay(day);

          return (
            <Card
              key={day.id}
              className={cn(
                "transition-colors",
                missed
                  ? "border-destructive/40 bg-destructive/5 hover:border-destructive/60"
                  : "border-border hover:border-primary/30",
              )}
              data-testid={`day-card-${day.date}`}
            >
              <CardContent className="p-0">
                <div className="flex flex-col md:flex-row">
                  <div
                    className={cn(
                      "w-full md:w-48 p-4 border-b md:border-b-0 md:border-r flex flex-col justify-center",
                      missed ? "bg-destructive/10 border-destructive/30" : "bg-muted/30 border-border",
                    )}
                  >
                    <div className="text-sm font-black uppercase tracking-wider">{day.day}</div>
                    <div className="text-xs text-muted-foreground mb-3">{formatDate(day.date)}</div>
                    <div className="mt-auto flex flex-wrap items-center gap-2">
                      {(day.equipmentList ?? [day.equipment]).map((eq, idx) => (
                        <span
                          key={`${day.date}-eq-${idx}`}
                          className="text-[10px] bg-secondary text-secondary-foreground px-2 py-1 rounded font-bold uppercase tracking-wider"
                          data-testid={`chip-equipment-${day.date}-${idx}`}
                        >
                          {eq}
                        </span>
                      ))}
                      <CustomizedBadge day={day} />
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
                      <h4 className="text-xl font-black uppercase tracking-tight">{day.sessionType}</h4>
                      <p className="text-sm text-muted-foreground line-clamp-2">{day.description}</p>
                      <div className="flex flex-wrap gap-4 text-sm pt-2">
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
                              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-mono">
                                <TimeOfDayBadge
                                  value={session.timeOfDay}
                                  testId={`badge-time-of-day-week-${session.id}`}
                                />
                                <span className="font-bold uppercase tracking-wider">{session.sessionType}</span>
                                {session.distanceMi != null && (
                                  <span><span className="text-muted-foreground">Dist</span> {formatDistance(session.distanceMi)}</span>
                                )}
                                {/* Per-bucket actuals with planned context
                                    (Task #76) — replaces the bare "Dur"
                                    tile so the user sees the gap between
                                    prescribed and actual minutes per
                                    bucket without leaving the row. */}
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
                        data-testid={`button-crush-${day.date}`}
                      >
                        <Zap className="h-3 w-3 mr-2" />
                        {hasSessions ? "Crushed Another" : "Crushed It"}
                      </Button>
                      <Button
                        variant="secondary"
                        className="uppercase font-bold text-xs"
                        onClick={() => openLog(ctxFor(day, null))}
                        disabled={isCrushing}
                        data-testid={`button-log-${day.date}`}
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
                          data-testid={`button-skip-${day.date}`}
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
