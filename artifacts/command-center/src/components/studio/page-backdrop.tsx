import { cn } from "@/lib/utils";
import { type MotifName } from "./motifs";

// PageBackdrop — the ambient layer behind every page.
//
// Cockpit rebuild: the old BH-STUDIO wordmark backsplash + strength line-art
// motifs (the "strength studio" identity) are gone. The cockpit look is a clean
// near-black canvas with a single, very faint neon top-glow so surfaces read as
// an instrument panel rather than a decorated page. Non-interactive,
// aria-hidden, sits UNDER the content (z-0).
//
// The `motif` / `hero` props are retained (many pages pass them) but the motif
// is intentionally not drawn anymore — only `hero` slightly strengthens the
// glow for tall landing pages.
export interface PageBackdropProps {
  /** Retained for API compatibility; no longer rendered in the cockpit look. */
  motif?: MotifName;
  /** Landing/hero variant — a touch more glow to fill a tall empty page. */
  hero?: boolean;
  className?: string;
}

export function PageBackdrop({ hero, className }: PageBackdropProps) {
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 z-0 overflow-hidden", className)}
    >
      {/* Faint neon signal glow from the top — the only decoration. */}
      <div
        className={cn(
          "absolute left-1/2 -translate-x-1/2 rounded-full blur-3xl",
          hero
            ? "top-[-18%] h-[420px] w-[820px] opacity-[0.10]"
            : "top-[-24%] h-[300px] w-[680px] opacity-[0.07]",
        )}
        style={{
          background:
            "radial-gradient(closest-side, hsl(var(--primary)), transparent)",
        }}
      />
    </div>
  );
}
