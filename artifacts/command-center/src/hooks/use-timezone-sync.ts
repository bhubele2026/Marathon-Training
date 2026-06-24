import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetUserPreferences,
  useUpdateUserPreferences,
  getGetUserPreferencesQueryKey,
} from "@workspace/api-client-react";

// Phase 9 — report the browser's IANA timezone to the server on app load so the
// coach's "today" boundary (nutrition rollover + open-day pace) follows the
// runner's local clock instead of UTC. Detects
// `Intl.DateTimeFormat().resolvedOptions().timeZone`, and PATCHes it onto
// user_preferences when the stored value is unset or differs (e.g. travel /
// new device). One write per change, guarded so we never loop.
export function useTimezoneSync(): void {
  const prefsQuery = useGetUserPreferences();
  const queryClient = useQueryClient();
  const updatePrefs = useUpdateUserPreferences({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getGetUserPreferencesQueryKey(),
        });
      },
    },
  });
  // Guard so an in-flight PATCH (or a transient query refetch) doesn't fire the
  // mutation repeatedly for the same detected zone.
  const sentRef = useRef<string | null>(null);

  useEffect(() => {
    if (!prefsQuery.isSuccess || !prefsQuery.data) return;
    let detected: string | null = null;
    try {
      detected = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
    } catch {
      detected = null;
    }
    if (!detected) return;

    const stored = prefsQuery.data.timezone ?? null;
    if (stored === detected) return;
    if (sentRef.current === detected) return;

    sentRef.current = detected;
    updatePrefs.mutate({ data: { timezone: detected } });
  }, [prefsQuery.isSuccess, prefsQuery.data, updatePrefs]);
}
