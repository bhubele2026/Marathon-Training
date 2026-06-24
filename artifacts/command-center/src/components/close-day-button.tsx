import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Lock, CheckCircle2 } from "lucide-react";

// "Close the day" — marks today's eating DONE so the coach + AI nutritionist
// judge it as a finished day. Until it's closed, today is treated as in-progress
// (judged by pace toward target, never warned as "too low"). Closing/reopening
// busts the coach + nutritionist caches so their read updates immediately.

type NutritionDay = {
  date: string;
  calories: number | null;
  closedAt: string | null;
};
type RecentResponse = { days: number; entries: NutritionDay[] };

// The runner's LOCAL calendar day, not UTC — so "the day" the button closes is
// the day they're actually living (an evening in the US is already next-day UTC).
function localTodayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

async function postClose(closed: boolean, date: string): Promise<NutritionDay> {
  const res = await fetch("/api/nutrition/close", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ closed, date }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<NutritionDay>;
}

// `date` is the day under review (defaults to the runner's local today). The
// button closes / reopens THAT day, and reads its closed state from the recent
// feed (90-day window, shared cache with the Nutrition page + log).
export function CloseDayButton({ date: dateProp }: { date?: string } = {}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const date = dateProp ?? localTodayStr();
  const isToday = date === localTodayStr();
  const { data } = useQuery({
    queryKey: ["/api/nutrition/recent", 90],
    queryFn: () => getJson<RecentResponse>("/api/nutrition/recent?days=90"),
  });
  const closed = data?.entries.find((e) => e.date === date)?.closedAt != null;

  const mut = useMutation({
    mutationFn: (close: boolean) => postClose(close, date),
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
          ? `${isToday ? "Today" : "That day"} now counts as finished — the coach gives its real verdict.`
          : `${isToday ? "Today" : "That day"} is open again — judged by pace, no low-intake warnings.`,
      });
    },
    onError: () => toast({ title: "Couldn't update the day", variant: "destructive" }),
  });

  if (closed) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
        <span className="flex items-center gap-2 text-sm font-bold text-primary">
          <CheckCircle2 className="h-4 w-4" />
          {isToday ? "Day closed — today's counted as final." : "This day is closed — counted as final."}
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
        {isToday ? (
          <>
            Still eating? Today's judged by{" "}
            <span className="font-medium text-foreground">pace</span> until you close it — no
            low-intake warnings mid-day.
          </>
        ) : (
          <>
            This day's still open — judged by{" "}
            <span className="font-medium text-foreground">pace</span>. Close it to lock in the
            verdict.
          </>
        )}
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
        {mut.isPending ? "Closing…" : isToday ? "Close the day" : "Close this day"}
      </Button>
    </div>
  );
}
