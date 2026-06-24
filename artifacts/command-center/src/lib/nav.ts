// Single source of truth for navigation destinations, shared between
// the top bar, the More menu, the mobile bottom bar, and the command
// palette. Sentence case everywhere; no all-caps.
import {
  LayoutDashboard,
  Activity,
  CalendarDays,
  Scale,
  Beef,
  Target,
  ListOrdered,
  History as HistoryIcon,
  Sparkles,
  CalendarCheck,
  Settings as SettingsIcon,
  type LucideIcon,
} from "lucide-react";

export interface NavDestination {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Short label for the cramped mobile bottom bar. */
  short?: string;
}

// The permanent primary destinations. Dashboard is the home/hub and leads
// the bar (it also renders at "/"); then the four daily surfaces.
export const PRIMARY_NAV: NavDestination[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, short: "Home" },
  { href: "/today", label: "Today", icon: Activity, short: "Today" },
  { href: "/plan", label: "Plan", icon: CalendarDays, short: "Plan" },
  { href: "/measurements", label: "Body", icon: Scale, short: "Body" },
  { href: "/nutrition", label: "Nutrition", icon: Beef, short: "Nutrition" },
];

// Everything else lives behind the single "More" menu. Ordered for cohesion:
// review surfaces (this week, training log, goals), then the planner, then
// settings.
export const MORE_NAV: NavDestination[] = [
  { href: "/recap", label: "This week", icon: CalendarCheck },
  { href: "/history", label: "History", icon: HistoryIcon },
  { href: "/log", label: "Training log", icon: ListOrdered },
  { href: "/goals", label: "Goals", icon: Target },
  { href: "/planner", label: "Planner", icon: Sparkles },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

// Flat list of every reachable page for the command palette's nav group.
export const ALL_NAV: NavDestination[] = [...PRIMARY_NAV, ...MORE_NAV];
