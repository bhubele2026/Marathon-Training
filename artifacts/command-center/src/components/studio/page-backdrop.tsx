import { cn } from "@/lib/utils";
import { MOTIFS, BhStudioWordmark, type MotifName } from "./motifs";

// PageBackdrop — the brand layer behind every page. A large BH STUDIO wordmark
// backsplash plus a per-page strength line-art motif, filling blank space so
// surfaces never read empty. Non-interactive, aria-hidden, sits UNDER the
// content (z-0). Draws in `currentColor` (the foreground ink) at a low opacity
// so it adapts to light + dark automatically.
//
// HARD RULE: watermarks live in genuinely empty zones only — anchored to the
// bottom edge and bleeding off-canvas so they never collide with headers,
// buttons, text, or charts (which sit in a `relative z-10` layer above).
//
// Render this ONCE per page inside a `relative overflow-hidden` container
// (PageContainer wires it in; standalone pages render it directly).
export interface PageBackdropProps {
  /** Per-page strength motif (barbell, plate, protein, …). */
  motif?: MotifName;
  /** Landing/hero variant — larger + lower, to fill a tall empty page. */
  hero?: boolean;
  className?: string;
}

export function PageBackdrop({ motif, hero, className }: PageBackdropProps) {
  const Motif = motif ? MOTIFS[motif] : null;
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 z-0 overflow-hidden text-foreground",
        className,
      )}
    >
      {/* Per-page strength motif — large + faint, anchored low-right and bled
          off the edge so it fills blank space without touching content. */}
      {Motif && (
        <Motif
          className={cn(
            "absolute opacity-[0.06] dark:opacity-[0.09]",
            hero
              ? "bottom-[-3%] right-[2%] h-[240px] w-[240px]"
              : "bottom-[7%] right-[-6%] h-[400px] w-[400px]",
          )}
        />
      )}
      {/* BH STUDIO wordmark backsplash — anchored to the bottom edge, bled off
          the left so only the brand reads, never a full boxed logo. */}
      <BhStudioWordmark
        className={cn(
          "absolute opacity-[0.05] dark:opacity-[0.08]",
          hero
            ? "-bottom-6 left-0 w-[min(1180px,94%)]"
            : "-bottom-4 left-1 w-[min(860px,88%)]",
        )}
      />
    </div>
  );
}
