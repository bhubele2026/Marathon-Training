import { useState } from "react";
import { useGetTodayPlan, useDeleteWorkout, getGetDashboardSummaryQueryKey, getGetTodayPlanQueryKey, getListWorkoutsQueryKey, getGetWeeklyMileageQueryKey, getGetEquipmentUsageQueryKey, getGetLongRunProgressionQueryKey, getGetRecentActivityQueryKey, getListPlanWeeksQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDistance, formatLoad, formatDuration } from "@/lib/format";
import { CheckCircle2, Activity, Play, Trash2, Edit } from "lucide-react";
import { WorkoutForm } from "@/components/workout-form";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
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

export default function Today() {
  const { data: today, isLoading } = useGetTodayPlan();
  const [formOpen, setFormOpen] = useState(false);
  const [editFormOpen, setEditFormOpen] = useState(false);
  const deleteWorkout = useDeleteWorkout();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const invalidateData = () => {
    queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetTodayPlanQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListWorkoutsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetWeeklyMileageQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetEquipmentUsageQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetLongRunProgressionQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetRecentActivityQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListPlanWeeksQueryKey() });
    queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] === '/api/plan/weeks' });
  };

  if (isLoading) {
    return <div className="space-y-6"><Skeleton className="h-64" /></div>;
  }

  if (!today) {
    return <div>Failed to load plan</div>;
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-black uppercase tracking-tight text-primary">Today's Mission</h2>
          <p className="text-muted-foreground uppercase font-medium tracking-widest">{today.date}</p>
        </div>
      </div>

      {!today.hasPlan ? (
        <Card className="border-dashed border-2 bg-muted/50">
          <CardContent className="p-12 text-center text-muted-foreground">
            <Activity className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <h3 className="text-xl font-bold uppercase tracking-wider mb-2">Rest Day</h3>
            <p>Recover and rebuild. No planned session today.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6">
          <Card className="border-primary/20 bg-primary/5">
            <CardHeader>
              <CardTitle className="text-lg uppercase tracking-wider text-primary">Mission Brief</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="bg-background p-6 rounded-md border border-border">
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
                  <div className="space-y-4 flex-1">
                    <div className="flex items-center gap-3">
                      <span className="font-black text-2xl uppercase tracking-tight">{today.plan?.sessionType}</span>
                      <span className="px-3 py-1 bg-secondary text-secondary-foreground rounded text-sm uppercase font-bold tracking-wider">{today.plan?.equipment}</span>
                    </div>
                    
                    <p className="text-foreground text-lg leading-relaxed">{today.plan?.description}</p>
                    
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6 pt-6 border-t border-border">
                      {today.plan?.distanceMi && (
                        <div>
                          <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Distance</p>
                          <p className="text-xl font-black">{formatDistance(today.plan.distanceMi)}</p>
                        </div>
                      )}
                      {today.plan?.cardioMin && (
                        <div>
                          <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Duration</p>
                          <p className="text-xl font-black">{formatDuration(today.plan.cardioMin)}</p>
                        </div>
                      )}
                      {today.plan?.strengthLoad && (
                        <div>
                          <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Strength Load</p>
                          <p className="text-xl font-black">{today.plan.strengthLoad}</p>
                        </div>
                      )}
                      {today.plan?.totalLoad && (
                        <div>
                          <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Total Load</p>
                          <p className="text-xl font-black">{formatLoad(today.plan.totalLoad)}</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {!today.loggedWorkout && (
                    <div className="shrink-0 flex items-center justify-center border-t md:border-t-0 md:border-l border-border pt-6 md:pt-0 md:pl-6">
                      <Button size="lg" className="w-full md:w-auto h-16 px-8 text-lg uppercase font-black tracking-widest group" onClick={() => setFormOpen(true)}>
                        <Play className="mr-2 h-6 w-6 group-hover:scale-110 transition-transform" />
                        Log Mission
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {today.loggedWorkout && (
            <Card className="border-border">
              <CardHeader className="bg-muted/30 border-b border-border pb-4 flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-lg uppercase tracking-wider flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-primary" />
                  Mission Accomplished
                </CardTitle>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setEditFormOpen(true)}>
                    <Edit className="h-4 w-4 mr-2" /> Edit
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="destructive" size="sm">
                        <Trash2 className="h-4 w-4 mr-2" /> Delete
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will permanently delete this workout log.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => {
                            deleteWorkout.mutate({ id: today.loggedWorkout!.id }, {
                              onSuccess: () => {
                                toast({ title: "Workout deleted" });
                                invalidateData();
                              }
                            });
                          }}
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </CardHeader>
              <CardContent className="p-6">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
                  {today.loggedWorkout.distanceMi != null && (
                    <div>
                      <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Distance</p>
                      <p className="text-xl font-black">{formatDistance(today.loggedWorkout.distanceMi)}</p>
                    </div>
                  )}
                  {today.loggedWorkout.durationMin != null && (
                    <div>
                      <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Duration</p>
                      <p className="text-xl font-black">{formatDuration(today.loggedWorkout.durationMin)}</p>
                    </div>
                  )}
                  {today.loggedWorkout.pace && (
                    <div>
                      <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Pace</p>
                      <p className="text-xl font-black">{today.loggedWorkout.pace}/mi</p>
                    </div>
                  )}
                  {today.loggedWorkout.rpe != null && (
                    <div>
                      <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">RPE</p>
                      <p className="text-xl font-black">{today.loggedWorkout.rpe}/10</p>
                    </div>
                  )}
                  {today.loggedWorkout.avgHr != null && (
                    <div>
                      <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Avg HR</p>
                      <p className="text-xl font-black">{today.loggedWorkout.avgHr} bpm</p>
                    </div>
                  )}
                  {today.loggedWorkout.totalLoad != null && (
                    <div>
                      <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Total Load</p>
                      <p className="text-xl font-black">{formatLoad(today.loggedWorkout.totalLoad)}</p>
                    </div>
                  )}
                </div>
                {today.loggedWorkout.notes && (
                  <div className="mt-6 pt-6 border-t border-border">
                    <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider mb-2">Notes</p>
                    <p className="text-sm">{today.loggedWorkout.notes}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {today.plan && (
        <WorkoutForm 
          open={formOpen} 
          onOpenChange={setFormOpen} 
          initial={{
            date: today.date,
            equipment: today.plan.equipment,
            sessionType: today.plan.sessionType,
            distanceMi: today.plan.distanceMi,
            durationMin: today.plan.cardioMin,
            totalLoad: today.plan.totalLoad,
            planDayId: today.plan.id,
          }} 
        />
      )}

      {today.loggedWorkout && (
        <WorkoutForm
          open={editFormOpen}
          onOpenChange={setEditFormOpen}
          workoutId={today.loggedWorkout.id}
          initial={today.loggedWorkout}
        />
      )}
    </div>
  );
}
