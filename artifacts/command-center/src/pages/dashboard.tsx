import { useGetDashboardBootstrap } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Legend, AreaChart, Area, Cell, ReferenceLine, ReferenceDot
} from "recharts";
import type { TooltipProps } from "recharts";
import { formatDistance, formatLoad, formatWeight, formatDate, formatDuration } from "@/lib/format";
import { PrimaryMetricDisplay } from "@/components/primary-metric-display";
import { SessionDetailDisclosure } from "@/components/session-detail-disclosure";
import { EquipmentChipRail } from "@/components/equipment-chip-rail";
import { PlannedBreakdown } from "@/components/planned-breakdown";
import { ActualBreakdown } from "@/components/actual-breakdown";
import {
  getPrimaryMetric,
  getPrimaryMetricCompare,
} from "@/lib/primary-metric";
import { format } from "date-fns";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Activity, CalendarDays, CheckCircle2, TrendingDown, TrendingUp, ArrowRight, Target, Zap, Edit, Trash2, ExternalLink, Pencil, XCircle } from "lucide-react";
import { useMissionActions } from "@/hooks/use-mission-actions";
import { QuickLogActivity } from "@/components/quick-log-activity";
import { RunTargetLine } from "@/components/run-target-line";
import { RaceWeekBanner, ChecklistNudge } from "@/components/race-week-banner";
import { TimeOfDayBadge } from "@/components/time-of-day-badge";
import { phaseColor } from "@/lib/phase-colors";
import { programColor } from "@/lib/program-colors";
import { EmptyPlanState } from "@/components/empty-plan-state";
import { NextScheduledRaceChip } from "@/components/next-scheduled-race-chip";
import { useFirstRunRedirect } from "@/hooks/use-first-run-redirect";
import { useListPlannerConfigs } from "@workspace/api-client-react";

type MileageTooltipRow = {
  phase?: string;
  dominantCardioEquipment?: string | null;
  plannedMiles?: number;
  plannedCardioMin?: number;
  wedSteady?: boolean | null;
  programs?: Array<{
    sourceEntryIndex: number;
    label: string;
    plannedMiles: number;
    plannedCardioMin: number;
  }>;
};

