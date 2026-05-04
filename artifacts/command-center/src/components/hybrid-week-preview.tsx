import { useMemo } from "react";
import { Trophy } from "lucide-react";
import {
  previewHybridWeek,
  type HybridFitnessLevel,
  type HybridMixPosition,
  type PlanRaceKind,
} from "@workspace/plan-generator";

export interface HybridWeekPreviewProps {
  position: HybridMixPosition;
  daysPerWeek: number;
  level: HybridFitnessLevel;
  blockWeeks: number;
  weekInBlock?: number;
  // Race-week branch (Task #203). When true, asks `previewHybridWeek`
  // for the campaign-final week shape (trailing Sat → Race Prep,
  // trailing Sun → RACE DAY at the matching distance) and renders the
  // Sunday cell with the same amber Trophy treatment Week Detail uses
  // for the marathon Sunday (Task #199). Defaults false → typical-week
  // preview (week 1 of the block).
  isRaceWeek?: boolean;
  // Race-day kind (Task #207). Drives which RACE_DAY_SPECS distance the
  // trailing Sunday is overridden to when `isRaceWeek` is set —
  // marathon (26.2) / half (13.1) / 10K (6.2) / 5K (3.1). Defaults to
  // "marathon" so existing callers (and the Task #203 marathon-only
  // branch) keep their behavior unchanged. When set to "none",
  // `previewHybridWeek` ignores `isRaceWeek` and emits the typical-week
  // shape — mirrors `buildHybridWeekDays`'s race-week guard.
  raceKind?: PlanRaceKind;
}

const SLOT_TONE = {
  rest: "text-muted-foreground",
  lift: "text-amber-600 dark:text-amber-400",
  run: "text-sky-600 dark:text-sky-400",
  "race-prep": "text-amber-700 dark:text-amber-300",
  race: "text-amber-700 dark:text-amber-300 font-bold",
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
  weekInBlock,
  isRaceWeek = false,
  raceKind = "marathon",
}: HybridWeekPreviewProps) {
  const preview = useMemo(
    () =>
      previewHybridWeek(
        { position, daysPerWeek, level },
        { weekInBlock, blockWeeks, isRaceWeek, raceKind },
      ),
    [
      position,
      daysPerWeek,
      level,
      weekInBlock,
      blockWeeks,
      isRaceWeek,
      raceKind,
    ],
  );

  const isCutback = preview.weekInBlock > 0 && preview.weekInBlock % 4 === 0;
  // Race-week previews suppress the Cutback badge — even if the
  // campaign-final week happens to align with a 4th-week cadence,
  // the trailing Sat/Sun overrides own that week's shape, not the
  // cutback scalar. Mirrors `buildHybridWeekDays`'s behavior where
  // the race-week branch skips the cutback-style description.
  const showCutbackBadge = isCutback && !preview.isRaceWeek;
  // Test-id prefix per branch so the planner can mount the typical-week
  // and race-week previews side-by-side without colliding on per-day
  // selectors (`planner-hybrid-preview-sun`, etc.). The typical-week
  // branch keeps the v1 prefix so existing planner-level tests that
  // target `planner-hybrid-preview-sun` / `-totals` keep working.
  const tidPrefix = preview.isRaceWeek
    ? "planner-hybrid-preview-race-week"
    : "planner-hybrid-preview";

  return (
    <div
      className="space-y-1.5 rounded-md border bg-muted/20 p-2"
      data-testid={tidPrefix}
      data-race-week={preview.isRaceWeek ? "true" : undefined}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {preview.isRaceWeek
            ? `Race week (week ${preview.weekInBlock} of ${preview.blockWeeks})`
            : `Typical week (week ${preview.weekInBlock} of ${preview.blockWeeks})`}
        </div>
        {preview.isRaceWeek && (
          <span
            className="rounded bg-amber-500/15 px-1 py-px text-[9px] font-mono uppercase tracking-wider text-amber-700 dark:text-amber-300 flex items-center gap-1"
            data-testid={`${tidPrefix}-badge`}
          >
            <Trophy className="h-2.5 w-2.5" /> Race Day
          </span>
        )}
        {showCutbackBadge && (
          <span
            className="rounded bg-amber-500/15 px-1 py-px text-[9px] font-mono uppercase tracking-wider text-amber-700 dark:text-amber-300"
            data-testid={`${tidPrefix}-cutback`}
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
                : s.kind === "race"
                  ? "RACE"
                  : s.kind === "race-prep"
                    ? "PREP"
                    : null;
          // Amber accent on the race-day Sunday cell — mirrors the
          // Week Detail card's race-day amber ring (Task #199) so the
          // visual language stays consistent between planning and
          // viewing the marathon Sunday.
          const cellClass =
            s.kind === "race"
              ? "rounded border border-amber-500/60 bg-amber-500/10 ring-1 ring-amber-500/30 p-1 text-center"
              : s.kind === "race-prep"
                ? "rounded border border-amber-500/40 bg-amber-500/5 p-1 text-center"
                : "rounded border bg-background p-1 text-center";
          return (
            <div
              key={s.day}
              className={cellClass}
              data-testid={`${tidPrefix}-${s.day.toLowerCase()}`}
              data-race-day={s.kind === "race" ? "true" : undefined}
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
                  data-testid={`${tidPrefix}-${s.day.toLowerCase()}-tag`}
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
        data-testid={`${tidPrefix}-totals`}
      >
        {preview.totals.sessions} sessions · {preview.totals.lifts} lift
        {preview.totals.lifts === 1 ? "" : "s"} · {preview.totals.runs} run
        {preview.totals.runs === 1 ? "" : "s"} ·{" "}
        {preview.totals.miles.toFixed(1)} mi
      </div>
    </div>
  );
}
