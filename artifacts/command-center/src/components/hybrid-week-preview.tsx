import { useMemo } from "react";
import {
  previewHybridWeek,
  type HybridFitnessLevel,
  type HybridMixPosition,
} from "@workspace/plan-generator";

export interface HybridWeekPreviewProps {
  position: HybridMixPosition;
  daysPerWeek: number;
  level: HybridFitnessLevel;
  blockWeeks: number;
  weekInBlock?: number;
}

const SLOT_TONE = {
  rest: "text-muted-foreground",
  lift: "text-amber-600 dark:text-amber-400",
  run: "text-sky-600 dark:text-sky-400",
} as const;

const RUN_INTENSITY_TAG = {
  easy: "EASY",
  quality: "TEMPO",
  long: "LONG",
} as const;

export function HybridWeekPreview({
  position,
  daysPerWeek,
  level,
  blockWeeks,
  weekInBlock = 1,
}: HybridWeekPreviewProps) {
  const preview = useMemo(
    () =>
      previewHybridWeek(
        { position, daysPerWeek, level },
        { weekInBlock, blockWeeks },
      ),
    [position, daysPerWeek, level, weekInBlock, blockWeeks],
  );

  const isCutback = preview.weekInBlock > 0 && preview.weekInBlock % 4 === 0;

  return (
    <div
      className="space-y-1.5 rounded-md border bg-muted/20 p-2"
      data-testid="planner-hybrid-preview"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Typical week (week {preview.weekInBlock} of {preview.blockWeeks})
        </div>
        {isCutback && (
          <span
            className="rounded bg-amber-500/15 px-1 py-px text-[9px] font-mono uppercase tracking-wider text-amber-700 dark:text-amber-300"
            data-testid="planner-hybrid-preview-cutback"
          >
            Cutback
          </span>
        )}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {preview.slots.map((s) => {
          const tag =
            s.kind === "lift"
              ? s.heavy
                ? "HEAVY"
                : "ACC"
              : s.kind === "run"
                ? RUN_INTENSITY_TAG[s.intensity]
                : null;
          return (
            <div
              key={s.day}
              className="rounded border bg-background p-1 text-center"
              data-testid={`planner-hybrid-preview-${s.day.toLowerCase()}`}
            >
              <div className="text-[9px] font-mono uppercase text-muted-foreground">
                {s.day}
              </div>
              <div
                className={
                  "mt-0.5 text-[10px] font-medium leading-tight " +
                  SLOT_TONE[s.kind]
                }
              >
                {s.label}
              </div>
              {tag && (
                <div
                  className="mt-0.5 text-[8px] font-mono uppercase tracking-wider text-muted-foreground"
                  data-testid={`planner-hybrid-preview-${s.day.toLowerCase()}-tag`}
                >
                  {tag}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div
        className="text-[10px] text-muted-foreground"
        data-testid="planner-hybrid-preview-totals"
      >
        {preview.totals.sessions} sessions · {preview.totals.lifts} lift
        {preview.totals.lifts === 1 ? "" : "s"} · {preview.totals.runs} run
        {preview.totals.runs === 1 ? "" : "s"} ·{" "}
        {preview.totals.miles.toFixed(1)} mi
      </div>
    </div>
  );
}
