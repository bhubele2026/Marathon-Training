// The coach's daily line on Today — a sardonic British tough-love reaction to
// what you logged. Quiet + de-boxed (a hairline + an accent rule), persona voice
// from GET /api/coach/daily/:date. Renders nothing until there's a note.

import { useQuery } from "@tanstack/react-query";
import { MessageSquare } from "lucide-react";

type CoachDaily = { date: string; note: string | null };

export function CoachLine({ date }: { date: string }) {
  const { data } = useQuery({
    queryKey: ["/api/coach/daily", date],
    queryFn: async (): Promise<CoachDaily> => {
      const r = await fetch(`/api/coach/daily/${date}`, {
        headers: { accept: "application/json" },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<CoachDaily>;
    },
    // The note is AI-generated; don't hammer it.
    staleTime: 60_000,
  });

  const note = data?.note;
  if (!note) return null;

  return (
    <div
      className="flex items-start gap-3 border-l-2 border-primary pl-3 py-1"
      data-testid="coach-daily-line"
    >
      <MessageSquare className="h-4 w-4 text-primary mt-1 shrink-0" />
      <p className="text-[15px] leading-relaxed text-foreground">{note}</p>
    </div>
  );
}
