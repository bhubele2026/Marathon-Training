import type { QueryClient } from "@tanstack/react-query";
import {
  getGetDashboardSummaryQueryKey,
  getGetDashboardBootstrapQueryKey,
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
  // Task #383: the dashboard cold-paint reads from a single
  // `/api/dashboard/bootstrap` query that fans out all 8 tile slices
  // server-side. Mutations must invalidate it alongside the per-tile
  // keys or Crushed It / skip / log-workout flows leave the dashboard
  // stale until natural refetch.
  queryClient.invalidateQueries({ queryKey: getGetDashboardBootstrapQueryKey() });
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
  // R6: the reactive per-day nutrition target (["/api/nutrition/day", date])
  // is driven by the day's training. Logging / editing / skipping / deleting
  // a workout changes the day's load, so the AI-adjusted "Eat today" calories
  // + rationale must recompute. Invalidate by key prefix so every dated
  // day-target query (the Today block + the Nutrition page's selected day)
  // refetches without the mutation sites needing to plumb the date through.
  queryClient.invalidateQueries({
    predicate: (query) => query.queryKey[0] === "/api/nutrition/day",
  });
}
