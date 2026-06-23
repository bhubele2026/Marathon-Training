import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Beef, Droplet, Flame, RefreshCw, Sparkles, Wheat } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { NutritionistPanel } from "@/components/nutritionist-panel";
import { NutritionLog } from "@/components/nutrition-log";
import { ResetNutritionButton } from "@/components/reset-nutrition-button";

// These routes are intentionally hand-fetched rather than going through the
// generated api-client: the nutrition slice isn't in openapi.yaml, so we hit
// the same-origin /api path the generated client resolves to anyway. Keeps
// the feature self-contained with no codegen step.
type NutritionDay = {
  date: string;
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  sodiumMg: number | null;
  updatedAt: string | null;
};
type RecentResponse = { days: number; entries: NutritionDay[] };
// Baseline targets from the Goals page. Any of them may be null until the
// runner computes them. sodiumLimitMg is a user LIMIT (null → 2300 default).
type GoalsTargets = {
  calorieTarget: number | null;
  proteinTargetG: number | null;
  carbsTargetG: number | null;
  fatTargetG: number | null;
  sodiumLimitMg: number | null;
};

// R5/R7 reactive per-day target. The ring TARGET prefers `adjusted` (today's
// training-reactive number) and falls back to `baseline`; `needsBaseline`
// means no targets exist at all.
type Macros = { cal: number; protein: number; carbs: number; fat: number };
type DayTarget = {
  date: string;
  baseline: Macros | null;
  adjusted: Macros | null;
  delta: Macros | null;
  rationale: string | null;
  actual: Macros | null;
  source: "planned" | "actual";
  needsBaseline?: boolean;
};

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

// Build a fixed N-day calendar axis ending today (oldest → newest), filling each
// day from `entries` (or a null-value placeholder). Without this, the trend only
// renders bars for days that HAVE data, so 1-2 logged days stretch into giant
// half-width blocks. A fixed axis makes one day read as one thin bar.
function buildTrendAxis(entries: NutritionDay[], days: number): NutritionDay[] {
  const byDate = new Map(entries.map((e) => [e.date, e]));
  const today = new Date(`${todayUtc()}T12:00:00Z`).getTime();
  const out: NutritionDay[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const iso = new Date(today - i * 86400000).toISOString().slice(0, 10);
    out.push(
      byDate.get(iso) ?? {
        date: iso,
        calories: null,
        proteinG: null,
        carbsG: null,
        fatG: null,
        sodiumMg: null,
        updatedAt: null,
      },
    );
  }
  return out;
}

function fmt(n: number): string {
  return n.toLocaleString();
}

