import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCreateWaterLog } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Plus, GlassWater } from "lucide-react";

// Phase 13 — tap-to-add water. Posts a timestamped log (fl oz) to /api/water;
// the server rolls it into the day's water total, which the WaterTracker reads.
// Quick presets for a cup (8 oz) and a bottle (16 oz) plus a custom amount.

interface WaterQuickAddProps {
  date?: string;
}

export function WaterQuickAdd({ date }: WaterQuickAddProps) {
  const [custom, setCustom] = useState("");
  const create = useCreateWaterLog();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["/api/nutrition/today"] });
    queryClient.invalidateQueries({ queryKey: ["/api/nutrition/recent", 90] });
    queryClient.invalidateQueries({ queryKey: ["/api/water"] });
  }

  function add(oz: number) {
    if (!Number.isFinite(oz) || oz <= 0) return;
    create.mutate(
      { data: { oz: Math.round(oz), ...(date ? { date } : {}) } },
      {
        onSuccess: () => {
          invalidate();
          setCustom("");
        },
        onError: () =>
          toast({ title: "Couldn't add water", variant: "destructive" }),
      },
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="water-quick-add">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={create.isPending}
        onClick={() => add(8)}
        data-testid="water-add-cup"
      >
        <GlassWater className="h-4 w-4 mr-1.5" /> +1 cup
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={create.isPending}
        onClick={() => add(16)}
        data-testid="water-add-bottle"
      >
        +16 oz
      </Button>
      <div className="flex items-center gap-1.5">
        <Input
          type="number"
          inputMode="numeric"
          placeholder="oz"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          className="h-9 w-20"
          data-testid="water-add-custom-input"
        />
        <Button
          type="button"
          size="sm"
          disabled={create.isPending || custom.trim() === ""}
          onClick={() => add(Number(custom))}
          data-testid="water-add-custom-submit"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
