import { useRunTargetingMode } from "@/hooks/use-run-targeting-mode";
import { formatRunTarget, isRunSession } from "@/lib/run-target";
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
  if (!isRunSession({ sessionType, runMin, distanceMi })) return null;
  const { primary, modeLabel } = formatRunTarget(mode, {
    sessionType,
    week,
    runMin,
    distanceMi,
    pace,
  });

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
        <span className="font-mono font-medium">{primary}</span>
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
      <p className="text-lg font-black mt-1" data-testid={testId ? `${testId}-primary` : undefined}>
        {primary}
      </p>
    </div>
  );
}
