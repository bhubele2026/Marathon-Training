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
