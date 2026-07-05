import { Link } from "wouter";
import { useMemo } from "react";
import {
  CalendarDays,
  Scale,
  Utensils,
  ClipboardList,
  ArrowRight,
  Plus,
} from "lucide-react";
import {
  useGetDashboardBootstrap,
  useListPlannerConfigs,
} from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { formatWeight } from "@/lib/format";
import { buildActivity } from "@/lib/activity";
import {
  ActivityCalendar,
  TrendArea,
  GoalArc,
  MetricRing,
  EmptyState,
} from "@/components/studio";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ThemeToggle } from "@/components/theme-toggle";
import { useFirstRunRedirect } from "@/hooks/use-first-run-redirect";

// The front door — modeled on the H2 Budget app's landing pattern, re-skinned in
// BH Studio's "Vibrant Summer" theme. A calm time-based greeting, then four big
// tiles that ARE the navigation (the global nav is hidden here — see layout.tsx),
// each carrying a headline stat and a small real-data mini-viz drawn from ONE
// dashboard-bootstrap call. Retires the old dense dashboard; the four section
// pages (Today / Body / Nutrition / Plan) hold the depth.

// Per-area icon-chip gradient, reusing the same summer sweeps the old dashboard
// gave each area so color identity stays consistent across the app.
const CHIP_GRADIENT = {
  today: "bg-summer-gradient",
  body: "bg-grad-body",
  nutrition: "bg-grad-fuel",
  plan: "bg-grad-plan",
} as const;

function greetingForHour(hour: number): string {
  if (hour < 12) return "Good morning.";
  if (hour < 18) return "Good afternoon.";
  return "Good evening.";
}

/** "2026-06-19" → "Jun 19" for the weight sparkline x-axis. */
function shortDate(iso: unknown): string {
  const s = String(iso);
  const d = new Date(`${s}T12:00:00`);
  return Number.isNaN(d.getTime())
    ? s
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── tile shell ────────────────────────────────────────────────────────────────

function LandingTile({
  icon,
  area,
  title,
  blurb,
  href,
  testid,
  children,
}: {
  icon: React.ReactNode;
  area: keyof typeof CHIP_GRADIENT;
  title: string;
  blurb: string;
  href: string;
  testid: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="group relative h-full" data-testid={`landing-tile-${testid}`}>
      <div className="relative flex h-full flex-col rounded-3xl border border-card-border bg-card p-6 shadow-tile transition-transform duration-200 hover:-translate-y-0.5 motion-reduce:transition-none sm:p-7">
        {/* Whole-tile click target sits above the (glanceable, non-interactive) viz. */}
        <Link
          href={href}
          className="absolute inset-0 z-20 rounded-3xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          aria-label={title}
        />
        <div className="flex items-start justify-between gap-3">
          <span
            className={cn(
              "flex h-12 w-12 items-center justify-center rounded-2xl text-white shadow-sm",
              CHIP_GRADIENT[area],
            )}
          >
            {icon}
          </span>
          <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
        </div>
        <div className="mt-4 font-display text-xl font-bold tracking-tight text-foreground">
          {title}
        </div>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{blurb}</p>
        {/* Viz is a glance only — pointer-events-none so clicks fall through to the
            tile's Link (no fighting the ActivityCalendar's own tooltips). */}
        {children != null && (
          <div className="pointer-events-none mt-6 flex-1">{children}</div>
        )}
      </div>
    </div>
  );
}

/** A small eyebrow-label + headline value, shared across tiles. */
function TileStat({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("leading-none", className)}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
        {label}
      </div>
      <div className="mt-1 font-display text-2xl font-extrabold tabular-nums tracking-tight text-foreground">
        {children}
      </div>
    </div>
  );
}

// ── page ────────────────────────────────────────────────────────────────────

function LandingSkeleton({ greeting }: { greeting: string }) {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 sm:py-10">
      <div className="mb-8">
        <h1
          className="font-display text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl"
          data-testid="landing-greeting"
        >
          {greeting}
        </h1>
        <p className="mt-1 text-base text-muted-foreground">Where do you want to go?</p>
      </div>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:auto-rows-fr">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-64 rounded-3xl" />
        ))}
      </div>
    </div>
  );
}

