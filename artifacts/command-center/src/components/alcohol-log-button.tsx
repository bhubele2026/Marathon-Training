import { useState } from "react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { AlcoholQuickAdd } from "@/components/alcohol-quick-add";
import { Wine } from "lucide-react";

// A compact "Log drink" affordance that mirrors the "Log food" trigger — a small
// button that pops the alcohol quick-add (+1 / custom / mark dry). Reused in the
// nutrition header (beside Log food) and on the dashboard alcohol box, so the
// drink-logging entry point lives wherever food + water logging already do.

interface AlcoholLogButtonProps {
  date?: string;
  triggerLabel?: string;
  triggerClassName?: string;
  /** Hide "Mark dry" inside the popover (e.g. a dense dashboard slot). */
  showMarkDry?: boolean;
}

export function AlcoholLogButton({
  date,
  triggerLabel = "Log drink",
  triggerClassName = "h-8 px-3 text-xs",
  showMarkDry = true,
}: AlcoholLogButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={triggerClassName}
          data-testid="button-log-drink"
        >
          <Wine className="mr-1.5 h-4 w-4" /> {triggerLabel}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto max-w-[20rem]">
        <p className="mb-2 font-display text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Log a drink
        </p>
        <AlcoholQuickAdd date={date} showMarkDry={showMarkDry} />
      </PopoverContent>
    </Popover>
  );
}
