import { useState } from "react";
import {
  useGetEquipmentPhaseSummary,
  useGetEquipmentUsage,
  useListWorkouts,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDistance, formatDuration, formatLoad, formatDate } from "@/lib/format";
import { Activity, Dumbbell, Clock, Route } from "lucide-react";
import { cn } from "@/lib/utils";

interface EquipmentStats {
  sessions: number;
  totalMinutes: number;
  totalDistance: number;
  totalLoad: number;
  plannedSessions: number;
  plannedMinutes: number;
  plannedDistance: number;
  plannedLoad: number;
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
            Planned sessions per machine across each phase
          </p>
        </div>
        {loadingPhases ? (
          <Skeleton className="h-40 w-full" />
        ) : phaseSummary && phaseSummary.phases.length > 0 ? (
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left p-3 text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
                      Equipment
                    </th>
                    {phaseSummary.phases.map((phase) => (
                      <th
                        key={phase}
                        className="text-right p-3 text-[10px] uppercase font-bold text-muted-foreground tracking-wider"
                      >
                        {phase}
                      </th>
                    ))}
                    <th className="text-right p-3 text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {phaseSummary.rows.map((row) => (
                    <tr key={row.equipment} className="border-b border-border last:border-0">
                      <td className="p-3 font-bold uppercase tracking-wider text-xs">
                        {row.equipment}
                      </td>
                      {row.counts.map((n, i) => (
                        <td
                          key={`${row.equipment}-${phaseSummary.phases[i]}`}
                          className={cn(
                            "p-3 text-right font-mono",
                            n === 0 && "text-muted-foreground/50",
                          )}
                        >
                          {n}
                        </td>
                      ))}
                      <td className="p-3 text-right font-mono font-bold">{row.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
