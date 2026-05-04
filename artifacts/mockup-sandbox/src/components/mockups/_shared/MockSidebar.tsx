import {
  Activity,
  CalendarDays,
  Dumbbell,
  Home,
  ListOrdered,
  Scale,
  Settings as SettingsIcon,
  SlidersHorizontal,
} from "lucide-react";

interface MockSidebarProps {
  activePath: string;
}

const NAV: Array<{ href: string; label: string; icon: typeof Home }> = [
  { href: "/", label: "Command Center", icon: Home },
  { href: "/today", label: "Today's Mission", icon: Activity },
  { href: "/plan", label: "Half Marathon Plan", icon: CalendarDays },
  { href: "/log", label: "Training Log", icon: ListOrdered },
  { href: "/measurements", label: "Body Metrics", icon: Scale },
  { href: "/equipment", label: "Equipment", icon: Dumbbell },
  { href: "/planner", label: "Phase Planner", icon: SlidersHorizontal },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

export function MockSidebar({ activePath }: MockSidebarProps) {
  return (
    <aside className="w-56 shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground flex flex-col">
      <div className="p-4 border-b border-sidebar-border flex items-center gap-3">
        <div className="h-9 w-9 rounded bg-sidebar-primary text-sidebar-primary-foreground flex items-center justify-center font-black text-base shrink-0">
          H2
        </div>
        <div className="min-w-0">
          <div className="font-bold text-sm tracking-tight uppercase leading-none text-sidebar-primary">
            Marathon
          </div>
          <div
            className="text-[9px] uppercase font-medium tracking-[0.2em] mt-1"
            style={{ opacity: 0.65 }}
          >
            Command Center
          </div>
        </div>
      </div>
      <nav className="flex-1 py-2 px-2 flex flex-col gap-0.5">
        {NAV.map((item) => {
          const Icon = item.icon;
          const isActive =
            activePath === item.href ||
            (item.href !== "/" && activePath.startsWith(item.href));
          return (
            <div
              key={item.href}
              className={
                "flex items-center gap-2.5 px-2.5 py-1.5 rounded text-[11px] font-bold uppercase tracking-wider transition-colors " +
                (isActive
                  ? "bg-sidebar-primary text-sidebar-primary-foreground"
                  : "hover:bg-sidebar-accent")
              }
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{item.label}</span>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
