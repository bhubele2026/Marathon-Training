import { useState } from "react";
import { useListWorkouts, useDeleteWorkout } from "@workspace/api-client-react";
import { LIFESTYLE_EQUIPMENT } from "@workspace/plan-generator";
import { invalidateMissionRelatedQueries } from "@/lib/invalidate-mission-queries";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDistance, formatLoad, formatDate } from "@/lib/format";
import { Edit, Trash2, Plus } from "lucide-react";
import { WorkoutForm } from "@/components/workout-form";
import { ActualBreakdown } from "@/components/actual-breakdown";
import { RunTargetLine } from "@/components/run-target-line";
import { PrimaryMetricDisplay } from "@/components/primary-metric-display";
import { SessionDetailDisclosure } from "@/components/session-detail-disclosure";
import { getPrimaryMetric } from "@/lib/primary-metric";
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

export default function Log() {
  const [equipment, setEquipment] = useState<string>("All");
  const [timeOfDay, setTimeOfDay] = useState<string>("All");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [formOpen, setFormOpen] = useState(false);
  const [editWorkout, setEditWorkout] = useState<any>(null);

  const queryParams = {
    ...(equipment !== "All" ? { equipment } : {}),
    ...(timeOfDay !== "All" ? { timeOfDay: timeOfDay as "AM" | "PM" | "Other" } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  };

  const { data: workouts, isLoading } = useListWorkouts(queryParams);
  const deleteWorkout = useDeleteWorkout();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const handleEdit = (workout: any) => {
    setEditWorkout(workout);
    setFormOpen(true);
  };

  const handleCreate = () => {
    setEditWorkout(null);
    setFormOpen(true);
  };

  const handleDelete = (id: number) => {
    deleteWorkout.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Workout deleted" });
        invalidateMissionRelatedQueries(queryClient);
      }
    });
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-black uppercase tracking-tight text-primary">Training Log</h2>
          <p className="text-muted-foreground uppercase font-medium tracking-widest mt-1">Activity History</p>
        </div>
        <Button onClick={handleCreate} className="uppercase font-bold tracking-wider">
          <Plus className="h-4 w-4 mr-2" /> Log New
        </Button>
      </div>

      <div className="bg-card border border-border rounded-lg p-4 flex flex-col md:flex-row gap-4 items-end">
        <div className="space-y-2 flex-1 w-full md:w-auto">
          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Equipment</label>
          <Select value={equipment} onValueChange={setEquipment}>
            <SelectTrigger>
              <SelectValue placeholder="All Equipment" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All Equipment</SelectItem>
              <SelectItem value="Tonal">Tonal</SelectItem>
              <SelectItem value="Peloton Tread">Peloton Tread</SelectItem>
              <SelectItem value="Peloton Bike">Peloton Bike</SelectItem>
              <SelectItem value="Peloton Row">Peloton Row</SelectItem>
              <SelectItem value="Outdoor">Outdoor</SelectItem>
              <SelectItem value={LIFESTYLE_EQUIPMENT}>{LIFESTYLE_EQUIPMENT}</SelectItem>
              <SelectItem value="None">None / Rest</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2 flex-1 w-full md:w-auto">
          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Time of Day</label>
          <Select value={timeOfDay} onValueChange={setTimeOfDay}>
            <SelectTrigger>
              <SelectValue placeholder="All Times" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All Times</SelectItem>
              <SelectItem value="AM">AM</SelectItem>
              <SelectItem value="PM">PM</SelectItem>
              <SelectItem value="Other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2 flex-1 w-full md:w-auto">
          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">From Date</label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="space-y-2 flex-1 w-full md:w-auto">
          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">To Date</label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {isLoading ? (
          <div className="p-8"><Skeleton className="h-64 w-full" /></div>
        ) : (
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="uppercase text-[10px] font-bold tracking-wider">Date</TableHead>
                <TableHead className="uppercase text-[10px] font-bold tracking-wider">Type</TableHead>
                <TableHead className="uppercase text-[10px] font-bold tracking-wider">Equipment</TableHead>
                {/* Task #138: collapsed Distance / Time / Pace / Load
                    columns into a single one-number "Metric" column
                    powered by getPrimaryMetric, matching the slimmed
                    session-card treatment from Task #133. The full
                    breakdown still lives in the per-row expand below. */}
                <TableHead className="uppercase text-[10px] font-bold tracking-wider text-right">Metric</TableHead>
                <TableHead className="text-right"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {workouts?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">No workouts found</TableCell>
                </TableRow>
              ) : (
                workouts?.flatMap((workout) => [
                  <TableRow key={workout.id} className="hover:bg-muted/30 border-b-0">
                    <TableCell className="font-medium whitespace-nowrap">{formatDate(workout.date)}</TableCell>
                    <TableCell className="font-bold">{workout.sessionType}</TableCell>
                    <TableCell>
                      <div
                        className="flex flex-wrap gap-1"
                        data-testid={`chip-rail-log-${workout.id}`}
                      >
                        {(workout.equipmentList ?? [workout.equipment]).map((eq, idx) => (
                          <span
                            key={`log-eq-${workout.id}-${idx}`}
                            className="text-[10px] bg-secondary text-secondary-foreground px-2 py-0.5 rounded font-bold uppercase tracking-wider"
                            data-testid={`chip-equipment-log-${workout.id}-${idx}`}
                          >
                            {eq}
                          </span>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      {/* Task #138: single headline number per row
                          (miles for runs, minutes for lifts/cardio,
                          total for mixed) instead of cramming distance
                          + duration + load into separate columns.
                          Hidden details (per-bucket breakdown, pace,
                          load, run-target) live in the disclosure row
                          below. */}
                      <PrimaryMetricDisplay
                        metric={getPrimaryMetric(workout)}
                        variant="compact"
                        testIdPrefix={`log-row-${workout.id}`}
                        className="inline-block text-right"
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEdit(workout)}>
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
                              <AlertDialogTitle>Delete workout?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDelete(workout.id)}>Delete</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>,
                  <TableRow key={`${workout.id}-detail`} className="hover:bg-transparent">
                    <TableCell colSpan={5} className="pt-0">
                      <SessionDetailDisclosure
                        testId={`toggle-log-session-detail-${workout.id}`}
                      >
                        <div className="space-y-3 px-1">
                          {/* Per-bucket actual breakdown (Task #76),
                              moved into the disclosure as part of the
                              Task #138 slim-down. */}
                          <ActualBreakdown
                            totalMin={workout.totalMin}
                            strengthMin={workout.strengthMin}
                            cardioMin={workout.cardioMin}
                            runMin={workout.runMin}
                            durationMin={workout.durationMin}
                            variant="compact"
                            testIdPrefix={`log-row-${workout.id}`}
                          />
                          <div className="grid grid-cols-3 gap-3 text-xs">
                            <div>
                              <p className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">Distance</p>
                              <p className="font-mono font-bold" data-testid={`log-row-${workout.id}-distance`}>{formatDistance(workout.distanceMi)}</p>
                            </div>
                            <div>
                              <p className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">Pace</p>
                              <p className="font-mono font-bold" data-testid={`log-row-${workout.id}-pace`}>{workout.pace || '-'}</p>
                            </div>
                            <div>
                              <p className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">Load</p>
                              <p className="font-mono font-bold" data-testid={`log-row-${workout.id}-load`}>{formatLoad(workout.totalLoad)}</p>
                            </div>
                          </div>
                          {/* Task #140 prescribed run-target line, kept
                              in the expand so the runner can still
                              compare planned vs actual without the
                              collapsed row growing back. */}
                          {workout.prescribedRunTarget && (
                            <RunTargetLine
                              sessionType={workout.prescribedRunTarget.sessionType}
                              week={workout.prescribedRunTarget.week}
                              runMin={workout.prescribedRunTarget.runMin}
                              distanceMi={workout.prescribedRunTarget.distanceMi}
                              pace={workout.prescribedRunTarget.pace}
                              variant="compact"
                              testId={`log-row-${workout.id}-run-target`}
                            />
                          )}
                        </div>
                      </SessionDetailDisclosure>
                    </TableCell>
                  </TableRow>,
                ])
              )}
            </TableBody>
          </Table>
        )}
      </div>

      <WorkoutForm 
        open={formOpen} 
        onOpenChange={setFormOpen} 
        workoutId={editWorkout?.id}
        initial={editWorkout || undefined} 
      />
    </div>
  );
}
