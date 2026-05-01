import { useState } from "react";
import { useGetEquipmentUsage, useListWorkouts } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDistance, formatDuration, formatLoad, formatDate } from "@/lib/format";
import { Activity, Dumbbell, Clock, Route } from "lucide-react";
import { cn } from "@/lib/utils";

export default function Equipment() {
  const [selectedEquipment, setSelectedEquipment] = useState<string>("All");
  const { data: usage, isLoading: loadingUsage } = useGetEquipmentUsage();
  
  const queryParams = selectedEquipment !== "All" ? { equipment: selectedEquipment, limit: 10 } : { limit: 10 };
  const { data: workouts, isLoading: loadingWorkouts } = useListWorkouts(queryParams);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-5xl mx-auto">
      <div>
        <h2 className="text-3xl font-black uppercase tracking-tight text-primary">Arsenal</h2>
        <p className="text-muted-foreground uppercase font-medium tracking-widest mt-1">Equipment Mileage & Usage</p>
      </div>

      {loadingUsage ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1,2,3].map(i => <Skeleton key={i} className="h-32 w-full" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <Card 
            className={cn(
              "cursor-pointer transition-all hover:border-primary/50",
              selectedEquipment === "All" && "border-primary bg-primary/5 shadow-sm"
            )}
            onClick={() => setSelectedEquipment("All")}
          >
            <CardContent className="p-6 flex flex-col h-full justify-center items-center text-center">
              <Dumbbell className={cn("h-8 w-8 mb-2", selectedEquipment === "All" ? "text-primary" : "text-muted-foreground")} />
              <div className="font-black text-lg uppercase tracking-wider">All Arsenal</div>
            </CardContent>
          </Card>

          {usage?.map((eq) => (
            <Card 
              key={eq.equipment}
              className={cn(
                "cursor-pointer transition-all hover:border-primary/50",
                selectedEquipment === eq.equipment && "border-primary bg-primary/5 shadow-sm"
              )}
              onClick={() => setSelectedEquipment(eq.equipment)}
            >
              <CardContent className="p-5">
                <div className="font-black text-lg uppercase tracking-wider mb-4 border-b border-border pb-2">{eq.equipment}</div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="flex items-center text-[10px] uppercase font-bold text-muted-foreground mb-1">
                      <Activity className="h-3 w-3 mr-1" /> Sessions
                    </div>
                    <div className="font-mono text-lg">{eq.sessions}</div>
                  </div>
                  <div>
                    <div className="flex items-center text-[10px] uppercase font-bold text-muted-foreground mb-1">
                      <Clock className="h-3 w-3 mr-1" /> Time
                    </div>
                    <div className="font-mono text-lg">{formatDuration(eq.totalMinutes)}</div>
                  </div>
                  <div>
                    <div className="flex items-center text-[10px] uppercase font-bold text-muted-foreground mb-1">
                      <Dumbbell className="h-3 w-3 mr-1" /> Load
                    </div>
                    <div className="font-mono text-lg">{formatLoad(eq.totalLoad)}</div>
                  </div>
                  {eq.totalDistance ? (
                    <div>
                      <div className="flex items-center text-[10px] uppercase font-bold text-muted-foreground mb-1">
                        <Route className="h-3 w-3 mr-1" /> Distance
                      </div>
                      <div className="font-mono text-lg">{formatDistance(eq.totalDistance)}</div>
                    </div>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="pt-6 border-t border-border">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-bold uppercase tracking-wider">Recent Activity</h3>
          {selectedEquipment !== "All" && (
            <Badge variant="secondary" className="cursor-pointer uppercase tracking-wider text-xs" onClick={() => setSelectedEquipment("All")}>
              Filter: {selectedEquipment} ✕
            </Badge>
          )}
        </div>

        {loadingWorkouts ? (
          <div className="space-y-4"><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>
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
                          <span className="block text-[10px] uppercase font-bold text-muted-foreground">Distance</span>
                          <span className="font-mono font-medium">{formatDistance(workout.distanceMi)}</span>
                        </div>
                      )}
                      {workout.durationMin != null && (
                        <div className="text-right">
                          <span className="block text-[10px] uppercase font-bold text-muted-foreground">Time</span>
                          <span className="font-mono font-medium">{formatDuration(workout.durationMin)}</span>
                        </div>
                      )}
                      {workout.totalLoad != null && (
                        <div className="text-right">
                          <span className="block text-[10px] uppercase font-bold text-muted-foreground">Load</span>
                          <span className="font-mono font-medium">{formatLoad(workout.totalLoad)}</span>
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
