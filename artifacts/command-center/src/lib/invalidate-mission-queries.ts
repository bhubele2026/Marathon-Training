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
  // Catches both `/api/plan/weeks` (list) and `/api/plan/weeks/{n}` (detail)
  // generated query keys so plan edits / swaps / resets always refresh the
  // week summary cards and the week detail screen together.
  queryClient.invalidateQueries({
    predicate: (query) =>
      typeof query.queryKey[0] === "string" &&
      (query.queryKey[0] as string).startsWith("/api/plan/weeks"),
  });
}
