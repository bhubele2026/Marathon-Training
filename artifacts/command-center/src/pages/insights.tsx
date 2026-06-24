// Insights (Phase 16). Turns the now-rich logged history (Phase 13 nutrition +
// water entries, workouts, body measurements) into a RANKED "what's working /
// what's not" read in the coach's voice, at Day / Week / Month scale. Every
// finding cites the owner's real numbers; nothing is fabricated — when there
// isn't enough logged yet, an honest empty state says so. Composed entirely
// client-side from the existing list endpoints (no aggregator endpoint).
import { useMemo, useState } from "react";
import {
  TrendingUp,
  Flame,
  HeartHandshake,
  Minus,
  Lightbulb,
  type LucideIcon,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  useListNutritionEntries,
  useListWaterLogs,
  useListWorkouts,
  useListMeasurements,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  SegmentedControl,
  CoachNote,
  EmptyState,
  StatTile,
  TrendArea,
  SectionHeader,
  type CoachTone,
} from "@/components/studio";
import {
  computeInsights,
  type Insight,
  type InsightTone,
} from "@/lib/insights";

type Scale = "day" | "week" | "month";

const SCALE_DAYS: Record<Scale, number> = { day: 14, week: 56, month: 182 };
const SCALE_LABEL: Record<Scale, string> = {
  day: "last 14 days",
  week: "last 8 weeks",
  month: "last 6 months",
};

// Insight tone → CoachNote surface + leading icon + status pill.
const TONE_COACH: Record<InsightTone, CoachTone> = {
  positive: "success",
  sassy: "accent",
  supportive: "accent",
  neutral: "neutral",
};
const TONE_ICON: Record<InsightTone, LucideIcon> = {
  positive: TrendingUp,
  sassy: Flame,
  supportive: HeartHandshake,
  neutral: Minus,
};
const TONE_STATUS: Record<InsightTone, string> = {
  positive: "Working",
  sassy: "Fix this",
  supportive: "With you",
  neutral: "Steady",
};

function localTodayStr(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
    .toISOString()
    .slice(0, 10);
}
function addDaysISO(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function inRange(iso: string, from: string, to: string): boolean {
  return iso >= from && iso <= to;
}

interface GoalsTargets {
  calorieTarget: number | null;
  proteinTargetG: number | null;
  goalKind?: string | null;
}

function InsightCard({ finding }: { finding: Insight }) {
  return (
    <CoachNote
      icon={TONE_ICON[finding.tone]}
      tone={TONE_COACH[finding.tone]}
      status={TONE_STATUS[finding.tone]}
    >
      <span className="font-semibold text-foreground">{finding.title}.</span>{" "}
      {finding.detail}
    </CoachNote>
  );
}

export default function Insights() {
  const [scale, setScale] = useState<Scale>("week");
  const today = localTodayStr();
  const from = useMemo(() => addDaysISO(today, -SCALE_DAYS[scale] + 1), [today, scale]);
  const to = today;

  const { data: entries, isLoading: lE } = useListNutritionEntries({ from, to });
  const { data: waters, isLoading: lW } = useListWaterLogs({ from, to });
  const { data: workouts, isLoading: lWo } = useListWorkouts({ from, to });
  const { data: measurementsAll, isLoading: lM } = useListMeasurements();
  const { data: targets } = useQuery({
    queryKey: ["/api/goals"],
    queryFn: async () => {
      const res = await fetch("/api/goals", { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as GoalsTargets;
    },
  });

  const loading = lE || lW || lWo || lM;

  const measurements = useMemo(
    () => (measurementsAll ?? []).filter((m) => inRange(m.date, from, to)),
    [measurementsAll, from, to],
  );

  const { findings, weightSeries, avgProtein, sessions } = useMemo(() => {
    const result = computeInsights({
      entries: entries ?? [],
      waters: waters ?? [],
      workouts: workouts ?? [],
      measurements,
      targets: targets ?? null,
      goalKind: targets?.goalKind ?? null,
      windowDays: SCALE_DAYS[scale],
    });
    const series = measurements
      .filter((m) => m.weight != null)
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((m) => ({ label: m.date.slice(5), value: m.weight as number }));
    const proDays = new Map<string, number>();
    for (const e of entries ?? []) {
      if (e.proteinG != null)
        proDays.set(e.date, (proDays.get(e.date) ?? 0) + e.proteinG);
    }
    const avgPro =
      proDays.size > 0
        ? Math.round([...proDays.values()].reduce((s, n) => s + n, 0) / proDays.size)
        : null;
    return {
      findings: result.findings,
      weightSeries: series,
      avgProtein: avgPro,
      sessions: (workouts ?? []).length,
    };
  }, [entries, waters, workouts, measurements, targets, scale]);

  return (
    <div className="mx-auto max-w-[1440px] px-4 md:px-8 py-6 flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold tracking-tight">
            Insights
          </h1>
          <p className="text-sm text-muted-foreground">
            What the {SCALE_LABEL[scale]} of your real logs are telling us.
          </p>
        </div>
        <SegmentedControl
          value={scale}
          onChange={(v) => setScale(v as Scale)}
          options={[
            { value: "day", label: "Daily" },
            { value: "week", label: "Weekly" },
            { value: "month", label: "Monthly" },
          ]}
          ariaLabel="Insights time scale"
        />
      </div>

      {loading ? (
        <div className="flex flex-col gap-3" data-testid="insights-loading">
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="h-24 w-full rounded-2xl" />
        </div>
      ) : findings.length === 0 ? (
        <EmptyState
          icon={Lightbulb}
          title="Not enough logged yet to call it"
          hint={`Log a few more days of food, water, training, or a weigh-in and your ${SCALE_LABEL[scale]} insights show up here — no guessing, only what's real.`}
        />
      ) : (
        <>
          {/* Supporting trend tiles */}
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <StatTile
              label="Avg protein"
              value={avgProtein != null ? String(avgProtein) : "—"}
              unit={avgProtein != null ? "g/day" : undefined}
            />
            <StatTile label="Sessions" value={String(sessions)} unit="logged" />
            <StatTile
              label="Weigh-ins"
              value={String(weightSeries.length)}
              unit="in window"
            />
          </div>

          {weightSeries.length >= 2 && (
            <Card>
              <CardContent className="p-6">
                <SectionHeader eyebrow="Weight trend" />
                <div className="mt-3">
                  <TrendArea
                    data={weightSeries}
                    xKey="label"
                    yKey="value"
                    unit="lb"
                    height={160}
                    sparseFallback={
                      <EmptyState
                        icon={Lightbulb}
                        title="Trend needs more weigh-ins"
                        hint="A couple more and the line fills in."
                      />
                    }
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {/* Ranked findings */}
          <div className="flex flex-col gap-3" data-testid="insights-findings">
            <SectionHeader eyebrow={`What's working / what's not · ${findings.length}`} />
            {findings.map((f) => (
              <InsightCard key={f.id} finding={f} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
