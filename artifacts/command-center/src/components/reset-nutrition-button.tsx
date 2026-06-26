import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Eraser } from "lucide-react";

// "Start nutrition tracking fresh from this date." Deletes every daily nutrition
// log BEFORE the chosen date (that date + everything after is kept), clears the
// cached AI report, and rebuilds the analysis from the new window. Plan, body
// measurements, and workouts are untouched. Defaults to today.
//
// Hand-fetched POST /api/nutrition/reset (same convention as the rest of the
// nutrition slice). Behind an AlertDialog confirm because it's destructive.

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

type ResetResponse = { before: string; deletedDays: number };

async function postReset(before: string): Promise<ResetResponse> {
  const res = await fetch("/api/nutrition/reset", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ before }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<ResetResponse>;
}

export function ResetNutritionButton() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [before, setBefore] = useState<string>(todayUtc());

  const reset = useMutation({
    mutationFn: () => postReset(before),
    onSuccess: (data) => {
      // Refresh every surface that summarized the now-deleted history. A reset
      // really does change the analysis inputs, but the server regenerates only
      // on an input-hash change — so mark the report stale and let it refresh in
      // the background next time the panel is opened rather than forcing a slow
      // regeneration as part of the reset.
      queryClient.invalidateQueries({
        queryKey: ["/api/nutritionist/analysis"],
        refetchType: "none",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/nutrition/recent"] });
      queryClient.invalidateQueries({ queryKey: ["/api/nutrition/today"] });
      queryClient.invalidateQueries({ queryKey: ["/api/nutrition/day"] });
      toast({
        title:
          data.deletedDays > 0
            ? `Cleared ${data.deletedDays} day${data.deletedDays === 1 ? "" : "s"} of nutrition`
            : "Nothing to clear",
        description:
          data.deletedDays > 0
            ? `Tracking now starts fresh from ${data.before}. Plan, body, and workouts are untouched.`
            : `No logged days before ${data.before}.`,
      });
    },
    onError: () => {
      toast({ title: "Couldn't reset nutrition", variant: "destructive" });
    },
  });

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between rounded-lg border border-dashed border-border p-4">
      <div className="space-y-1">
        <p className="text-sm font-bold tracking-wider text-foreground flex items-center gap-2">
          <Eraser className="h-4 w-4 text-muted-foreground" />
          Start nutrition fresh
        </p>
        <p className="text-xs text-muted-foreground max-w-md">
          Clears all logged nutrition <span className="font-semibold">before</span> the date
          below (that day onward is kept) and rebuilds the AI read. Your plan, body
          measurements, and workouts are not affected.
        </p>
      </div>
      <div className="flex items-end gap-2">
        <div className="flex flex-col gap-1">
          <label
            htmlFor="reset-before-date"
            className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
          >
            Keep from
          </label>
          <Input
            id="reset-before-date"
            type="date"
            value={before}
            max={todayUtc()}
            onChange={(e) => setBefore(e.target.value || todayUtc())}
            className="w-[150px]"
            data-testid="input-reset-before-date"
          />
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" data-testid="button-reset-nutrition">
              Clear earlier logs
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Clear nutrition before {before}?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently deletes every logged nutrition day before{" "}
                <span className="font-semibold">{before}</span>. That date and everything
                after it stays. Your plan, body measurements, and workouts are not touched.
                This can't be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => reset.mutate()}
                data-testid="button-reset-nutrition-confirm"
              >
                Clear earlier logs
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
