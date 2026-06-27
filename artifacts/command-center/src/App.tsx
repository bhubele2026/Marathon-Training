import { Suspense } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";
import { VisualThemeProvider } from "@/lib/visual-theme";
import { useTimezoneSync } from "@/hooks/use-timezone-sync";
import { Skeleton } from "@/components/ui/skeleton";
import { lazyWithReload } from "@/lib/lazy-with-reload";
import { RouteErrorBoundary } from "@/components/route-error-boundary";

// Task #382: route-level code splitting. Each page becomes its own
// async chunk so the initial entry bundle only carries the layout +
// router shell. Heavyweight per-page dependencies (notably recharts on
// dashboard / measurements, and the plan generator + zod recipes on
// planner) load on demand when the runner navigates there.
const Dashboard = lazyWithReload(() => import("@/pages/dashboard"));
const Today = lazyWithReload(() => import("@/pages/today"));
const Plan = lazyWithReload(() => import("@/pages/plan"));
const WeekDetail = lazyWithReload(() => import("@/pages/week-detail"));
const Log = lazyWithReload(() => import("@/pages/log"));
const Measurements = lazyWithReload(() => import("@/pages/measurements"));
const Nutrition = lazyWithReload(() => import("@/pages/nutrition"));
const History = lazyWithReload(() => import("@/pages/history"));
const Insights = lazyWithReload(() => import("@/pages/insights"));
const Goals = lazyWithReload(() => import("@/pages/goals"));
const Recap = lazyWithReload(() => import("@/pages/recap"));
const Equipment = lazyWithReload(() => import("@/pages/equipment"));
const Planner = lazyWithReload(() => import("@/pages/planner"));
const PlanBuilder = lazyWithReload(() => import("@/pages/plan-builder"));
const Settings = lazyWithReload(() => import("@/pages/settings"));
const NotFound = lazyWithReload(() => import("@/pages/not-found"));

// Task #382: cache-friendly React Query defaults. Pre-task #382 every
// query refetched on every mount / window-focus, which made cross-page
// Caching is the navigation-speed lever: revisiting a page should read cache
// instantly and only revalidate when genuinely stale, not refetch on every mount.
//   - staleTime 5min: shared/rarely-changing data (preferences, goals, recent
//     nutrition, the AI analysis) is reused across navigations rather than
//     refetched per page. Crucially this is LONGER than the slow
//     /nutritionist/analysis generation, which previously went stale before it
//     returned and re-triggered itself 5–6× per load — now one fetch is reused.
//   - gcTime 30min: keeps payloads warm across longer detours so back-nav is
//     instant even after a while away.
//   - refetchOnWindowFocus false: Replit's preview iframe loses focus on every
//     chat interaction (and focus refetch isn't worth the churn here).
//   - refetchOnMount left at the default (revalidate ONLY if stale): cached
//     data renders immediately, a background refetch runs only when stale — and
//     mutation invalidations still take effect on the next mount (which an
//     explicit `false` would suppress).
//   - retry 1 caps retry storms when the API server is briefly unavailable.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60_000,
      gcTime: 30 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
    mutations: {
      retry: 0,
    },
  },
});

function RouteFallback() {
  return (
    <div className="space-y-4 p-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

function Router() {
  // Phase 9: report the browser timezone to the server once on load so the
  // coach's "today" boundary follows the runner's local clock, not UTC.
  useTimezoneSync();
  return (
    <Layout>
      <RouteErrorBoundary>
        <Suspense fallback={<RouteFallback />}>
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/today" component={Today} />
          <Route path="/plan" component={Plan} />
          <Route path="/plan/:week" component={WeekDetail} />
          <Route path="/log" component={Log} />
          <Route path="/measurements" component={Measurements} />
          <Route path="/nutrition" component={Nutrition} />
          <Route path="/history" component={History} />
          <Route path="/insights" component={Insights} />
          <Route path="/goals" component={Goals} />
          <Route path="/recap" component={Recap} />
          <Route path="/equipment" component={Equipment} />
          {/* Chat-first plan builder is the primary planner; the legacy
              template/blocks editor stays available at /planner/manual. */}
          <Route path="/planner" component={PlanBuilder} />
          <Route path="/planner/manual" component={Planner} />
          <Route path="/settings" component={Settings} />
          <Route component={NotFound} />
        </Switch>
        </Suspense>
      </RouteErrorBoundary>
    </Layout>
  );
}

function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
      <QueryClientProvider client={queryClient}>
        {/* VisualThemeProvider lives inside the QueryClientProvider so
            it can hydrate from the server-side user-preferences row
            (Task #196). The provider still falls back to localStorage
            synchronously on first render, so there's no flash of the
            default arctic palette while the query resolves. */}
        <VisualThemeProvider>
          <TooltipProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <Router />
            </WouterRouter>
            <Toaster />
          </TooltipProvider>
        </VisualThemeProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