export default function Landing() {
  const greeting = greetingForHour(new Date().getHours());

  const { data: bootstrap, isLoading } = useGetDashboardBootstrap();
  const plannerConfigsQuery = useListPlannerConfigs();

  const summary = bootstrap?.summary;
  const weightTrend = bootstrap?.weightTrend ?? [];
  const recentActivity = bootstrap?.recentActivity ?? [];
  const today = bootstrap?.today;

  // Preserve the new-runner → planner nudge that used to live on the dashboard:
  // repointing "/" here would otherwise silently drop it.
  useFirstRunRedirect({
    hasPlan: summary?.hasPlan ?? false,
    hasDrafts: (plannerConfigsQuery.data?.configs?.length ?? 0) > 0,
    ready:
      summary !== undefined &&
      plannerConfigsQuery.data !== undefined &&
      !plannerConfigsQuery.isError,
  });

  const activity = useMemo(() => buildActivity(recentActivity), [recentActivity]);

  if (isLoading && !summary) return <LandingSkeleton greeting={greeting} />;

  const loggedToday = today?.loggedWorkouts?.length ?? 0;
  const todayCaption = today?.plan?.sessionType?.trim() || "Rest day";
  const weightCurrent = summary?.weightCurrent ?? null;
  const weightToGoal = summary?.weightToGoal ?? 0;
  const adherence = Math.round(summary?.adherencePct ?? 0);
  const currentWeek = summary?.currentWeek ?? 0;
  const currentPhase = summary?.currentPhase?.trim() || "No plan yet";
  const sessionsDone = summary?.weeklySessionsCompleted ?? 0;
  const sessionsPlanned = summary?.weeklySessionsPlanned ?? 0;

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 sm:py-10">
      {/* Greeting + theme/quick-action controls */}
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1
            className="font-display text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl"
            data-testid="landing-greeting"
          >
            {greeting}
          </h1>
          <p className="mt-1 text-base text-muted-foreground">
            Where do you want to go?
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            asChild
            size="sm"
            className="h-8 gap-1.5 font-semibold gradient-primary shadow-sm hover:brightness-110"
            data-testid="landing-log"
          >
            <Link href="/log">
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Log</span>
            </Link>
          </Button>
          <div className="text-muted-foreground">
            <ThemeToggle />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:auto-rows-fr">
        {/* TODAY — recent-activity heatmap */}
        <LandingTile
          testid="today"
          href="/today"
          area="today"
          icon={<CalendarDays className="h-6 w-6" strokeWidth={1.75} />}
          title="Today"
          blurb="What's on for today, and how consistent you've been."
        >
          <div className="flex items-center justify-between gap-3">
            <TileStat label="Logged today">{loggedToday}</TileStat>
            <span className="text-xs font-medium text-muted-foreground">{todayCaption}</span>
          </div>
          <div className="mt-4">
            <ActivityCalendar
              days={activity.days}
              stats={{
                activeDays: activity.activeDays,
                vsLast30: activity.activeDays - activity.prevActiveDays,
                streak: activity.streak,
              }}
            />
          </div>
        </LandingTile>

        {/* BODY — weight trend sparkline */}
        <LandingTile
          testid="body"
          href="/measurements"
          area="body"
          icon={<Scale className="h-6 w-6" strokeWidth={1.75} />}
          title="Body"
          blurb="Weight & measurements — the recomp trend at a glance."
        >
          <TileStat label="Current weight">{formatWeight(weightCurrent)}</TileStat>
          <p className="mt-1 text-xs text-muted-foreground">
            {weightToGoal > 0 ? `${weightToGoal.toFixed(0)} lb to goal` : "Tracking"}
          </p>
          <div className="mt-3">
            <TrendArea
              data={weightTrend as unknown as Array<Record<string, unknown>>}
              xKey="date"
              yKey="weight"
              unit="lb"
              height={112}
              valueFormatter={(n) => n.toFixed(0)}
              xTickFormatter={shortDate}
              sparseFallback={
                <EmptyState
                  icon={Scale}
                  title="Not much logged yet"
                  hint="Log a few weigh-ins to see your trend."
                />
              }
            />
          </div>
        </LandingTile>

        {/* NUTRITION — plan-adherence arc */}
        <LandingTile
          testid="nutrition"
          href="/nutrition"
          area="nutrition"
          icon={<Utensils className="h-6 w-6" strokeWidth={1.75} />}
          title="Nutrition"
          blurb="Fuel & macros — how close you're eating to the plan."
        >
          <div className="mt-2 flex items-center justify-center">
            <GoalArc value={adherence / 100} label="On plan" size={132} />
          </div>
        </LandingTile>

        {/* PLAN — weekly sessions ring */}
        <LandingTile
          testid="plan"
          href="/plan"
          area="plan"
          icon={<ClipboardList className="h-6 w-6" strokeWidth={1.75} />}
          title="Plan"
          blurb="Where you are in the block, and this week's sessions."
        >
          <div className="flex items-center justify-between gap-3">
            <TileStat label="Current week">Wk {currentWeek}</TileStat>
            <span className="max-w-[9rem] truncate text-xs font-medium text-muted-foreground">
              {currentPhase}
            </span>
          </div>
          <div className="mt-4 flex items-center justify-center">
            <MetricRing
              value={sessionsDone}
              goal={sessionsPlanned > 0 ? sessionsPlanned : null}
              label="Sessions"
            />
          </div>
        </LandingTile>
      </div>
    </div>
  );
}
