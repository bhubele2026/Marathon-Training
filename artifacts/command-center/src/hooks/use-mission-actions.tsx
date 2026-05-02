import { useState } from "react";
import {
  useCreateWorkout,
  useDeleteWorkout,
  PlanDay,
  Workout,
  WorkoutSuggestions,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { WorkoutForm } from "@/components/workout-form";
import { invalidateMissionRelatedQueries } from "@/lib/invalidate-mission-queries";
import { crushSass, skipSass } from "@/lib/sass";
import { defaultTimeOfDayForNow } from "@/lib/time-of-day";
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

// Mirror of the inference table in workout-form.tsx so the Crushed It
// shortcut tags the resulting workout with the same modality the user
// would otherwise pick by hand.
function inferModalityFromEquipment(
  equipment: string,
): "Cardio" | "Strength" | null {
  switch (equipment) {
    case "Tonal":
      return "Strength";
    case "Peloton Tread":
    case "Peloton Bike":
    case "Peloton Row":
    case "Outdoor":
      return "Cardio";
    default:
      return null;
  }
}

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
  const [skipCtx, setSkipCtx] = useState<MissionContext | null>(null);
  const createWorkout = useCreateWorkout();
  const deleteWorkout = useDeleteWorkout();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const invalidateAll = () => invalidateMissionRelatedQueries(queryClient);

  const crushIt = (ctx: MissionContext) => {
    if (!ctx.plan) {
      toast({ title: "No plan to crush", variant: "destructive" });
      return;
    }
    const { plan } = ctx;
    // Mirror the prescribed per-bucket minutes onto the actual workout so
    // the plan-vs-actual breakdown on /today and /plan/:week shows a
    // perfect match for "Crushed It". Falls back to plan.cardioMin for
    // legacy `durationMin` consumers (e.g. equipment usage chart) when
    // totalMin is null.
    const liftMin = plan.strengthMin ?? null;
    const cardioMin = plan.cardioMin ?? null;
    const runMin = plan.runMin ?? null;
    const totalMin =
      plan.totalMin ??
      (liftMin == null && cardioMin == null && runMin == null
        ? null
        : (liftMin ?? 0) + (cardioMin ?? 0) + (runMin ?? 0));
    createWorkout.mutate(
      {
        data: {
          date: ctx.date,
          equipment: plan.equipment,
          // Inherit the prescribed chip rail so logged sessions render
          // the same multi-machine pills as the plan day.
          equipmentList: plan.equipmentList ?? [plan.equipment],
          sessionType: plan.sessionType,
          durationMin: totalMin ?? plan.cardioMin ?? 0,
          strengthMin: liftMin,
          cardioMin: cardioMin,
          runMin: runMin,
          distanceMi: plan.distanceMi ?? null,
          pace: ctx.suggestions?.pace ?? plan.pace ?? "",
          avgHr: ctx.suggestions?.avgHr ?? null,
          rpe: ctx.suggestions?.rpe ?? null,
          strengthLoad: plan.strengthLoad ?? 0,
          totalLoad: plan.totalLoad ?? 0,
          notes: "Crushed it as planned.",
          planDayId: plan.id,
          // Tag with AM/PM based on the local clock so multi-session days
          // sort sensibly without forcing the user into the form.
          timeOfDay: defaultTimeOfDayForNow(),
          // Tag the modality from the planned equipment so the new
          // cardio/strength filter reflects quick-logged sessions too.
          modality: inferModalityFromEquipment(plan.equipment),
        },
      },
      {
        onSuccess: () => {
          const sass = crushSass();
          toast({ title: sass.title, description: sass.description });
          invalidateAll();
        },
        onError: () => {
          toast({ title: "Failed to log workout", variant: "destructive" });
        },
      },
    );
  };

  const confirmSkip = () => {
    if (!skipCtx) return;
    const ctx = skipCtx;
    createWorkout.mutate(
      {
        data: {
          date: ctx.date,
          equipment: "None",
          equipmentList: ["None"],
          sessionType: "Skipped",
          durationMin: 0,
          distanceMi: null,
          pace: "",
          avgHr: null,
          rpe: null,
          strengthLoad: 0,
          totalLoad: 0,
          notes: `Skipped: ${ctx.plan?.sessionType ?? "session"}.`,
          planDayId: ctx.plan?.id,
        },
      },
      {
        onSuccess: () => {
          const sass = skipSass();
          toast({ title: sass.title, description: sass.description, variant: "destructive" });
          invalidateAll();
          setSkipCtx(null);
        },
        onError: () => {
          toast({ title: "Failed to record skip", variant: "destructive" });
        },
      },
    );
  };

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
                  // Preserve the planned multi-machine rail when the
                  // user logs manually so a Tonal+Bike day arrives in
                  // the form with both chips on, not just the scalar.
                  equipmentList:
                    logCtx.plan.equipmentList ?? [logCtx.plan.equipment],
                  sessionType: logCtx.plan.sessionType,
                  distanceMi: logCtx.plan.distanceMi,
                  // Pre-fill the rolled-up duration from the plan's total
                  // minutes when available so it matches the per-bucket
                  // pre-fill below; fall back to the legacy cardioMin
                  // value for plan rows that haven't been backfilled yet.
                  durationMin: logCtx.plan.totalMin ?? logCtx.plan.cardioMin,
                  // Pre-fill the per-bucket actuals from the plan day so
                  // the user just confirms the breakdown rather than
                  // typing it from scratch (same UX as "Crushed It").
                  strengthMin: logCtx.plan.strengthMin,
                  cardioMin: logCtx.plan.cardioMin,
                  runMin: logCtx.plan.runMin,
                  totalLoad: logCtx.plan.totalLoad,
                  planDayId: logCtx.plan.id,
                  rpe: logCtx.suggestions?.rpe ?? null,
                  avgHr: logCtx.suggestions?.avgHr ?? null,
                  pace: logCtx.suggestions?.pace ?? null,
                }
              : { date: logCtx.date }
          }
          suggestions={logCtx.suggestions}
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
      <AlertDialog open={!!skipCtx} onOpenChange={(open) => !open && setSkipCtx(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Skip this workout?</AlertDialogTitle>
            <AlertDialogDescription>
              Logging a skip permanently records that you bailed on{" "}
              <span className="font-semibold">
                {skipCtx?.plan?.sessionType ?? "this session"}
              </span>
              . The plan doesn't forget. Neither will the scale.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={createWorkout.isPending}>
              Nevermind, I'll do it
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={createWorkout.isPending}
              onClick={(e) => {
                e.preventDefault();
                confirmSkip();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {createWorkout.isPending ? "Logging..." : "Yep, I skipped"}
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
    requestSkip: (ctx: MissionContext) => setSkipCtx(ctx),
    crushIt,
    isDeleting: deleteWorkout.isPending,
    isCrushing: createWorkout.isPending,
    dialogs,
  };
}
