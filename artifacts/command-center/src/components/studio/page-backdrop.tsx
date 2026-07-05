import { cn } from "@/lib/utils";
import { MOTIFS, BhStudioWordmark, type MotifName } from "./motifs";

// PageBackdrop — the brand layer behind every page. A large, very faint BH
// STUDIO wordmark backsplash plus a per-page strength line-art motif, filling
// blank space so surfaces never read empty. Non-interactive, aria-hidden, sits
// under the content (z-0). Draws in `currentColor` (the foreground ink) at a
// whisper of opacity so it adapts to light + dark automatically.
//
// Render this ONCE per page inside a `relative` container (PageContainer wires
// it in); page content sits above it with `relative z-10`.
export interface PageBackdropProps {
  /** Per-page strength motif (barbell, plate, protein, …). */
  motif?: MotifName;
  className?: string;
}

export function PageBackdrop({ motif, className }: PageBackdropProps) {
  const Motif = motif ? MOTIFS[motif] : null;
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 z-0 overflow-hidden text-foreground",
        className,
      )}
    >
      {/* Per-page strength motif — large, faint, low on the right so it fills
          blank space without colliding with header controls. */}
      {Motif && (
        <Motif className="absolute bottom-[8%] right-[-6%] h-[380px] w-[380px] opacity-[0.035] dark:opacity-[0.055]" />
      )}
      {/* BH STUDIO wordmark backsplash — anchored bottom-left, barely there. */}
      <BhStudioWordmark className="absolute -bottom-4 left-1 w-[min(820px,86%)] opacity-[0.03] dark:opacity-[0.045]" />
    </div>
  );
}
