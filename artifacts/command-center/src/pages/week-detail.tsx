import { useGetPlanWeek, getGetPlanWeekQueryKey } from "@workspace/api-client-react";
import { useParams, useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDistance, formatLoad, formatDate, formatDuration } from "@/lib/format";
import { ChevronLeft, ChevronRight, Activity, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { WorkoutForm } from "@/components/workout-form";
import { useState } from "react";

export default function WeekDetail() {
  const params = useParams();
  const weekNum = parseInt(params.week || "1", 10);
  const [, setLocation] = useLocation();
  const [formOpen, setFormOpen] = useState(false);
  const [selectedDay, setSelectedDay] = useState<any>(null);

  const { data: week, isLoading } = useGetPlanWeek(weekNum, {
    query: {
      enabled: !!weekNum && !isNaN(weekNum),
      queryKey: getGetPlanWeekQueryKey(weekNum),
    }
  });

  if (isLoading) {
    return <div className="space-y-6 max-w-4xl mx-auto"><Skeleton className="h-32 w-full" /><Skeleton className="h-96 w-full" /></div>;
  }

  if (!week) return <div>Week not found</div>;

  const handleLogClick = (day: any) => {
    setSelectedDay(day);
    setFormOpen(true);
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-4xl mx-auto">
      
      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" onClick={() => setLocation(`/plan/${weekNum - 1}`)} disabled={weekNum <= 1}>
          <ChevronLeft className="h-4 w-4 mr-1" /> Prev Week
        </Button>
        <div className="text-center">
          <h2 className="text-2xl font-black uppercase tracking-tight text-primary">Week {week.week}</h2>
          <p className="text-xs text-muted-foreground uppercase font-bold tracking-widest mt-1">{formatDate(week.startDate)} - {formatDate(week.endDate)}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setLocation(`/plan/${weekNum + 1}`)}>
          Next Week <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-card border border-border rounded-lg p-4">
        <div>
          <p className="text-[10px] uppercase font-bold text-muted-foreground">Phase</p>
          <p className="font-black text-lg">{week.phase}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase font-bold text-muted-foreground">Volume</p>
          <p className="font-black text-lg">{formatDistance(week.actualMiles)} / {formatDistance(week.plannedMiles)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase font-bold text-muted-foreground">Long Run</p>
          <p className="font-black text-lg">{formatDistance(week.longRunMi)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase font-bold text-muted-foreground">Sessions</p>
          <p className="font-black text-lg">{week.completedSessions || 0} / {week.totalSessions || 0}</p>
        </div>
      </div>

      <div className="space-y-4">
        {week.days.map((day) => {
          if (day.isRest) {
            return (
              <Card key={day.id} className="border-dashed border-2 bg-muted/20">
                <CardContent className="p-4 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-bold uppercase tracking-wider">{day.day}</div>
                    <div className="text-xs text-muted-foreground">{formatDate(day.date)}</div>
                  </div>
                  <div className="text-sm text-muted-foreground font-medium uppercase tracking-wider flex items-center gap-2">
                    <Activity className="h-4 w-4 opacity-50" />
                    Rest / Recovery
                  </div>
                </CardContent>
              </Card>
            );
          }

          return (
            <Card key={day.id} className="border-border hover:border-primary/30 transition-colors">
              <CardContent className="p-0">
                <div className="flex flex-col md:flex-row">
                  <div className="w-full md:w-48 bg-muted/30 p-4 border-b md:border-b-0 md:border-r border-border flex flex-col justify-center">
                    <div className="text-sm font-black uppercase tracking-wider">{day.day}</div>
                    <div className="text-xs text-muted-foreground mb-3">{formatDate(day.date)}</div>
                    <div className="mt-auto">
                      <span className="text-[10px] bg-secondary text-secondary-foreground px-2 py-1 rounded font-bold uppercase tracking-wider">
                        {day.equipment}
                      </span>
                    </div>
                  </div>
                  <div className="flex-1 p-6 flex flex-col md:flex-row justify-between gap-6">
                    <div className="space-y-3 flex-1">
                      <h4 className="text-xl font-black uppercase tracking-tight">{day.sessionType}</h4>
                      <p className="text-sm text-muted-foreground line-clamp-2">{day.description}</p>
                      <div className="flex flex-wrap gap-4 text-sm pt-2">
                        {day.distanceMi != null && (
                          <div>
                            <span className="text-[10px] uppercase font-bold text-muted-foreground block">Distance</span>
                            <span className="font-mono font-medium">{formatDistance(day.distanceMi)}</span>
                          </div>
                        )}
                        {day.cardioMin != null && (
                          <div>
                            <span className="text-[10px] uppercase font-bold text-muted-foreground block">Duration</span>
                            <span className="font-mono font-medium">{formatDuration(day.cardioMin)}</span>
                          </div>
                        )}
                        {day.totalLoad != null && (
                          <div>
                            <span className="text-[10px] uppercase font-bold text-muted-foreground block">Load</span>
                            <span className="font-mono font-medium">{formatLoad(day.totalLoad)}</span>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center justify-center shrink-0">
                      <Button variant="secondary" className="w-full md:w-auto uppercase font-bold text-xs" onClick={() => handleLogClick(day)}>
                        <Play className="h-3 w-3 mr-2" /> Log
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {selectedDay && (
        <WorkoutForm
          open={formOpen}
          onOpenChange={setFormOpen}
          initial={{
            date: selectedDay.date,
            equipment: selectedDay.equipment,
            sessionType: selectedDay.sessionType,
            distanceMi: selectedDay.distanceMi,
            durationMin: selectedDay.cardioMin,
            totalLoad: selectedDay.totalLoad,
            planDayId: selectedDay.id,
          }}
        />
      )}
    </div>
  );
}
