import { Suspense } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";
import { VisualThemeProvider } from "@/lib/visual-theme";
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
const Goals = lazyWithReload(() => import("@/pages/goals"));
const Recap = lazyWithReload(() => import("@/pages/recap"));
const Equipment = lazyWithReload(() => import("@/pages/equipment"));
const Planner = lazyWithReload(() => import("@/pages/planner"));
const PlanBuilder = lazyWithReload(() => import("@/pages/plan-builder"));
const Settings = lazyWithReload(() => import("@/pages/settings"));
const NotFound = lazyWithReload(() => import("@/pages/not-found"));

// Task #382: cache-friendly React Query defaults. Pre-task #382 every
// query refetched on every mount / window-focus, which made cross-page
// navigation flash skeletons even when the cached payload was < 1s old.
// 30s staleTime covers the typical "navigate dashboard → /plan → back"
// loop; mutations explicitly invalidate so writes still propagate
// immediately. 5min gcTime keeps payloads warm across longer detours.
// refetchOnWindowFocus disabled because Replit's preview iframe loses
// focus on every chat interaction. retry: 1 caps retry storms when the
// API server is briefly unavailable.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
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
