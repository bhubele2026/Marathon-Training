import {
  useGetUserPreferences,
  type UserPreferencesRunTargetingMode,
} from "@workspace/api-client-react";

// Tiny convenience hook that returns the active run targeting mode (Task
// #134). Falls back to "effort" while the prefs query is loading or
// errored so the run target line on Today / Week Detail always renders
// something meaningful.
export function useRunTargetingMode(): UserPreferencesRunTargetingMode {
  const { data } = useGetUserPreferences();
  return data?.runTargetingMode ?? "effort";
}

// Companion hook (Task #141) returning the user's configured max heart
// rate, or null when unset / still loading. Drives the personalized
// BPM range suffix the HR Zone targeting mode renders next to each
// "Zone N" label. Returning null is the explicit "fall back to the
// generic label" signal — formatRunTarget handles it.
export function useMaxHr(): number | null {
  const { data } = useGetUserPreferences();
  return data?.maxHr ?? null;
}
