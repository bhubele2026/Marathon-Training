import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Beef, Droplet, Flame, RefreshCw, Sparkles, Wheat } from "lucide-react";
import type { LucideIcon } from "lucide-react";

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

// Standard daily sodium guideline (mg) used when the runner hasn't set a limit.
const DEFAULT_SODIUM_LIMIT_MG = 2300;
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

// Sodium readout: today's intake vs the daily limit (user-set or the 2300 mg
// default). This is a LIMIT, not a target — the whole point is to flag when the
// runner is OVER, so the over state uses the muted warning tone (destructive),
// NOT the cobalt accent. Under is neutral/ok; not-yet-synced shows the limit
// with an "awaiting intake" state rather than a dead dash.
function SodiumReadout({
  intake,
  limit,
}: {
  intake: number | null;
  limit: number;
}) {
  const awaiting = intake == null;
  const over = !awaiting && intake > limit;
  const overBy = over ? intake - limit : 0;
  const pct = awaiting ? 0 : Math.min(100, (intake / limit) * 100);

  return (
    <div className="space-y-2" data-testid="nutrition-sodium">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
          Sodium
        </div>
        <span
          className={
            "text-sm tabular-nums " +
            (over ? "font-bold text-destructive" : "text-muted-foreground")
          }
        >
          {awaiting ? (
            <>
              <span className="text-muted-foreground">Awaiting intake</span>
              <span className="text-muted-foreground"> · limit {fmt(limit)} mg</span>
            </>
          ) : (
            <>
              <span
                className={
                  "font-bold " + (over ? "text-destructive" : "text-foreground")
                }
              >
                {fmt(intake)}
              </span>{" "}
              / {fmt(limit)} mg
            </>
          )}
        </span>
      </div>
      {/* Thick bar. Track is neutral; fill is muted/neutral when under the
          limit and the warning tone when over. */}
      <div className="h-3 w-full bg-muted overflow-hidden">
        <div
          className={
            "h-full transition-[width] " +
            (over ? "bg-destructive" : awaiting ? "bg-muted-foreground/30" : "bg-foreground/70")
          }
          style={{ width: `${awaiting ? 0 : pct}%` }}
        />
      </div>
      <p className="h-4 text-[11px] tabular-nums">
        {over ? (
          <span
            className="font-bold text-destructive"
            data-testid="nutrition-sodium-over"
          >
            Over by {fmt(overBy)} mg
          </span>
        ) : awaiting ? (
          <span className="text-muted-foreground">No sodium synced yet today</span>
        ) : (
          <span className="text-muted-foreground">
            {fmt(Math.max(0, limit - intake))} mg under limit
          </span>
        )}
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
  const peak = Math.max(goal ?? 0, 1, ...entries.map((e) => pick(e) ?? 0));
  const latest = entries[0] ? pick(entries[0]) : null;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
          <Icon className="h-3.5 w-3.5 text-primary" />
          {label}
        </div>
        <span className="text-xs tabular-nums text-muted-foreground">
          {latest != null ? (
            <>
              <span className="font-bold text-foreground">{fmt(latest)}</span> {unit}
            </>
          ) : (
            <span>—</span>
          )}
          {goal != null && (
            <span className="text-muted-foreground"> · goal {fmt(goal)}</span>
          )}
        </span>
      </div>
      {/* Oldest → newest left to right (entries arrive newest-first). */}
      <div className="flex items-end gap-0.5 h-10">
        {[...entries].reverse().map((e) => {
          const v = pick(e);
          const h = v == null ? 0 : Math.max(2, (v / peak) * 100);
          const hitGoal = goal != null && v != null && v >= goal;
          return (
            <div
              key={e.date}
              className="flex-1 bg-muted/60 h-full flex items-end"
              title={`${formatDayLabel(e.date)}: ${v != null ? `${v} ${unit}` : "no data"}`}
            >
              <div
                className={hitGoal ? "w-full bg-primary" : "w-full bg-primary/40"}
                style={{ height: `${h}%` }}
              />
            </div>
          );
        })}
      </div>
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

  // Sodium: today's intake vs the daily limit (user-set, else 2300 mg default).
  // A LIMIT, not part of the macro/calorie math — derived independently of the
  // ring targets so it shows even before any AI targets are computed.
  const sodiumIntake = today?.sodiumMg ?? null;
  const sodiumLimit = baselineGoals?.sodiumLimitMg ?? DEFAULT_SODIUM_LIMIT_MG;

  const entries = recentQuery.data?.entries ?? [];
  const loadingRings =
    todayQuery.isLoading || goalsQuery.isLoading || dayQuery.isLoading;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-4xl font-extrabold tracking-tight text-primary">
          Nutrition
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Calories and macros synced from your food tracker via Apple Health.
        </p>
      </div>

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
          {/* Sodium vs daily limit — a ceiling to stay under, flagged in the
              warning tone when over. Independent of the macro rings/targets. */}
          {!loadingRings && (
            <div className="mt-6 border-t border-border pt-4">
              <SodiumReadout intake={sodiumIntake} limit={sodiumLimit} />
            </div>
          )}
        </CardContent>
      </Card>

      {/* 14-day trend across all four macros */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm tracking-wider text-muted-foreground">
            Last 14 days
          </CardTitle>
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
                entries={entries}
                pick={(e) => e.calories}
                goal={target?.cal ?? null}
              />
              <MacroTrendRow
                label="Protein"
                Icon={Beef}
                unit="g"
                entries={entries}
                pick={(e) => e.proteinG}
                goal={target?.protein ?? null}
              />
              <MacroTrendRow
                label="Carbs"
                Icon={Wheat}
                unit="g"
                entries={entries}
                pick={(e) => e.carbsG}
                goal={target?.carbs ?? null}
              />
              <MacroTrendRow
                label="Fat"
                Icon={Droplet}
                unit="g"
                entries={entries}
                pick={(e) => e.fatG}
                goal={target?.fat ?? null}
              />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
