import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Beef, ChevronLeft, ChevronRight, Droplet, Flame, RefreshCw, Sparkles, Wheat } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { NutritionistPanel } from "@/components/nutritionist-panel";
import {
  CoachNote,
  MetricRing,
  WaterTracker,
  type MetricRingArc,
} from "@/components/studio";
import { NutritionLog } from "@/components/nutrition-log";
import { ResetNutritionButton } from "@/components/reset-nutrition-button";
import { CloseDayButton } from "@/components/close-day-button";
import { ConsistencyStrip } from "@/components/consistency-strip";
import { NutritionEntryForm } from "@/components/nutrition-entry-form";
import { NutritionPlanCard } from "@/components/nutrition-plan-card";
import { WaterQuickAdd } from "@/components/water-quick-add";

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
  waterMl: number | null;
  closedAt: string | null;
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

const ML_PER_OZ = 29.5735;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

// The runner's LOCAL calendar day (YYYY-MM-DD), not UTC. An evening in the US is
// already "tomorrow" in UTC, so a UTC "today" would flip the rings to an empty
// new day before the runner's day is actually over (their logged data then looks
// like it vanished). Local keeps "today" aligned with the day they're living.
function localTodayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Shift a YYYY-MM-DD string by n days, TZ-safe (operates on the date parts in
// UTC and reformats), for the day navigator's prev/next.
function shiftDay(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

// "Tue, Jun 24" style label for a YYYY-MM-DD (anchored at noon UTC so the
// calendar day doesn't drift across timezones).
function dayLabel(dateStr: string): string {
  return new Date(`${dateStr}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

// Build a fixed N-day calendar axis ending today (oldest → newest), filling each
// day from `entries` (or a null-value placeholder). Without this, the trend only
// renders bars for days that HAVE data, so 1-2 logged days stretch into giant
// half-width blocks. A fixed axis makes one day read as one thin bar.
function buildTrendAxis(entries: NutritionDay[], days: number): NutritionDay[] {
  const byDate = new Map(entries.map((e) => [e.date, e]));
  const today = new Date(`${localTodayStr()}T12:00:00Z`).getTime();
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
        waterMl: null,
        closedAt: null,
        updatedAt: null,
      },
    );
  }
  return out;
}

// Average ounces of water over the most-recent `n` days that have water logged.
// Order-independent (sorts by date desc first) since the recent feed's order
// isn't contractual. Derived client-side from the per-day `waterMl` already
// synced from Apple Health — no dedicated water endpoint (Phase 13 adds writes).
function avgOz(entries: NutritionDay[], n: number): number | null {
  const withWater = entries
    .filter((e) => e.waterMl != null && e.waterMl > 0)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, n);
  if (withWater.length === 0) return null;
  const totalMl = withWater.reduce((s, e) => s + (e.waterMl ?? 0), 0);
  return totalMl / withWater.length / ML_PER_OZ;
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

// A compact macro readout chip — the supporting detail beside the hero ring.
// The colored dot is the macro's fixed metric color (protein=violet,
// carbs=teal, fat=amber); the line below states what's left / hit / awaiting.
function MacroChip({
  label,
  Icon,
  color,
  value,
  target,
  unit,
}: {
  label: string;
  Icon: LucideIcon;
  color: string;
  value: number | null;
  target: number | null;
  unit: string;
}) {
  const hasGoal = target != null && target > 0;
  const awaiting = value == null;
  const hit = hasGoal && value != null && value >= target;
  const remaining =
    hasGoal && value != null ? Math.max(0, target - value) : null;
  return (
    <div className="rounded-xl bg-secondary/60 p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        <span
          className="h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: color }}
          aria-hidden
        />
        <Icon className="h-3.5 w-3.5" style={{ color }} />
        {label}
      </div>
      <p className="mt-1.5 font-display text-2xl font-extrabold tabular-nums leading-none tracking-tight text-foreground">
        {awaiting ? (hasGoal ? fmt(target) : "—") : fmt(value)}
        {hasGoal && (
          <span className="ml-1 text-xs font-medium text-muted-foreground">
            / {fmt(target)} {unit}
          </span>
        )}
      </p>
      <p className="mt-1 h-4 text-[11px] tabular-nums text-muted-foreground">
        {awaiting
          ? hasGoal
            ? "awaiting intake"
            : "—"
          : hit
            ? "goal hit"
            : remaining != null
              ? `${fmt(remaining)} ${unit} to go`
              : `${fmt(value)} ${unit}`}
      </p>
    </div>
  );
}

// One macro's 14-day trend row: a progress bar toward the daily goal plus a
// day-by-day strip once there's enough data. Colored to the macro's fixed
// metric color (azure/violet/teal/amber); a bar within 90–110% of goal reads
// as on-target in success-green.
function MacroTrendRow({
  label,
  Icon,
  unit,
  color,
  entries,
  pick,
  goal,
}: {
  label: string;
  Icon: LucideIcon;
  unit: string;
  color: string;
  entries: NutritionDay[];
  pick: (e: NutritionDay) => number | null;
  goal: number | null;
}) {
  const values = entries.map((e) => pick(e));
  const logged = values.filter((v): v is number => v != null);
  const loggedCount = logged.length;
  const avg = loggedCount
    ? Math.round(logged.reduce((a, b) => a + b, 0) / loggedCount)
    : null;
  const pct =
    goal != null && goal > 0 && avg != null ? Math.round((avg / goal) * 100) : null;
  // 90–110% of goal reads as "on target" (success); otherwise the macro color.
  const onTarget = pct != null && pct >= 90 && pct <= 110;
  const barPct = pct == null ? 0 : Math.max(0, Math.min(100, pct));
  const peak = Math.max(goal ?? 0, 1, ...logged);
  const SHOW_STRIP_AT = 5; // enough days that the daily bars read as a trend

  return (
    <div className="space-y-2">
      <div className="flex items-end justify-between gap-3">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          <Icon className="h-3.5 w-3.5" style={{ color }} />
          {label}
        </div>
        <div className="text-right leading-none">
          <div className="font-display text-lg font-extrabold tabular-nums">
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
          className="h-full rounded-full"
          style={{
            width: `${barPct}%`,
            backgroundColor: onTarget ? "hsl(var(--success))" : color,
          }}
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
                    className="w-full rounded-sm"
                    style={{ backgroundColor: color, opacity: hitGoal ? 1 : 0.45, height: `${h}%` }}
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
  // The day under review — defaults to today; the navigator steps it back/forward
  // so any past day can be reviewed (and closed). Never past today.
  const todayStr = localTodayStr();
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const date = selectedDate;
  const isToday = selectedDate === todayStr;

  // Power touch: ←/→ browse days (ignored while typing in a field). Never future.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const el = document.activeElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || (el as HTMLElement).isContentEditable)) return;
      if (e.key === "ArrowLeft") setSelectedDate((cur) => shiftDay(cur, -1));
      else setSelectedDate((cur) => (cur >= todayStr ? cur : shiftDay(cur, 1)));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [todayStr]);
  const todayQuery = useQuery({
    queryKey: ["/api/nutrition/today"],
    queryFn: () => getJson<NutritionDay>("/api/nutrition/today"),
  });
  // 90-day window so the navigator + close button have each day's full row
  // (water / sodium / closedAt). Shared key with the Nutrition log, so it's one
  // fetch for the trend, the rings' per-day row, the log, and the close button.
  const recentQuery = useQuery({
    queryKey: ["/api/nutrition/recent", 90],
    queryFn: () => getJson<RecentResponse>("/api/nutrition/recent?days=90"),
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

  // Prefer the LOCAL-day row from the recent feed (it carries water / sodium /
  // updatedAt for the runner's actual day); fall back to /api/nutrition/today
  // (the server's UTC day) only when the local day isn't in the window yet.
  const today =
    recentQuery.data?.entries.find((e) => e.date === date) ??
    (isToday ? todayQuery.data : undefined);
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

  // Per-macro intake (prefer the day-target's actual; fall back to the synced
  // row). Each degrades to null → "awaiting intake".
  const calValue = today?.calories ?? day?.actual?.cal ?? null;
  const proteinValue = today?.proteinG ?? day?.actual?.protein ?? null;
  const carbsValue = today?.carbsG ?? day?.actual?.carbs ?? null;
  const fatValue = today?.fatG ?? day?.actual?.fat ?? null;

  // Macro arcs step inward from the azure calorie hero (matches the Today page).
  const macroArcs: MetricRingArc[] = [
    { value: proteinValue, goal: target?.protein ?? null, color: "hsl(var(--chart-2))", label: "Protein" },
    { value: carbsValue, goal: target?.carbs ?? null, color: "hsl(var(--chart-3))", label: "Carbs" },
    { value: fatValue, goal: target?.fat ?? null, color: "hsl(var(--chart-4))", label: "Fat" },
  ];

  const entries = recentQuery.data?.entries ?? [];
  // Fixed 14-day axis so sparse data renders as thin daily bars, not blocks.
  const trendAxis = buildTrendAxis(entries, 14);
  const loadingRings =
    todayQuery.isLoading || goalsQuery.isLoading || dayQuery.isLoading;

  // Hydration — derived client-side from the synced `waterMl`. Goal defaults to
  // a flat 64 oz here (bodyweight isn't fetched on this page); Phase 13 wires
  // first-class water writes + a bodyweight-scaled goal.
  const waterOz = today?.waterMl != null ? Math.round(today.waterMl / ML_PER_OZ) : 0;

  return (
    <div className="mx-auto max-w-[1440px] space-y-6 px-4 md:px-8">
      <div>
        <h1 className="font-display text-4xl font-extrabold tracking-tight text-foreground">
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

      {/* Logging streak + clickable mini-calendar of recent days. */}
      <ConsistencyStrip
        entries={entries}
        selectedDate={selectedDate}
        todayStr={todayStr}
        onSelect={setSelectedDate}
      />

      {/* Per-day review tile: navigator + the calorie hero ring with macro arcs,
          compact macro chips, a first-class water tracker, and the coach's
          reactivity note. One tile — no divider rules. */}
      <Card className="p-6">
        <CardHeader className="p-0 pb-4">
          <CardTitle className="flex flex-wrap items-center justify-between gap-3 text-sm tracking-wider text-muted-foreground">
            {/* Day navigator — step back/forward, or jump with the date input. */}
            <div className="flex items-center gap-1 normal-case">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setSelectedDate(shiftDay(selectedDate, -1))}
                aria-label="Previous day"
                data-testid="button-prev-day"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <input
                type="date"
                value={selectedDate}
                max={todayStr}
                onChange={(e) => e.target.value && setSelectedDate(e.target.value)}
                className="rounded-xl border border-input bg-transparent px-2 py-1 text-xs tabular-nums text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                data-testid="input-review-date"
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setSelectedDate(shiftDay(selectedDate, 1))}
                disabled={isToday}
                aria-label="Next day"
                data-testid="button-next-day"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <span className="ml-1 font-display text-sm font-semibold tracking-tight text-foreground">
                {isToday ? "Today" : dayLabel(selectedDate)}
              </span>
              {!isToday && (
                <button
                  type="button"
                  onClick={() => setSelectedDate(todayStr)}
                  className="ml-1 rounded text-xs font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  data-testid="button-jump-today"
                >
                  Today
                </button>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-3 normal-case">
              <NutritionEntryForm
                date={date}
                triggerLabel="Log food"
                triggerClassName="h-8 px-3 text-xs"
              />
              <span className="flex items-center gap-1.5 text-xs font-normal">
                <RefreshCw className="h-3 w-3" />
                {formatUpdated(today?.updatedAt ?? null)}
              </span>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loadingRings ? (
            <Skeleton className="h-48 w-full rounded-2xl" />
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
            <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
              {/* Calories hero ring + macro arcs + supporting chips. */}
              <div className="space-y-5">
                <div className="flex items-center gap-5">
                  <MetricRing
                    value={calValue}
                    goal={target?.cal ?? null}
                    label="kcal"
                    hero
                    macros={macroArcs}
                  />
                  <div className="min-w-0">
                    <p className="font-display text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                      Calories
                    </p>
                    <p className="font-display text-3xl font-extrabold tabular-nums tracking-tight text-foreground">
                      {calValue != null ? fmt(calValue) : fmt(target?.cal ?? 0)}
                      <span className="ml-1 text-sm font-medium text-muted-foreground">
                        {target?.cal != null ? `/ ${fmt(target.cal)} kcal` : "kcal"}
                      </span>
                    </p>
                    {adjusted && baseline && (
                      <p
                        className="mt-1 text-xs text-muted-foreground tabular-nums"
                        data-testid="text-nutrition-recomp"
                      >
                        baseline {fmt(baseline.cal)} → today{" "}
                        <span className="font-semibold text-foreground">{fmt(adjusted.cal)}</span> kcal
                        {day?.source === "actual" ? " · from logged session" : ""}
                      </p>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <MacroChip label="Protein" Icon={Beef} color="hsl(var(--chart-2))" value={proteinValue} target={target?.protein ?? null} unit="g" />
                  <MacroChip label="Carbs" Icon={Wheat} color="hsl(var(--chart-3))" value={carbsValue} target={target?.carbs ?? null} unit="g" />
                  <MacroChip label="Fat" Icon={Droplet} color="hsl(var(--chart-4))" value={fatValue} target={target?.fat ?? null} unit="g" />
                </div>
                {day?.rationale && <CoachNote icon={Sparkles}>{day.rationale}</CoachNote>}
              </div>

              {/* Hydration — first-class tile (replaces the old orphan line),
                  now with tap-to-add logging into the real water store. */}
              <div data-testid="tile-nutrition-water" className="space-y-3">
                <WaterTracker
                  oz={waterOz}
                  goalOz={64}
                  weeklyAvgOz={avgOz(entries, 7)}
                  monthlyAvgOz={avgOz(entries, 30)}
                />
                <WaterQuickAdd date={date} />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Close / reopen the day under review (acts on the selected date). */}
      <CloseDayButton date={selectedDate} />

      {/* Phase 15: the viewable personalized nutrition plan, derived from the
          baseline targets (which trace to the active plan's goal + safe deficit). */}
      <NutritionPlanCard
        calorieTarget={baselineGoals?.calorieTarget ?? null}
        proteinTargetG={baselineGoals?.proteinTargetG ?? null}
        carbsTargetG={baselineGoals?.carbsTargetG ?? null}
        fatTargetG={baselineGoals?.fatTargetG ?? null}
      />

      {/* 14-day trend across all four macros, each in its fixed metric color. */}
      <Card>
        <CardHeader>
          <CardTitle className="font-display text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            Last 14 days
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Your average per logged day vs your daily goal.
          </p>
        </CardHeader>
        <CardContent>
          {recentQuery.isLoading ? (
            <Skeleton className="h-40 w-full rounded-2xl" />
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
                color="hsl(var(--chart-1))"
                entries={trendAxis}
                pick={(e) => e.calories}
                goal={target?.cal ?? null}
              />
              <MacroTrendRow
                label="Protein"
                Icon={Beef}
                unit="g"
                color="hsl(var(--chart-2))"
                entries={trendAxis}
                pick={(e) => e.proteinG}
                goal={target?.protein ?? null}
              />
              <MacroTrendRow
                label="Carbs"
                Icon={Wheat}
                unit="g"
                color="hsl(var(--chart-3))"
                entries={trendAxis}
                pick={(e) => e.carbsG}
                goal={target?.carbs ?? null}
              />
              <MacroTrendRow
                label="Fat"
                Icon={Droplet}
                unit="g"
                color="hsl(var(--chart-4))"
                entries={trendAxis}
                pick={(e) => e.fatG}
                goal={target?.fat ?? null}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Per-day history of every logged day with the actual numbers. */}
      <NutritionLog onSelectDate={setSelectedDate} selectedDate={selectedDate} />

      {/* Maintenance: start nutrition tracking fresh from a chosen date
          (clears earlier logs + rebuilds the AI read; plan/body/workouts kept). */}
      <ResetNutritionButton />
    </div>
  );
}
