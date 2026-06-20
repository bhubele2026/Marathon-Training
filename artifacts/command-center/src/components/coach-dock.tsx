import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useLocation } from "wouter";
import { MessageSquareText, X } from "lucide-react";

// The always-on coach presence (Phase 1): a slim, on-brand, dismissible strip
// that sits above page content in the shell and reacts to the CURRENT screen +
// today's data. Non-blocking and fail-safe — it renders nothing while loading,
// when the server returns no line (AI unconfigured / empty day), or once
// dismissed for the day. The line itself is generated server-side in the shared
// coach voice (GET /api/coach/line?context=…), hand-fetched like the rest of the
// coach slice.

function contextForPath(loc: string): string {
  if (loc === "/") return "dashboard";
  if (loc.startsWith("/today")) return "today";
  if (loc.startsWith("/nutrition")) return "nutrition";
  if (loc.startsWith("/measurements")) return "body";
  if (loc.startsWith("/plan")) return "plan";
  return "general";
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

// Dismissal persists for the rest of the day so "always there" never becomes
// nagging; it comes back tomorrow. Wrapped so a locked-down localStorage can
// never throw and break the shell.
function readDismissed(): boolean {
  try {
    return localStorage.getItem("coachDockDismissed") === todayKey();
  } catch {
    return false;
  }
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export function CoachDock() {
  const [location] = useLocation();
  const context = contextForPath(location);
  const [dismissed, setDismissed] = useState(readDismissed);

  const { data } = useQuery({
    queryKey: ["/api/coach/line", context],
    queryFn: () =>
      getJson<{ context: string; line: string | null }>(
        `/api/coach/line?context=${context}`,
      ),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const line = data?.line ?? null;
  if (dismissed || !line) return null;

  const dismiss = () => {
    try {
      localStorage.setItem("coachDockDismissed", todayKey());
    } catch {
      /* ignore */
    }
    setDismissed(true);
  };

  return (
    <div
      className="mb-6 flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-2.5"
      data-testid="coach-dock"
      data-coach-context={context}
    >
      <MessageSquareText className="h-4 w-4 text-primary mt-0.5 shrink-0" />
      <p className="flex-1 text-sm leading-snug text-foreground">{line}</p>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss coach"
        className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
        data-testid="coach-dock-dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
