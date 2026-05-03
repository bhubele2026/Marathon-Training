import { useGetTodayPlan } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDistance, formatLoad } from "@/lib/format";
import { CheckCircle2, Activity, Trash2, Edit, Zap, Pencil, XCircle, Rocket } from "lucide-react";
import { useMissionActions } from "@/hooks/use-mission-actions";
import { QuickLogActivity } from "@/components/quick-log-activity";
import { TimeOfDayBadge } from "@/components/time-of-day-badge";
import { PlannedBreakdown } from "@/components/planned-breakdown";
import { ActualBreakdown } from "@/components/actual-breakdown";
import { PrimaryMetricDisplay } from "@/components/primary-metric-display";
import { SessionDetailDisclosure } from "@/components/session-detail-disclosure";
import {
  getPrimaryMetric,
  getPrimaryMetricCompare,
} from "@/lib/primary-metric";
import { format, parseISO } from "date-fns";

export default function Today() {
  const { data: today, isLoading } = useGetTodayPlan();
  const { openLog, openEdit, requestDelete, requestSkip, crushIt, isDeleting, isCrushing, dialogs } =
    useMissionActions();
  const baseCtx = today
    ? { date: today.date, plan: today.plan, suggestions: today.suggestions }
    : null;

  if (isLoading) {
    return <div className="space-y-6"><Skeleton className="h-64" /></div>;
  }

  if (!today) {
    return <div>Failed to load plan</div>;
  }

  const sessions = today.loggedWorkouts ?? [];
  const hasSessions = sessions.length > 0;
  // Pre-launch countdown: when the API tells us today is before the first
  // scheduled session, take over the page with a dedicated countdown card so
  // the user has clear orientation during the gap. We hide both the plan card
  // (which would otherwise show a Mon rest day at the start of week 1) and
  // the generic "Rest Day" empty state in this window.
  const showCountdown =
    typeof today.daysUntilStart === "number" && today.daysUntilStart > 0 && !!today.firstSession;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-black uppercase tracking-tight text-primary">Today's Mission</h2>
          <p className="text-muted-foreground uppercase font-medium tracking-widest">{today.date}</p>
        </div>
      </div>

      {showCountdown && today.firstSession ? (
        <Card
          className="border-primary/40 bg-primary/5"
          data-testid="card-campaign-countdown"
        >
          <CardHeader className="border-b border-border pb-4">
            <CardTitle className="text-lg uppercase tracking-wider text-primary flex items-center gap-2">
              <Rocket className="h-5 w-5" />
              Pre-Launch
            </CardTitle>
          </CardHeader>
          <CardContent className="p-8 text-center space-y-6">
            <div>
              <p className="text-sm text-muted-foreground uppercase font-bold tracking-widest mb-2">
                Campaign Starts In
              </p>
              <p
                className="text-6xl font-black text-primary leading-none"
                data-testid="text-countdown-days"
              >
                {today.daysUntilStart}
              </p>
              <p className="text-sm text-muted-foreground uppercase font-bold tracking-widest mt-2">
                {today.daysUntilStart === 1 ? "Day" : "Days"}
              </p>
            </div>
            <div className="bg-background border border-border rounded-md p-6 text-left max-w-xl mx-auto">
              <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider mb-2">
                First Scheduled Session
              </p>
              <p className="text-lg font-black uppercase tracking-tight" data-testid="text-first-session-date">
                {format(parseISO(today.firstSession.date), "EEE MMM d")} —{" "}
                <span className="text-primary">{today.firstSession.sessionType}</span>
              </p>
              {today.firstSession.description && (
                <p className="text-sm text-muted-foreground mt-2">{today.firstSession.description}</p>
              )}
              {/* Slim collapsed view (Task #133): just the one headline
                  number for the first session. Equipment chips, the
                  planned minute breakdown, and the strength / total load
                  tiles all live behind "Show details" below. */}
              <div className="mt-4">
                <PrimaryMetricDisplay
                  metric={getPrimaryMetric(today.firstSession)}
                  variant="prominent"
                  testIdPrefix="first-session"
                />
              </div>
              <div className="mt-4">
                <SessionDetailDisclosure testId="toggle-first-session-detail">
                  <div className="space-y-4">
                    <div className="flex flex-wrap gap-2">
                      {(today.firstSession.equipmentList ?? [today.firstSession.equipment]).map((eq, idx) => {
                        const date = today.firstSession!.date;
                        return (
                          <span
                            key={`first-eq-${idx}`}
                            className="text-[10px] bg-secondary text-secondary-foreground px-2 py-1 rounded font-bold uppercase tracking-wider"
                            data-testid={`chip-equipment-${date}-${idx}`}
                          >
                            {eq}
                          </span>
                        );
                      })}
                    </div>
                    <PlannedBreakdown
                      totalMin={today.firstSession.totalMin}
                      strengthMin={today.firstSession.strengthMin}
                      cardioMin={today.firstSession.cardioMin}
                      runMin={today.firstSession.runMin}
                      runDistanceMi={today.firstSession.distanceMi}
                      variant="prominent"
                      testIdPrefix="first-session"
                    />
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                      {today.firstSession.distanceMi != null && today.firstSession.distanceMi > 0 && (
                        <div>
                          <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Distance</p>
                          <p className="text-base font-black">{formatDistance(today.firstSession.distanceMi)}</p>
                        </div>
                      )}
                      {today.firstSession.strengthLoad != null && today.firstSession.strengthLoad > 0 && (
                        <div>
                          <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Strength Load</p>
                          <p className="text-base font-black">{today.firstSession.strengthLoad}</p>
                        </div>
                      )}
                      {today.firstSession.totalLoad > 0 && (
                        <div>
                          <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Total Load</p>
                          <p className="text-base font-black">{formatLoad(today.firstSession.totalLoad)}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </SessionDetailDisclosure>
              </div>
            </div>
            <p className="text-sm text-muted-foreground italic">
              Use this window to dial in nutrition, sleep, and gear. The grind starts soon.
            </p>
          </CardContent>
        </Card>
      ) : !today.hasPlan ? (
        <Card className="border-dashed border-2 bg-muted/50">
          <CardContent className="p-12 text-center text-muted-foreground">
            <Activity className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <h3 className="text-xl font-bold uppercase tracking-wider mb-2">Rest Day</h3>
            <p>Recover and rebuild. No planned session today.</p>
          </CardContent>
        </Card>
      ) : null}

      <QuickLogActivity testIdSuffix="today" />

      {today.hasPlan && !showCountdown && (
        <div className="grid gap-6">
          <Card className="border-primary/20 bg-primary/5">
            <CardHeader>
              <CardTitle className="text-lg uppercase tracking-wider text-primary">Mission Brief</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="bg-background p-6 rounded-md border border-border">
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
                  <div className="space-y-4 flex-1">
                    {/* Slim collapsed view (Task #133): title + the one
                        headline number. Equipment chips, planned minute
                        breakdown, distance, strength load and total load
                        all live in the "Show details" disclosure below. */}
                    <div className="flex flex-wrap items-baseline gap-3">
                      <span className="font-black text-2xl uppercase tracking-tight">{today.plan?.sessionType}</span>
                    </div>

                    {today.plan?.description && (
                      <p className="text-foreground text-lg leading-relaxed">{today.plan.description}</p>
                    )}

                    <PrimaryMetricDisplay
                      metric={getPrimaryMetric(today.plan)}
                      variant="prominent"
                      testIdPrefix="today-plan"
                    />

                    <SessionDetailDisclosure testId="toggle-today-plan-detail">
                      <div className="space-y-4">
                        {today.plan && (
                          <div className="flex flex-wrap gap-2">
                            {(today.plan.equipmentList ?? [today.plan.equipment]).map((eq, idx) => (
                              <span
                                key={`today-eq-${idx}`}
                                className="px-3 py-1 bg-secondary text-secondary-foreground rounded text-sm uppercase font-bold tracking-wider"
                                data-testid={`chip-equipment-${today.plan!.date}-${idx}`}
                              >
                                {eq}
                              </span>
                            ))}
                          </div>
                        )}
                        {today.plan && (
                          <PlannedBreakdown
                            totalMin={today.plan.totalMin}
                            strengthMin={today.plan.strengthMin}
                            cardioMin={today.plan.cardioMin}
                            runMin={today.plan.runMin}
                            runDistanceMi={today.plan.distanceMi}
                            variant="prominent"
                            testIdPrefix="today-plan"
                          />
                        )}
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                          {today.plan?.distanceMi && (
                            <div>
                              <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Distance</p>
                              <p className="text-xl font-black">{formatDistance(today.plan.distanceMi)}</p>
                            </div>
                          )}
                          {today.plan?.strengthLoad && (
                            <div>
                              <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Strength Load</p>
                              <p className="text-xl font-black">{today.plan.strengthLoad}</p>
                            </div>
                          )}
                          {today.plan?.totalLoad && (
                            <div>
                              <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Total Load</p>
                              <p className="text-xl font-black">{formatLoad(today.plan.totalLoad)}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </SessionDetailDisclosure>
                  </div>

                  <div className="shrink-0 flex flex-col items-stretch justify-center gap-3 border-t md:border-t-0 md:border-l border-border pt-6 md:pt-0 md:pl-6 md:w-56">
                    <Button
                      size="lg"
                      className="h-14 px-6 text-base uppercase font-black tracking-widest group"
                      onClick={() => baseCtx && crushIt({ ...baseCtx, loggedWorkout: null })}
                      disabled={isCrushing}
                      data-testid="button-crush-today"
                    >
                      <Zap className="mr-2 h-5 w-5 group-hover:scale-110 transition-transform" />
                      {hasSessions ? "Crushed Another" : "Crushed It"}
                    </Button>
                    <Button
                      variant="secondary"
                      className="uppercase font-bold tracking-wider"
                      onClick={() => baseCtx && openLog({ ...baseCtx, loggedWorkout: null })}
                      disabled={isCrushing}
                      data-testid="button-log-today"
                    >
                      <Pencil className="mr-2 h-4 w-4" />
                      {hasSessions ? "Log Another" : "Log Mission"}
                    </Button>
                    {!hasSessions && (
                      <Button
                        variant="outline"
                        className="uppercase font-bold tracking-wider text-destructive hover:text-destructive border-destructive/40"
                        onClick={() => baseCtx && requestSkip({ ...baseCtx, loggedWorkout: null })}
                        disabled={isCrushing}
                        data-testid="button-skip-today"
                      >
                        <XCircle className="mr-2 h-4 w-4" />
                        Skipped
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {sessions.map((session) => (
            <Card key={session.id} className="border-border" data-testid={`session-today-${session.id}`}>
              <CardHeader className="bg-muted/30 border-b border-border pb-4 flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-lg uppercase tracking-wider flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-primary" />
                  Mission Accomplished
                  <TimeOfDayBadge
                    value={session.timeOfDay}
                    className="ml-2"
                    testId={`badge-time-of-day-today-${session.id}`}
                  />
                  <span className="text-xs font-mono normal-case tracking-normal text-muted-foreground ml-2">
                    {session.sessionType}
                  </span>
                </CardTitle>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => baseCtx && openEdit({ ...baseCtx, loggedWorkout: session })}
                    data-testid={`button-edit-today-${session.id}`}
                  >
                    <Edit className="h-4 w-4 mr-2" /> Edit
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => baseCtx && requestDelete({ ...baseCtx, loggedWorkout: session })}
                    disabled={isDeleting}
                    data-testid={`button-delete-today-${session.id}`}
                  >
                    <Trash2 className="h-4 w-4 mr-2" /> Delete
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-6 space-y-4">
                {/* Slim collapsed view (Task #133): show only the one
                    headline actual-vs-planned number. The full per-bucket
                    ActualBreakdown, distance, pace, RPE, avg HR, load,
                    equipment chips and notes all live in the disclosure
                    below so the card stays scannable. */}
                <PrimaryMetricDisplay
                  metric={getPrimaryMetricCompare(session, today.plan)}
                  variant="prominent"
                  testIdPrefix={`session-today-${session.id}`}
                />
                <SessionDetailDisclosure
                  testId={`toggle-today-session-detail-${session.id}`}
                >
                  <div className="space-y-6">
                    <span
                      className="flex flex-wrap gap-1"
                      data-testid={`chip-rail-actual-${session.id}`}
                    >
                      {(session.equipmentList ?? [session.equipment]).map((eq, idx) => (
                        <span
                          key={`actual-eq-${session.id}-${idx}`}
                          className="text-[10px] bg-secondary text-secondary-foreground px-2 py-0.5 rounded font-bold uppercase tracking-wider"
                          data-testid={`chip-equipment-actual-${session.id}-${idx}`}
                        >
                          {eq}
                        </span>
                      ))}
                    </span>
                    <ActualBreakdown
                      totalMin={session.totalMin}
                      strengthMin={session.strengthMin}
                      cardioMin={session.cardioMin}
                      runMin={session.runMin}
                      durationMin={session.durationMin}
                      plannedTotalMin={today.plan?.totalMin}
                      plannedStrengthMin={today.plan?.strengthMin}
                      plannedCardioMin={today.plan?.cardioMin}
                      plannedRunMin={today.plan?.runMin}
                      variant="prominent"
                      testIdPrefix={`session-today-${session.id}`}
                    />
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
                      {session.distanceMi != null && (
                        <div>
                          <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Distance</p>
                          <p className="text-xl font-black">{formatDistance(session.distanceMi)}</p>
                        </div>
                      )}
                      {session.pace && (
                        <div>
                          <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Pace</p>
                          <p className="text-xl font-black">{session.pace}/mi</p>
                        </div>
                      )}
                      {session.rpe != null && (
                        <div>
                          <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">RPE</p>
                          <p className="text-xl font-black">{session.rpe}/10</p>
                        </div>
                      )}
                      {session.avgHr != null && (
                        <div>
                          <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Avg HR</p>
                          <p className="text-xl font-black">{session.avgHr} bpm</p>
                        </div>
                      )}
                      {session.totalLoad != null && (
                        <div>
                          <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Total Load</p>
                          <p className="text-xl font-black">{formatLoad(session.totalLoad)}</p>
                        </div>
                      )}
                    </div>
                    {session.notes && (
                      <div className="pt-4 border-t border-border">
                        <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider mb-2">Notes</p>
                        <p className="text-sm">{session.notes}</p>
                      </div>
                    )}
                  </div>
                </SessionDetailDisclosure>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {dialogs}
    </div>
  );
}
