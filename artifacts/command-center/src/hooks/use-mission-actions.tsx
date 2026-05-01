import { useState } from "react";
import { useDeleteWorkout, TodayPlan } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { WorkoutForm } from "@/components/workout-form";
import { invalidateMissionRelatedQueries } from "@/lib/invalidate-mission-queries";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function useMissionActions(today: TodayPlan | undefined) {
  const [logOpen, setLogOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const deleteWorkout = useDeleteWorkout();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const invalidateAll = () => invalidateMissionRelatedQueries(queryClient);

  const dialogs = (
    <>
      {today?.plan && (
        <WorkoutForm
          open={logOpen}
          onOpenChange={setLogOpen}
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
      {today?.loggedWorkout && (
        <WorkoutForm
          open={editOpen}
          onOpenChange={setEditOpen}
          workoutId={today.loggedWorkout.id}
          initial={today.loggedWorkout}
        />
      )}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this workout log.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteWorkout.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteWorkout.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (!today?.loggedWorkout) return;
                deleteWorkout.mutate(
                  { id: today.loggedWorkout.id },
                  {
                    onSuccess: () => {
                      toast({ title: "Workout deleted" });
                      invalidateAll();
                      setDeleteOpen(false);
                    },
                    onError: () => {
                      toast({ title: "Failed to delete workout", variant: "destructive" });
                    },
                  }
                );
              }}
            >
              {deleteWorkout.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );

  return {
    openLog: () => setLogOpen(true),
    openEdit: () => setEditOpen(true),
    requestDelete: () => setDeleteOpen(true),
    isDeleting: deleteWorkout.isPending,
    dialogs,
  };
}
