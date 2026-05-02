import { useState } from "react";
import {
  useGetEquipmentPhaseSummary,
  useGetEquipmentUsage,
  useListWorkouts,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatDistance, formatDuration, formatLoad, formatDate } from "@/lib/format";
import { Activity, Dumbbell, Clock, Route } from "lucide-react";
import { cn } from "@/lib/utils";

const PHASE_COLORS = [
  "hsl(24 95% 53%)",
  "hsl(199 89% 48%)",
  "hsl(142 71% 45%)",
  "hsl(271 76% 53%)",
  "hsl(346 87% 55%)",
  "hsl(48 96% 53%)",
  "hsl(180 65% 40%)",
  "hsl(217 91% 60%)",
];

function phaseColor(index: number) {
  return PHASE_COLORS[index % PHASE_COLORS.length];
}

interface EquipmentStats {
  sessions: number;
  totalMinutes: number;
  totalDistance: number;
  totalLoad: number;
  plannedSessions: number;
  plannedMinutes: number;
  plannedDistance: number;
  plannedLoad: number;
  plannedToDateSessions: number;
  plannedToDateMinutes: number;
  plannedToDateDistance: number;
  plannedToDateLoad: number;
}

type PaceStatus = "behind" | "on-track" | "ahead" | "idle";

function paceStatus(actual: number, plannedToDate: number): PaceStatus {
  if (plannedToDate <= 0) return "idle";
  const ratio = actual / plannedToDate;
  if (ratio < 0.85) return "behind";
  if (ratio > 1.15) return "ahead";
  return "on-track";
}

const PACE_STYLES: Record<PaceStatus, { bar: string; track: string; badge: string; label: string }> = {
  behind: {
    bar: "bg-amber-500",
    track: "bg-amber-500/15",
    badge: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
    label: "Behind",
  },
  "on-track": {
    bar: "bg-emerald-500",
    track: "bg-emerald-500/15",
    badge: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    label: "On track",
  },
  ahead: {
    bar: "bg-sky-500",
    track: "bg-sky-500/15",
    badge: "border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400",
    label: "Ahead",
  },
  idle: {
    bar: "bg-muted-foreground/40",
    track: "bg-muted/40",
    badge: "border-border bg-muted/30 text-muted-foreground",
    label: "Not yet scheduled",
  },
};

