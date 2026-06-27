import { ReactNode, useCallback, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { nutritionistQueryKey } from "@/components/nutritionist-panel";
import { motion, AnimatePresence } from "framer-motion";
import { MoreHorizontal, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ThemeToggle } from "./theme-toggle";
import {
  CommandPalette,
  useCommandPaletteHotkey,
} from "./command-palette";
import { CoachDock } from "./coach-dock";
import { PRIMARY_NAV, MORE_NAV } from "@/lib/nav";

interface LayoutProps {
  children: ReactNode;
}

function isActivePath(location: string, href: string): boolean {
  if (href === "/") return location === "/";
  return location === href || location.startsWith(href + "/");
}

function Wordmark() {
  return (
    <Link
      href="/"
      className="flex items-baseline gap-1 shrink-0 select-none rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
      aria-label="BH Studio home"
    >
      <span className="font-display text-xl font-extrabold uppercase italic tracking-tight text-primary leading-none">
        BH
      </span>
      <span className="font-display text-xl font-extrabold uppercase italic tracking-tight text-sidebar-foreground leading-none">
        Studio
      </span>
    </Link>
  );
}

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [moreSheetOpen, setMoreSheetOpen] = useState(false);
  const queryClient = useQueryClient();

  const togglePalette = useCallback(() => setPaletteOpen((v) => !v), []);
  useCommandPaletteHotkey(togglePalette);

  // Hover/focus prefetch: warm a route's slow primary query before the click so
  // the page renders from cache. Only the AI Nutritionist read (Today +
  // Nutrition) is slow enough to matter — everything else returns in <500ms.
  // prefetchQuery respects staleTime, so repeated hovers don't spam the server.
  const prefetchRoute = useCallback(
    (href: string) => {
      if (href === "/nutrition" || href === "/today") {
        queryClient.prefetchQuery({
          queryKey: nutritionistQueryKey(8),
          queryFn: () =>
            fetch("/api/nutritionist/analysis?weeks=8", {
              headers: { accept: "application/json" },
            }).then((r) => {
              if (!r.ok) throw new Error(`HTTP ${r.status}`);
              return r.json();
            }),
        });
      }
    },
    [queryClient],
  );

  const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.platform);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Bright top bar: white chrome on the faint cool canvas, cool ink, one
          azure accent — a light header that matches the tiled content. Uses
          the semantic `sidebar` tokens, so flipping to dark mode (theme
          toggle) gives the dark-bar option for free. */}
      <header className="sticky top-0 z-40 border-b border-sidebar-border bg-sidebar text-sidebar-foreground">
        <div className="mx-auto max-w-[1600px] px-4 md:px-6 h-14 flex items-center gap-7">
          <Wordmark />

          {/* Primary nav — exactly four destinations (desktop). */}
          <nav className="hidden md:flex items-center gap-1">
            {PRIMARY_NAV.map((item) => {
              const active = isActivePath(location, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onMouseEnter={() => prefetchRoute(item.href)}
                  onFocus={() => prefetchRoute(item.href)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-sm font-medium tracking-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar",
                    active
                      ? "bg-secondary text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary/60",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}

            {/* Single More menu holds every other page. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="rounded-full px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors inline-flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
                  data-testid="nav-more"
                >
                  More
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-52">
                {MORE_NAV.map((item) => {
                  const Icon = item.icon;
                  return (
                    <DropdownMenuItem key={item.href} asChild>
                      <Link
                        href={item.href}
                        className="flex items-center gap-2 cursor-pointer"
                      >
                        <Icon className="h-4 w-4" />
                        {item.label}
                      </Link>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </nav>

          {/* Right cluster: primary quick action, command-palette
              trigger, theme toggle. */}
          <div className="ml-auto flex items-center gap-2">
            <Button
              asChild
              size="sm"
              className="h-8 gap-1.5 font-semibold gradient-primary shadow-sm hover:brightness-110"
              data-testid="button-log"
            >
              <Link href="/log">
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">Log</span>
              </Link>
            </Button>
            <button
              onClick={togglePalette}
              data-testid="button-command-palette"
              aria-label="Open command palette"
              className="hidden sm:inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
            >
              <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] font-medium leading-none text-muted-foreground">
                {isMac ? "⌘" : "Ctrl"} K
              </kbd>
            </button>
            <div className="text-muted-foreground">
              <ThemeToggle />
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 px-4 md:px-6 py-4 md:py-6 pb-24 md:pb-8">
        <div className="mx-auto max-w-[1600px]">
          {/* Always-on, dismissible coach presence — sits above the page and
              reacts to the current screen. Outside the route transition so it
              persists across navigation. */}
          <CoachDock />
          {/* Restrained route-change transition: gentle fade + slide. */}
          <AnimatePresence mode="wait">
            <motion.div
              key={location}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      {/* Mobile bottom tab bar: same primary set + a More entry. Matches the
          bright chrome of the top bar via the semantic sidebar tokens. */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-sidebar-border bg-sidebar text-sidebar-foreground flex items-stretch justify-around">
        {PRIMARY_NAV.map((item) => {
          const active = isActivePath(location, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className="flex flex-col items-center justify-center gap-0.5 py-2 flex-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
            >
              <Icon
                className={cn(
                  "h-5 w-5",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              />
              <span
                className={cn(
                  "text-[10px]",
                  active ? "text-primary font-medium" : "text-muted-foreground",
                )}
              >
                {item.short ?? item.label}
              </span>
            </Link>
          );
        })}

        <Sheet open={moreSheetOpen} onOpenChange={setMoreSheetOpen}>
          <SheetTrigger asChild>
            <button
              className="flex flex-col items-center justify-center gap-0.5 py-2 flex-1 text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
              data-testid="nav-more-mobile"
            >
              <MoreHorizontal className="h-5 w-5" />
              <span className="text-[10px]">More</span>
            </button>
          </SheetTrigger>
          <SheetContent side="bottom" className="rounded-t-xl">
            <SheetHeader>
              <SheetTitle className="text-left text-base font-medium">
                More
              </SheetTitle>
            </SheetHeader>
            <div className="grid grid-cols-2 gap-2 mt-4 pb-2">
              {MORE_NAV.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMoreSheetOpen(false)}
                    className="flex items-center gap-2 rounded-md border border-border px-3 py-3 text-sm hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </SheetContent>
        </Sheet>
      </nav>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
