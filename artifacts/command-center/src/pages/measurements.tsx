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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend,
} from "recharts";
import { formatDate } from "@/lib/format";
import { Plus, Edit, Trash2 } from "lucide-react";
import { MeasurementForm } from "@/components/measurement-form";
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

// Phase 4. A circumference-tape site charted over time. belly/chest are
// fat-loss sites; arms/legs (summed L+R) are lean-mass proxies. Each one
// gets a baseline → latest delta line and its own series on the chart.
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

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-[1600px] mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-4xl font-extrabold tracking-tight text-foreground">Body</h2>
          <p className="text-muted-foreground font-medium tracking-widest mt-1">
            Lose inches, gain muscle
          </p>
        </div>
        {/* Phase 4. Fast logging — one prominent primary action up top
            opens the check-in form (1 tap to open, submit inside). */}
        <Button
          onClick={handleCreate}
          size="lg"
          className="font-black tracking-wider"
          data-testid="measurements-log-cta"
        >
          <Plus className="h-5 w-5 mr-2" /> Log measurement
        </Button>
      </div>

      {/* Weekly weight goal — quiet target-vs-actual for the current week. Set
          it on Goals; read-only here. De-boxed to match the rest of the page. */}
      {weekly && (
        <section className="border-t border-border pt-6">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground mb-3">
            This week
          </p>
          <div className="flex flex-wrap items-baseline gap-x-10 gap-y-2">
            <div>
              <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                Target
              </p>
              <p className="text-3xl font-extrabold tabular-nums leading-none">
                {weekly.currentWeekTargetLb}
                <span className="text-base text-muted-foreground font-bold"> lb</span>
              </p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                Actual
              </p>
              <p className="text-3xl font-extrabold tabular-nums leading-none">
                {weekly.latestActualLb != null ? weekly.latestActualLb : "—"}
                <span className="text-base text-muted-foreground font-bold"> lb</span>
              </p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                Pace
              </p>
              <p className="text-sm font-mono tabular-nums mt-1.5">
                {weekly.rateLb < 0
                  ? `−${Math.abs(weekly.rateLb)} lb/wk`
                  : weekly.rateLb > 0
                    ? `+${weekly.rateLb} lb/wk`
                    : "maintain"}
              </p>
            </div>
            {weekly.onTrack != null && (
              <span
                className={
                  "text-sm font-bold self-center " +
                  (weekly.onTrack
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-amber-600 dark:text-amber-400")
                }
              >
                {weekly.onTrack ? "On track" : "Off track"}
                {weekly.varianceLb != null && weekly.varianceLb !== 0 && (
                  <span className="ml-1 font-mono font-normal text-muted-foreground">
                    ({weekly.varianceLb > 0 ? "+" : ""}
                    {weekly.varianceLb} lb)
                  </span>
                )}
              </span>
            )}
          </div>
        </section>
      )}

      {/* Phase 6: the recomp deltas ARE the hero of this screen — large
          numbers straight on the page (no card), one quiet label above,
          separated by a hairline rather than boxed. */}
      <section className="border-t border-border pt-6">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground mb-5">
          Since baseline
        </p>
        {loadingMs ? (
          <Skeleton className="h-20 w-full" />
        ) : !hasMeasurements ? (
          <p className="text-sm text-muted-foreground">
            Log your first measurement to see your baseline → latest change
            per site.
          </p>
        ) : (
          <div
            className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-6"
            data-testid="measurements-site-deltas"
          >
            {siteDeltas.map(({ def, baseline, latest, delta }) => {
              const grew = delta != null && delta < 0;
              const shrank = delta != null && delta > 0;
              const good = def.muscleProxy ? grew : shrank;
              const magnitude = delta == null ? null : Math.abs(delta);
              return (
                <div
                  key={def.key}
                  data-testid={`measurements-site-delta-${def.key}`}
                >
                  <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                    {def.label}
                  </p>
                  <div className="text-5xl font-extrabold mt-1.5 tabular-nums leading-none">
                    {latest != null ? latest.toFixed(1) : "—"}
                    <span className="text-xl text-muted-foreground font-bold">"</span>
                  </div>
                  <p className="text-xs mt-1.5">
                    {magnitude != null && magnitude > 0 ? (
                      <span
                        className={`font-mono font-bold ${good ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}
                      >
                        {def.muscleProxy
                          ? `${grew ? "+" : "-"}${magnitude.toFixed(1)}"`
                          : `-${magnitude.toFixed(1)}"`}
                      </span>
                    ) : (
                      <span className="text-muted-foreground font-mono">no change</span>
                    )}
                    <span className="text-muted-foreground">
                      {" "}
                      from {baseline != null ? `${baseline.toFixed(1)}"` : "—"}
                    </span>
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Phase 6: weight is secondary on the Body screen — a flat, de-boxed
          trend section, not a competing card. */}
      <section className="border-t border-border pt-6">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground mb-4">
          Weight trend
        </p>
        <div>
          {loadingMs ? <Skeleton className="h-56 w-full" /> : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={weightData} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorWeightMain" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="date" tickFormatter={(str) => format(parseISO(str), 'MMM d')} />
                  <YAxis domain={["dataMin - 5", "dataMax + 5"]} />
                  <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }} />
                  <Area type="monotone" dataKey="weight" name="Weight" stroke="hsl(var(--chart-1))" strokeWidth={3} fillOpacity={1} fill="url(#colorWeightMain)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </section>

      <section className="border-t border-border pt-6">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground mb-4">
          Tape measurements
        </p>
        <div>
          {loadingMs ? <Skeleton className="h-64 w-full" /> : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={tapeData} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="date" tickFormatter={(str) => format(parseISO(str), 'MMM d')} />
                  <YAxis />
                  <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }} />
                  <Legend />
                  {/* Single accent (chart-1 = belly) + neutral-gray ramp; no rainbow. */}
                  {SITE_DEFS.map((def) => (
                    <Line
                      key={def.key}
                      type="monotone"
                      dataKey={def.key}
                      name={def.label}
                      stroke={def.stroke}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </section>

      <div className="bg-card border border-card-border shadow-card overflow-hidden">
        {loadingMs ? (
          <div className="p-8"><Skeleton className="h-64 w-full" /></div>
        ) : (
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="text-[10px] font-bold tracking-wider">Date</TableHead>
                <TableHead className="text-[10px] font-bold tracking-wider text-right">Weight</TableHead>
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
                  <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                    No measurements yet. Log your first check-in to start tracking.
                  </TableCell>
                </TableRow>
              ) : (
                measurements?.map((m) => (
                  <TableRow key={m.id} className="hover:bg-muted/30">
                    <TableCell className="font-medium whitespace-nowrap">{formatDate(m.date)}</TableCell>
                    <TableCell className="text-right font-mono font-bold text-primary">{m.weight ? `${m.weight.toFixed(1)}` : '-'}</TableCell>
                    <TableCell className="text-right font-mono">{m.belly || '-'}</TableCell>
                    <TableCell className="text-right font-mono">{m.chest || '-'}</TableCell>
                    <TableCell className="text-right font-mono">{m.lArm || '-'}/{m.rArm || '-'}</TableCell>
                    <TableCell className="text-right font-mono">{m.lLeg || '-'}/{m.rLeg || '-'}</TableCell>
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
      </div>

      <MeasurementForm
        open={formOpen}
        onOpenChange={setFormOpen}
        measurementId={editItem?.id}
        initial={editItem || undefined}
      />
    </div>
  );
}
