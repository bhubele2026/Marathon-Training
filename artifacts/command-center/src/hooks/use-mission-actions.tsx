import { useState } from "react";
import { useDeleteWorkout, PlanDay, Workout, WorkoutSuggestions } from "@workspace/api-client-react";
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

export type MissionContext = {
  date: string;
  plan?: PlanDay | null;
  loggedWorkout?: Workout | null;
  suggestions?: WorkoutSuggestions | null;
};

export function useMissionActions() {
  const [logCtx, setLogCtx] = useState<MissionContext | null>(null);
  const [editCtx, setEditCtx] = useState<MissionContext | null>(null);
  const [deleteCtx, setDeleteCtx] = useState<MissionContext | null>(null);
  const deleteWorkout = useDeleteWorkout();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const invalidateAll = () => invalidateMissionRelatedQueries(queryClient);

  const dialogs = (
    <>
      {logCtx && (
        <WorkoutForm
          open={!!logCtx}
          onOpenChange={(open) => !open && setLogCtx(null)}
          initial={
            logCtx.plan
              ? {
                  date: logCtx.date,
                  equipment: logCtx.plan.equipment,
                  sessionType: logCtx.plan.sessionType,
                  distanceMi: logCtx.plan.distanceMi,
                  durationMin: logCtx.plan.cardioMin,
                  totalLoad: logCtx.plan.totalLoad,
                  planDayId: logCtx.plan.id,
                  rpe: logCtx.suggestions?.rpe ?? null,
                  avgHr: logCtx.suggestions?.avgHr ?? null,
                  pace: logCtx.suggestions?.pace ?? null,
                }
              : { date: logCtx.date }
          }
        />
      )}
      {editCtx?.loggedWorkout && (
        <WorkoutForm
          open={!!editCtx}
          onOpenChange={(open) => !open && setEditCtx(null)}
          workoutId={editCtx.loggedWorkout.id}
          initial={editCtx.loggedWorkout}
        />
      )}
      <AlertDialog open={!!deleteCtx} onOpenChange={(open) => !open && setDeleteCtx(null)}>
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
                if (!deleteCtx?.loggedWorkout) return;
                deleteWorkout.mutate(
                  { id: deleteCtx.loggedWorkout.id },
                  {
                    onSuccess: () => {
                      toast({ title: "Workout deleted" });
                      invalidateAll();
                      setDeleteCtx(null);
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
    openLog: (ctx: MissionContext) => setLogCtx(ctx),
    openEdit: (ctx: MissionContext) => setEditCtx(ctx),
    requestDelete: (ctx: MissionContext) => setDeleteCtx(ctx),
    isDeleting: deleteWorkout.isPending,
    dialogs,
  };
}