export function MileageTooltipContent({
  active,
  payload,
  label,
}: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as MileageTooltipRow | undefined;
  const base = row?.phase ? `Week ${label} · ${row.phase}` : `Week ${label}`;
  const cardioOnly =
    (row?.plannedMiles ?? 0) === 0 && (row?.plannedCardioMin ?? 0) > 0;
  const heading = cardioOnly && row?.dominantCardioEquipment
    ? `${base} · ${row.dominantCardioEquipment}`
    : base;
  // Task #144: render per-program planned breakdown when 2+ programs
  // contribute to this week. The existing Planned/Actual rows still show
  // the combined headline values; the breakdown clarifies which program
  // drove the combined number.
  const programs = row?.programs ?? [];
  const showPrograms = programs.length > 1;
  return (
    <div
      className="rounded border bg-card text-card-foreground text-xs shadow-md p-2 space-y-1"
      style={{ borderColor: "hsl(var(--border))" }}
      data-testid="mileage-tooltip"
    >
      <div className="font-bold uppercase tracking-wider">{heading}</div>
      {payload.map((entry, idx) => {
        const value = Number(entry.value ?? 0);
        const isCardio =
          entry.name === "Planned cardio" || entry.name === "Actual cardio";
        return (
          <div key={`tt-${idx}`} className="flex items-center gap-2">
            <span
              className="h-2 w-2 rounded-sm"
              style={{ backgroundColor: entry.color }}
              aria-hidden
            />
            <span className="text-muted-foreground">{entry.name}</span>
            <span className="ml-auto font-mono">
              {isCardio
                ? `${value.toFixed(0)} min`
                : `${value.toFixed(1)} mi`}
            </span>
          </div>
        );
      })}
      {showPrograms && (
        <div
          className="border-t pt-1 mt-1 space-y-0.5"
          style={{ borderColor: "hsl(var(--border))" }}
          data-testid="mileage-tooltip-programs"
        >
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
            Per Program
          </div>
          {programs.map((p) => (
            <div
              key={`tt-prog-${p.sourceEntryIndex}`}
              className="flex items-center gap-2"
              data-testid={`mileage-tooltip-program-${p.sourceEntryIndex}`}
            >
              <span
                className="h-2 w-2 rounded-sm shrink-0"
                style={{ backgroundColor: programColor(p.sourceEntryIndex) }}
                aria-hidden
              />
              <span className="text-muted-foreground">{p.label}</span>
              <span className="ml-auto font-mono">
                {p.plannedMiles.toFixed(1)} mi
                {p.plannedCardioMin > 0 && (
                  <> · {p.plannedCardioMin.toFixed(0)} min</>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
      {/* Task #187: amber-400 "Steady Wed (Z3)" callout that mirrors the
          legend swatch so a runner hovering a marked week can confirm the
          Z3 stimulus without scanning back to the legend. Omitted on
          non-steady weeks to keep the tooltip compact. */}
      {row?.wedSteady === true && (
        <div
          className="flex items-center gap-1.5"
          data-testid="mileage-tooltip-steady"
        >
          <span
            className="h-2 w-2 rounded-full bg-amber-400"
            aria-hidden
          />
          <span className="text-muted-foreground">Steady Wed (Z3)</span>
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  // Task #383. Single consolidated bootstrap call for the dashboard's
  // first paint. The 8 per-tile endpoints stay intact (mutations and
  // other pages still invalidate / re-fetch individual slices), but the
  // cold load that used to fire 8 parallel HTTP round-trips now pays
  // exactly one. Per-tile `isLoading` flags collapse to the shared
  // `loadingBootstrap` because every slice lands in the same response.
  const { data: bootstrap, isLoading: loadingBootstrap } =
    useGetDashboardBootstrap();
  const summary = bootstrap?.summary;
  const weightTrend = bootstrap?.weightTrend;
  const mileage = bootstrap?.weeklyMileage;
  const equipment = bootstrap?.equipmentUsage;
  const longRun = bootstrap?.longRunProgression;
  const activity = bootstrap?.recentActivity;
  const today = bootstrap?.today;
  const overview = bootstrap?.overview;
  const loadingSummary = loadingBootstrap;
  const loadingWeight = loadingBootstrap;
  const loadingMileage = loadingBootstrap;
  const loadingEq = loadingBootstrap;
  const loadingLongRun = loadingBootstrap;
  const loadingActivity = loadingBootstrap;
  const loadingToday = loadingBootstrap;
  const { openLog, openEdit, requestDelete, requestSkip, crushIt, isDeleting, isCrushing, dialogs } =
    useMissionActions();
  const todayBaseCtx = today
    ? { date: today.date, plan: today.plan, suggestions: today.suggestions }
    : null;
  const todaySessions = today?.loggedWorkouts ?? [];
  const hasTodaySessions = todaySessions.length > 0;

  // Task #308: when no plan has ever been applied AND the runner has
  // no saved planner drafts, jump them straight into the Phase Planner
  // on first session load instead of dropping them on an empty
  // dashboard. Both upstream queries must succeed before we redirect
  // (an error here just leaves the runner on the dashboard).
  const plannerConfigsQuery = useListPlannerConfigs();
  useFirstRunRedirect({
    hasPlan: summary?.hasPlan ?? false,
    hasDrafts: (plannerConfigsQuery.data?.configs?.length ?? 0) > 0,
    ready:
      summary !== undefined &&
      plannerConfigsQuery.data !== undefined &&
      !plannerConfigsQuery.isError,
  });

  if (loadingSummary) return <DashboardSkeleton />;

  if (!summary) return <div>Failed to load dashboard</div>;

  // Task #209: per-kind race-campaign framing for the dashboard header
  // — same labels /plan uses (Task #204) so the two surfaces stay in
  // lock-step. `summary.raceKind` is null on tonal-first / non-race
  // campaigns (lift_primary blocks, ad-hoc Custom blocks) so the
  // header collapses to no campaign title in those cases instead of
  // presupposing a marathon. Marathon plans intentionally collapse to
  // plain "Race Campaign" so the long-running flagship copy stays
  // unchanged after this task.
  const raceKind = summary.raceKind ?? null;
  // Task #244: header title is driven by the active planner config's
  // `name` so the dashboard reads the same label as the sidebar nav
  // and /plan header instead of a hardcoded per-raceKind label. The
  // countdown subtitle is still gated on `raceKind` so non-race plans
  // (lift_primary blocks, ad-hoc Custom blocks) don't presuppose a
  // race day.
  const headerTitle = summary.activeConfigName?.trim() || "Workout Plan";

  // Task #307: when no Phase Planner config has ever been applied, hide
  // every plan-driven tile (This Week, Days to Race, Total Volume,
  // Today, Week Snapshot, Mileage chart, Long Run Build) and
  // surface the shared "Open Phase Planner" CTA. Body Mass / Body trend
  // / Recent Logs / Equipment stay visible because they remain
  // useful even before a plan exists.
  if (!summary.hasPlan) {
    return (
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div data-testid="dashboard-header" className="flex flex-col gap-2">
          <h2
            className="text-3xl font-black uppercase tracking-tight text-primary"
            data-testid="dashboard-header-title"
            data-race-kind=""
          >
            {headerTitle}
          </h2>
          <p
            className="text-muted-foreground uppercase font-medium tracking-widest text-sm"
            data-testid="dashboard-header-subtitle"
          >
            No plan applied yet
          </p>
        </div>
        <EmptyPlanState testId="dashboard-empty-plan" />
        <div
          className="grid grid-cols-1 md:grid-cols-2 gap-4"
          data-testid="dashboard-empty-stats"
        >
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between space-x-2">
                <div>
                  <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                    Body Mass
                  </p>
                  <div className="text-3xl font-black mt-1">
                    {formatWeight(summary.weightCurrent)}
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    Goal: {summary.weightGoal ?? "—"} |{" "}
                    <span className="text-primary font-semibold">
                      -{summary.weightLost.toFixed(1)} lbs
                    </span>
                  </p>
                </div>
                <TrendingDown className="h-8 w-8 text-muted-foreground opacity-50" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between space-x-2">
                <div>
                  <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                    Total Volume
                  </p>
                  <div className="text-3xl font-black mt-1">
                    {formatDistance(summary.totalMilesAllTime)}
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    Logged across all sessions
                  </p>
                </div>
                <Activity className="h-8 w-8 text-muted-foreground opacity-50" />
              </div>
            </CardContent>
          </Card>
        </div>
        <Card data-testid="dashboard-empty-recent-activity">
          <CardHeader>
            <CardTitle className="text-lg uppercase tracking-wider">Recent Logs</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingActivity ? (
              <Skeleton className="h-64" />
            ) : !activity || activity.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No workouts logged yet. Apply a plan to start tracking your sessions, or log
                ad-hoc activities from the Workouts page.
              </p>
            ) : (
              <div className="space-y-4">
                {activity.slice(0, 5).map((act) => (
                  <div key={act.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-xs font-bold shrink-0">
                        {act.equipment.substring(0, 1)}
                      </div>
                      <div className="w-px h-full bg-border my-1"></div>
                    </div>
                    <div className="pb-4">
                      <div className="text-xs text-muted-foreground">{formatDate(act.date)}</div>
                      <div className="font-bold text-sm">{act.sessionType}</div>
                      <div className="text-xs flex gap-2 mt-1">
                        {act.distanceMi ? <span>{formatDistance(act.distanceMi)}</span> : null}
                        {act.durationMin ? <span>{formatDuration(act.durationMin)}</span> : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">

      <div data-testid="dashboard-header" className="flex flex-col gap-2">
        {overview?.nextScheduledRace && (
          <NextScheduledRaceChip
            race={overview.nextScheduledRace}
            testId="dashboard-chip-next-scheduled-race"
          />
        )}
        <h2
          className="text-3xl font-black uppercase tracking-tight text-primary"
          data-testid="dashboard-header-title"
          data-race-kind={raceKind ?? ""}
        >
          {headerTitle}
        </h2>
        {raceKind !== null ? (
          <div className="flex flex-wrap items-center gap-3">
            <p
              className="text-muted-foreground uppercase font-medium tracking-widest text-sm"
              data-testid="dashboard-header-subtitle"
            >
              {summary.daysToRace} Days to Race Day
            </p>
            <ChecklistNudge testId="dashboard-checklist-reminder" />
          </div>
        ) : (
          <ChecklistNudge testId="dashboard-checklist-reminder" />
        )}
      </div>

      <RaceWeekBanner raceKind={raceKind} />

      {/* Top Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card
          className="bg-card border-l-4"
          style={{ borderLeftColor: phaseColor(summary.currentPhase) }}
        >
          <CardContent className="p-6">
            <div className="flex items-center justify-between space-x-2">
              <div>
                <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">This Week</p>
                <div className="text-3xl font-black mt-1">Week {summary.currentWeek}</div>
                <p
                  className="text-sm font-semibold uppercase mt-1 flex items-center gap-2"
                  data-testid="dashboard-current-phase"
                >
                  <span
                    className="h-2.5 w-2.5 rounded-sm shrink-0"
                    style={{ backgroundColor: phaseColor(summary.currentPhase) }}
                    aria-hidden
                  />
                  <span style={{ color: phaseColor(summary.currentPhase) }}>
                    {summary.currentPhase}
                  </span>
                </p>
              </div>
              <CalendarDays className="h-8 w-8 text-muted-foreground opacity-50" />
            </div>
          </CardContent>
        </Card>

        {/* Phase 1: race countdown is gated on an actual race campaign.
            `raceKind` is null in workout-planner / recomp mode (no pinned
            race day), so this "Days to Race" tile only renders when a race
            is scheduled. Phase 4 will add a recomp metric in its place. */}
        {raceKind !== null && (
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between space-x-2">
                <div>
                  <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Days to Race</p>
                  <div className="text-3xl font-black mt-1">{summary.daysToRace}</div>
                  <p className="text-sm text-muted-foreground mt-1">Adherence: <span className="text-foreground font-semibold">{summary.adherencePct.toFixed(0)}%</span></p>
                </div>
                <Target className="h-8 w-8 text-muted-foreground opacity-50" />
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between space-x-2">
              <div>
                <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Body Mass</p>
                <div className="text-3xl font-black mt-1">{formatWeight(summary.weightCurrent)}</div>
                <p className="text-sm text-muted-foreground mt-1">
                  Goal: {summary.weightGoal ?? "—"} | <span className="text-primary font-semibold">-{summary.weightLost.toFixed(1)} lbs</span>
                </p>
              </div>
              <TrendingDown className="h-8 w-8 text-muted-foreground opacity-50" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between space-x-2">
              <div>
                <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Total Volume</p>
                <div className="text-3xl font-black mt-1">{formatDistance(summary.totalMilesAllTime)}</div>
                <p className="text-sm text-muted-foreground mt-1">Max Long Run: <span className="text-foreground font-semibold">{formatDistance(summary.longestRunMi)}</span></p>
              </div>
              <Activity className="h-8 w-8 text-muted-foreground opacity-50" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Main Content Column */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Today */}
          <Card className="border-primary/20 bg-primary/5">
            <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-lg uppercase tracking-wider text-primary">Today</CardTitle>
              <Link href="/today">
                <Button variant="ghost" size="sm" className="text-xs uppercase tracking-wider text-muted-foreground hover:text-primary">
                  Open Today <ExternalLink className="ml-1 h-3 w-3" />
                </Button>
              </Link>
            </CardHeader>
            <CardContent>
              {loadingToday ? <Skeleton className="h-16" /> : (
                today?.hasPlan ? (
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-background p-4 rounded-md border border-border">
                    <div className="flex-1 min-w-0">
                      {/* Slim collapsed view (Task #133): title + the
                          one headline number for the planned session.
                          Equipment chip and distance/cardio/load tiles
                          drop off the surface — open Today for full
                          detail. */}
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-bold text-lg">{today.plan?.sessionType}</span>
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-2">{today.plan?.description}</p>
                      <div className="mt-3">
                        <PrimaryMetricDisplay
                          metric={getPrimaryMetric(today.plan)}
                          variant="compact"
                          testIdPrefix="dashboard-today-plan"
                        />
                      </div>

                      {today.plan && (
                        <div className="mt-3">
                          <SessionDetailDisclosure testId="toggle-dashboard-today-plan-detail">
                            <div className="space-y-3">
                              <EquipmentChipRail
                                equipmentList={today.plan.equipmentList}
                                equipment={today.plan.equipment}
                                chipTestIdPrefix={`chip-equipment-dashboard-${today.plan.date}`}
                                keyPrefix="dash-eq"
                              />
                              <PlannedBreakdown
                                totalMin={today.plan.totalMin}
                                strengthMin={today.plan.strengthMin}
                                cardioMin={today.plan.cardioMin}
                                runMin={today.plan.runMin}
                                runDistanceMi={today.plan.distanceMi}
                                variant="compact"
                                testIdPrefix="dashboard-today-plan"
                              />
                              <div className="grid grid-cols-3 gap-3">
                                {today.plan.distanceMi != null && (
                                  <div>
                                    <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Distance</p>
                                    <p className="text-sm font-black">{formatDistance(today.plan.distanceMi)}</p>
                                  </div>
                                )}
                                {today.plan.strengthLoad && (
                                  <div>
                                    <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Strength Load</p>
                                    <p className="text-sm font-black">{today.plan.strengthLoad}</p>
                                  </div>
                                )}
                                {today.plan.totalLoad != null && (
                                  <div>
                                    <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Total Load</p>
                                    <p className="text-sm font-black">{formatLoad(today.plan.totalLoad)}</p>
                                  </div>
                                )}
                              </div>
                            </div>
                          </SessionDetailDisclosure>
                        </div>
                      )}

                      {hasTodaySessions && (
                        <div className="mt-3 pt-3 border-t border-border space-y-2">
                          <div className="text-xs uppercase tracking-wider text-muted-foreground font-bold">
                            {todaySessions.length > 1 ? `${todaySessions.length} Sessions Logged` : "Logged"}
                          </div>
                          {todaySessions.map((session) => (
                            <div
                              key={session.id}
                              className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 bg-background border border-border rounded px-3 py-2"
                              data-testid={`session-dashboard-${session.id}`}
                            >
                              {/* Slim collapsed row (Task #133): title +
                                  one headline number (actual vs
                                  planned). Pace, RPE, raw duration etc.
                                  are hidden — the full detail lives on
                                  the Today page. */}
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm flex-1 min-w-0">
                                <TimeOfDayBadge
                                  value={session.timeOfDay}
                                  testId={`badge-time-of-day-dashboard-${session.id}`}
                                />
                                <span className="text-xs uppercase font-bold tracking-wider text-muted-foreground">
                                  {session.sessionType}
                                </span>
                                <PrimaryMetricDisplay
                                  metric={getPrimaryMetricCompare(session, today.plan)}
                                  variant="compact"
                                  testIdPrefix={`session-dashboard-${session.id}`}
                                  className="ml-auto"
                                />
                              </div>
                              <div className="flex gap-2 shrink-0">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => todayBaseCtx && openEdit({ ...todayBaseCtx, loggedWorkout: session })}
                                  data-testid={`button-edit-dashboard-${session.id}`}
                                >
                                  <Edit className="h-3 w-3 mr-1" /> Edit
                                </Button>
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  onClick={() => todayBaseCtx && requestDelete({ ...todayBaseCtx, loggedWorkout: session })}
                                  disabled={isDeleting}
                                  data-testid={`button-delete-dashboard-${session.id}`}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </div>
                              <div className="basis-full">
                                <SessionDetailDisclosure
                                  testId={`toggle-dashboard-session-detail-${session.id}`}
                                >
                                  <div className="space-y-3">
                                    <EquipmentChipRail
                                      equipmentList={session.equipmentList}
                                      equipment={session.equipment}
                                      chipTestIdPrefix={`chip-equipment-actual-dashboard-${session.id}`}
                                      railTestId={`chip-rail-actual-dashboard-${session.id}`}
                                      keyPrefix={`dash-actual-eq-${session.id}`}
                                    />
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
                                      variant="compact"
                                      testIdPrefix={`session-dashboard-${session.id}`}
                                    />
                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                      {session.distanceMi != null && (
                                        <div>
                                          <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Distance</p>
                                          <p className="text-sm font-black">{formatDistance(session.distanceMi)}</p>
                                        </div>
                                      )}
                                      {session.pace && (
                                        <div>
                                          <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Pace</p>
                                          <p className="text-sm font-black">{session.pace}/mi</p>
                                        </div>
                                      )}
                                      {session.rpe != null && (
                                        <div>
                                          <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">RPE</p>
                                          <p className="text-sm font-black">{session.rpe}/10</p>
                                        </div>
                                      )}
                                      {session.totalLoad != null && (
                                        <div>
                                          <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Total Load</p>
                                          <p className="text-sm font-black">{formatLoad(session.totalLoad)}</p>
                                        </div>
                                      )}
                                    </div>
                                    {session.notes && (
                                      <div className="pt-2 border-t border-border">
                                        <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider mb-1">Notes</p>
                                        <p className="text-sm">{session.notes}</p>
                                      </div>
                                    )}
                                  </div>
                                </SessionDetailDisclosure>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="shrink-0 flex flex-col items-stretch md:items-end gap-2">
                      {hasTodaySessions && (
                        <div className="flex items-center gap-2 text-primary font-bold bg-primary/10 px-4 py-2 rounded-md justify-center">
                          <CheckCircle2 className="h-5 w-5" />
                          Done
                        </div>
                      )}
                      <div className="flex flex-col gap-2 w-full md:w-44">
                        <Button
                          className="uppercase font-black tracking-wider"
                          onClick={() => todayBaseCtx && crushIt({ ...todayBaseCtx, loggedWorkout: null })}
                          disabled={isCrushing}
                          data-testid="button-crush-dashboard"
                        >
                          <Zap className="mr-2 h-4 w-4" />
                          {hasTodaySessions ? "Done again" : "Done"}
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          className="uppercase font-bold tracking-wider"
                          onClick={() => todayBaseCtx && openLog({ ...todayBaseCtx, loggedWorkout: null })}
                          disabled={isCrushing}
                          data-testid="button-log-dashboard"
                        >
                          <Pencil className="mr-2 h-3.5 w-3.5" />
                          {hasTodaySessions ? "Log Another" : "Log session"}
                        </Button>
                        {!hasTodaySessions && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="uppercase font-bold tracking-wider text-destructive hover:text-destructive border-destructive/40"
                            onClick={() => todayBaseCtx && requestSkip({ ...todayBaseCtx, loggedWorkout: null })}
                            disabled={isCrushing}
                            data-testid="button-skip-dashboard"
                          >
                            <XCircle className="mr-2 h-3.5 w-3.5" />
                            Skipped
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-muted-foreground italic bg-background p-4 rounded-md border border-border">
                    Rest day. Recover and rebuild.
                  </div>
                )
              )}
            </CardContent>
          </Card>
          {dialogs}

          {/* Current Week Progress */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg uppercase tracking-wider">Week {summary.currentWeek} Snapshot</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <div className="flex justify-between text-sm font-bold uppercase">
                  <span>Mileage</span>
                  <span>{formatDistance(summary.weeklyMilesActual)} / {formatDistance(summary.weeklyMilesPlanned)}</span>
                </div>
                <Progress value={(summary.weeklyMilesActual / Math.max(summary.weeklyMilesPlanned, 1)) * 100} className="h-3" />
              </div>
              <div className="space-y-2">
                <div className="flex justify-between text-sm font-bold uppercase">
                  <span>Training Load</span>
                  <span>{formatLoad(summary.weeklyLoadActual)} / {formatLoad(summary.weeklyLoadPlanned)}</span>
                </div>
                <Progress value={(summary.weeklyLoadActual / Math.max(summary.weeklyLoadPlanned, 1)) * 100} className="h-3" />
              </div>
              <div className="space-y-2">
                <div className="flex justify-between text-sm font-bold uppercase">
                  <span>Sessions Completed</span>
                  <span>{summary.weeklySessionsCompleted} / {summary.weeklySessionsPlanned}</span>
                </div>
                <Progress value={(summary.weeklySessionsCompleted / Math.max(summary.weeklySessionsPlanned, 1)) * 100} className="h-3" />
              </div>

              {/* Task #144: per-program breakdown of the combined headline
                  numbers above. Only renders when 2+ programs are stacked
                  (entries-mode multi-program campaigns); legacy single-
                  program campaigns just see the combined totals. Each
                  row shows program label + actual/planned per metric and
                  a program-end-date badge when the program ends before
                  the campaign marathon date. */}
              {summary.programs.length > 1 && (
                <div
                  className="border-t border-border pt-4 space-y-3"
                  data-testid="snapshot-programs-breakdown"
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <div className="text-xs uppercase tracking-wider font-bold text-muted-foreground">
                      Per Program
                    </div>
                    <div
                      className="flex flex-wrap items-center gap-x-3 gap-y-1"
                      data-testid="dashboard-program-legend"
                    >
                      {summary.programs.map((p) => (
                        <div
                          key={`legend-${p.sourceEntryIndex}`}
                          className="flex items-center gap-1.5"
                          data-testid={`dashboard-program-legend-${p.sourceEntryIndex}`}
                        >
                          <span
                            className="h-2.5 w-2.5 rounded-sm shrink-0"
                            style={{
                              backgroundColor: programColor(p.sourceEntryIndex),
                            }}
                            aria-hidden
                          />
                          <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">
                            {p.label}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                  {summary.programs.map((p) => {
                    const programEndsEarly =
                      p.endDate < new Date(new Date().getTime() + summary.daysToRace * 24 * 3600 * 1000).toISOString().slice(0, 10);
                    // Task #159: per-program "Race in N days" countdown so a
                    // runner with overlapping blocks can see at a glance how
                    // imminent each program's race is. Computed from the
                    // program endDate vs today (UTC, matching daysToRace).
                    const todayMs = new Date(new Date().toISOString().slice(0, 10)).getTime();
                    const endMs = new Date(p.endDate).getTime();
                    const programDaysToRace = Math.max(
                      0,
                      Math.ceil((endMs - todayMs) / (24 * 3600 * 1000)),
                    );
                    return (
                      <div
                        key={`snapshot-program-${p.sourceEntryIndex}`}
                        className="rounded border border-border bg-muted/30 p-3 space-y-2 border-l-4"
                        style={{ borderLeftColor: programColor(p.sourceEntryIndex) }}
                        data-testid={`snapshot-program-${p.sourceEntryIndex}`}
                      >
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className="font-bold text-sm uppercase tracking-wider">
                            {p.label}
                          </span>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span
                              className="text-[10px] font-bold uppercase tracking-wider text-primary bg-background px-2 py-0.5 rounded"
                              data-testid={`snapshot-program-race-in-${p.sourceEntryIndex}`}
                            >
                              Race in {programDaysToRace} {programDaysToRace === 1 ? "day" : "days"}
                            </span>
                            {programEndsEarly && (
                              <span
                                className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground bg-background px-2 py-0.5 rounded"
                                data-testid={`snapshot-program-end-${p.sourceEntryIndex}`}
                              >
                                Ends {p.endDate}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                          <div>
                            <div className="text-[10px] uppercase font-bold text-muted-foreground">Miles</div>
                            <div className="font-mono">
                              {formatDistance(p.weeklyMilesActual)} / {formatDistance(p.weeklyMilesPlanned)}
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] uppercase font-bold text-muted-foreground">Load</div>
                            <div className="font-mono">
                              {formatLoad(p.weeklyLoadActual)} / {formatLoad(p.weeklyLoadPlanned)}
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] uppercase font-bold text-muted-foreground">Sessions</div>
                            <div className="font-mono">
                              {p.weeklySessionsCompleted} / {p.weeklySessionsPlanned}
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] uppercase font-bold text-muted-foreground">Adherence</div>
                            <div
                              className="font-mono"
                              data-testid={`snapshot-program-adherence-${p.sourceEntryIndex}`}
                            >
                              {p.adherencePct.toFixed(0)}%
                              <span className="text-muted-foreground ml-1">
                                ({p.adherenceCompleted}/{p.adherencePlanned})
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <div
                className="flex items-center justify-between border-t border-border pt-4 text-sm font-bold uppercase text-muted-foreground"
                data-testid="row-lifestyle-minutes"
              >
                <span>Lifestyle Minutes</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-foreground">{formatDuration(summary.weeklyLifestyleMinutes)}</span>
                  {/* Task #34: trend versus the previous 4-week average.
                      Backend returns null when fewer than 4 prior plan_weeks
                      exist, which hides the indicator until there's enough
                      history. A small +/-5 minute deadband keeps tiny
                      week-to-week jitter from flipping the arrow. */}
                  {summary.prevFourWeekAvgLifestyleMinutes != null && (() => {
                    const baseline = summary.prevFourWeekAvgLifestyleMinutes;
                    const diff = summary.weeklyLifestyleMinutes - baseline;
                    const fmt = (n: number) =>
                      `${n > 0 ? "+" : ""}${Math.round(n)}m vs ${Math.round(baseline)}m avg`;
                    if (diff > 5) return (
                      <span className="flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400 text-xs" data-testid="lifestyle-trend-up" title="vs previous 4-week average">
                        <TrendingUp className="h-3 w-3" />{fmt(diff)}
                      </span>
                    );
                    if (diff < -5) return (
                      <span className="flex items-center gap-0.5 text-amber-600 dark:text-amber-400 text-xs" data-testid="lifestyle-trend-down" title="vs previous 4-week average">
                        <TrendingDown className="h-3 w-3" />{fmt(diff)}
                      </span>
                    );
                    return (
                      <span className="flex items-center gap-0.5 text-muted-foreground text-xs" data-testid="lifestyle-trend-flat" title="vs previous 4-week average">
                        <ArrowRight className="h-3 w-3" />~{Math.round(baseline)}m avg
                      </span>
                    );
                  })()}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Weekly Mileage Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg uppercase tracking-wider">Mileage Volume</CardTitle>
            </CardHeader>
            <CardContent>
              {loadingMileage ? <Skeleton className="h-64" /> : (
                <>
                  <PhaseLegend
                    phases={uniquePhases(mileage?.map((m) => m.phase))}
                    showActualSwatch
                  />
                  <p className="text-xs text-muted-foreground mb-2" data-testid="mileage-chart-cardio-note">
                    Bike / row weeks plot cross-train minutes on the right
                    axis so cardio-only weeks aren't zero-height bars.
                  </p>
                  {/* Task #183: amber Z3 markers on the dashboard mileage
                      chart, mirroring BlockSparkline / MileageCurve in the
                      planner. The dot rides the planned-miles bar top of
                      each Steady-Wed week so a runner can see at a glance
                      which weeks earn the Z3 stimulus without opening
                      planner. `wedSteady` comes from
                      `plan_days.session_type` so customizations that swap
                      Wed away from steady drop the marker on the next
                      refetch. */}
                  {/* Task #160: when the campaign stacks 2+ programs we
                      split the planned-miles bar into one stacked
                      segment per program (colored by `programColor`)
                      so a runner can visually trace each program's
                      contribution week by week. The aggregate
                      `plannedMiles` bar is suppressed in that case to
                      avoid double-counting. Single-program campaigns
                      keep the legacy single bar. */}
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={(mileage ?? []).map((row) => {
                          const augmented: Record<string, unknown> = { ...row };
                          for (const p of row.programs ?? []) {
                            augmented[`prog_${p.sourceEntryIndex}_planned`] =
                              p.plannedMiles;
                          }
                          return augmented;
                        })}
                      >
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                        <XAxis dataKey="week" tickFormatter={(v) => `W${v}`} />
                        <YAxis yAxisId="miles" />
                        <YAxis
                          yAxisId="cardio"
                          orientation="right"
                          tickFormatter={(v) => `${v}m`}
                        />
                        <Tooltip
                          contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }}
                          content={MileageTooltipContent}
                        />
                        <Legend />
                        {summary && (
                          <ReferenceLine
                            yAxisId="miles"
                            x={summary.currentWeek}
                            stroke="hsl(var(--primary))"
                            strokeDasharray="4 4"
                            strokeWidth={2}
                            label={{ value: "Now", position: "top", fill: "hsl(var(--primary))", fontSize: 10, fontWeight: 700 }}
                          />
                        )}
                        {/* Task #183: amber Z3 marker per Steady-Wed week,
                            sitting at the top of the planned-miles bar.
                            Recharts ReferenceDot renders inside the chart
                            coordinate space so the dot tracks bar height
                            on cardio-only and tapered weeks alike. We use
                            a custom `shape` so the SVG circle carries a
                            stable data-testid for the per-week marker
                            assertion (Recharts' built-in dot strips
                            arbitrary props). */}
                        {(mileage ?? [])
                          .filter((row) => row.wedSteady === true)
                          .map((row) => (
                            <ReferenceDot
                              key={`steady-${row.week}`}
                              yAxisId="miles"
                              x={row.week}
                              y={Math.max(row.plannedMiles, row.actualMiles)}
                              ifOverflow="extendDomain"
                              isFront
                              shape={(props) => {
                                const { cx, cy } = props as {
                                  cx?: number;
                                  cy?: number;
                                };
                                if (cx == null || cy == null) {
                                  return (
                                    <g
                                      data-testid={`mileage-chart-steady-w${row.week}`}
                                    />
                                  );
                                }
                                return (
                                  <circle
                                    cx={cx}
                                    cy={cy}
                                    r={4}
                                    fill="rgb(251 191 36)"
                                    stroke="hsl(var(--card))"
                                    strokeWidth={1}
                                    data-testid={`mileage-chart-steady-w${row.week}`}
                                  />
                                );
                              }}
                            />
                          ))}
                        {summary.programs.length > 1 ? (
                          summary.programs.map((p, i) => (
                            <Bar
                              key={`prog-bar-${p.sourceEntryIndex}`}
                              yAxisId="miles"
                              dataKey={`prog_${p.sourceEntryIndex}_planned`}
                              name={`Planned · ${p.label}`}
                              stackId="planned"
                              fill={programColor(p.sourceEntryIndex)}
                              opacity={0.55}
                              radius={
                                i === summary.programs.length - 1
                                  ? [2, 2, 0, 0]
                                  : [0, 0, 0, 0]
                              }
                            />
                          ))
                        ) : (
                          <Bar
                            yAxisId="miles"
                            dataKey="plannedMiles"
                            name="Planned"
                            fill="hsl(var(--muted-foreground))"
                            opacity={0.3}
                            radius={[2, 2, 0, 0]}
                          />
                        )}
                        <Bar yAxisId="miles" dataKey="actualMiles" name="Actual" radius={[2, 2, 0, 0]}>
                          {(mileage ?? []).map((row, i) => (
                            <Cell
                              key={`mileage-${row.week}-${i}`}
                              fill={row.phase ? phaseColor(row.phase) : "hsl(var(--primary))"}
                            />
                          ))}
                        </Bar>
                        <Bar
                          yAxisId="cardio"
                          dataKey="plannedCardioMin"
                          name="Planned cardio"
                          fill="hsl(var(--muted-foreground))"
                          opacity={0.2}
                          radius={[2, 2, 0, 0]}
                        />
                        <Bar
                          yAxisId="cardio"
                          dataKey="actualCardioMin"
                          name="Actual cardio"
                          fill="hsl(var(--chart-2, var(--primary)))"
                          opacity={0.7}
                          radius={[2, 2, 0, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  {/* Task #183: amber-400 "Steady Wed · N wks" legend that
                      mirrors BlockSparkline / MileageCurve in the planner.
                      Only renders when at least one week earns the Z3
                      stimulus, matching the per-block sparkline behavior. */}
                  {(() => {
                    const steadyCount =
                      mileage?.filter((m) => m.wedSteady === true).length ?? 0;
                    if (steadyCount === 0) return null;
                    return (
                      <div
                        className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground mt-2"
                        data-testid="mileage-chart-steady-legend"
                      >
                        <span
                          className="h-2 w-2 rounded-full bg-amber-400"
                          aria-hidden
                        />
                        <span>
                          Steady Wed ·{" "}
                          <span className="font-semibold tabular-nums">
                            {steadyCount}
                          </span>{" "}
                          wk{steadyCount === 1 ? "" : "s"}
                        </span>
                      </div>
                    );
                  })()}
                </>
              )}
            </CardContent>
          </Card>

          {/* Long Run Progression */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg uppercase tracking-wider">Long Run Build</CardTitle>
            </CardHeader>
            <CardContent>
              {loadingLongRun ? <Skeleton className="h-64" /> : (
                <>
                  <PhaseLegend phases={uniquePhases(longRun?.map((p) => p.phase))} />
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={longRun}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                        <XAxis dataKey="week" tickFormatter={(v) => `W${v}`} />
                        <YAxis yAxisId="miles" tickFormatter={(v) => `${v} mi`} />
                        {longRun?.some(
                          (p) =>
                            (p.plannedCardioMin ?? 0) > 0 ||
                            (p.actualCardioMin ?? p.cardioMin ?? 0) > 0,
                        ) && (
                          <YAxis
                            yAxisId="cardio"
                            orientation="right"
                            tickFormatter={(v) => `${v} min`}
                          />
                        )}
                        <Tooltip
                          contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }}
                          labelFormatter={(label, payload) => {
                            const phase = payload?.[0]?.payload?.phase;
                            return phase ? `Week ${label} · ${phase}` : `Week ${label}`;
                          }}
                        />
                        <Legend />
                        {summary && (
                          <ReferenceLine
                            yAxisId="miles"
                            x={summary.currentWeek}
                            stroke="hsl(var(--primary))"
                            strokeDasharray="4 4"
                            strokeWidth={2}
                            label={{ value: "Now", position: "top", fill: "hsl(var(--primary))", fontSize: 10, fontWeight: 700 }}
                          />
                        )}
                        <Line yAxisId="miles" type="stepAfter" dataKey="plannedMi" name="Long run target (mi)" stroke="hsl(var(--muted-foreground))" strokeDasharray="5 5" strokeWidth={2} dot={false} />
                        <Line
                          yAxisId="miles"
                          type="monotone"
                          dataKey="actualMi"
                          name="Long run completed (mi)"
                          stroke="hsl(var(--muted-foreground))"
                          strokeOpacity={0.5}
                          strokeWidth={2}
                          dot={(props) => {
                            const { cx, cy, payload, index } = props as {
                              cx?: number; cy?: number;
                              payload?: { phase?: string; week?: number; actualMi?: number };
                              index?: number;
                            };
                            if (cx == null || cy == null) {
                              return <g key={`long-run-dot-${index ?? 0}`} />;
                            }
                            const fill = payload?.phase ? phaseColor(payload.phase) : "hsl(var(--primary))";
                            return (
                              <circle
                                key={`long-run-dot-${payload?.week ?? index ?? 0}`}
                                cx={cx}
                                cy={cy}
                                r={4}
                                fill={fill}
                                stroke="hsl(var(--card))"
                                strokeWidth={1}
                              />
                            );
                          }}
                        />
                        {longRun?.some(
                          (p) =>
                            (p.plannedCardioMin ?? 0) > 0 ||
                            (p.actualCardioMin ?? p.cardioMin ?? 0) > 0,
                        ) && (
                          <>
                            <Bar
                              yAxisId="cardio"
                              dataKey="plannedCardioMin"
                              name="Cross-train target (min)"
                              fill="hsl(var(--chart-2, var(--primary)))"
                              opacity={0.18}
                              radius={[2, 2, 0, 0]}
                            />
                            <Bar
                              yAxisId="cardio"
                              dataKey="actualCardioMin"
                              name="Cross-train completed (min)"
                              fill="hsl(var(--chart-2, var(--primary)))"
                              opacity={0.55}
                              radius={[2, 2, 0, 0]}
                            />
                          </>
                        )}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

        </div>

        {/* Right Sidebar Column */}
        <div className="space-y-6">

          {/* Quick Log Activity */}
          <QuickLogActivity />

          {/* Weight Trend */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg uppercase tracking-wider">Body trend</CardTitle>
            </CardHeader>
            <CardContent>
              {loadingWeight ? <Skeleton className="h-48" /> : (
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={weightTrend}>
                      <defs>
                        <linearGradient id="colorWeight" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(var(--brand-purple))" stopOpacity={0.35}/>
                          <stop offset="95%" stopColor="hsl(var(--brand-purple))" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                      <XAxis dataKey="date" tickFormatter={(str) => format(new Date(str), 'MMM d')} hide />
                      <YAxis domain={[summary?.weightGoal ? summary.weightGoal - 5 : 200, summary?.weightStart ? summary.weightStart + 5 : 300]} hide />
                      <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }} />
                      <Area type="monotone" dataKey="weight" stroke="hsl(var(--brand-purple))" strokeWidth={3} fillOpacity={1} fill="url(#colorWeight)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Equipment */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg uppercase tracking-wider">Equipment</CardTitle>
            </CardHeader>
            <CardContent>
              {loadingEq ? <Skeleton className="h-64" /> : (
                <div className="space-y-4">
                  {equipment?.map(eq => {
                    // Task #144: when a machine is shared by 2+ programs
                    // (e.g. Tonal scheduled by both a Tonal Lift program and
                    // a 5K Improver cross-train block), show a thin per-
                    // program attribution line so the runner can see who
                    // owns the planned minutes.
                    const sharedPrograms = eq.byProgram.filter(
                      (p) => p.plannedSessions > 0,
                    );
                    const isShared = sharedPrograms.length > 1;
                    return (
                      <div
                        key={eq.equipment}
                        className="border-b border-border pb-3 last:border-0 last:pb-0"
                        data-testid={`arsenal-row-${eq.equipment}`}
                      >
                        <div className="flex justify-between items-center">
                          <div>
                            <div className="font-bold text-sm">{eq.equipment}</div>
                            <div className="text-xs text-muted-foreground">{eq.sessions} sessions</div>
                          </div>
                          <div className="text-right">
                            <div className="font-mono text-sm">{formatDuration(eq.totalMinutes)}</div>
                            <div className="text-xs text-muted-foreground uppercase">Load {formatLoad(eq.totalLoad)}</div>
                          </div>
                        </div>
                        {isShared && (
                          <div
                            className="mt-2 pl-2 border-l-2 border-muted text-[11px] text-muted-foreground space-y-0.5"
                            data-testid={`arsenal-row-${eq.equipment}-programs`}
                          >
                            {sharedPrograms.map((p) => (
                              <div
                                key={`arsenal-${eq.equipment}-prog-${p.sourceEntryIndex}`}
                                className="flex items-center justify-between gap-2"
                                data-testid={`arsenal-row-${eq.equipment}-program-${p.sourceEntryIndex}`}
                              >
                                <span className="flex items-center gap-1.5 min-w-0">
                                  <span
                                    className="h-2 w-2 rounded-sm shrink-0"
                                    style={{
                                      backgroundColor: programColor(p.sourceEntryIndex),
                                    }}
                                    aria-hidden
                                  />
                                  <span className="uppercase tracking-wider font-bold truncate">{p.label}</span>
                                </span>
                                <span className="font-mono shrink-0">
                                  {p.plannedSessions}× · {Math.round(p.plannedMinutes)}m
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent Activity */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg uppercase tracking-wider">Recent Logs</CardTitle>
            </CardHeader>
            <CardContent>
              {loadingActivity ? <Skeleton className="h-64" /> : (
                <div className="space-y-4">
                  {activity?.slice(0,5).map(act => (
                    <div key={act.id} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-xs font-bold shrink-0">
                          {act.equipment.substring(0,1)}
                        </div>
                        <div className="w-px h-full bg-border my-1"></div>
                      </div>
                      <div className="pb-4">
                        <div className="text-xs text-muted-foreground">{formatDate(act.date)}</div>
                        <div className="font-bold text-sm">{act.sessionType}</div>
                        <div className="text-xs flex gap-2 mt-1">
                          {act.distanceMi ? <span>{formatDistance(act.distanceMi)}</span> : null}
                          {act.durationMin ? <span>{formatDuration(act.durationMin)}</span> : null}
                        </div>
                        {/* Task #147: surface the prescribed run-target
                            snapshot alongside the actuals so a runner
                            glancing at Recent Logs sees what the plan
                            asked for without bouncing to /log. The
                            component no-ops on rest / strength / cardio
                            sessions and on rows that have no plan-day
                            join (off-plan / quick-logged Lifestyle), so
                            we can render it unconditionally. */}
                        {act.prescribedRunTarget && (
                          <div className="mt-1">
                            <RunTargetLine
                              sessionType={act.prescribedRunTarget.sessionType}
                              week={act.prescribedRunTarget.week}
                              runMin={act.prescribedRunTarget.runMin}
                              distanceMi={act.prescribedRunTarget.distanceMi}
                              pace={act.prescribedRunTarget.pace}
                              variant="compact"
                              testId={`recent-activity-${act.id}-run-target`}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

        </div>
      </div>

    </div>
  );
}

function uniquePhases(phases: Array<string | undefined> | undefined): string[] {
  if (!phases) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of phases) {
    if (!p || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

function PhaseLegend({ phases, showActualSwatch = false }: { phases: string[]; showActualSwatch?: boolean }) {
  if (phases.length === 0) return null;
  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-3"
      data-testid="phase-legend"
    >
      {phases.map((phase) => (
        <div key={phase} className="flex items-center gap-2">
          <span
            className="h-3 w-3 rounded-sm shrink-0"
            style={{ backgroundColor: phaseColor(phase) }}
            aria-hidden
          />
          <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">
            {phase}
          </span>
        </div>
      ))}
      {showActualSwatch && (
        <div className="ml-auto flex items-center gap-3 text-[10px] uppercase font-bold tracking-wider text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <span
              className="h-3 w-3 rounded-sm border border-foreground/20 bg-foreground/10"
              aria-hidden
            />
            Planned
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className="h-3 w-3 rounded-sm bg-foreground/70"
              aria-hidden
            />
            Actual (by phase)
          </div>
        </div>
      )}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[1,2,3,4].map(i => <Skeleton key={i} className="h-32 w-full" />)}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
        <div className="space-y-6">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    </div>
  );
}