function formatUpdated(iso: string | null): string {
  if (!iso) return "Not synced yet today";
  const d = new Date(iso);
  return `Synced ${d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

function formatDayLabel(date: string): string {
  // date is YYYY-MM-DD; render without TZ drift by anchoring at noon UTC.
  const d = new Date(`${date}T12:00:00Z`);
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric" });
}

// A single macro ring. Monochrome-accent: the progress arc is the teal accent
// (primary), the track is neutral (muted).
//
// R7 dead-state elimination: when a `target` exists we ALWAYS render the
// target track. If intake hasn't synced (`value` null) we show the target
// number over an empty fill ("awaiting intake") rather than a bare dash with
// "No goal set". The "No goal" branch never renders on this page anymore —
// the caller only mounts rings when targets exist.
function MacroRing({
  label,
  Icon,
  value,
  target,
  unit,
}: {
  label: string;
  Icon: LucideIcon;
  value: number | null;
  target: number | null;
  unit: string;
}) {
  const size = 116;
  const stroke = 11;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const hasGoal = target != null && target > 0;
  const awaiting = value == null;
  const pct =
    value != null && hasGoal ? Math.min(1, value / (target as number)) : 0;
  const hit = hasGoal && value != null && value >= (target as number);
  const remaining =
    hasGoal && value != null ? Math.max(0, (target as number) - value) : null;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={stroke}
            className="stroke-muted"
          />
          {hasGoal && !awaiting && (
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              strokeWidth={stroke}
              strokeLinecap="round"
              className="stroke-primary transition-[stroke-dashoffset]"
              strokeDasharray={circ}
              strokeDashoffset={circ * (1 - pct)}
            />
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {/* Awaiting intake: lead with the TARGET number (muted) so the ring
              still means something before the day's food syncs. */}
          <span
            className={
              "text-3xl font-extrabold tabular-nums leading-none " +
              (awaiting ? "text-muted-foreground" : "text-primary")
            }
          >
            {awaiting ? (hasGoal ? fmt(target as number) : "—") : fmt(value as number)}
          </span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">
            {unit}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
        <Icon className="h-3.5 w-3.5 text-primary" />
        {label}
      </div>
      <p className="h-4 text-[11px] text-muted-foreground tabular-nums">
        {awaiting
          ? hasGoal
            ? `Target ${fmt(target as number)} · awaiting intake`
            : "Awaiting intake"
          : hit
            ? "Goal hit"
            : remaining != null
              ? `${fmt(remaining)} ${unit} to go`
              : `${fmt(value as number)} ${unit}`}
      </p>
    </div>
  );
}

// One macro's 14-day trend row: a compact sparkbar strip. The peak across the
// window scales each bar; a bar that meets/exceeds the per-macro target fills
// to full accent, the rest to a dimmer accent so the trend reads at a glance.
function MacroTrendRow({
  label,
  Icon,
  unit,
  entries,
  pick,
  goal,
}: {
  label: string;
  Icon: LucideIcon;
  unit: string;
  entries: NutritionDay[];
  pick: (e: NutritionDay) => number | null;
  goal: number | null;
}) {
  // `entries` is the fixed oldest → newest axis (buildTrendAxis); only days with
  // data count toward the average. The hero is "average per logged day vs goal"
  // as a single readable progress bar; the day-by-day strip only appears once
  // there's enough data for it to read as a trend rather than empty cells.
  const values = entries.map((e) => pick(e));
  const logged = values.filter((v): v is number => v != null);
  const loggedCount = logged.length;
  const avg = loggedCount
    ? Math.round(logged.reduce((a, b) => a + b, 0) / loggedCount)
    : null;
  const pct =
    goal != null && goal > 0 && avg != null ? Math.round((avg / goal) * 100) : null;
  // 90–110% of goal reads as "on target" (green); otherwise the brand accent.
  const onTarget = pct != null && pct >= 90 && pct <= 110;
  const barPct = pct == null ? 0 : Math.max(0, Math.min(100, pct));
  const peak = Math.max(goal ?? 0, 1, ...logged);
  const SHOW_STRIP_AT = 5; // enough days that the daily bars read as a trend

  return (
    <div className="space-y-2">
      <div className="flex items-end justify-between gap-3">
        <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
          <Icon className="h-3.5 w-3.5 text-primary" />
          {label}
        </div>
        <div className="text-right leading-none">
          <div className="text-lg font-extrabold tabular-nums">
            {avg != null ? fmt(avg) : "—"}
            <span className="text-sm font-bold text-muted-foreground">
              {goal != null ? ` / ${fmt(goal)}` : ""} {unit}
            </span>
          </div>
          <div className="text-[10px] text-muted-foreground tracking-wider mt-0.5">
            avg / day
          </div>
        </div>
      </div>

      {/* Progress toward the daily goal — the at-a-glance read. */}
      <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden">
        <div
          className={"h-full rounded-full " + (onTarget ? "bg-emerald-500" : "bg-primary")}
          style={{ width: `${barPct}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground tabular-nums">
        <span>{pct != null ? `${pct}% of goal` : "set a goal to track"}</span>
        <span>
          {loggedCount} of {entries.length} days logged
        </span>
      </div>

      {/* Day-by-day trend — only once there's enough data to be worth reading. */}
      {loggedCount >= SHOW_STRIP_AT && (
        <div className="flex items-end gap-px h-8 pt-1">
          {entries.map((e) => {
            const v = pick(e);
            const h = v == null ? 0 : Math.max(6, (v / peak) * 100);
            const hitGoal = goal != null && v != null && v >= goal;
            return (
              <div
                key={e.date}
                className="flex-1 h-full flex items-end rounded-sm bg-muted/40"
                title={`${formatDayLabel(e.date)}: ${v != null ? `${v} ${unit}` : "no data"}`}
              >
                {v != null && (
                  <div
                    className={"w-full rounded-sm " + (hitGoal ? "bg-primary" : "bg-primary/45")}
                    style={{ height: `${h}%` }}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function Nutrition() {
  const date = todayUtc();
  const todayQuery = useQuery({
    queryKey: ["/api/nutrition/today"],
    queryFn: () => getJson<NutritionDay>("/api/nutrition/today"),
  });
  const recentQuery = useQuery({
    queryKey: ["/api/nutrition/recent", 14],
    queryFn: () => getJson<RecentResponse>("/api/nutrition/recent?days=14"),
  });
  // Baseline targets (the fixed recomp numbers) from the Goals page.
  const goalsQuery = useQuery({
    queryKey: ["/api/goals"],
    queryFn: () => getJson<GoalsTargets>("/api/goals"),
  });
  // R7: today's reactive per-day target drives the rings — the ADJUSTED number
  // (training-reactive) is the live target; baseline is the fallback. Shares
  // the same query key the Today block + mission-action invalidation use, so
  // logging a workout refreshes the rings here too.
  const dayQuery = useQuery({
    queryKey: ["/api/nutrition/day", date],
    queryFn: () => getJson<DayTarget>(`/api/nutrition/day/${date}`),
  });

  const today = todayQuery.data;
  const day = dayQuery.data;
  const baselineGoals = goalsQuery.data;

  // TARGET = today's adjusted target, else baseline (day-target baseline, then
  // the /api/goals baseline as a final fallback so the rings work even before
  // a day-target row exists).
  const adjusted = day?.adjusted ?? null;
  const baseline =
    day?.baseline ??
    (baselineGoals
      ? {
          cal: baselineGoals.calorieTarget ?? 0,
          protein: baselineGoals.proteinTargetG ?? 0,
          carbs: baselineGoals.carbsTargetG ?? 0,
          fat: baselineGoals.fatTargetG ?? 0,
        }
      : null);

  const target = adjusted ?? baseline;
  // "No targets at all": the day-target service says needsBaseline AND the
  // Goals baseline is also empty. This is the only state that shows the
  // single "Calculate targets" CTA — never four "No goal set" rings.
  const noTargets =
    (day?.needsBaseline ?? false) &&
    (baselineGoals == null ||
      (baselineGoals.calorieTarget == null &&
        baselineGoals.proteinTargetG == null &&
        baselineGoals.carbsTargetG == null &&
        baselineGoals.fatTargetG == null));

  // Ring FILL = actual intake (prefer the day-target's actual; fall back to
  // today's synced row). Each macro degrades to null → "awaiting intake".
  const actual: Macros | null =
    day?.actual ??
    (today &&
    (today.calories != null ||
      today.proteinG != null ||
      today.carbsG != null ||
      today.fatG != null)
      ? {
          cal: today.calories ?? 0,
          protein: today.proteinG ?? 0,
          carbs: today.carbsG ?? 0,
          fat: today.fatG ?? 0,
        }
      : null);

  const macros: Array<{
    label: string;
    Icon: LucideIcon;
    value: number | null;
    target: number | null;
    unit: string;
  }> = [
    {
      label: "Calories",
      Icon: Flame,
      value: today?.calories ?? day?.actual?.cal ?? null,
      target: target?.cal ?? null,
      unit: "kcal",
    },
    {
      label: "Protein",
      Icon: Beef,
      value: today?.proteinG ?? day?.actual?.protein ?? null,
      target: target?.protein ?? null,
      unit: "g",
    },
    {
      label: "Carbs",
      Icon: Wheat,
      value: today?.carbsG ?? day?.actual?.carbs ?? null,
      target: target?.carbs ?? null,
      unit: "g",
    },
    {
      label: "Fat",
      Icon: Droplet,
      value: today?.fatG ?? day?.actual?.fat ?? null,
      target: target?.fat ?? null,
      unit: "g",
    },
  ];

  const entries = recentQuery.data?.entries ?? [];
  // Fixed 14-day axis so sparse data renders as thin daily bars, not blocks.
  const trendAxis = buildTrendAxis(entries, 14);
  const loadingRings =
    todayQuery.isLoading || goalsQuery.isLoading || dayQuery.isLoading;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-4xl font-extrabold tracking-tight text-foreground">
          Nutrition
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Calories and macros synced from your food tracker via Apple Health.
        </p>
      </div>

      {/* AI Nutritionist deep-dive — protein adequacy, body-composition
          diagnosis (where you are, what you should see, why you may not be),
          fuelling, and concrete next moves. Reads the server-cached analysis. */}
      <NutritionistPanel variant="full" weeks={8} />

      {/* Today's four macros vs target. Phase 6: de-boxed — the rings sit on
          the page under a quiet hairline header, not stranded in a giant
          outlined panel. */}
      <Card className="border-0 bg-transparent shadow-none">
        <CardHeader className="px-0 pb-3 border-b border-border">
          <CardTitle className="flex items-center justify-between text-sm tracking-wider text-muted-foreground">
            <span>Today</span>
            <span className="flex items-center gap-1.5 text-xs font-normal normal-case">
              <RefreshCw className="h-3 w-3" />
              {formatUpdated(today?.updatedAt ?? null)}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="px-0 pt-4">
          {loadingRings ? (
            <Skeleton className="h-40 w-full" />
          ) : noTargets ? (
            // R7: one clear CTA when NO targets exist — never four dead rings.
            <div
              className="flex flex-col items-center gap-3 py-6 text-center"
              data-testid="nutrition-no-targets"
            >
              <Sparkles className="h-7 w-7 text-primary" />
              <p className="text-sm text-muted-foreground max-w-sm">
                No targets yet. Calculate your reactive calorie + macro targets
                and these rings light up with today's number.
              </p>
              <Button
                className="font-bold tracking-wider"
                onClick={() => window.location.assign("/goals")}
                data-testid="button-nutrition-calculate-targets"
              >
                Calculate targets
              </Button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
                {macros.map((m) => (
                  <MacroRing key={m.label} {...m} />
                ))}
              </div>
              {/* baseline → adjusted reactivity readout + rationale. */}
              {adjusted && baseline && (
                <div className="mt-4 space-y-2">
                  <p
                    className="text-xs text-muted-foreground tabular-nums"
                    data-testid="text-nutrition-recomp"
                  >
                    baseline {fmt(baseline.cal)} → today{" "}
                    <span className="font-bold text-foreground">
                      {fmt(adjusted.cal)}
                    </span>{" "}
                    kcal
                    {day?.source === "actual" ? " · from logged session" : ""}
                  </p>
                  {day?.rationale && (
                    <p className="text-sm text-muted-foreground border-l-2 border-primary/40 pl-3 flex items-start gap-2">
                      <Sparkles className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
                      <span>{day.rationale}</span>
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* 14-day trend across all four macros */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm tracking-wider text-muted-foreground">
            Last 14 days
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Your average per logged day vs your daily goal.
          </p>
        </CardHeader>
        <CardContent>
          {recentQuery.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No nutrition synced yet. Once your Apple Shortcut runs, the days
              will fill in here.
            </p>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2">
              <MacroTrendRow
                label="Calories"
                Icon={Flame}
                unit="kcal"
                entries={trendAxis}
                pick={(e) => e.calories}
                goal={target?.cal ?? null}
              />
              <MacroTrendRow
                label="Protein"
                Icon={Beef}
                unit="g"
                entries={trendAxis}
                pick={(e) => e.proteinG}
                goal={target?.protein ?? null}
              />
              <MacroTrendRow
                label="Carbs"
                Icon={Wheat}
                unit="g"
                entries={trendAxis}
                pick={(e) => e.carbsG}
                goal={target?.carbs ?? null}
              />
              <MacroTrendRow
                label="Fat"
                Icon={Droplet}
                unit="g"
                entries={trendAxis}
                pick={(e) => e.fatG}
                goal={target?.fat ?? null}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Per-day history of every logged day with the actual numbers. */}
      <NutritionLog />

      {/* Maintenance: start nutrition tracking fresh from a chosen date
          (clears earlier logs + rebuilds the AI read; plan/body/workouts kept). */}
      <ResetNutritionButton />
    </div>
  );
}
