import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  Activity,
  Beef,
  CalendarDays,
  Dumbbell,
  Home,
  LineChart,
  ListOrdered,
  Scale,
  Settings as SettingsIcon,
  SlidersHorizontal,
  Target,
  Trophy,
} from "lucide-react";
import { useGetPlanOverview } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./theme-toggle";
import { QuickLogFab } from "./quick-log-fab";

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();
  // Task #244: the /plan nav label follows the active planner config's
  // name so the sidebar reads the same label the runner sees on the
  // /plan and /dashboard headers, instead of a hardcoded "Half Marathon
  // Plan" that doesn't match Tonal-first / non-running campaigns.
  const { data: overview } = useGetPlanOverview();
  const planLabel = overview?.activeConfigName?.trim() || "Workout Plan";

  const navItems = [
    { href: "/", label: "Studio", icon: Home },
    { href: "/today", label: "Today", icon: Activity },
    { href: "/goals", label: "Goals", icon: Target },
    { href: "/nutrition", label: "Nutrition", icon: Beef },
    { href: "/plan", label: planLabel, icon: CalendarDays },
    { href: "/log", label: "Training Log", icon: ListOrdered },
    { href: "/measurements", label: "Body Metrics", icon: Scale },
    { href: "/races", label: "Race History", icon: Trophy },
    { href: "/equipment", label: "Equipment", icon: Dumbbell },
    { href: "/planner", label: "Phase Planner", icon: SlidersHorizontal },
    { href: "/settings", label: "Settings", icon: SettingsIcon },
  ];

  return (
    <div className="flex min-h-screen bg-background text-foreground flex-col md:flex-row">
      <aside className="w-full md:w-64 border-r border-border bg-card flex flex-col hidden md:flex shrink-0">
        <div className="p-6 border-b border-sidebar-border">
          <div className="flex items-center gap-2.5">
            <span className="h-6 w-1.5 rounded-sm bg-primary shrink-0" />
            <h1 className="font-extrabold text-2xl tracking-tight text-foreground uppercase leading-none">
              Studio
            </h1>
          </div>
          <p className="text-[10px] text-muted-foreground uppercase font-semibold tracking-[0.28em] mt-2 pl-4">
            Strength studio
          </p>
        </div>
        <nav className="flex-1 py-4 flex flex-col gap-1 px-3">
          {navItems.map((item) => {
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            const Icon = item.icon;
            return (
              <Link 
                key={item.href} 
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-semibold uppercase tracking-wider transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-foreground hover:bg-primary/10 hover:text-primary"
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Mobile nav header */}
      <header className="md:hidden border-b border-border bg-card p-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="h-5 w-1.5 rounded-sm bg-primary shrink-0" />
          <h1 className="font-extrabold text-lg tracking-tight text-foreground uppercase">
            Studio
          </h1>
        </div>
      </header>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 border-t border-border bg-card flex items-center justify-around p-2 z-50">
        {navItems.map((item) => {
          const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href} className="flex flex-col items-center p-2">
              <Icon className={cn("h-5 w-5 mb-1", isActive ? "text-primary" : "text-foreground")} />
              <span className={cn("text-[10px] font-bold uppercase tracking-wider", isActive ? "text-primary" : "text-foreground")}>
                {item.label.split(" ")[0]}
              </span>
            </Link>
          );
        })}
      </nav>

      <main className="flex-1 p-4 md:p-8 overflow-y-auto pb-24 md:pb-8">
        <div className="max-w-6xl mx-auto">
          {children}
        </div>
      </main>

      <QuickLogFab />
    </div>
  );
}
