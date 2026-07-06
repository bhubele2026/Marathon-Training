import { Link } from "wouter";
import { useMemo } from "react";
import {
  CalendarDays,
  Scale,
  Utensils,
  ClipboardList,
  ArrowRight,
  ArrowUpRight,
  Plus,
} from "lucide-react";
import {
  useGetDashboardBootstrap,
  useListPlannerConfigs,
} from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { formatWeight } from "@/lib/format";
import { buildActivity } from "@/lib/activity";
import { ActivityCalendar, PageBackdrop } from "@/components/studio";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ThemeToggle } from "@/components/theme-toggle";
import { useFirstRunRedirect } from "@/hooks/use-first-run-redirect";

// The front door — warm editorial (Oura / Levels). A greeting in an editorial
// serif, ONE real graphic (30-day training consistency, drills into the log),
// then four identical clean nav tiles. Global nav is hidden here (layout.tsx).
// Data comes from one dashboard-bootstrap call.

function greetingForHour(hour: number): string {
  if (hour < 12) return "Good morning.";
  if (hour < 18) return "Good afternoon.";
  return "Good evening.";
}

// ── nav tile (identical size, stat-only) ─────────────────────────────────────

function NavTile({
  icon,
  title,
  href,
  testid,
  stat,
  statLabel,
  caption,
}: {
  icon: React.ReactNode;
  title: string;
  href: string;
  testid: string;
  stat: React.ReactNode;
  statLabel: string;
  caption?: string;
}) {
  return (
    <Link
      href={href}
      data-testid={`landing-tile-${testid}`}
      aria-label={title}
      className="group flex h-44 flex-col rounded-xl border border-card-border bg-card p-5 shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-tile)] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 motion-reduce:transition-none"
    >
      <div className="flex items-center justify-between">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/12 text-accent">
          {icon}
        </span>
        <ArrowUpRight className="h-4 w-4 text-muted-foreground/60 transition-colors group-hover:text-accent" />
      </div>
      <div className="mt-3 font-display text-lg font-semibold tracking-tight text-foreground">
        {title}
      </div>
      <div className="mt-auto">
        <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          {statLabel}
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="font-num text-2xl font-bold tabular-nums tracking-tight text-foreground">
            {stat}
          </span>
          {caption && (
            <span className="truncate text-[11px] font-medium text-muted-foreground">
              {caption}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

// ── the one real graphic — training consistency, drills into the log ──────────

function ConsistencyPanel({
  days,
  activeDays,
  prevActiveDays,
  streak,
}: {
  days: ReturnType<typeof buildActivity>["days"];
  activeDays: number;
  prevActiveDays: number;
  streak: number;
}) {
  const vs = activeDays - prevActiveDays;
  return (
    <Link
      href="/today"
      data-testid="landing-consistency"
      aria-label="Training consistency — open Today"
      className="group mb-4 flex flex-col gap-8 rounded-xl border border-card-border bg-card p-6 shadow-card transition-all duration-200 hover:shadow-[var(--shadow-tile)] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 sm:flex-row sm:items-center sm:justify-between sm:gap-10"
    >
      {/* Left: prominent stat block */}
      <div className="min-w-0">
        <div className="flex items-center justify-between gap-4">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Training · last 30 days
          </div>
          <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground transition-colors group-hover:text-accent sm:hidden">
            Open <ArrowRight className="h-3.5 w-3.5" />
          </span>
        </div>
        <div className="mt-2 flex items-baseline gap-1.5">
          <span className="font-num text-5xl font-bold tabular-nums tracking-tight text-foreground">
            {activeDays}
          </span>
          <span className="font-num text-xl font-semibold tabular-nums text-muted-foreground">
            /30
          </span>
          <span className="ml-1 text-sm font-medium text-muted-foreground">active days</span>
        </div>
        <div className="mt-4 flex items-center gap-8">
          <div>
            <div className="font-num text-2xl font-bold tabular-nums text-foreground">{streak}</div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Day streak
            </div>
          </div>
          <div>
            <div
              className={cn(
                "font-num text-2xl font-bold tabular-nums",
                vs >= 0 ? "text-accent" : "text-foreground",
              )}
            >
              {vs >= 0 ? "+" : ""}
              {vs}
            </div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              vs prev 30
            </div>
          </div>
        </div>
        <span className="mt-5 hidden items-center gap-1 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground transition-colors group-hover:text-accent sm:inline-flex">
          Open training log
          <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
      {/* Right: the heatmap */}
      <div className="pointer-events-none shrink-0">
        <ActivityCalendar days={days} showPeriodLabel={false} />
      </div>
    </Link>
  );
}

// ── page ────────────────────────────────────────────────────────────────────

function LandingHeader({ greeting }: { greeting: string }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          BH Studio
        </div>
        <h1
          className="font-display text-4xl font-semibold tracking-tight text-foreground sm:text-5xl"
          data-testid="landing-greeting"
        >
          {greeting}
        </h1>
        <p className="mt-2 text-base text-muted-foreground">
          Where do you want to go?
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button asChild size="sm" className="h-9 gap-1.5 rounded-lg font-semibold" data-testid="landing-log">
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
  );
}

function LandingSkeleton({ greeting }: { greeting: string }) {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <LandingHeader greeting={greeting} />
      <div className="mb-6 h-px bg-border" />
      <Skeleton className="mb-4 h-56 rounded-xl" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-44 rounded-xl" />
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
  const recentActivity = bootstrap?.recentActivity ?? [];
  const today = bootstrap?.today;

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

  return (
    <div className="relative min-h-[100dvh] overflow-hidden">
      {/* Brand backsplash — barbell + BH STUDIO wordmark filling the lower
          empty half of the front door. Behind content, never overlapping. */}
      <PageBackdrop motif="barbell" hero />
      <div className="relative z-10 mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <LandingHeader greeting={greeting} />
      <div className="mb-6 h-px bg-border" />

      {/* The one real graphic — drills into the log. */}
      <ConsistencyPanel
        days={activity.days}
        activeDays={activity.activeDays}
        prevActiveDays={activity.prevActiveDays}
        streak={activity.streak}
      />

      {/* Four identical nav tiles. */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <NavTile
          testid="today"
          href="/today"
          icon={<CalendarDays className="h-5 w-5" strokeWidth={2} />}
          title="Today"
          statLabel="Logged today"
          stat={loggedToday}
          caption={todayCaption}
        />
        <NavTile
          testid="body"
          href="/measurements"
          icon={<Scale className="h-5 w-5" strokeWidth={2} />}
          title="Body"
          statLabel="Current weight"
          stat={formatWeight(weightCurrent)}
          caption={weightToGoal > 0 ? `${weightToGoal.toFixed(0)} to goal` : "Tracking"}
        />
        <NavTile
          testid="nutrition"
          href="/nutrition"
          icon={<Utensils className="h-5 w-5" strokeWidth={2} />}
          title="Nutrition"
          statLabel="On plan"
          stat={`${adherence}%`}
          caption="Fuel & macros"
        />
        <NavTile
          testid="plan"
          href="/plan"
          icon={<ClipboardList className="h-5 w-5" strokeWidth={2} />}
          title="Plan"
          statLabel="Current week"
          stat={`Wk ${currentWeek}`}
          caption={currentPhase}
        />
      </div>
      </div>
    </div>
  );
}
