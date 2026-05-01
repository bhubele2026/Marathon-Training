import { useGetPlanOverview, useListPlanWeeks } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDistance, formatDate } from "@/lib/format";
import { useLocation } from "wouter";
import { CalendarDays, Target, Activity } from "lucide-react";
import { cn } from "@/lib/utils";

export default function Plan() {
  const { data: overview, isLoading: loadingOverview } = useGetPlanOverview();
  const { data: weeks, isLoading: loadingWeeks } = useListPlanWeeks();
  const [, setLocation] = useLocation();

  if (loadingOverview || loadingWeeks) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  if (!overview || !weeks) return <div>Failed to load plan</div>;

  const groupedWeeks = weeks.reduce((acc, week) => {
    if (!acc[week.phase]) acc[week.phase] = [];
    acc[week.phase].push(week);
    return acc;
  }, {} as Record<string, typeof weeks>);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-5xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-black uppercase tracking-tight text-primary">52-Week Campaign</h2>
          <p className="text-muted-foreground uppercase font-medium tracking-widest mt-1">
            {overview.weeksRemaining} Weeks to Race Day ({formatDate(overview.raceDate)})
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="p-6 flex items-center gap-4">
            <CalendarDays className="h-8 w-8 text-primary" />
            <div>
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Current Week</p>
              <div className="text-2xl font-black">Week {overview.currentWeek}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6 flex items-center gap-4">
            <Activity className="h-8 w-8 text-muted-foreground" />
            <div>
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Phase</p>
              <div className="text-2xl font-black">{overview.currentPhase}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6 flex items-center gap-4">
            <Target className="h-8 w-8 text-muted-foreground" />
            <div>
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Target Miles</p>
              <div className="text-2xl font-black">{overview.weeklyMilesTarget ? formatDistance(overview.weeklyMilesTarget) : '-'}</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-12">
        {Object.entries(groupedWeeks).map(([phase, phaseWeeks]) => (
          <div key={phase} className="space-y-4">
            <h3 className="text-xl font-bold uppercase tracking-wider border-b border-border pb-2 sticky top-0 bg-background/95 backdrop-blur z-10">{phase}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {phaseWeeks.map(week => {
                const isCurrent = week.week === overview.currentWeek;
                const completedPct = week.totalSessions 
                  ? ((week.completedSessions || 0) / week.totalSessions) * 100 
                  : 0;

                return (
                  <Card 
                    key={week.week} 
                    className={cn(
                      "cursor-pointer transition-all hover:border-primary/50 hover:shadow-md",
                      isCurrent && "border-primary shadow-sm bg-primary/5"
                    )}
                    onClick={() => setLocation(`/plan/${week.week}`)}
                  >
                    <CardContent className="p-5">
                      <div className="flex justify-between items-start mb-4">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-black text-lg">W{week.week}</span>
                            {isCurrent && <span className="text-[10px] bg-primary text-primary-foreground px-2 py-0.5 rounded font-bold uppercase tracking-wider">Active</span>}
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">{formatDate(week.startDate)} - {formatDate(week.endDate)}</p>
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-y-4 gap-x-2 text-sm mb-4">
                        <div>
                          <p className="text-[10px] uppercase font-bold text-muted-foreground">Volume</p>
                          <p className="font-mono font-medium">{formatDistance(week.plannedMiles)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase font-bold text-muted-foreground">Long Run</p>
                          <p className="font-mono font-medium">{formatDistance(week.longRunMi)}</p>
                        </div>
                      </div>

                      <div className="space-y-1.5 mt-4 pt-4 border-t border-border">
                        <div className="flex justify-between text-[10px] uppercase font-bold text-muted-foreground">
                          <span>Adherence</span>
                          <span>{week.completedSessions || 0}/{week.totalSessions || 0}</span>
                        </div>
                        <Progress value={completedPct} className="h-1.5 bg-muted" />
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
