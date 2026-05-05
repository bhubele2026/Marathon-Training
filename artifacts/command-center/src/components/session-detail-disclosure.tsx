// Tiny wrapper around Radix Collapsible used to hide the heavy session
// detail (chip rails, planned/actual minute breakdown, pace, load,
// equipment chips) behind an expand affordance on the slimmed-down
// session cards (Task #133).
//
// Task #137 tightened the layout: when the panel opens it now renders
// inside a top-bordered, slightly indented gutter so the detail reads
// as a structured continuation of the slim card header rather than a
// loose dump of components below the trigger. The trigger itself uses
// the same uppercase / tracking-wider typography as the primary-metric
// label so the collapsed and expanded states share a visual language.
//
// Notes:
//   * `forceMount` keeps the children in the DOM when collapsed. They
//     end up with `data-state="closed"` and the `hidden` HTML attribute
//     so they are visually hidden but still queryable by tests that
//     reach for nested test ids (equipment chips, breakdown cells, …).
//   * Default state is closed so page loads start in the "one number"
//     view the task spec calls for.
import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

interface Props {
  children: ReactNode;
  /** Stable id used to namespace the trigger button's data-testid. */
  testId?: string;
  /** Visual size of the trigger. */
  size?: "sm" | "md";
  /** Optional extra class on the trigger row. */
  className?: string;
}

export function SessionDetailDisclosure({
  children,
  testId,
  size = "sm",
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        className={cn(
          "inline-flex items-center gap-1 text-muted-foreground hover:text-primary uppercase font-bold tracking-wider transition-colors",
          size === "sm" ? "text-[10px]" : "text-xs",
          className,
        )}
        data-testid={testId}
        data-state={open ? "open" : "closed"}
        type="button"
      >
        <ChevronDown
          className={cn(
            "transition-transform",
            size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5",
            open && "rotate-180",
          )}
        />
        {open ? "Hide details" : "Show details"}
      </CollapsibleTrigger>
      <CollapsibleContent forceMount>
        <div
          className={cn(
            "overflow-hidden transition-all",
            // Open: anchor the panel to the card with a thin top border
            // and a small left gutter so the detail visually pairs with
            // the headline above instead of floating loose. Closed: zero
            // out every box-model dimension so forceMount'd children
            // don't reserve layout space.
            open
              ? "mt-3 pt-3 pl-3 border-t border-border/50 space-y-3"
              : "h-0 m-0 p-0",
          )}
          // When closed we still keep children in the DOM (forceMount)
          // for tests, but visually collapse them with a `hidden`
          // attribute so they don't take layout space or get focus.
          {...(open ? {} : { hidden: true })}
        >
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
