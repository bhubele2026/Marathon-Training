import { useState, useMemo } from "react";
import {
  useListMeasurements,
  useDeleteMeasurement,
  getListMeasurementsQueryKey,
  getGetWeightTrendQueryKey,
  getGetDashboardSummaryQueryKey,
  getGetDashboardBootstrapQueryKey,
  type Measurement,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Plus, Edit, Trash2 } from "lucide-react";
import { MeasurementForm } from "@/components/measurement-form";
import { StatReadout } from "@/components/studio/stat-readout";
import { TrendArea } from "@/components/studio/trend-area";
import { EmptyState } from "@/components/studio/empty-state";
import { CountUp } from "@/components/studio/count-up";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

// A circumference-tape site charted over time. belly/chest are fat-loss sites;
// arms/legs (summed L+R) are lean-mass proxies. Each one gets a baseline →
// latest delta and its own series on the chart.
type SitePoint = { date: string; value: number };
type SiteDef = {
  key: string;
  label: string;
  // Growth here reads as a lean-mass proxy (arms/legs).
  muscleProxy: boolean;
  pick: (m: Measurement) => number | null;
  // chart-1 is the accent; chart-2..5 + muted-foreground are neutral grays.
  stroke: string;
};

const SITE_DEFS: SiteDef[] = [
  { key: "belly", label: "Belly", muscleProxy: false, pick: (m) => m.belly ?? null, stroke: "hsl(var(--chart-1))" },
  { key: "chest", label: "Chest", muscleProxy: false, pick: (m) => m.chest ?? null, stroke: "hsl(var(--chart-2))" },
  {
    key: "arms",
    label: "Arms (L+R)",
    muscleProxy: true,
    pick: (m) => sumPair(m.lArm, m.rArm),
    stroke: "hsl(var(--chart-3))",
  },
  {
    key: "legs",
    label: "Legs (L+R)",
    muscleProxy: true,
    pick: (m) => sumPair(m.lLeg, m.rLeg),
    stroke: "hsl(var(--chart-4))",
  },
];

function sumPair(a?: number | null, b?: number | null): number | null {
  if (a == null && b == null) return null;
  return (a ?? 0) + (b ?? 0);
}

type WeeklyWeight = {
  rateLb: number;
  currentWeekTargetLb: number;
  latestActualLb: number | null;
  varianceLb: number | null;
  onTrack: boolean | null;
};

// Shared eyebrow label — 11px uppercase, cool-muted (DESIGN LAW typography).
const EYEBROW =
  "font-display text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground";

