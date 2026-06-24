// History browser (Phase 14). Browse exactly what was logged by Day /
// Week / Month, with manual-vs-synced provenance on every nutrition and
// water entry. Composed entirely CLIENT-SIDE from the Phase 13 entries
// endpoints (nutrition entries + water logs, both range-queryable) plus
// the existing workouts + measurements lists — no aggregator endpoint
// needed. Bright tiled language; honest empty/sparse states.
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, UtensilsCrossed, Dumbbell, Droplet, Scale } from "lucide-react";
import {
  useListNutritionEntries,
  useListWaterLogs,
  useListWorkouts,
  useListMeasurements,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  SegmentedControl,
  StatTile,
  TrendArea,
  EmptyState,
  SectionHeader,
} from "@/components/studio";

type Granularity = "day" | "week" | "month";

// ---- local-day helpers (mirror nutrition.tsx's localTodayStr) ----
function localTodayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const dt = new Date(Date.UTC(y, m - 1, day));
  return dt.toISOString().slice(0, 10);
}
function parseISO(iso: string): Date {
  return new Date(`${iso}T12:00:00Z`);
}
function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addDaysISO(iso: string, n: number): string {
  const d = parseISO(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toISO(d);
}
// Monday-on-or-before, for week windows.
function mondayOnOrBefore(iso: string): string {
  const d = parseISO(iso);
  const dow = (d.getUTCDay() + 6) % 7; // 0 = Monday
  return addDaysISO(iso, -dow);
}
function firstOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}
function lastOfMonth(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m!, 0)); // day 0 of next month = last day
  return toISO(d);
}

// Resolve the [from, to] window + a human label for the active period.
function windowFor(granularity: Granularity, anchor: string): {
  from: string;
  to: string;
  label: string;
} {
  if (granularity === "day") {
    return { from: anchor, to: anchor, label: prettyDay(anchor) };
  }
  if (granularity === "week") {
    const from = mondayOnOrBefore(anchor);
    const to = addDaysISO(from, 6);
    return { from, to, label: `${prettyShort(from)} – ${prettyShort(to)}` };
  }
  const from = firstOfMonth(anchor);
  const to = lastOfMonth(anchor);
  return {
    from,
    to,
    label: parseISO(from).toLocaleDateString(undefined, {
      month: "long",
      year: "numeric",
    }),
  };
}
function stepAnchor(granularity: Granularity, anchor: string, dir: -1 | 1): string {
  if (granularity === "day") return addDaysISO(anchor, dir);
  if (granularity === "week") return addDaysISO(mondayOnOrBefore(anchor), dir * 7);
  // month
  const [y, m] = firstOfMonth(anchor).split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + dir, 1));
  return toISO(d);
}
function prettyDay(iso: string): string {
  return parseISO(iso).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}
