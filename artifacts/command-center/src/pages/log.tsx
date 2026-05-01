import { useState } from "react";
import { useListWorkouts, useDeleteWorkout } from "@workspace/api-client-react";
import { invalidateMissionRelatedQueries } from "@/lib/invalidate-mission-queries";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDistance, formatDuration, formatLoad, formatDate } from "@/lib/format";
import { Edit, Trash2, Plus } from "lucide-react";
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

export default function Log() {
  const [equipment, setEquipment] = useState<string>("All");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [formOpen, setFormOpen] = useState(false);
  const [editWorkout, setEditWorkout] = useState<any>(null);

  const queryParams = {
    ...(equipment !== "All" ? { equipment } : {}),
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
              <SelectItem value="Lifestyle">Lifestyle</SelectItem>
              <SelectItem value="None">None / Rest</SelectItem>
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
                <TableHead className="uppercase text-[10px] font-bold tracking-wider text-right">Distance</TableHead>
                <TableHead className="uppercase text-[10px] font-bold tracking-wider text-right">Time</TableHead>
                <TableHead className="uppercase text-[10px] font-bold tracking-wider text-right">Pace</TableHead>
                <TableHead className="uppercase text-[10px] font-bold tracking-wider text-right">Load</TableHead>
                <TableHead className="text-right"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {workouts?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">No workouts found</TableCell>
                </TableRow>
              ) : (
                workouts?.map((workout) => (
                  <TableRow key={workout.id} className="hover:bg-muted/30">
                    <TableCell className="font-medium whitespace-nowrap">{formatDate(workout.date)}</TableCell>
                    <TableCell className="font-bold">{workout.sessionType}</TableCell>
                    <TableCell>
                      <span className="text-[10px] bg-secondary text-secondary-foreground px-2 py-0.5 rounded font-bold uppercase tracking-wider">
                        {workout.equipment}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-mono">{formatDistance(workout.distanceMi)}</TableCell>
                    <TableCell className="text-right font-mono">{formatDuration(workout.durationMin)}</TableCell>
                    <TableCell className="text-right font-mono">{workout.pace || '-'}</TableCell>
                    <TableCell className="text-right font-mono">{formatLoad(workout.totalLoad)}</TableCell>
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
                  </TableRow>
                ))
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
