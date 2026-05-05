import type { QueryClient } from "@tanstack/react-query";
import {
  getGetDashboardSummaryQueryKey,
  getGetTodayPlanQueryKey,
  getListWorkoutsQueryKey,
  getGetWeeklyMileageQueryKey,
  getGetEquipmentUsageQueryKey,
  getGetLongRunProgressionQueryKey,
  getGetRecentActivityQueryKey,
  getGetRecentLifestyleActivitiesQueryKey,
  getGetPlanOverviewQueryKey,
  getListPlannerConfigsQueryKey,
} from "@workspace/api-client-react";

export function invalidateMissionRelatedQueries(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
  queryClient.invalidateQueries({ queryKey: getGetTodayPlanQueryKey() });
  queryClient.invalidateQueries({ queryKey: getListWorkoutsQueryKey() });
  queryClient.invalidateQueries({ queryKey: getGetWeeklyMileageQueryKey() });
  queryClient.invalidateQueries({ queryKey: getGetEquipmentUsageQueryKey() });
  queryClient.invalidateQueries({ queryKey: getGetLongRunProgressionQueryKey() });
  queryClient.invalidateQueries({ queryKey: getGetRecentActivityQueryKey() });
  queryClient.invalidateQueries({ queryKey: getGetRecentLifestyleActivitiesQueryKey() });
  queryClient.invalidateQueries({ queryKey: getGetPlanOverviewQueryKey() });
  // Planner configs (Task #80, multi-config since Task #82) drive
  // /plan/full-reset and are the source of truth for the Phase Planner
  // page; invalidate so a Reset/Apply elsewhere refreshes the dropdown
  // (which row is active, lastAppliedAt, etc).
  queryClient.invalidateQueries({ queryKey: getListPlannerConfigsQueryKey() });
  // Per-config detail caches are keyed by id, so invalidate by URL
  // prefix to catch every saved config the runner has open.
  queryClient.invalidateQueries({
    predicate: (query) =>
      typeof query.queryKey[0] === "string" &&
      (query.queryKey[0] as string).startsWith("/api/planner/configs/"),
  });
  // Catches both `/api/plan/weeks` (list) and `/api/plan/weeks/{n}` (detail)
  // generated query keys so plan edits / swaps / resets always refresh the
  // week summary cards and the week detail screen together.
  queryClient.invalidateQueries({
    predicate: (query) =>
      typeof query.queryKey[0] === "string" &&
      (query.queryKey[0] as string).startsWith("/api/plan/weeks"),
  });
}
