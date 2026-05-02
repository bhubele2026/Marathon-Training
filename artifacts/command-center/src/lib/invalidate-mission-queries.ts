import type { QueryClient } from "@tanstack/react-query";
import {
  getGetDashboardSummaryQueryKey,
  getGetTodayPlanQueryKey,
  getListWorkoutsQueryKey,
  getGetWeeklyMileageQueryKey,
  getGetEquipmentUsageQueryKey,
  getGetLongRunProgressionQueryKey,
  getGetRecentActivityQueryKey,
  getGetPlanOverviewQueryKey,
  getGetPlannerConfigQueryKey,
} from "@workspace/api-client-react";

export function invalidateMissionRelatedQueries(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
  queryClient.invalidateQueries({ queryKey: getGetTodayPlanQueryKey() });
  queryClient.invalidateQueries({ queryKey: getListWorkoutsQueryKey() });
  queryClient.invalidateQueries({ queryKey: getGetWeeklyMileageQueryKey() });
  queryClient.invalidateQueries({ queryKey: getGetEquipmentUsageQueryKey() });
  queryClient.invalidateQueries({ queryKey: getGetLongRunProgressionQueryKey() });
  queryClient.invalidateQueries({ queryKey: getGetRecentActivityQueryKey() });
  queryClient.invalidateQueries({ queryKey: getGetPlanOverviewQueryKey() });
  // Planner config (Task #80) drives /plan/full-reset and is the source of
  // truth for the Phase Planner page; invalidate so a Reset/Apply elsewhere
  // refreshes the page header and timeline math.
  queryClient.invalidateQueries({ queryKey: getGetPlannerConfigQueryKey() });
  // Catches both `/api/plan/weeks` (list) and `/api/plan/weeks/{n}` (detail)
  // generated query keys so plan edits / swaps / resets always refresh the
  // week summary cards and the week detail screen together.
  queryClient.invalidateQueries({
    predicate: (query) =>
      typeof query.queryKey[0] === "string" &&
      (query.queryKey[0] as string).startsWith("/api/plan/weeks"),
  });
}
