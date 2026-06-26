import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCreateAlcohol, useMarkDryDay } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Plus, Wine, CheckCircle2 } from "lucide-react";

// Tap-to-log alcohol — mirrors WaterQuickAdd. Posts a timestamped entry
// (standard drinks) to /api/alcohol, or marks the day intentionally dry. This is
// a reduction tool: "Mark dry" is the positive action, surfaced right alongside
// the drink quick-add.

interface AlcoholQuickAddProps {
  date?: string;
  /** Hide the "Mark dry" action (e.g. in a compact dashboard slot). */
  showMarkDry?: boolean;
}

export function AlcoholQuickAdd({ date, showMarkDry = true }: AlcoholQuickAddProps) {
  const [custom, setCustom] = useState("");
  const create = useCreateAlcohol();
  const markDry = useMarkDryDay();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["/api/alcohol"] });
    // The dashboard box + tiles read the computed summary under its own key.
    queryClient.invalidateQueries({ queryKey: ["/api/alcohol/summary"] });
    // A drink DOES change the nutritionist inputs, but the server regenerates
    // only when the input hash changes — so just mark the report stale and let
    // it refresh in the background next time the panel is viewed, instead of
    // forcing an immediate (slow) regeneration on every quick-add.
    queryClient.invalidateQueries({
      queryKey: ["/api/nutritionist/analysis"],
      refetchType: "none",
    });
  }

  function add(standardDrinks: number) {
    if (!Number.isFinite(standardDrinks) || standardDrinks <= 0) return;
    create.mutate(
      { data: { standardDrinks, ...(date ? { date } : {}) } },
      {
        onSuccess: () => {
          invalidate();
          setCustom("");
        },
        onError: () => toast({ title: "Couldn't log that drink", variant: "destructive" }),
      },
    );
  }

  function dry() {
    markDry.mutate(
      { data: { ...(date ? { date } : {}) } },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: "Logged a dry day 🙌" });
        },
        onError: () => toast({ title: "Couldn't mark dry", variant: "destructive" }),
      },
    );
  }

  const pending = create.isPending || markDry.isPending;

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="alcohol-quick-add">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => add(1)}
        data-testid="alcohol-add-one"
      >
        <Wine className="mr-1.5 h-4 w-4" /> +1 drink
      </Button>
      <div className="flex items-center gap-1.5">
        <Input
          type="number"
          inputMode="decimal"
          step="0.5"
          placeholder="drinks"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          className="h-9 w-24"
          data-testid="alcohol-add-custom-input"
        />
        <Button
          type="button"
          size="sm"
          disabled={pending || custom.trim() === ""}
          onClick={() => add(Number(custom))}
          data-testid="alcohol-add-custom-submit"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      {showMarkDry && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={dry}
          className="text-[hsl(var(--success))] hover:text-[hsl(var(--success))]"
          data-testid="alcohol-mark-dry"
        >
          <CheckCircle2 className="mr-1.5 h-4 w-4" /> Mark dry
        </Button>
      )}
    </div>
  );
}
