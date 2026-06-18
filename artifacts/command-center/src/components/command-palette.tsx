import { useEffect } from "react";
import { useLocation } from "wouter";
import {
  Activity,
  Scale,
  Sparkles,
  PlusCircle,
} from "lucide-react";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { ALL_NAV } from "@/lib/nav";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Cmd/Ctrl-K command palette (Phase 2). Built on shadcn's `command`
// primitive (cmdk). Fuzzy-navigates to every page plus a handful of
// quick actions. Quick actions navigate to the relevant route for now.
export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const [, navigate] = useLocation();

  const go = (href: string) => {
    onOpenChange(false);
    navigate(href);
  };

  // Quick actions. Each routes the runner to the surface that owns the
  // action so the palette stays functional without a fabricated modal.
  const quickActions = [
    { label: "Log workout", icon: PlusCircle, href: "/log" },
    { label: "Log measurement", icon: Scale, href: "/measurements" },
    { label: "New plan", icon: Sparkles, href: "/planner" },
    { label: "Ask AI to adjust today", icon: Activity, href: "/planner" },
  ];

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search pages and actions..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Quick actions">
          {quickActions.map((action) => {
            const Icon = action.icon;
            return (
              <CommandItem
                key={action.label}
                value={`action ${action.label}`}
                onSelect={() => go(action.href)}
              >
                <Icon className="h-4 w-4" />
                <span>{action.label}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>
        <CommandGroup heading="Go to">
          {ALL_NAV.map((item) => {
            const Icon = item.icon;
            return (
              <CommandItem
                key={item.href}
                value={`page ${item.label} ${item.href}`}
                onSelect={() => go(item.href)}
              >
                <Icon className="h-4 w-4" />
                <span>{item.label}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

// Global Cmd/Ctrl-K keydown that toggles the palette. Lives in a hook
// so the layout can own the open state.
export function useCommandPaletteHotkey(toggle: () => void) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        toggle();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [toggle]);
}
