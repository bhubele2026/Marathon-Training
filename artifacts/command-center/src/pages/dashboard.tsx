import { useState } from "react";
import { useLocation } from "wouter";
import {
  CalendarDays,
  Dumbbell,
  Utensils,
  Scale,
  ClipboardList,
  Sparkles,
  Activity,
  ArrowRight,
} from "lucide-react";
import { useGetDashboardBootstrap } from "@workspace/api-client-react";
import { useListPlannerConfigs } from "@workspace/api-client-react";
import type { Workout } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  SegmentedControl,
  FeatureTile,
  StatTile,
  TrendArea,
  ActivityCalendar,
  GoalArc,
  CoachNote,
  EmptyState,
  type ActivityDay,
  type SegmentedOption,
} from "@/components/studio";
import { RecompHero } from "@/components/recomp-hero";
import { DashboardFuelTile } from "@/components/dashboard-fuel-tile";
import { DashboardWaterTile } from "@/components/dashboard-water-tile";
import { DashboardTracking } from "@/components/dashboard-tracking";
import { DashboardNutritionInsights } from "@/components/dashboard-nutrition-insights";
import { ProgressDiagnosis } from "@/components/progress-diagnosis";
import { EmptyPlanState } from "@/components/empty-plan-state";
import { useFirstRunRedirect } from "@/hooks/use-first-run-redirect";
import { formatLoad, formatWeight, formatDistance } from "@/lib/format";

// Phase 4 — the Dashboard is the home hub. A bright, tiled, glanceable surface:
// a Daily/Weekly/Monthly scale toggle, big FeatureTiles into Today / Body /
// Nutrition / Plan, a calorie ring + water tracker, a soft weight trend, an
// activity calendar, a goal arc, session/load mini-bars, the body-recomp hero,
// and an AI front-door. All marathon scaffolding (Days to Race, Mileage Volume,
// Long Run Build, race week) is gone; running survives only as a plan goal.

