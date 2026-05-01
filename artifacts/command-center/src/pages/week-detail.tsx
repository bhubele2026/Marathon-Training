import { useGetPlanWeek, getGetPlanWeekQueryKey, useListWorkouts, getListWorkoutsQueryKey, Workout, PlanDayWithSuggestions } from "@workspace/api-client-react";
import { useParams, useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDistance, formatLoad, formatDate, formatDuration } from "@/lib/format";
import { ChevronLeft, ChevronRight, Activity, Play, Edit, Trash2, CheckCircle2, Zap, XCircle, Pencil, AlertTriangle } from "lucide-react";
import { useMissionActions } from "@/hooks/use-mission-actions";
import { cn } from "@/lib/utils";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function WeekDetail() {
  const params = useParams();
  const weekNum = parseInt(params.week || "1", 10);
  const [, setLocation] = useLocation();
  const { openLog, openEdit, requestDelete, requestSkip, crushIt, isDeleting, isCrushing, dialogs } =
    useMissionActions();

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

  // Map: date -> latest logged workout for that date
  const workoutByDate = new Map<string, Workout>();
  for (const w of workouts ?? []) {
    const existing = workoutByDate.get(w.date);
    if (!existing || (w.createdAt > existing.createdAt)) {
      workoutByDate.set(w.date, w);
    }
  }

  const today = todayISO();
  const isMissedDay = (day: PlanDayWithSuggestions) =>
    !day.isRest && day.date < today && !workoutByDate.get(day.date);

  const ctxFor = (day: PlanDayWithSuggestions) => ({
    date: day.date,
    plan: day,
    loggedWorkout: workoutByDate.get(day.date) ?? null,
    suggestions: day.suggestions ?? null,
  });

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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-card border border-border rounded-lg p-4">
        <div>
          <p className="text-[10px] uppercase font-bold text-muted-foreground">Phase</p>
          <p className="font-black text-lg">{week.phase}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase font-bold text-muted-foreground">Volume</p>
          <p className="font-black text-lg">{formatDistance(week.actualMiles)} / {formatDistance(week.plannedMiles)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase font-bold text-muted-foreground">Long Run</p>
          <p className="font-black text-lg">{formatDistance(week.longRunMi)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase font-bold text-muted-foreground">Sessions</p>
          <p className="font-black text-lg">{week.completedSessions || 0} / {week.totalSessions || 0}</p>
        </div>
      </div>

      <div className="space-y-4">
        {week.days.map((day) => {
          if (day.isRest) {
            const restWorkout = workoutByDate.get(day.date) ?? null;
            return (
              <Card key={day.id} className="border-dashed border-2 bg-muted/20">
                <CardContent className="p-4 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-bold uppercase tracking-wider">{day.day}</div>
                    <div className="text-xs text-muted-foreground">{formatDate(day.date)}</div>
                  </div>
                  <div className="text-sm text-muted-foreground font-medium uppercase tracking-wider flex items-center gap-2">
                    <Activity className="h-4 w-4 opacity-50" />
                    Rest / Recovery
                  </div>
                  <div className="flex gap-2 ml-auto">
                    {restWorkout ? (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-xs uppercase font-bold"
                          onClick={() =>
                            openEdit({ date: day.date, plan: day, loggedWorkout: restWorkout })
                          }
                          data-testid={`button-edit-${day.date}`}
                        >
                          <Edit className="h-3 w-3 mr-1" /> Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs uppercase font-bold text-destructive hover:text-destructive"
                          onClick={() =>
                            requestDelete({ date: day.date, plan: day, loggedWorkout: restWorkout })
                          }
                          disabled={isDeleting}
                          data-testid={`button-delete-${day.date}`}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs uppercase font-bold"
                        onClick={() => openLog({ date: day.date, plan: day })}
                        data-testid={`button-log-${day.date}`}
                      >
                        <Play className="h-3 w-3 mr-1" /> Log
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          }

          const logged = workoutByDate.get(day.date) ?? null;
          const ctx = ctxFor(day);
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
                      <span className="text-[10px] bg-secondary text-secondary-foreground px-2 py-1 rounded font-bold uppercase tracking-wider">
                        {day.equipment}
                      </span>
                      {logged && (
                        <span className="text-[10px] bg-primary/10 text-primary px-2 py-1 rounded font-bold uppercase tracking-wider flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3" /> Logged
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
                  <div className="flex-1 p-6 flex flex-col md:flex-row justify-between gap-6">
                    <div className="space-y-3 flex-1">
                      <h4 className="text-xl font-black uppercase tracking-tight">{day.sessionType}</h4>
                      <p className="text-sm text-muted-foreground line-clamp-2">{day.description}</p>
                      <div className="flex flex-wrap gap-4 text-sm pt-2">
                        {day.distanceMi != null && (
                          <div>
                            <span className="text-[10px] uppercase font-bold text-muted-foreground block">Distance</span>
                            <span className="font-mono font-medium">
                              {logged?.distanceMi != null
                                ? `${formatDistance(logged.distanceMi)} / ${formatDistance(day.distanceMi)}`
                                : formatDistance(day.distanceMi)}
                            </span>
                          </div>
                        )}
                        {day.cardioMin != null && (
                          <div>
                            <span className="text-[10px] uppercase font-bold text-muted-foreground block">Duration</span>
                            <span className="font-mono font-medium">
                              {logged?.durationMin != null
                                ? `${formatDuration(logged.durationMin)} / ${formatDuration(day.cardioMin)}`
                                : formatDuration(day.cardioMin)}
                            </span>
                          </div>
                        )}
                        {day.totalLoad != null && day.totalLoad > 0 && (
                          <div>
                            <span className="text-[10px] uppercase font-bold text-muted-foreground block">Load</span>
                            <span className="font-mono font-medium">
                              {logged?.totalLoad != null
                                ? `${formatLoad(logged.totalLoad)} / ${formatLoad(day.totalLoad)}`
                                : formatLoad(day.totalLoad)}
                            </span>
                          </div>
                        )}
                        {logged?.pace && (
                          <div>
                            <span className="text-[10px] uppercase font-bold text-muted-foreground block">Pace</span>
                            <span className="font-mono font-medium">{logged.pace}/mi</span>
                          </div>
                        )}
                        {logged?.rpe != null && (
                          <div>
                            <span className="text-[10px] uppercase font-bold text-muted-foreground block">RPE</span>
                            <span className="font-mono font-medium">{logged.rpe}/10</span>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex md:flex-col items-stretch justify-end gap-2 shrink-0 md:w-44">
                      {logged ? (
                        <>
                          <Button
                            variant="secondary"
                            className="uppercase font-bold text-xs"
                            onClick={() => openEdit(ctx)}
                            data-testid={`button-edit-${day.date}`}
                          >
                            <Edit className="h-3 w-3 mr-2" /> Edit
                          </Button>
                          <Button
                            variant="outline"
                            className="uppercase font-bold text-xs text-destructive hover:text-destructive border-destructive/30"
                            onClick={() => requestDelete(ctx)}
                            disabled={isDeleting}
                            data-testid={`button-delete-${day.date}`}
                          >
                            <Trash2 className="h-3 w-3 mr-2" /> Delete
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            className="uppercase font-black text-xs bg-primary hover:bg-primary/90"
                            onClick={() => crushIt(ctx)}
                            disabled={isCrushing}
                            data-testid={`button-crush-${day.date}`}
                          >
                            <Zap className="h-3 w-3 mr-2" /> Crushed It
                          </Button>
                          <Button
                            variant="secondary"
                            className="uppercase font-bold text-xs"
                            onClick={() => openLog(ctx)}
                            disabled={isCrushing}
                            data-testid={`button-log-${day.date}`}
                          >
                            <Pencil className="h-3 w-3 mr-2" /> Log Actual
                          </Button>
                          <Button
                            variant="outline"
                            className="uppercase font-bold text-xs text-destructive hover:text-destructive border-destructive/30"
                            onClick={() => requestSkip(ctx)}
                            disabled={isCrushing}
                            data-testid={`button-skip-${day.date}`}
                          >
                            <XCircle className="h-3 w-3 mr-2" /> Skipped
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {dialogs}
    </div>
  );
}
