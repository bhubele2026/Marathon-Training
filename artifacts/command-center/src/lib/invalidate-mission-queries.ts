import type { QueryClient } from "@tanstack/react-query";
import {
  getGetDashboardSummaryQueryKey,
  getGetTodayPlanQueryKey,
  getListWorkoutsQueryKey,
  getGetWeeklyMileageQueryKey,
  getGetEquipmentUsageQueryKey,
  getGetLongRunProgressionQueryKey,
  getGetRecentActivityQueryKey,
  getListPlanWeeksQueryKey,
} from "@workspace/api-client-react";

export function invalidateMissionRelatedQueries(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
  queryClient.invalidateQueries({ queryKey: getGetTodayPlanQueryKey() });
  queryClient.invalidateQueries({ queryKey: getListWorkoutsQueryKey() });
  queryClient.invalidateQueries({ queryKey: getGetWeeklyMileageQueryKey() });
  queryClient.invalidateQueries({ queryKey: getGetEquipmentUsageQueryKey() });
  queryClient.invalidateQueries({ queryKey: getGetLongRunProgressionQueryKey() });
  queryClient.invalidateQueries({ queryKey: getGetRecentActivityQueryKey() });
  queryClient.invalidateQueries({ queryKey: getListPlanWeeksQueryKey() });
  queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] === "/api/plan/weeks" });
}
