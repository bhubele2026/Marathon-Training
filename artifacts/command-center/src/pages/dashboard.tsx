import { useState } from "react";
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
  BarChart, Bar, Legend, AreaChart, Area
} from "recharts";
import { formatDistance, formatLoad, formatWeight, formatDate, formatDuration } from "@/lib/format";
import { format } from "date-fns";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Activity, CalendarDays, CheckCircle2, TrendingDown, Target, Clock, Zap, Play, Edit, Trash2, ExternalLink, Dog, Trees, Home, Mountain, Plus } from "lucide-react";
import { useMissionActions } from "@/hooks/use-mission-actions";
import { WorkoutForm } from "@/components/workout-form";

type LifestylePreset = {
  label: string;
  icon: typeof Dog;
  sessionType: string;
};

const LIFESTYLE_PRESETS: LifestylePreset[] = [
  { label: "Walk Dogs", icon: Dog, sessionType: "Dog Walk" },
  { label: "Mow Lawn", icon: Trees, sessionType: "Yard Work" },
  { label: "Yard Work", icon: Home, sessionType: "Yard Work" },
  { label: "Hike", icon: Mountain, sessionType: "Hike" },
];

export default function Dashboard() {
  const [quickLogOpen, setQuickLogOpen] = useState(false);
  const [quickLogPreset, setQuickLogPreset] = useState<{ sessionType: string } | null>(null);

  const openQuickLog = (sessionType: string | null) => {
    setQuickLogPreset(sessionType ? { sessionType } : null);
    setQuickLogOpen(true);
  };

  const { data: summary, isLoading: loadingSummary } = useGetDashboardSummary();
  const { data: weightTrend, isLoading: loadingWeight } = useGetWeightTrend();
  const { data: mileage, isLoading: loadingMileage } = useGetWeeklyMileage();
  const { data: equipment, isLoading: loadingEq } = useGetEquipmentUsage();
  const { data: longRun, isLoading: loadingLongRun } = useGetLongRunProgression();
  const { data: activity, isLoading: loadingActivity } = useGetRecentActivity();
  const { data: today, isLoading: loadingToday } = useGetTodayPlan();
  const { openLog, openEdit, requestDelete, isDeleting, dialogs } = useMissionActions();
  const todayCtx = today
    ? { date: today.date, plan: today.plan, loggedWorkout: today.loggedWorkout, suggestions: today.suggestions }
    : null;

  if (loadingSummary) return <DashboardSkeleton />;

  if (!summary) return <div>Failed to load dashboard</div>;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      {/* Top Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-card">
          <CardContent className="p-6">
            <div className="flex items-center justify-between space-x-2">
              <div>
                <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Mission Status</p>
                <div className="text-3xl font-black mt-1">Week {summary.currentWeek}</div>
                <p className="text-sm text-primary font-semibold uppercase mt-1">{summary.currentPhase}</p>
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

                      {today.loggedWorkout && (
                        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 pt-3 border-t border-border text-sm">
                          <span className="text-xs uppercase tracking-wider text-muted-foreground font-bold">Logged:</span>
                          {today.loggedWorkout.distanceMi != null && (
                            <span><span className="text-muted-foreground">Dist</span> <span className="font-bold">{formatDistance(today.loggedWorkout.distanceMi)}</span></span>
                          )}
                          {today.loggedWorkout.durationMin != null && (
                            <span><span className="text-muted-foreground">Dur</span> <span className="font-bold">{formatDuration(today.loggedWorkout.durationMin)}</span></span>
                          )}
                          {today.loggedWorkout.pace && (
                            <span><span className="text-muted-foreground">Pace</span> <span className="font-bold">{today.loggedWorkout.pace}/mi</span></span>
                          )}
                          {today.loggedWorkout.rpe != null && (
                            <span><span className="text-muted-foreground">RPE</span> <span className="font-bold">{today.loggedWorkout.rpe}/10</span></span>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="shrink-0 flex flex-col items-stretch md:items-end gap-2">
                      {today.loggedWorkout ? (
                        <>
                          <div className="flex items-center gap-2 text-primary font-bold bg-primary/10 px-4 py-2 rounded-md justify-center">
                            <CheckCircle2 className="h-5 w-5" />
                            MISSION COMPLETE
                          </div>
                          <div className="flex gap-2 justify-end">
                            <Button variant="outline" size="sm" onClick={() => todayCtx && openEdit(todayCtx)}>
                              <Edit className="h-4 w-4 mr-1" /> Edit
                            </Button>
                            <Button variant="destructive" size="sm" onClick={() => todayCtx && requestDelete(todayCtx)} disabled={isDeleting}>
                              <Trash2 className="h-4 w-4 mr-1" /> Delete
                            </Button>
                          </div>
                        </>
                      ) : (
                        <Button size="lg" className="w-full md:w-auto uppercase font-bold tracking-wider" onClick={() => todayCtx && openLog(todayCtx)}>
                          <Play className="mr-2 h-4 w-4" />
                          Log Mission
                        </Button>
                      )}
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
            </CardContent>
          </Card>

          {/* Weekly Mileage Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg uppercase tracking-wider">Mileage Volume</CardTitle>
            </CardHeader>
            <CardContent>
              {loadingMileage ? <Skeleton className="h-64" /> : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={mileage}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                      <XAxis dataKey="week" tickFormatter={(v) => `W${v}`} />
                      <YAxis />
                      <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }} />
                      <Legend />
                      <Bar dataKey="plannedMiles" name="Planned" fill="hsl(var(--muted-foreground))" opacity={0.3} radius={[2, 2, 0, 0]} />
                      <Bar dataKey="actualMiles" name="Actual" fill="hsl(var(--primary))" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
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
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={longRun}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                      <XAxis dataKey="week" tickFormatter={(v) => `W${v}`} />
                      <YAxis />
                      <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }} />
                      <Legend />
                      <Line type="stepAfter" dataKey="plannedMi" name="Target" stroke="hsl(var(--muted-foreground))" strokeDasharray="5 5" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="actualMi" name="Completed" stroke="hsl(var(--primary))" strokeWidth={3} dot={{ r: 4, fill: 'hsl(var(--primary))' }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

        </div>

        {/* Right Sidebar Column */}
        <div className="space-y-6">

          {/* Quick Log Activity */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg uppercase tracking-wider">Quick Log Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-2">
                {LIFESTYLE_PRESETS.map((preset) => {
                  const Icon = preset.icon;
                  return (
                    <Button
                      key={preset.label}
                      variant="outline"
                      className="h-auto py-3 flex flex-col gap-1 uppercase font-bold tracking-wider text-xs"
                      onClick={() => openQuickLog(preset.sessionType)}
                      data-testid={`button-quick-log-${preset.sessionType.toLowerCase().replace(/\s+/g, '-')}`}
                    >
                      <Icon className="h-5 w-5" />
                      {preset.label}
                    </Button>
                  );
                })}
              </div>
              <Button
                variant="ghost"
                className="w-full mt-2 uppercase font-bold tracking-wider text-xs"
                onClick={() => openQuickLog(null)}
                data-testid="button-quick-log-custom"
              >
                <Plus className="h-4 w-4 mr-1" />
                Custom Activity
              </Button>
            </CardContent>
          </Card>

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

      <WorkoutForm
        open={quickLogOpen}
        onOpenChange={setQuickLogOpen}
        initial={{
          date: new Date().toISOString().split('T')[0],
          equipment: "Lifestyle",
          sessionType: quickLogPreset?.sessionType ?? "",
        }}
      />
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
