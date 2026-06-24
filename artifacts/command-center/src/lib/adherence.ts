export type AdherenceStatus = "met" | "in-progress" | "neutral";

// Per-minute training-load weights. Mirror the server's
// nutrition-engine.computePlannedLoad (STRENGTH 1.5 / RUN 1.0 / CARDIO 0.8) so a
// day's load reads the same client-side as it does in the reactive engine.
// Strength is heaviest (most metabolically taxing per minute), running next,
// low-intensity cardio lightest. Load is what we judge a DAY's adherence on —
// not raw minutes and never a single fragment — because it already weights
// modalities, so swapping 40 min of bike+row for a lift + a run reads as the
// same day's work, not a miss.
export const STRENGTH_LOAD_PER_MIN = 1.5;
export const RUN_LOAD_PER_MIN = 1.0;
export const CARDIO_LOAD_PER_MIN = 0.8;

export type MinuteBuckets = {
  strengthMin?: number | null;
  cardioMin?: number | null;
  runMin?: number | null;
};

/** Weighted training load from a day's minute buckets. */
export function loadFromMinutes(b: MinuteBuckets): number {
  const s = Math.max(0, b.strengthMin ?? 0);
  const c = Math.max(0, b.cardioMin ?? 0);
  const r = Math.max(0, b.runMin ?? 0);
  return s * STRENGTH_LOAD_PER_MIN + r * RUN_LOAD_PER_MIN + c * CARDIO_LOAD_PER_MIN;
}

/**
 * Load for one logged workout or plan day. Prefers the server-computed
 * `totalLoad` (kept consistent across pages); falls back to the weighted
 * minute buckets, then to a flat total/duration proxy for legacy rows that
 * only carry an undifferentiated minute count.
 */
export function entryLoad(
  e: MinuteBuckets & {
    totalLoad?: number | null;
    totalMin?: number | null;
    durationMin?: number | null;
  },
): number {
  if (e.totalLoad != null && e.totalLoad > 0) return e.totalLoad;
  const hasBuckets =
    (e.strengthMin ?? 0) > 0 || (e.cardioMin ?? 0) > 0 || (e.runMin ?? 0) > 0;
  if (hasBuckets) return loadFromMinutes(e);
  return Math.max(0, e.totalMin ?? e.durationMin ?? 0);
}

/** Which modalities a day actually involved (>0 min). */
function modalitySet(b: MinuteBuckets): Set<"strength" | "cardio" | "run"> {
  const set = new Set<"strength" | "cardio" | "run">();
  if ((b.strengthMin ?? 0) > 0) set.add("strength");
  if ((b.cardioMin ?? 0) > 0) set.add("cardio");
  if ((b.runMin ?? 0) > 0) set.add("run");
  return set;
}

/**
 * Substitution = the day's load/volume is essentially met but the runner hit it
 * through a DIFFERENT modality mix than the plan asked for (e.g. plan said
 * 40 min conditioning, they did a lift + a run). That's the work done a
 * different way — not a miss — so the coach should say "you did the work, just
 * your way" rather than grade it short. Requires the day load to be met
 * (ratio ≥ 0.9) AND the planned modality set to differ from what was logged.
 */
export function detectSubstitution(
  planned: MinuteBuckets,
  actual: MinuteBuckets,
  dayLoadRatio: number,
): boolean {
  if (dayLoadRatio < 0.9) return false;
  const p = modalitySet(planned);
  const a = modalitySet(actual);
  if (p.size === 0 || a.size === 0) return false;
  // Differ if the plan asked for a modality the runner skipped, or the runner
  // added one the plan didn't have.
  const plannedMissing = [...p].some((m) => !a.has(m));
  const addedExtra = [...a].some((m) => !p.has(m));
  return plannedMissing || addedExtra;
}

export function adherenceStatus(
  actual: number | null | undefined,
  planned: number | null | undefined,
): AdherenceStatus {
  const a = actual ?? 0;
  const p = planned ?? 0;
  if (p <= 0) return "neutral";
  if (a >= p) return "met";
  if (a > 0) return "in-progress";
  return "neutral";
}

export function adherenceTextClass(status: AdherenceStatus): string {
  switch (status) {
    case "met":
      return "text-success";
    case "in-progress":
      return "text-warning";
    default:
      return "";
  }
}

// Background tint for the adherence progress bar's filled indicator. Mirrors
// adherenceTextClass so the bar reads in the same color family as the
// planned-vs-actual headline above it. Returns empty for "neutral" so the
// default Progress styling applies (and a 0% bar simply has nothing to color).
export function adherenceBarClass(status: AdherenceStatus): string {
  switch (status) {
    case "met":
      return "bg-success dark:bg-success";
    case "in-progress":
      return "bg-warning dark:bg-warning";
    default:
      return "";
  }
}