export default function Measurements() {
  const { data: measurements, isLoading: loadingMs } = useListMeasurements();
  // Weekly weight goal (read-only here; set on Goals). Hand-fetched like the
  // rest of /api/goals.
  const goalsQuery = useQuery({
    queryKey: ["/api/goals"],
    queryFn: async () => {
      const r = await fetch("/api/goals", { headers: { accept: "application/json" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return (await r.json()) as { weeklyWeight: WeeklyWeight | null };
    },
  });
  const weekly = goalsQuery.data?.weeklyWeight ?? null;

  const [formOpen, setFormOpen] = useState(false);
  const [editItem, setEditItem] = useState<Measurement | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const handleCreate = () => {
    setEditItem(null);
    setFormOpen(true);
  };

  const handleEdit = (item: Measurement) => {
    setEditItem(item);
    setFormOpen(true);
  };

  const deleteMutation = useDeleteMeasurement();

  const handleDelete = (id: number) => {
    deleteMutation.mutate(
      { id },
      {
        onSuccess: () => {
          toast({ title: "Measurement deleted" });
          queryClient.invalidateQueries({ queryKey: getListMeasurementsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetWeightTrendQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetDashboardBootstrapQueryKey() });
        },
      },
    );
  };

  // Oldest → newest, for the time-series charts.
  const chrono = useMemo(
    () => (measurements ? [...measurements].reverse() : []),
    [measurements],
  );

  // Weight series (drop rows with no weight).
  const weightData = useMemo(
    () =>
      chrono
        .filter((m) => m.weight != null)
        .map((m) => ({ date: m.date, weight: m.weight })),
    [chrono],
  );

  // Per-site series for the tape chart (combined into one dataset keyed by date).
  const tapeData = useMemo(() => {
    return chrono
      .map((m) => {
        const row: Record<string, string | number | null> = { date: m.date };
        for (const def of SITE_DEFS) row[def.key] = def.pick(m);
        return row;
      })
      .filter((row) => SITE_DEFS.some((d) => row[d.key] != null));
  }, [chrono]);

  // Per-site baseline → latest deltas (earliest/latest non-null value).
  const siteDeltas = useMemo(() => {
    return SITE_DEFS.map((def) => {
      const series: SitePoint[] = [];
      for (const m of chrono) {
        const v = def.pick(m);
        if (v != null && Number.isFinite(v)) series.push({ date: m.date, value: v });
      }
      const baseline = series.length > 0 ? series[0]!.value : null;
      const latest = series.length > 0 ? series[series.length - 1]!.value : null;
      const delta = baseline != null && latest != null ? baseline - latest : null;
      return { def, baseline, latest, delta };
    });
  }, [chrono]);

  const hasMeasurements = (measurements?.length ?? 0) > 0;

  const round1 = (n: number) => Math.round(n * 10) / 10;

  // Weight hero: latest weigh-in + change vs the prior one. On a cut, a drop is
  // the good direction (success); a gain is off-direction; equal reads Flat.
  const latestWeight =
    weightData.length > 0 ? (weightData[weightData.length - 1]!.weight as number | null) : null;
  const prevWeight =
    weightData.length > 1 ? (weightData[weightData.length - 2]!.weight as number | null) : null;
  const weightDelta =
    latestWeight != null && prevWeight != null ? round1(latestWeight - prevWeight) : null;
  const cutGoal = (weekly?.rateLb ?? -1) <= 0; // default to a cut when no goal set

  // Latest logged body-fat % (newest non-null), for the body-comp hero / seed.
  const latestBodyFat = useMemo(() => {
    for (let i = chrono.length - 1; i >= 0; i--) {
      if (chrono[i]!.bodyFatPct != null) return chrono[i]!.bodyFatPct as number;
    }
    return null;
  }, [chrono]);

  // Selected tape series for the chart — accent the chosen one, neutral the rest.
  const [selectedSite, setSelectedSite] = useState<string>(SITE_DEFS[0]!.key);
  const NEUTRAL_RAMP = [
    "hsl(var(--chart-3))",
    "hsl(var(--chart-4))",
    "hsl(var(--chart-5))",
    "hsl(var(--chart-2))",
  ];

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-[1440px] mx-auto px-4 md:px-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-4xl font-extrabold tracking-tight text-foreground">Body</h2>
          <p className="text-muted-foreground font-medium mt-1">Lose inches, gain muscle</p>
        </div>
        {/* Fast logging — one prominent primary action opens the check-in form. */}
        <Button
          onClick={handleCreate}
          size="lg"
          className="font-semibold"
          data-testid="measurements-log-cta"
        >
          <Plus className="h-5 w-5 mr-2" /> Log measurement
        </Button>
      </div>

      {/* HERO TILE — weight is the single oversized readout, with its change vs
          the last weigh-in as a semantic delta chip, body fat alongside, and the
          soft azure trend area right below it. One hero per surface. */}
      <Card className="shadow-tile">
        <CardContent className="p-6 md:p-8 space-y-7">
          <div className="flex flex-wrap items-end justify-between gap-x-12 gap-y-6">
            <div className="flex flex-col gap-2">
              <span className={EYEBROW}>Weight</span>
              <div className="flex items-end gap-3">
                <span className="font-display text-[clamp(2.5rem,6vw,4.5rem)] font-extrabold leading-none tabular-nums tracking-tight text-primary">
                  {latestWeight != null ? (
                    <CountUp value={latestWeight} format={(n) => n.toFixed(1)} />
                  ) : (
                    "—"
                  )}
                </span>
                <span className="pb-2 text-base font-medium text-muted-foreground">lb</span>
                {weightDelta != null && weightDelta !== 0 && (
                  <Badge
                    variant={(weightDelta < 0) === cutGoal ? "success" : "neutral"}
                    className="mb-2 tabular-nums"
                  >
                    {weightDelta < 0 ? "▼" : "▲"} {Math.abs(weightDelta).toFixed(1)} lb vs last
                  </Badge>
                )}
                {weightDelta === 0 && (
                  <Badge variant="neutral" className="mb-2 tabular-nums">
                    Flat · {latestWeight?.toFixed(1)} lb
                  </Badge>
                )}
              </div>
            </div>

            {/* Body-fat: a stat when logged, an invitation (never a dash) when not. */}
            {latestBodyFat != null ? (
              <StatReadout label="Body fat" value={latestBodyFat.toFixed(1)} unit="%" />
            ) : (
              <EmptyState
                title="Body fat not logged"
                hint="Log body-fat % (or your neck + waist) to split fat loss from muscle."
                action={
                  <Button variant="outline" size="sm" onClick={handleCreate}>
                    Log it
                  </Button>
                }
                className="p-0"
              />
            )}
          </div>

          <div>
            <span className={cn(EYEBROW, "block mb-3")}>Weight trend</span>
            {loadingMs ? (
              <Skeleton className="h-56 w-full" />
            ) : (
              <TrendArea
                data={weightData}
                xKey="date"
                yKey="weight"
                unit="lb"
                height={224}
                valueFormatter={(n) => n.toFixed(1)}
                xTickFormatter={(v) => format(parseISO(String(v)), "MMM d")}
                sparseFallback={
                  <EmptyState
                    title="Not enough weigh-ins yet"
                    hint="One weigh-in down. Two more and your trend line shows up."
                  />
                }
              />
            )}
          </div>
        </CardContent>
      </Card>

      {/* Weekly weight goal — quiet target-vs-actual for the current week. Set it
          on Goals; read-only here. */}
      {weekly && (
        <Card className="shadow-card">
          <CardContent className="p-6">
            <span className={cn(EYEBROW, "block mb-3")}>This week</span>
            <div className="flex flex-wrap items-baseline gap-x-10 gap-y-2">
              <div>
                <p className={EYEBROW}>Target</p>
                <p className="font-display text-3xl font-extrabold tabular-nums leading-none mt-1">
                  {weekly.currentWeekTargetLb}
                  <span className="text-base text-muted-foreground font-bold"> lb</span>
                </p>
              </div>
              <div>
                <p className={EYEBROW}>Actual</p>
                <p className="font-display text-3xl font-extrabold tabular-nums leading-none mt-1">
                  {weekly.latestActualLb != null ? weekly.latestActualLb : "—"}
                  <span className="text-base text-muted-foreground font-bold"> lb</span>
                </p>
              </div>
              <div>
                <p className={EYEBROW}>Pace</p>
                <p className="text-sm font-semibold tabular-nums mt-1.5">
                  {weekly.rateLb < 0
                    ? `−${Math.abs(weekly.rateLb)} lb/wk`
                    : weekly.rateLb > 0
                      ? `+${weekly.rateLb} lb/wk`
                      : "maintain"}
                </p>
              </div>
              {weekly.onTrack != null && (
                <span
                  className={cn(
                    "text-sm font-bold self-center",
                    weekly.onTrack ? "text-success" : "text-destructive",
                  )}
                >
                  {weekly.onTrack ? "On track" : "Off track"}
                  {weekly.varianceLb != null && weekly.varianceLb !== 0 && (
                    <span className="ml-1 font-normal tabular-nums text-muted-foreground">
                      ({weekly.varianceLb > 0 ? "+" : ""}
                      {weekly.varianceLb} lb)
                    </span>
                  )}
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Since baseline — the recomp deltas per tape site. */}
      <Card className="shadow-card">
        <CardContent className="p-6 md:p-8">
          <span className={cn(EYEBROW, "block mb-5")}>Since baseline</span>
          {loadingMs ? (
            <Skeleton className="h-20 w-full" />
          ) : !hasMeasurements ? (
            <p className="text-sm text-muted-foreground">
              Log your first measurement to see your baseline → latest change per site.
            </p>
          ) : (
            <div
              className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-6"
              data-testid="measurements-site-deltas"
            >
              {siteDeltas.map(({ def, latest, delta }) => {
                const magnitude = delta == null ? null : Math.abs(delta);
                const up = delta != null && delta < 0; // latest > baseline (grew)
                const good = def.muscleProxy ? up : !up;
                const deltaChip =
                  magnitude != null && magnitude > 0
                    ? {
                        value: `${up ? "▲" : "▼"} ${magnitude.toFixed(1)}"`,
                        tone: (good ? "success" : "neutral") as "success" | "neutral",
                      }
                    : undefined;
                return (
                  <div key={def.key} data-testid={`measurements-site-delta-${def.key}`}>
                    <StatReadout
                      label={def.label}
                      value={latest != null ? latest.toFixed(1) : "—"}
                      unit={'"'}
                      delta={deltaChip}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tape measurements — selected site is the azure line, the rest recede
          into the neutral ramp; pill toggles instead of a dotted legend. */}
      <Card className="shadow-card">
        <CardContent className="p-6 md:p-8">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <span className={EYEBROW}>Tape measurements</span>
            <div className="flex flex-wrap gap-1.5">
              {SITE_DEFS.map((def) => (
                <button
                  key={def.key}
                  type="button"
                  onClick={() => setSelectedSite(def.key)}
                  aria-pressed={selectedSite === def.key}
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    selectedSite === def.key
                      ? "border-primary/30 bg-primary/10 text-primary"
                      : "border-border bg-muted/40 text-muted-foreground hover:text-foreground",
                  )}
                >
                  {def.label}
                </button>
              ))}
            </div>
          </div>
          {loadingMs ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={tapeData} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(str) => format(parseISO(str), "MMM d")}
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    tickLine={false}
                    axisLine={false}
                    width={36}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      borderColor: "hsl(var(--border))",
                      borderRadius: 12,
                      boxShadow: "var(--shadow-pop)",
                    }}
                  />
                  {/* Selected site = accent; the rest recede into the neutral ramp. */}
                  {SITE_DEFS.map((def, i) => {
                    const isSel = def.key === selectedSite;
                    return (
                      <Line
                        key={def.key}
                        type="monotone"
                        dataKey={def.key}
                        name={def.label}
                        stroke={isSel ? "hsl(var(--primary))" : NEUTRAL_RAMP[i % NEUTRAL_RAMP.length]}
                        strokeWidth={isSel ? 2.5 : 1.25}
                        strokeOpacity={isSel ? 1 : 0.5}
                        dot={false}
                        activeDot={isSel ? { r: 3 } : false}
                        connectNulls
                      />
                    );
                  })}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Full check-in history. */}
      <Card className="overflow-hidden shadow-card">
        {loadingMs ? (
          <div className="p-8"><Skeleton className="h-64 w-full" /></div>
        ) : (
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="text-[10px] font-bold tracking-wider">Date</TableHead>
                <TableHead className="text-[10px] font-bold tracking-wider text-right">Weight</TableHead>
                <TableHead className="text-[10px] font-bold tracking-wider text-right">Body Fat %</TableHead>
                <TableHead className="text-[10px] font-bold tracking-wider text-right">Neck</TableHead>
                <TableHead className="text-[10px] font-bold tracking-wider text-right">Belly</TableHead>
                <TableHead className="text-[10px] font-bold tracking-wider text-right">Chest</TableHead>
                <TableHead className="text-[10px] font-bold tracking-wider text-right">Arms (L/R)</TableHead>
                <TableHead className="text-[10px] font-bold tracking-wider text-right">Legs (L/R)</TableHead>
                <TableHead className="text-right"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!hasMeasurements ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-12 text-muted-foreground">
                    No measurements yet. Log your first check-in to start tracking.
                  </TableCell>
                </TableRow>
              ) : (
                measurements?.map((m) => (
                  <TableRow key={m.id} className="hover:bg-muted/30">
                    <TableCell className="font-medium whitespace-nowrap">{formatDate(m.date)}</TableCell>
                    <TableCell className="text-right tabular-nums font-bold text-primary">{m.weight ? `${m.weight.toFixed(1)}` : '-'}</TableCell>
                    <TableCell className="text-right tabular-nums">{m.bodyFatPct != null ? `${m.bodyFatPct.toFixed(1)}%` : '-'}</TableCell>
                    <TableCell className="text-right tabular-nums">{m.neck || '-'}</TableCell>
                    <TableCell className="text-right tabular-nums">{m.belly || '-'}</TableCell>
                    <TableCell className="text-right tabular-nums">{m.chest || '-'}</TableCell>
                    <TableCell className="text-right tabular-nums">{m.lArm || '-'}/{m.rArm || '-'}</TableCell>
                    <TableCell className="text-right tabular-nums">{m.lLeg || '-'}/{m.rLeg || '-'}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEdit(m)}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete check-in?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will permanently delete this body measurement entry.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDelete(m.id)}>Delete</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </Card>

      <MeasurementForm
        open={formOpen}
        onOpenChange={setFormOpen}
        measurementId={editItem?.id}
        initial={editItem || undefined}
      />
    </div>
  );
}
