import {
  useMaxHr,
  useRestingHr,
  useRunTargetingMode,
} from "@/hooks/use-run-targeting-mode";
import { formatRunTarget, HR_ZONE_COLORS, isRunSession } from "@/lib/run-target";
import { cn } from "@/lib/utils";

interface RunTargetLineProps {
  sessionType: string;
  week: number;
  runMin: number | null | undefined;
  distanceMi?: number | null;
  pace?: string | null;
  variant?: "prominent" | "compact";
  testId?: string;
}

// Single source of truth for the prescribed-run target line (Task #134).
// Replaces the legacy "pace · run minutes" snippet on Today, the week
// detail collapsed/expanded cards, and the pre-launch first-session
// preview. Returns null for non-run prescriptions (rest, strength,
// cardio cross-train) so the surrounding layout collapses naturally.
//
// Task #165: when the active mode is "hr_zones", we also render a
// small color swatch next to "Zone N · …" matching the Settings
// preview's 5-zone color ramp (1=grey, 2=green, 3=yellow, 4=orange,
// 5=red). Colors come from `HR_ZONE_COLORS` so this surface stays in
// lockstep with Settings — the bucket comes back from `formatRunTarget`
// rather than being re-derived here.
export function RunTargetLine({
  sessionType,
  week,
  runMin,
  distanceMi,
  pace,
  variant = "prominent",
  testId,
}: RunTargetLineProps) {
  const mode = useRunTargetingMode();
  const maxHr = useMaxHr();
  const restingHr = useRestingHr();
  if (!isRunSession({ sessionType, runMin, distanceMi })) return null;
  const { primary, modeLabel, bucket } = formatRunTarget(mode, {
    sessionType,
    week,
    runMin,
    distanceMi,
    pace,
    maxHr,
    restingHr,
  });

  const showZoneSwatch = mode === "hr_zones";
  const swatchTestId = testId ? `${testId}-zone-swatch` : undefined;
  // Mid-saturation 500-shade Tailwind tokens chosen in HR_ZONE_COLORS
  // stay legible against both the light (~bg-primary/5) and dark
  // muted backgrounds; the inset ring provides a subtle outline so a
  // green / yellow swatch never disappears against the chip.
  const swatchClass = HR_ZONE_COLORS[bucket].swatchClass;

  if (variant === "compact") {
    return (
      <span
        className="inline-flex items-baseline gap-1.5 text-xs"
        data-testid={testId}
        data-run-targeting-mode={mode}
      >
        <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">
          {modeLabel}
        </span>
        <span className="inline-flex items-center gap-1.5 font-mono font-medium">
          {showZoneSwatch && (
            <span
              aria-hidden="true"
              className={`inline-block h-2.5 w-2.5 rounded-sm ring-1 ring-inset ring-black/10 dark:ring-white/15 ${swatchClass}`}
              data-testid={swatchTestId}
            />
          )}
          {primary}
        </span>
      </span>
    );
  }

  return (
    <div
      className={cn(
        "rounded-md border border-primary/30 bg-primary/5 px-4 py-3",
      )}
      data-testid={testId}
      data-run-targeting-mode={mode}
    >
      <p className="text-[10px] text-primary uppercase font-bold tracking-widest">
        Run Target · {modeLabel}
      </p>
      <p
        className="mt-1 flex items-center gap-2 text-lg font-black"
        data-testid={testId ? `${testId}-primary` : undefined}
      >
        {showZoneSwatch && (
          <span
            aria-hidden="true"
            className={`inline-block h-3 w-3 rounded-sm ring-1 ring-inset ring-black/10 dark:ring-white/15 ${swatchClass}`}
            data-testid={swatchTestId}
          />
        )}
        <span>{primary}</span>
      </p>
    </div>
  );
}
