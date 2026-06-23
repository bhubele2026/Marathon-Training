import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Lock, CheckCircle2 } from "lucide-react";

// "Close the day" — marks today's eating DONE so the coach + AI nutritionist
// judge it as a finished day. Until it's closed, today is treated as in-progress
// (judged by pace toward target, never warned as "too low"). Closing/reopening
// busts the coach + nutritionist caches so their read updates immediately.

type TodayNutrition = {
  date: string;
  calories: number | null;
  closedAt: string | null;
};

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

async function postClose(closed: boolean): Promise<TodayNutrition> {
  const res = await fetch("/api/nutrition/close", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ closed }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<TodayNutrition>;
}

export function CloseDayButton() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["/api/nutrition/today"],
    queryFn: () => getJson<TodayNutrition>("/api/nutrition/today"),
  });
  const closed = data?.closedAt != null;

  const mut = useMutation({
    mutationFn: (close: boolean) => postClose(close),
    onSuccess: (_res, close) => {
      // Everything that reads "is today final?" needs to re-evaluate.
      qc.invalidateQueries({ queryKey: ["/api/nutrition/today"] });
      qc.invalidateQueries({ queryKey: ["/api/nutritionist/analysis"] });
      qc.invalidateQueries({ queryKey: ["/api/coach/daily"] });
      qc.invalidateQueries({ queryKey: ["/api/coach/line"] });
      qc.invalidateQueries({ queryKey: ["/api/nutrition/recent"] });
      qc.invalidateQueries({ queryKey: ["/api/nutrition/day"] });
      toast({
        title: close ? "Day closed" : "Day reopened",
        description: close
          ? "Today now counts as a finished day — the coach gives its real verdict."
          : "Today's open again — judged by pace, no low-intake warnings.",
      });
    },
    onError: () => toast({ title: "Couldn't update the day", variant: "destructive" }),
  });

  if (closed) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
        <span className="flex items-center gap-2 text-sm font-bold text-primary">
          <CheckCircle2 className="h-4 w-4" />
          Day closed — today's counted as final.
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => mut.mutate(false)}
          disabled={mut.isPending}
          data-testid="button-reopen-day"
        >
          Reopen
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-border px-4 py-3">
      <span className="text-sm text-muted-foreground">
        Still eating? Today's judged by <span className="font-medium text-foreground">pace</span>{" "}
        until you close it — no low-intake warnings mid-day.
      </span>
      <Button
        variant="outline"
        size="sm"
        className="font-bold tracking-wider shrink-0"
        onClick={() => mut.mutate(true)}
        disabled={mut.isPending}
        data-testid="button-close-day"
      >
        <Lock className="h-3.5 w-3.5 mr-1.5" />
        {mut.isPending ? "Closing…" : "Close the day"}
      </Button>
    </div>
  );
}
