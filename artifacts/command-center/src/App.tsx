import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";

import Dashboard from "@/pages/dashboard";
import Today from "@/pages/today";
import Plan from "@/pages/plan";
import WeekDetail from "@/pages/week-detail";
import Log from "@/pages/log";
import Measurements from "@/pages/measurements";
import Equipment from "@/pages/equipment";
import Planner from "@/pages/planner";
import Settings from "@/pages/settings";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/today" component={Today} />
        <Route path="/plan" component={Plan} />
        <Route path="/plan/:week" component={WeekDetail} />
        <Route path="/log" component={Log} />
        <Route path="/measurements" component={Measurements} />
        <Route path="/equipment" component={Equipment} />
        <Route path="/planner" component={Planner} />
        <Route path="/settings" component={Settings} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