function prettyShort(iso: string): string {
  return parseISO(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function inRange(iso: string, from: string, to: string): boolean {
  return iso >= from && iso <= to;
}
function n(v: number | null | undefined): number {
  return v ?? 0;
}

export default function History() {
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [anchor, setAnchor] = useState<string>(localTodayStr());

  const { from, to, label } = useMemo(
    () => windowFor(granularity, anchor),
    [granularity, anchor],
  );

  const { data: entries, isLoading: lE } = useListNutritionEntries({ from, to });
  const { data: waters, isLoading: lW } = useListWaterLogs({ from, to });
  const { data: workoutsAll, isLoading: lWo } = useListWorkouts({ from, to });
  const { data: measurementsAll, isLoading: lM } = useListMeasurements();
  const loading = lE || lW || lWo || lM;

  // Measurements aren't range-queryable server-side — filter client-side.
  const measurements = useMemo(
    () => (measurementsAll ?? []).filter((m) => inRange(m.date, from, to)),
    [measurementsAll, from, to],
  );
  const workouts = workoutsAll ?? [];
  const foodEntries = entries ?? [];
  const waterLogs = waters ?? [];

  // ---- period rollups ----
  const totals = useMemo(() => {
    const cal = foodEntries.reduce((s, e) => s + n(e.calories), 0);
    const protein = foodEntries.reduce((s, e) => s + n(e.proteinG), 0);
    const waterOz = waterLogs.reduce((s, w) => s + n(w.oz), 0);
    const loggedDays = new Set(foodEntries.map((e) => e.date)).size;
    return { cal, protein, waterOz, loggedDays, sessions: workouts.length };
  }, [foodEntries, waterLogs, workouts]);

  // Weight trend over the window (for the period chart) — uses real
  // weigh-ins in range; sparse fallback handles <2 points.
  const weightTrend = useMemo(
    () =>
      measurements
        .filter((m) => m.weight != null)
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((m) => ({ date: prettyShort(m.date), weight: m.weight as number })),
    [measurements],
  );

  // ---- per-day grouping (desc) ----
  const days = useMemo(() => {
    const set = new Set<string>();
    foodEntries.forEach((e) => set.add(e.date));
    waterLogs.forEach((w) => set.add(w.date));
    workouts.forEach((w) => set.add(w.date));
    measurements.forEach((m) => set.add(m.date));
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [foodEntries, waterLogs, workouts, measurements]);

  const hasAnything = days.length > 0;

  return (
    <div className="mx-auto max-w-[1440px] px-4 md:px-8 py-6 flex flex-col gap-6">
      {/* Header + scale toggle + period navigator */}
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold tracking-tight text-foreground">
            History
          </h1>
          <p className="text-[15px] text-muted-foreground">
            Everything you've logged — manual and synced, side by side.
          </p>
        </div>
        <SegmentedControl<Granularity>
          ariaLabel="History range"
          value={granularity}
          onChange={setGranularity}
          options={[
            { value: "day", label: "Daily" },
            { value: "week", label: "Weekly" },
            { value: "month", label: "Monthly" },
          ]}
        />
      </div>

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          aria-label="Previous period"
          data-testid="history-prev"
          onClick={() => setAnchor((a) => stepAnchor(granularity, a, -1))}
          className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-card-border bg-card text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div
          className="font-display text-lg font-bold tracking-tight text-foreground"
          data-testid="history-period-label"
        >
          {label}
        </div>
        <button
          type="button"
          aria-label="Next period"
          data-testid="history-next"
          onClick={() => setAnchor((a) => stepAnchor(granularity, a, 1))}
          className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-card-border bg-card text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {/* Period rollup tiles */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          icon={UtensilsCrossed}
          label="Calories"
          value={Math.round(totals.cal).toLocaleString()}
          unit="kcal"
          footer={
            <span className="text-[12px] text-muted-foreground">
              {granularity === "day" ? "this day" : `${totals.loggedDays} logged days`}
            </span>
          }
        />
        <StatTile
          icon={UtensilsCrossed}
          label="Protein"
          value={Math.round(totals.protein).toLocaleString()}
          unit="g"
        />
        <StatTile icon={Dumbbell} label="Sessions" value={String(totals.sessions)} />
        <StatTile
          icon={Droplet}
          label="Water"
          value={(totals.waterOz / 33.814).toFixed(2)}
          unit="L"
          footer={
            <span className="text-[12px] text-muted-foreground tabular-nums">
              {Math.round(totals.waterOz)} oz
            </span>
          }
        />
      </div>

      {/* Weight trend across the window */}
      <Card>
        <CardContent className="p-6">
          <SectionHeader eyebrow={`Weight · ${label}`} />
          <div className="mt-4">
            <TrendArea
              data={weightTrend}
              xKey="date"
              yKey="weight"
              unit=" lb"
              sparseFallback={
                <EmptyState
                  icon={Scale}
                  title="Not enough weigh-ins this period"
                  hint="Log a couple and your trend line shows up here."
                />
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Per-day breakdown with provenance */}
      {!hasAnything ? (
        <EmptyState
          icon={UtensilsCrossed}
          title={loading ? "Loading…" : "Nothing logged this period"}
          hint={
            loading
              ? "Pulling your entries together."
              : "Pick another period, or log a meal, water, or a workout to fill it in."
          }
        />
      ) : (
        <div className="flex flex-col gap-4" data-testid="history-days">
          {days.map((d) => (
            <DayCard
              key={d}
              date={d}
              entries={foodEntries.filter((e) => e.date === d)}
              waterLogs={waterLogs.filter((w) => w.date === d)}
              workouts={workouts.filter((w) => w.date === d)}
              measurements={measurements.filter((m) => m.date === d)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProvenanceBadge({ source }: { source: "manual" | "health_sync" }) {
  return source === "manual" ? (
    <Badge variant="azure" data-testid="badge-manual">
      Manual
    </Badge>
  ) : (
    <Badge variant="neutral" data-testid="badge-synced">
      Synced
    </Badge>
  );
}

function macroLine(e: {
  calories?: number | null;
  proteinG?: number | null;
  carbsG?: number | null;
  fatG?: number | null;
}): string {
  const parts: string[] = [];
  if (e.calories != null) parts.push(`${Math.round(e.calories)} kcal`);
  if (e.proteinG != null) parts.push(`${Math.round(e.proteinG)}P`);
  if (e.carbsG != null) parts.push(`${Math.round(e.carbsG)}C`);
  if (e.fatG != null) parts.push(`${Math.round(e.fatG)}F`);
  return parts.join(" · ") || "—";
}

function DayCard({
  date,
  entries,
  waterLogs,
  workouts,
  measurements,
}: {
  date: string;
  entries: Array<{
    id: number;
    label?: string | null;
    calories?: number | null;
    proteinG?: number | null;
    carbsG?: number | null;
    fatG?: number | null;
    source: "manual" | "health_sync";
  }>;
  waterLogs: Array<{ id: number; oz: number; source: "manual" | "health_sync" }>;
  workouts: Array<{ id: number; sessionType: string; totalMin?: number | null; durationMin?: number | null }>;
  measurements: Array<{ id: number; weight?: number | null; bodyFatPct?: number | null }>;
}) {
  const waterOz = waterLogs.reduce((s, w) => s + n(w.oz), 0);
  return (
    <Card data-testid={`history-day-${date}`}>
      <CardContent className="p-6 min-w-0">
        <div className="mb-3 font-display text-base font-bold tracking-tight text-foreground">
          {prettyDay(date)}
        </div>
        <div className="flex flex-col gap-2">
          {entries.map((e) => (
            <div
              key={`f${e.id}`}
              className="flex items-center justify-between gap-3 min-w-0"
            >
              <div className="min-w-0">
                <div className="truncate text-[15px] font-medium text-foreground">
                  {e.label || "Food"}
                </div>
                <div className="text-[13px] text-muted-foreground tabular-nums">
                  {macroLine(e)}
                </div>
              </div>
              <ProvenanceBadge source={e.source} />
            </div>
          ))}

          {waterLogs.length > 0 && (
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-[15px] text-foreground">
                <Droplet className="h-4 w-4 text-[hsl(var(--chart-5))]" />
                <span className="tabular-nums">{Math.round(waterOz)} oz water</span>
              </div>
              <ProvenanceBadge
                source={
                  waterLogs.every((w) => w.source === "manual") ? "manual" : "health_sync"
                }
              />
            </div>
          )}

          {workouts.map((w) => (
            <div key={`w${w.id}`} className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-[15px] text-foreground">
                <Dumbbell className="h-4 w-4 text-primary" />
                <span>{w.sessionType}</span>
                <span className="text-[13px] text-muted-foreground tabular-nums">
                  {n(w.totalMin) || n(w.durationMin)} min
                </span>
              </div>
              <Badge variant="neutral">Workout</Badge>
            </div>
          ))}

          {measurements.map((m) => (
            <div key={`m${m.id}`} className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-[15px] text-foreground">
                <Scale className="h-4 w-4 text-primary" />
                <span className="tabular-nums">
                  {m.weight != null ? `${m.weight} lb` : "Check-in"}
                  {m.bodyFatPct != null ? ` · ${m.bodyFatPct}% bf` : ""}
                </span>
              </div>
              <Badge variant="neutral">Body</Badge>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
