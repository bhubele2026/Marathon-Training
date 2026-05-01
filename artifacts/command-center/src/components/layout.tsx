import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { 
  Activity, 
  CalendarDays, 
  Dumbbell, 
  Home, 
  LineChart, 
  ListOrdered,
  Scale
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./theme-toggle";

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();

  const navItems = [
    { href: "/", label: "Command Center", icon: Home },
    { href: "/today", label: "Today's Mission", icon: Activity },
    { href: "/plan", label: "Half Marathon Plan", icon: CalendarDays },
    { href: "/log", label: "Training Log", icon: ListOrdered },
    { href: "/measurements", label: "Body Metrics", icon: Scale },
    { href: "/equipment", label: "Equipment", icon: Dumbbell },
  ];

  return (
    <div className="flex min-h-screen bg-background text-foreground flex-col md:flex-row">
      <aside className="w-full md:w-64 border-r border-border bg-card flex flex-col hidden md:flex shrink-0">
        <div className="p-6 border-b border-border flex items-center justify-between">
          <div>
            <h1 className="font-bold text-xl tracking-tight text-primary uppercase">Marathon</h1>
            <p className="text-xs text-muted-foreground uppercase font-medium tracking-widest">Command Center</p>
          </div>
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
        <div>
          <h1 className="font-bold text-lg tracking-tight text-primary uppercase">Marathon</h1>
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
    </div>
  );
}