type Scale = "daily" | "weekly" | "monthly";
const SCALE_OPTIONS: SegmentedOption<Scale>[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

const MS_DAY = 86_400_000;

function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Build the last 30 calendar days for the activity calendar, marking each day
// active (level 1 light / 2 solid) from logged workout minutes. Derived purely
// client-side from the recent-activity slice already in the bootstrap.
function buildActivity(workouts: Workout[]): {
  days: ActivityDay[];
  activeDays: number;
  prevActiveDays: number;
  streak: number;
} {
  const minutesByDate = new Map<string, number>();
  for (const w of workouts) {
    const d = (w.date ?? "").slice(0, 10);
    if (!d) continue;
    const mins = w.totalMin ?? w.durationMin ?? 0;
    minutesByDate.set(d, (minutesByDate.get(d) ?? 0) + mins);
  }
  const today = new Date();
  const days: ActivityDay[] = [];
  let activeDays = 0;
  let prevActiveDays = 0;
  for (let i = 29; i >= 0; i--) {
    const dt = new Date(today.getTime() - i * MS_DAY);
    const key = dateKey(dt);
    const mins = minutesByDate.get(key) ?? 0;
    const level: 0 | 1 | 2 = mins === 0 ? 0 : mins >= 30 ? 2 : 1;
    if (level > 0) activeDays++;
    days.push({ date: key, level });
  }
  // Prior 30-day window (days 31..60) for the "vs last 30" footer stat.
  for (let i = 59; i >= 30; i--) {
    const dt = new Date(today.getTime() - i * MS_DAY);
    if ((minutesByDate.get(dateKey(dt)) ?? 0) > 0) prevActiveDays++;
  }
  // Streak: consecutive active days counting back from today.
  let streak = 0;
  for (let i = 0; i < 60; i++) {
    const dt = new Date(today.getTime() - i * MS_DAY);
    if ((minutesByDate.get(dateKey(dt)) ?? 0) > 0) streak++;
    else if (i > 0) break; // today not logged yet shouldn't break the streak
    else continue;
  }
  return { days, activeDays, prevActiveDays, streak };
}

// A token-only horizontal compare bar (actual vs planned) — no chart lib needed
// for a single proportion, keeps the tile light.
function MiniBar({
  label,
  actual,
  planned,
  format,
  testId,
}: {
  label: string;
  actual: number;
  planned: number;
  format: (n: number) => string;
  testId?: string;
}) {
  const pct =
    planned > 0 ? Math.min(100, Math.round((actual / planned) * 100)) : actual > 0 ? 100 : 0;
  return (
    <div className="space-y-1.5" data-testid={testId}>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-display font-semibold tabular-nums">
          {format(actual)}
          {planned > 0 && (
            <span className="text-muted-foreground font-normal">
              {" "}
              / {format(planned)}
            </span>
          )}
        </span>
      </div>
      <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="mx-auto max-w-[1440px] px-4 md:px-8 py-6 space-y-6">
      <Skeleton className="h-10 w-64 rounded-xl" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28 rounded-3xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-64 rounded-3xl" />
        ))}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [scale, setScale] = useState<Scale>("daily");
  const [, navigate] = useLocation();
  const { data: bootstrap, isLoading } = useGetDashboardBootstrap();

  const summary = bootstrap?.summary;
  const weightTrend = bootstrap?.weightTrend ?? [];
  const recentActivity = bootstrap?.recentActivity ?? [];
  const today = bootstrap?.today;

  const plannerConfigsQuery = useListPlannerConfigs();
  useFirstRunRedirect({
    hasPlan: summary?.hasPlan ?? false,
    hasDrafts: (plannerConfigsQuery.data?.configs?.length ?? 0) > 0,
    ready:
      summary !== undefined &&
      plannerConfigsQuery.data !== undefined &&
      !plannerConfigsQuery.isError,
  });

  if (isLoading) return <DashboardSkeleton />;
  if (!summary) return <div>Failed to load dashboard</div>;

  const headerTitle = summary.activeConfigName?.trim() || "Workout Plan";

  // Goal progress: weight journey toward goal, falling back to plan adherence.
  const goalPct =
    summary.weightStart != null &&
    summary.weightCurrent != null &&
    summary.weightGoal != null &&
    summary.weightStart !== summary.weightGoal
      ? Math.max(
          0,
          Math.min(
            100,
            ((summary.weightStart - summary.weightCurrent) /
              (summary.weightStart - summary.weightGoal)) *
              100,
          ),
        )
      : summary.adherencePct;

  // ---- Empty-plan state: no plan applied yet ----------------------------
  if (!summary.hasPlan) {
    return (
      <div className="mx-auto max-w-[1440px] px-4 md:px-8 py-6 space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div data-testid="dashboard-header" className="flex flex-col gap-1">
          <h2
            className="text-4xl font-display font-extrabold tracking-tight text-foreground"
            data-testid="dashboard-header-title"
          >
            {headerTitle}
          </h2>
          <p
            className="text-muted-foreground font-medium text-sm"
            data-testid="dashboard-header-subtitle"
          >
            No plan applied yet
          </p>
        </div>
        <EmptyPlanState testId="dashboard-empty-plan" />
        <RecompHero recomp={summary.recomp} weightGoal={summary.weightGoal} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <DashboardFuelTile />
          <DashboardWaterTile weightLb={summary.weightCurrent} />
        </div>
      </div>
    );
  }

  // ---- Active-plan hub --------------------------------------------------
  const activity = buildActivity(recentActivity);
  const todaySessions = today?.loggedWorkouts ?? [];

  // The scale toggle reframes the training-load section.
  const last30 = recentActivity.filter((w) => {
    const t = Date.parse(w.date ?? "");
    return !Number.isNaN(t) && Date.now() - t <= 30 * MS_DAY;
  });
  const monthLoad = last30.reduce((s, w) => s + (w.totalLoad ?? 0), 0);
  const dayLoad = todaySessions.reduce((s, w) => s + (w.totalLoad ?? 0), 0);

  const trainingTile =
    scale === "daily"
      ? {
          label: "Today",
          sessions: { actual: todaySessions.length, planned: today?.plans?.length ?? 0 },
          load: { actual: dayLoad, planned: 0 },
        }
      : scale === "weekly"
        ? {
            label: `Week ${summary.currentWeek} · ${summary.currentPhase}`,
            sessions: {
              actual: summary.weeklySessionsCompleted,
              planned: summary.weeklySessionsPlanned,
            },
            load: {
              actual: summary.weeklyLoadActual,
              planned: summary.weeklyLoadPlanned,
            },
          }
        : {
            label: "Last 30 days",
            sessions: { actual: last30.length, planned: 0 },
            load: { actual: monthLoad, planned: 0 },
          };

  return (
    <div className="mx-auto max-w-[1440px] px-4 md:px-8 py-6 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header + scale toggle */}
      <div
        data-testid="dashboard-header"
        className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between"
      >
        <div className="flex flex-col gap-1">
          <h2
            className="text-4xl font-display font-extrabold tracking-tight text-foreground"
            data-testid="dashboard-header-title"
          >
            {headerTitle}
          </h2>
          <p
            className="text-muted-foreground font-medium text-sm"
            data-testid="dashboard-header-subtitle"
          >
            Week {summary.currentWeek} · {summary.currentPhase} ·{" "}
            {summary.adherencePct}% on plan
          </p>
        </div>
        <SegmentedControl<Scale>
          options={SCALE_OPTIONS}
          value={scale}
          onChange={setScale}
          ariaLabel="Dashboard time scale"
        />
      </div>

      {/* Big nav tiles */}
      <div
        className="grid grid-cols-2 lg:grid-cols-4 gap-4"
        data-testid="dashboard-feature-tiles"
      >
        <FeatureTile
          icon={CalendarDays}
          label="Today"
          stat={`${todaySessions.length} logged`}
          caption={today?.plan?.sessionType ?? "Rest day"}
          onClick={() => navigate("/today")}
          testId="dashboard-tile-today"
        />
        <FeatureTile
          icon={Scale}
          label="Body"
          stat={formatWeight(summary.weightCurrent)}
          caption={
            summary.weightToGoal > 0
              ? `${summary.weightToGoal.toFixed(0)} lb to goal`
              : "Tracking"
          }
          onClick={() => navigate("/measurements")}
          tone="soft"
        />
        <FeatureTile
          icon={Utensils}
          label="Nutrition"
          stat={`${summary.adherencePct}%`}
          caption="Fuel & macros"
          onClick={() => navigate("/nutrition")}
          tone="soft"
        />
        <FeatureTile
          icon={ClipboardList}
          label="Plan"
          stat={`Wk ${summary.currentWeek}`}
          caption={summary.currentPhase}
          onClick={() => navigate("/plan")}
          tone="soft"
        />
      </div>

      {/* Primary grid: fuel ring, water, training-load */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <DashboardFuelTile />
        <DashboardWaterTile weightLb={summary.weightCurrent} />
        <Card data-testid="dashboard-training-tile">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Training load
              </p>
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground">
                <Activity className="h-3.5 w-3.5" />
                {trainingTile.label}
              </span>
            </div>
            <MiniBar
              label="Sessions"
              actual={trainingTile.sessions.actual}
              planned={trainingTile.sessions.planned}
              format={(n) => String(n)}
              testId="dashboard-bar-sessions"
            />
            <MiniBar
              label="Load"
              actual={trainingTile.load.actual}
              planned={trainingTile.load.planned}
              format={(n) => formatLoad(n)}
              testId="dashboard-bar-load"
            />
          </CardContent>
        </Card>
      </div>

      {/* Trends: weight area, goal arc, activity calendar */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <StatTile
          icon={Scale}
          label="Weight"
          value={formatWeight(summary.weightCurrent)}
          tone="foreground"
          tileClassName="lg:col-span-1"
          footer={
            <TrendArea
              data={weightTrend as unknown as Array<Record<string, unknown>>}
              xKey="date"
              yKey="weight"
              unit="lb"
              height={120}
              sparseFallback={
                <EmptyState
                  icon={Scale}
                  title="Not much logged yet"
                  hint="Log a few weigh-ins to see your trend."
                />
              }
            />
          }
        />
        <Card>
          <CardContent className="p-6 flex flex-col items-center justify-center gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground self-start">
              Goal progress
            </p>
            <GoalArc
              value={Math.round(goalPct)}
              label="to goal"
              caption={
                summary.weightGoal != null
                  ? `Goal ${summary.weightGoal.toFixed(0)} lb`
                  : "Set a goal on Goals"
              }
            />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground mb-4">
              Activity
            </p>
            <ActivityCalendar
              days={activity.days}
              stats={{
                activeDays: activity.activeDays,
                vsLast30: activity.activeDays - activity.prevActiveDays,
                streak: activity.streak,
              }}
            />
          </CardContent>
        </Card>
      </div>

      {/* AI front door */}
      <Card
        className="border-l-2 border-l-primary"
        data-testid="dashboard-ai-frontdoor"
      >
        <CardContent className="p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <CoachNote icon={Sparkles} tone="neutral" className="border-0 p-0 bg-transparent">
            <span className="font-display font-semibold text-foreground">
              How can I help?
            </span>{" "}
            Ask the coach to tweak today, or build your next goal — a cut, a
            recomp block, even a 5k.
          </CoachNote>
          <Button onClick={() => navigate("/plan-builder")} className="shrink-0">
            Ask the coach
            <ArrowRight className="ml-1.5 h-4 w-4" />
          </Button>
        </CardContent>
      </Card>

      {/* Body recomposition hero */}
      <RecompHero recomp={summary.recomp} weightGoal={summary.weightGoal} />

      {/* Nutrition "should vs is" insights (owns its own data) */}
      <DashboardNutritionInsights />

      {/* Existing tracking + progress diagnosis hubs (own their own data) */}
      <DashboardTracking />
      <ProgressDiagnosis />
    </div>
  );
}
