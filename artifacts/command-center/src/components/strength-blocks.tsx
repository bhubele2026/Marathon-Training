// Renders the real strength workout for a plan day (or logged session): the
// ordered list of movements with sets x reps and a load target. Phase 1 added
// the underlying strengthBlocks model — before this, a "strength workout" was
// just a minute count and a sentence. Renders nothing when there are no blocks,
// so rest / pure-conditioning / pure-run / legacy days fall back to the prose
// description + minute breakdown already shown by the caller.

import type { StrengthBlock } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";

// Human label for an OPTIONAL load target, e.g. "75% 1RM", "RIR 2", "135 lb",
// "BW". Usually null — Tonal's auto-weight owns the load, so the coach leaves it
// empty and we render nothing.
function formatLoad(b: StrengthBlock): string | null {
  switch (b.loadType) {
    case "percent_1rm":
      return b.loadValue != null ? `${b.loadValue}% 1RM` : null;
    case "rir":
      return b.loadValue != null ? `RIR ${b.loadValue}` : "RIR";
    case "lb":
      return b.loadValue != null ? `${b.loadValue} lb` : null;
    case "bodyweight":
      return "BW";
    default:
      return null;
  }
}

// The set scheme. Reps are OPTIONAL — Tonal drives them — so by default we show
// just "4 sets"; if the coach added a rep note we show "4 × 8-10".
function formatScheme(b: StrengthBlock): string {
  if (b.reps != null && b.reps !== "") return `${b.sets} × ${b.reps}`;
  return `${b.sets} ${b.sets === 1 ? "set" : "sets"}`;
}

export interface StrengthBlocksProps {
  blocks: StrengthBlock[] | null | undefined;
  variant?: "compact" | "prominent";
  testIdPrefix?: string;
}

export function StrengthBlocks({
  blocks,
  variant = "compact",
  testIdPrefix,
}: StrengthBlocksProps) {
  if (!blocks || blocks.length === 0) return null;
  const tid = (s: string) => (testIdPrefix ? `${testIdPrefix}-${s}` : undefined);
  const prominent = variant === "prominent";

  return (
    <ul
      className={cn("flex flex-col", prominent ? "gap-2" : "gap-1.5")}
      data-testid={tid("strength-blocks")}
    >
      {blocks.map((b, i) => {
        const load = formatLoad(b);
        return (
          <li
            key={i}
            className="flex items-baseline justify-between gap-3"
            data-testid={tid(`strength-block-${i}`)}
          >
            <div className="min-w-0">
              <span
                className={cn(
                  "font-semibold text-foreground",
                  prominent ? "text-base" : "text-sm",
                )}
              >
                {b.movement}
              </span>
              {b.tonalMode && (
                <span className="ml-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                  {b.tonalMode}
                </span>
              )}
              {b.cue && (
                <span className="block text-xs text-muted-foreground truncate">
                  {b.cue}
                </span>
              )}
            </div>
            <div className="shrink-0 text-right tabular-nums tabular-nums">
              <span
                className={cn(
                  "text-foreground",
                  prominent ? "text-base" : "text-sm",
                )}
              >
                {formatScheme(b)}
              </span>
              {load && (
                <span
                  className={cn(
                    "ml-2 text-muted-foreground",
                    prominent ? "text-sm" : "text-xs",
                  )}
                >
                  {load}
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
