import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { useSwapPlanDay, PlanDay } from "@workspace/api-client-react";
import { invalidateMissionRelatedQueries } from "@/lib/invalidate-mission-queries";
import { formatDate } from "@/lib/format";
import { ArrowLeftRight } from "lucide-react";

interface MoveDayPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  day: PlanDay;
  candidates: PlanDay[];
}

export function MoveDayPicker({ open, onOpenChange, day, candidates }: MoveDayPickerProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const swapPlanDay = useSwapPlanDay();

  const handleSwap = (other: PlanDay) => {
    swapPlanDay.mutate(
      { id: day.id, data: { withDayId: other.id } },
      {
        onSuccess: () => {
          toast({
            title: "Days swapped",
            description: `${day.day} (${day.sessionType}) traded places with ${other.day} (${other.sessionType}).`,
          });
          invalidateMissionRelatedQueries(queryClient);
          onOpenChange(false);
        },
        onError: () => {
          toast({ title: "Failed to swap days", variant: "destructive" });
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Move {day.day}'s session</DialogTitle>
          <DialogDescription>
            Pick a day in this week to swap session content with. Calendar dates stay put — only the sessions trade places.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {candidates.length === 0 && (
            <p className="text-sm text-muted-foreground">No other days available in this week.</p>
          )}
          {candidates.map((c) => (
            <button
              key={c.id}
              type="button"
              disabled={swapPlanDay.isPending}
              onClick={() => handleSwap(c)}
              className="w-full flex items-center justify-between gap-3 rounded-md border border-border bg-card p-3 text-left transition-colors hover:border-primary/50 hover:bg-muted/50 disabled:opacity-50"
              data-testid={`button-swap-with-${c.date}`}
            >
              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-bold uppercase tracking-wider text-xs">{c.day}</span>
                  <span className="text-xs text-muted-foreground">{formatDate(c.date)}</span>
                </div>
                <div className="text-sm font-medium truncate">
                  {c.isRest ? "Rest / Recovery" : c.sessionType}
                </div>
                {!c.isRest && (
                  <div className="text-xs text-muted-foreground truncate">{c.equipment}</div>
                )}
              </div>
              <ArrowLeftRight className="h-4 w-4 text-muted-foreground shrink-0" />
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
