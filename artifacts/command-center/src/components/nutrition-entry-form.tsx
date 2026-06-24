import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCreateNutritionEntry } from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Plus } from "lucide-react";

// Phase 13 — manual food logging. A timestamped entry (label + macros) that
// posts to /api/nutrition/entries; the server rolls it into the day total
// alongside any Apple-Health-synced entry. After a write we invalidate the
// hand-fetched nutrition queries so the page (ring, chips, water, trend)
// refetches with the new total.
//
// `date` is the local day the entry counts toward (defaults to the server's
// local day when omitted, but the Nutrition page passes the day under review).

interface NutritionEntryFormProps {
  date?: string;
  triggerLabel?: string;
  triggerClassName?: string;
}

function numOrNull(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

export function NutritionEntryForm({
  date,
  triggerLabel = "Log food",
  triggerClassName,
}: NutritionEntryFormProps) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [calories, setCalories] = useState("");
  const [proteinG, setProteinG] = useState("");
  const [carbsG, setCarbsG] = useState("");
  const [fatG, setFatG] = useState("");
  const create = useCreateNutritionEntry();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  function reset() {
    setLabel("");
    setCalories("");
    setProteinG("");
    setCarbsG("");
    setFatG("");
  }

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["/api/nutrition/today"] });
    queryClient.invalidateQueries({ queryKey: ["/api/nutrition/recent", 90] });
    queryClient.invalidateQueries({ queryKey: ["/api/nutrition/day"] });
    queryClient.invalidateQueries({ queryKey: ["/api/nutrition/entries"] });
  }

  function submit() {
    const data = {
      ...(date ? { date } : {}),
      label: label.trim() || null,
      calories: numOrNull(calories),
      proteinG: numOrNull(proteinG),
      carbsG: numOrNull(carbsG),
      fatG: numOrNull(fatG),
    };
    create.mutate(
      { data },
      {
        onSuccess: () => {
          toast({ title: "Logged", description: label.trim() || "Food entry added." });
          invalidate();
          reset();
          setOpen(false);
        },
        onError: () => {
          toast({ title: "Couldn't log that", description: "Try again.", variant: "destructive" });
        },
      },
    );
  }

  const nothingEntered =
    !calories.trim() && !proteinG.trim() && !carbsG.trim() && !fatG.trim();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className={triggerClassName} data-testid="nutrition-entry-open">
          <Plus className="h-4 w-4 mr-2" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">Log food</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground">Label</label>
            <Input
              placeholder="Chicken & rice"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              data-testid="nutrition-entry-label"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Calories</label>
              <Input
                type="number"
                inputMode="numeric"
                value={calories}
                onChange={(e) => setCalories(e.target.value)}
                data-testid="nutrition-entry-calories"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Protein (g)</label>
              <Input
                type="number"
                inputMode="numeric"
                value={proteinG}
                onChange={(e) => setProteinG(e.target.value)}
                data-testid="nutrition-entry-protein"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Carbs (g)</label>
              <Input
                type="number"
                inputMode="numeric"
                value={carbsG}
                onChange={(e) => setCarbsG(e.target.value)}
                data-testid="nutrition-entry-carbs"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Fat (g)</label>
              <Input
                type="number"
                inputMode="numeric"
                value={fatG}
                onChange={(e) => setFatG(e.target.value)}
                data-testid="nutrition-entry-fat"
              />
            </div>
          </div>
          <Button
            className="w-full"
            disabled={nothingEntered || create.isPending}
            onClick={submit}
            data-testid="nutrition-entry-submit"
          >
            {create.isPending ? "Saving…" : "Add entry"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
