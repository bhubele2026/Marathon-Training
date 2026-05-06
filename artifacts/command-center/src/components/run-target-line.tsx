import {
  useHrZoneModel,
  useMaxHr,
  useRestingHr,
  useRunTargetingMode,
} from "@/hooks/use-run-targeting-mode";
import {
  formatRunTarget,
  HR_ZONE_COLORS,
  HR_ZONE_TONES,
  isRunSession,
} from "@/lib/run-target";
import { cn } from "@/lib/utils";

interface RunTargetLineProps {
  sessionType: string;
  week: number;
  runMin: number | null | undefined;
  distanceMi?: number | null;
  pace?: string | null;
  variant?: "prominent" | "compact";
  testId?: string;
  // Task #227: when set, the prominent chip wrapper picks up the
  // zone-N tone from `HR_ZONE_TONES[zoneBucket]` (border + bg + eyebrow
  // label color) instead of the generic primary tone. Used by
  // race-week pace chips on dashboard / Today / week-detail so the
  // 5K race-day pace reads as VO2 (red), 10K as threshold (orange),
  // and marathon-pace as steady (amber). Race callers look the bucket
  // up via `RACE_DAY_ZONE_BUCKET[kind]` (race-day-label.ts) so the
  // mapping has one source of truth. Independent of the user's
  // active run-targeting mode — the tone fires whether the prescription
  // string is a pace, an effort label, or an HR-zone range.
  zoneBucket?: 1 | 2 | 3 | 4 | 5;
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
  zoneBucket,
}: RunTargetLineProps) {
  const mode = useRunTargetingMode();
  const maxHr = useMaxHr();
  const restingHr = useRestingHr();
  const hrZoneModel = useHrZoneModel();
  if (!isRunSession({ sessionType, runMin, distanceMi })) return null;
  const { primary, modeLabel, bucket } = formatRunTarget(mode, {
    sessionType,
    week,
    runMin,
    distanceMi,
    pace,
    maxHr,
    restingHr,
    hrZoneModel,
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

  // Task #227: when a zoneBucket override is supplied (race-week pace
  // chip) the wrapper picks up the zone-N border / background / label
  // tone from HR_ZONE_TONES so the prescription's intensity reads at a
  // glance. Otherwise we fall through to the generic primary tone the
  // chip has used since Task #134.
  const tone = zoneBucket != null ? HR_ZONE_TONES[zoneBucket] : null;
  const wrapperClass = tone
    ? cn("rounded-md border px-4 py-3", tone.borderClass, tone.bgClass)
    : cn("rounded-md border border-primary/30 bg-primary/5 px-4 py-3");
  const labelClass = tone
    ? cn("text-[10px] uppercase font-bold tracking-widest", tone.labelClass)
    : "text-[10px] text-primary uppercase font-bold tracking-widest";
  return (
    <div
      className={wrapperClass}
      data-testid={testId}
      data-run-targeting-mode={mode}
      data-zone-bucket={zoneBucket ?? undefined}
    >
      <p className={labelClass}>
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
      {/* Task #234: when the chip is dressed in a zone tone (race-week
          pace chip on Today / week-detail), surface a one-line caption
          decoding the color into the same Z3/Z4/Z5 + threshold/VO2
          vocabulary used elsewhere in the app so the runner learns
          what each tone means. */}
      {tone ? (
        <p
          className={cn(
            "mt-1 text-[10px] uppercase font-bold tracking-wider",
            tone.labelClass,
          )}
          data-testid={testId ? `${testId}-zone-hint` : undefined}
        >
          {tone.description}
        </p>
      ) : null}
    </div>
  );
}