function PacingIndicator({
  actualSessions,
  plannedToDateSessions,
  plannedSessions,
}: {
  actualSessions: number;
  plannedToDateSessions: number;
  plannedSessions: number;
}) {
  const status = paceStatus(actualSessions, plannedToDateSessions);
  const styles = PACE_STYLES[status];
  const isIdle = status === "idle";
  const ratio = isIdle ? 0 : actualSessions / Math.max(1, plannedToDateSessions);
  const fillPct = Math.max(0, Math.min(1, ratio)) * 100;
  const deltaPct = isIdle ? 0 : Math.round((ratio - 1) * 100);
  const deltaLabel = isIdle
    ? styles.label
    : deltaPct === 0
      ? "On plan"
      : deltaPct > 0
        ? `+${deltaPct}% ahead`
        : `${deltaPct}% behind`;

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">
          Pace vs plan
        </div>
        <span
          className={cn(
            "text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded border",
            styles.badge,
          )}
        >
          {deltaLabel}
        </span>
      </div>
      <div
        className={cn("relative h-2 w-full overflow-hidden rounded-full", styles.track)}
        role="progressbar"
        aria-valuenow={Math.round(fillPct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Actual sessions vs planned to date"
      >
        <div
          className={cn("h-full transition-all", styles.bar)}
          style={{ width: `${fillPct}%` }}
        />
      </div>
      <div className="mt-1 text-[10px] tracking-wider text-muted-foreground/80 font-mono">
        {isIdle
          ? `0 of ${plannedSessions} planned this campaign`
          : `${actualSessions} of ${plannedToDateSessions} due so far · ${plannedSessions} planned total`}
      </div>
    </div>
  );
}

function PlannedActualRow({
  label,
  icon,
  planned,
  actual,
  hideWhenEmpty = false,
}: {
  label: string;
  icon: React.ReactNode;
  planned: string;
  actual: string;
  hideWhenEmpty?: boolean;
}) {
  if (hideWhenEmpty && planned === "-" && actual === "-") return null;
  return (
    <div>
      <div className="flex items-center text-[10px] uppercase font-bold text-muted-foreground mb-1">
        {icon}
        <span className="ml-1">{label}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground/80">Planned</div>
          <div className="font-mono text-base">{planned}</div>
        </div>
        <div>
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground/80">Actual</div>
          <div className="font-mono text-base">{actual}</div>
        </div>
      </div>
    </div>
  );
}

export default function Equipment() {
  const [selectedEquipment, setSelectedEquipment] = useState<string>("All");
  const { data: usage, isLoading: loadingUsage } = useGetEquipmentUsage();
  const { data: phaseSummary, isLoading: loadingPhases } = useGetEquipmentPhaseSummary();

  const queryParams =
    selectedEquipment !== "All"
      ? { equipment: selectedEquipment, limit: 10 }
      : { limit: 10 };
  const { data: workouts, isLoading: loadingWorkouts } = useListWorkouts(queryParams);

  const combined: EquipmentStats = (usage ?? []).reduce<EquipmentStats>(
    (acc, eq) => ({
      sessions: acc.sessions + eq.sessions,
      totalMinutes: acc.totalMinutes + eq.totalMinutes,
      totalDistance: acc.totalDistance + (eq.totalDistance ?? 0),
      totalLoad: acc.totalLoad + eq.totalLoad,
      plannedSessions: acc.plannedSessions + eq.plannedSessions,
      plannedMinutes: acc.plannedMinutes + eq.plannedMinutes,
      plannedDistance: acc.plannedDistance + eq.plannedDistance,
      plannedLoad: acc.plannedLoad + eq.plannedLoad,
      plannedToDateSessions: acc.plannedToDateSessions + eq.plannedToDateSessions,
      plannedToDateMinutes: acc.plannedToDateMinutes + eq.plannedToDateMinutes,
      plannedToDateDistance: acc.plannedToDateDistance + eq.plannedToDateDistance,
      plannedToDateLoad: acc.plannedToDateLoad + eq.plannedToDateLoad,
    }),
    {
      sessions: 0,
      totalMinutes: 0,
      totalDistance: 0,
      totalLoad: 0,
      plannedSessions: 0,
      plannedMinutes: 0,
      plannedDistance: 0,
      plannedLoad: 0,
      plannedToDateSessions: 0,
      plannedToDateMinutes: 0,
      plannedToDateDistance: 0,
      plannedToDateLoad: 0,
    },
  );

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-5xl mx-auto">
      <div>
        <h2 className="text-3xl font-black uppercase tracking-tight text-primary">Arsenal</h2>
        <p className="text-muted-foreground uppercase font-medium tracking-widest mt-1">
          Equipment Mileage & Usage
        </p>
      </div>

      {loadingUsage ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-48 w-full" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <Card
            className={cn(
              "cursor-pointer transition-all hover:border-primary/50",
              selectedEquipment === "All" && "border-primary bg-primary/5 shadow-sm",
            )}
            onClick={() => setSelectedEquipment("All")}
          >
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-4 border-b border-border pb-2">
                <Dumbbell
                  className={cn(
                    "h-5 w-5",
                    selectedEquipment === "All" ? "text-primary" : "text-muted-foreground",
                  )}
                />
                <div className="font-black text-lg uppercase tracking-wider">All Arsenal</div>
              </div>
              <PacingIndicator
                actualSessions={combined.sessions}
                plannedToDateSessions={combined.plannedToDateSessions}
                plannedSessions={combined.plannedSessions}
              />
              <div className="grid grid-cols-2 gap-4">
                <PlannedActualRow
                  label="Sessions"
                  icon={<Activity className="h-3 w-3" />}
                  planned={String(combined.plannedSessions)}
                  actual={String(combined.sessions)}
                />
                <PlannedActualRow
                  label="Time"
                  icon={<Clock className="h-3 w-3" />}
                  planned={formatDuration(combined.plannedMinutes)}
                  actual={formatDuration(combined.totalMinutes)}
                />
                <PlannedActualRow
                  label="Load"
                  icon={<Dumbbell className="h-3 w-3" />}
                  planned={formatLoad(combined.plannedLoad)}
                  actual={formatLoad(combined.totalLoad)}
                />
                <PlannedActualRow
                  label="Distance"
                  icon={<Route className="h-3 w-3" />}
                  planned={formatDistance(combined.plannedDistance)}
                  actual={formatDistance(combined.totalDistance)}
                />
              </div>
            </CardContent>
          </Card>

          {usage?.map((eq) => (
            <Card
              key={eq.equipment}
              className={cn(
                "cursor-pointer transition-all hover:border-primary/50",
                selectedEquipment === eq.equipment && "border-primary bg-primary/5 shadow-sm",
              )}
              onClick={() => setSelectedEquipment(eq.equipment)}
            >
              <CardContent className="p-5">
                <div className="font-black text-lg uppercase tracking-wider mb-4 border-b border-border pb-2">
                  {eq.equipment}
                </div>
                <PacingIndicator
                  actualSessions={eq.sessions}
                  plannedToDateSessions={eq.plannedToDateSessions}
                  plannedSessions={eq.plannedSessions}
                />
                <div className="grid grid-cols-2 gap-4">
                  <PlannedActualRow
                    label="Sessions"
                    icon={<Activity className="h-3 w-3" />}
                    planned={String(eq.plannedSessions)}
                    actual={String(eq.sessions)}
                  />
                  <PlannedActualRow
                    label="Time"
                    icon={<Clock className="h-3 w-3" />}
                    planned={formatDuration(eq.plannedMinutes)}
                    actual={formatDuration(eq.totalMinutes)}
                  />
                  <PlannedActualRow
                    label="Load"
                    icon={<Dumbbell className="h-3 w-3" />}
                    planned={formatLoad(eq.plannedLoad)}
                    actual={formatLoad(eq.totalLoad)}
                  />
                  <PlannedActualRow
                    label="Distance"
                    icon={<Route className="h-3 w-3" />}
                    planned={formatDistance(eq.plannedDistance)}
                    actual={formatDistance(eq.totalDistance ?? 0)}
                    hideWhenEmpty={!eq.plannedDistance && !eq.totalDistance}
                  />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="pt-6 border-t border-border">
        <div className="mb-4">
          <h3 className="text-xl font-bold uppercase tracking-wider">Campaign Distribution</h3>
          <p className="text-xs text-muted-foreground uppercase tracking-widest mt-1">
            Planned vs actual sessions per machine across each phase
          </p>
        </div>
        {loadingPhases ? (
          <Skeleton className="h-40 w-full" />
        ) : phaseSummary && phaseSummary.phases.length > 0 ? (
          <Card>
            <CardContent className="p-5">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-5">
                {phaseSummary.phases.map((phase, i) => (
                  <div key={phase} className="flex items-center gap-2">
                    <span
                      className="h-3 w-3 rounded-sm shrink-0"
                      style={{ backgroundColor: phaseColor(i) }}
                      aria-hidden
                    />
                    <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">
                      {phase}
                    </span>
                  </div>
                ))}
                <div className="ml-auto flex items-center gap-3 text-[10px] uppercase font-bold tracking-wider text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <span
                      className="h-3 w-3 rounded-sm border border-foreground/20 bg-foreground/10"
                      aria-hidden
                    />
                    Planned
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span
                      className="h-3 w-3 rounded-sm bg-foreground/70"
                      aria-hidden
                    />
                    Actual
                  </div>
                </div>
              </div>

              <TooltipProvider delayDuration={100}>
                {(() => {
                  const maxTotal = phaseSummary.rows.reduce(
                    (m, r) => (Math.max(r.total, r.actualTotal) > m ? Math.max(r.total, r.actualTotal) : m),
                    1,
                  );
                  return (
                    <div className="space-y-3">
                      {phaseSummary.rows.map((row) => {
                        const barTotal = Math.max(row.total, row.actualTotal);
                        const widthPct = barTotal === 0 ? 0 : (barTotal / maxTotal) * 100;
                        return (
                          <div
                            key={row.equipment}
                            className="grid grid-cols-[7rem_1fr_4.25rem] items-center gap-3"
                          >
                            <div className="font-bold uppercase tracking-wider text-xs truncate">
                              {row.equipment}
                            </div>
                            <div className="relative h-7 rounded-sm bg-muted/40 overflow-hidden">
                              {barTotal > 0 && (
                                <div
                                  className="absolute inset-y-0 left-0 flex"
                                  style={{ width: `${widthPct}%` }}
                                >
                                  {row.counts.map((planned, i) => {
                                    const actual = row.actualCounts[i] ?? 0;
                                    const segValue = Math.max(planned, actual);
                                    if (segValue === 0) return null;
                                    const segPct = (segValue / barTotal) * 100;
                                    const color = phaseColor(i);
                                    const fillRatio =
                                      planned === 0
                                        ? actual > 0
                                          ? 1
                                          : 0
                                        : Math.min(1, actual / planned);
                                    const fillPct = fillRatio * 100;
                                    const overshoot = planned > 0 && actual > planned;
                                    return (
                                      <Tooltip
                                        key={`${row.equipment}-${phaseSummary.phases[i]}`}
                                      >
                                        <TooltipTrigger asChild>
                                          <div
                                            className="relative h-full cursor-default border-r border-background/30 last:border-r-0 transition-opacity hover:opacity-90"
                                            style={{ width: `${segPct}%` }}
                                          >
                                            <div
                                              className="absolute inset-0"
                                              style={{
                                                backgroundColor: color,
                                                opacity: 0.25,
                                              }}
                                              aria-hidden
                                            />
                                            <div
                                              className="absolute inset-y-0 left-0"
                                              style={{
                                                width: `${fillPct}%`,
                                                backgroundColor: color,
                                              }}
                                              aria-hidden
                                            />
                                            {overshoot && (
                                              <div
                                                className="absolute inset-y-0 right-0 w-0.5 bg-foreground/70"
                                                aria-hidden
                                                title="Over plan"
                                              />
                                            )}
                                            {segPct >= 14 && (
                                              <div className="relative h-full flex items-center justify-center text-[10px] font-bold text-white tabular-nums drop-shadow-[0_1px_1px_rgba(0,0,0,0.6)]">
                                                {actual}/{planned}
                                              </div>
                                            )}
                                          </div>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                          <div className="font-bold uppercase tracking-wider">
                                            {phaseSummary.phases[i]}
                                          </div>
                                          <div className="text-xs">
                                            {actual} of {planned} planned session
                                            {planned === 1 ? "" : "s"}
                                            {planned > 0 && (
                                              <>
                                                {" "}· {Math.round((actual / planned) * 100)}%
                                              </>
                                            )}
                                          </div>
                                          {overshoot && (
                                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">
                                              {actual - planned} over plan
                                            </div>
                                          )}
                                          {planned === 0 && actual > 0 && (
                                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">
                                              Unplanned
                                            </div>
                                          )}
                                        </TooltipContent>
                                      </Tooltip>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                            <div
                              className={cn(
                                "text-right font-mono text-xs leading-tight",
                                row.total === 0 && row.actualTotal === 0 && "text-muted-foreground/50",
                              )}
                            >
                              <div className="font-bold tabular-nums">
                                {row.actualTotal}
                                <span className="text-muted-foreground">/{row.total}</span>
                              </div>
                              <div className="text-[9px] uppercase tracking-wider text-muted-foreground">
                                done/plan
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </TooltipProvider>
            </CardContent>
          </Card>
        ) : (
          <div className="text-center py-8 text-muted-foreground bg-muted/20 rounded-lg border border-dashed border-border text-sm">
            No campaign phases planned yet.
          </div>
        )}
      </div>

      <div className="pt-6 border-t border-border">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-bold uppercase tracking-wider">Recent Activity</h3>
          {selectedEquipment !== "All" && (
            <Badge
              variant="secondary"
              className="cursor-pointer uppercase tracking-wider text-xs"
              onClick={() => setSelectedEquipment("All")}
            >
              Filter: {selectedEquipment} ✕
            </Badge>
          )}
        </div>

        {loadingWorkouts ? (
          <div className="space-y-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <div className="grid gap-4">
            {workouts?.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground bg-muted/20 rounded-lg border border-dashed border-border">
                No recent activity for this equipment.
              </div>
            ) : (
              workouts?.map((workout) => (
                <Card key={workout.id} className="bg-card">
                  <CardContent className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div className="h-12 w-12 rounded bg-muted/50 flex items-center justify-center shrink-0">
                        <Dumbbell className="h-6 w-6 text-muted-foreground" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="font-bold text-lg">{workout.sessionType}</h4>
                          <span className="text-[10px] bg-secondary text-secondary-foreground px-2 py-0.5 rounded font-bold uppercase tracking-wider">
                            {workout.equipment}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">{formatDate(workout.date)}</p>
                      </div>
                    </div>

                    <div className="flex gap-6 text-sm">
                      {workout.distanceMi != null && (
                        <div className="text-right">
                          <span className="block text-[10px] uppercase font-bold text-muted-foreground">
                            Distance
                          </span>
                          <span className="font-mono font-medium">
                            {formatDistance(workout.distanceMi)}
                          </span>
                        </div>
                      )}
                      {workout.durationMin != null && (
                        <div className="text-right">
                          <span className="block text-[10px] uppercase font-bold text-muted-foreground">
                            Time
                          </span>
                          <span className="font-mono font-medium">
                            {formatDuration(workout.durationMin)}
                          </span>
                        </div>
                      )}
                      {workout.totalLoad != null && (
                        <div className="text-right">
                          <span className="block text-[10px] uppercase font-bold text-muted-foreground">
                            Load
                          </span>
                          <span className="font-mono font-medium">
                            {formatLoad(workout.totalLoad)}
                          </span>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
