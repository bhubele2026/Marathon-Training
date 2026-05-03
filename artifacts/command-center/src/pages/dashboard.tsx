import { 
  useGetDashboardSummary, 
  useGetWeightTrend, 
  useGetWeeklyMileage, 
  useGetEquipmentUsage, 
  useGetLongRunProgression, 
  useGetRecentActivity,
  useGetTodayPlan
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Legend, AreaChart, Area, Cell, ReferenceLine
} from "recharts";
import { formatDistance, formatLoad, formatWeight, formatDate, formatDuration } from "@/lib/format";
import { format } from "date-fns";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Activity, CalendarDays, CheckCircle2, TrendingDown, TrendingUp, ArrowRight, Target, Zap, Edit, Trash2, ExternalLink, Pencil, XCircle } from "lucide-react";
import { useMissionActions } from "@/hooks/use-mission-actions";
import { QuickLogActivity } from "@/components/quick-log-activity";
import { RaceWeekBanner } from "@/components/race-week-banner";
import { TimeOfDayBadge } from "@/components/time-of-day-badge";
import { phaseColor } from "@/lib/phase-colors";

export default function Dashboard() {
  const { data: summary, isLoading: loadingSummary } = useGetDashboardSummary();
  const { data: weightTrend, isLoading: loadingWeight } = useGetWeightTrend();
  const { data: mileage, isLoading: loadingMileage } = useGetWeeklyMileage();
  const { data: equipment, isLoading: loadingEq } = useGetEquipmentUsage();
  const { data: longRun, isLoading: loadingLongRun } = useGetLongRunProgression();
  const { data: activity, isLoading: loadingActivity } = useGetRecentActivity();
  const { data: today, isLoading: loadingToday } = useGetTodayPlan();
  const { openLog, openEdit, requestDelete, requestSkip, crushIt, isDeleting, isCrushing, dialogs } =
    useMissionActions();
  const todayBaseCtx = today
    ? { date: today.date, plan: today.plan, suggestions: today.suggestions }
    : null;
  const todaySessions = today?.loggedWorkouts ?? [];
  const hasTodaySessions = todaySessions.length > 0;

  if (loadingSummary) return <DashboardSkeleton />;

  if (!summary) return <div>Failed to load dashboard</div>;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">

      <RaceWeekBanner />

      {/* Top Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card
          className="bg-card border-l-4"
          style={{ borderLeftColor: phaseColor(summary.currentPhase) }}
        >
          <CardContent className="p-6">
            <div className="flex items-center justify-between space-x-2">
              <div>
                <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Mission Status</p>
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

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between space-x-2">
              <div>
                <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Body Mass</p>
                <div className="text-3xl font-black mt-1">{formatWeight(summary.weightCurrent)}</div>
                <p className="text-sm text-muted-foreground mt-1">
                  Goal: {summary.weightGoal} | <span className="text-primary font-semibold">-{summary.weightLost.toFixed(1)} lbs</span>
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
          
          {/* Today's Mission */}
          <Card className="border-primary/20 bg-primary/5">
            <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-lg uppercase tracking-wider text-primary">Today's Mission</CardTitle>
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
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-bold text-lg">{today.plan?.sessionType}</span>
                        <span className="text-xs px-2 py-0.5 bg-secondary text-secondary-foreground rounded uppercase font-bold">{today.plan?.equipment}</span>
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-2">{today.plan?.description}</p>
                      <div className="flex flex-wrap gap-4 mt-3 text-sm font-medium">
                        {today.plan?.distanceMi ? <span>{formatDistance(today.plan.distanceMi)}</span> : null}
                        {today.plan?.cardioMin ? <span>{today.plan.cardioMin} min</span> : null}
                        {today.plan?.strengthLoad ? <span>Load: {today.plan.strengthLoad}</span> : null}
                      </div>

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
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                                <TimeOfDayBadge
                                  value={session.timeOfDay}
                                  testId={`badge-time-of-day-dashboard-${session.id}`}
                                />
                                <span className="text-xs uppercase font-bold tracking-wider text-muted-foreground">
                                  {session.sessionType}
                                </span>
                                {session.distanceMi != null && (
                                  <span><span className="text-muted-foreground">Dist</span> <span className="font-bold">{formatDistance(session.distanceMi)}</span></span>
                                )}
                                {session.durationMin != null && (
                                  <span><span className="text-muted-foreground">Dur</span> <span className="font-bold">{formatDuration(session.durationMin)}</span></span>
                                )}
                                {session.pace && (
                                  <span><span className="text-muted-foreground">Pace</span> <span className="font-bold">{session.pace}/mi</span></span>
                                )}
                                {session.rpe != null && (
                                  <span><span className="text-muted-foreground">RPE</span> <span className="font-bold">{session.rpe}/10</span></span>
                                )}
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
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="shrink-0 flex flex-col items-stretch md:items-end gap-2">
                      {hasTodaySessions && (
                        <div className="flex items-center gap-2 text-primary font-bold bg-primary/10 px-4 py-2 rounded-md justify-center">
                          <CheckCircle2 className="h-5 w-5" />
                          MISSION COMPLETE
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
                          {hasTodaySessions ? "Crushed Another" : "Crushed It"}
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
                          {hasTodaySessions ? "Log Another" : "Log Mission"}
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
              <div
                className="flex items-center justify-between border-t border-border pt-4 text-sm font-bold uppercase text-muted-foreground"
                data-testid="row-lifestyle-minutes"
              >
                <span>Lifestyle Minutes</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-foreground">{formatDuration(summary.weeklyLifestyleMinutes)}</span>
                  {summary.prevWeeklyLifestyleMinutes != null && (() => {
                    const diff = summary.weeklyLifestyleMinutes - summary.prevWeeklyLifestyleMinutes;
                    if (diff > 0) return (
                      <span className="flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400 text-xs" data-testid="lifestyle-trend-up">
                        <TrendingUp className="h-3 w-3" />+{Math.round(diff)}m
                      </span>
                    );
                    if (diff < 0) return (
                      <span className="flex items-center gap-0.5 text-amber-600 dark:text-amber-400 text-xs" data-testid="lifestyle-trend-down">
                        <TrendingDown className="h-3 w-3" />{Math.round(diff)}m
                      </span>
                    );
                    return (
                      <span className="flex items-center gap-0.5 text-muted-foreground text-xs" data-testid="lifestyle-trend-flat">
                        <ArrowRight className="h-3 w-3" />same
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
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={mileage}>
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
                          labelFormatter={(label, payload) => {
                            const row = payload?.[0]?.payload as
                              | { phase?: string; dominantCardioEquipment?: string | null; plannedMiles?: number; plannedCardioMin?: number }
                              | undefined;
                            const base = row?.phase ? `Week ${label} · ${row.phase}` : `Week ${label}`;
                            const cardioOnly =
                              (row?.plannedMiles ?? 0) === 0 &&
                              (row?.plannedCardioMin ?? 0) > 0;
                            if (cardioOnly && row?.dominantCardioEquipment) {
                              return `${base} · ${row.dominantCardioEquipment}`;
                            }
                            return base;
                          }}
                          formatter={(value, name) => {
                            if (name === "Planned cardio" || name === "Actual cardio") {
                              return [`${Number(value).toFixed(0)} min`, name];
                            }
                            return [`${Number(value).toFixed(1)} mi`, name];
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
                        <Bar yAxisId="miles" dataKey="plannedMiles" name="Planned" fill="hsl(var(--muted-foreground))" opacity={0.3} radius={[2, 2, 0, 0]} />
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
                        <YAxis yAxisId="miles" />
                        {longRun?.some((p) => p.cardioMin != null && p.cardioMin > 0) && (
                          <YAxis yAxisId="cardio" orientation="right" tickFormatter={(v) => `${v}m`} />
                        )}
                        <Tooltip
                          contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }}
                          labelFormatter={(label, payload) => {
                            const phase = payload?.[0]?.payload?.phase;
                            return phase ? `Week ${label} · ${phase}` : `Week ${label}`;
                          }}
                        />
                        <Legend />
                        <Line yAxisId="miles" type="stepAfter" dataKey="plannedMi" name="Target" stroke="hsl(var(--muted-foreground))" strokeDasharray="5 5" strokeWidth={2} dot={false} />
                        <Line
                          yAxisId="miles"
                          type="monotone"
                          dataKey="actualMi"
                          name="Completed"
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
                        {longRun?.some((p) => p.cardioMin != null && p.cardioMin > 0) && (
                          <Bar
                            yAxisId="cardio"
                            dataKey="cardioMin"
                            name="Cardio min"
                            fill="hsl(var(--chart-2, var(--primary)))"
                            opacity={0.25}
                            radius={[2, 2, 0, 0]}
                          />
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
              <CardTitle className="text-lg uppercase tracking-wider">Mass Trend</CardTitle>
            </CardHeader>
            <CardContent>
              {loadingWeight ? <Skeleton className="h-48" /> : (
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={weightTrend}>
                      <defs>
                        <linearGradient id="colorWeight" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                      <XAxis dataKey="date" tickFormatter={(str) => format(new Date(str), 'MMM d')} hide />
                      <YAxis domain={[summary?.weightGoal ? summary.weightGoal - 5 : 200, summary?.weightStart ? summary.weightStart + 5 : 300]} hide />
                      <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }} />
                      <Area type="monotone" dataKey="weight" stroke="hsl(var(--primary))" strokeWidth={3} fillOpacity={1} fill="url(#colorWeight)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Equipment Arsenal */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg uppercase tracking-wider">Arsenal Usage</CardTitle>
            </CardHeader>
            <CardContent>
              {loadingEq ? <Skeleton className="h-64" /> : (
                <div className="space-y-4">
                  {equipment?.map(eq => (
                    <div key={eq.equipment} className="flex justify-between items-center border-b border-border pb-3 last:border-0 last:pb-0">
                      <div>
                        <div className="font-bold text-sm">{eq.equipment}</div>
                        <div className="text-xs text-muted-foreground">{eq.sessions} sessions</div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-sm">{formatDuration(eq.totalMinutes)}</div>
                        <div className="text-xs text-muted-foreground uppercase">Load {formatLoad(eq.totalLoad)}</div>
                      </div>
                    </div>
                  ))}
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
