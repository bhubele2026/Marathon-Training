import { type ReactNode, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ChevronRight, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  type InsightStatus,
  type PillTone,
  statusToPillTone,
  pillToneColor,
  defaultPillLabel,
  tonedSurface,
} from "./types";

// The scorecard tile shell (mockup `.tile`): a --card surface with the standard
// border + shadow, a header (name + status pill), the viz slot, one caption
// line, and a "Why ›" disclosure that opens the depth-on-demand drawer (the
// 8-week trend chart + the longer reasoning). Token-driven → flips light/dark.

export interface PillSpec {
  tone: PillTone;
  label: string;
  glyph?: string;
}

export function StatusPill({ tone, label, glyph }: PillSpec) {
  const color = pillToneColor(tone);
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-[0.04em]"
      style={{ color, background: tonedSurface(tone, 12), borderColor: tonedSurface(tone, 28) }}
    >
      {glyph && <span aria-hidden="true">{glyph}</span>}
      {label}
    </span>
  );
}

export interface InsightTileProps {
  name: string;
  status: InsightStatus;
  /** Override the pill (e.g. sodium "high" amber, consistency "3 days" info). */
  pill?: PillSpec;
  caption: string;
  /** The viz (gauge/bar/droplet/dial/hero). */
  children: ReactNode;
  /** Depth-on-demand content: the 8-week chart + the long `detail` prose. */
  drawer?: ReactNode;
  whyLabel?: string;
  className?: string;
}

export function InsightTile({
  name,
  status,
  pill,
  caption,
  children,
  drawer,
  whyLabel = "Why",
  className,
}: InsightTileProps) {
  const [open, setOpen] = useState(false);
  const reduced = useReducedMotion();
  const tone = pill?.tone ?? statusToPillTone(status);
  const pillSpec: PillSpec = pill ?? { tone, ...defaultPillLabel(status) };
  // A small, tasteful win state when a read lands in a good place: a soft
  // success-tinted border + a sparkle by the name (calm fade, instant under
  // reduced motion). Suppressed when the pill is overridden to a non-status tone.
  const winning = !pill && (status === "ahead" || status === "on_track");
  return (
    <section
      className={cn(
        "rounded-2xl border bg-card p-4 shadow-card transition-transform duration-150 hover:-translate-y-0.5",
        winning ? "border-[hsl(var(--success))]/35" : "border-card-border",
        className,
      )}
      data-testid={`tile-${name.toLowerCase().replace(/[^a-z]+/g, "-")}`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 font-display text-[15px] font-bold tracking-tight text-foreground">
          {name}
          {winning && (
            <motion.span
              initial={reduced ? { opacity: 1 } : { opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={reduced ? { duration: 0 } : { duration: 0.4, ease: "easeOut" }}
              aria-hidden="true"
              data-testid="tile-win"
            >
              <Sparkles className="h-3.5 w-3.5 text-[hsl(var(--success))]" />
            </motion.span>
          )}
        </h3>
        <StatusPill {...pillSpec} />
      </div>

      <div>{children}</div>

      <p className="mt-2.5 text-[12.5px] leading-snug text-foreground/85">{caption}</p>

      {drawer && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-0.5 rounded text-[11.5px] font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            aria-expanded={open}
            data-testid="tile-why"
          >
            {whyLabel} <ChevronRight className={cn("h-3 w-3 transition-transform", open && "rotate-90")} />
          </button>
          {open && <div className="mt-3 border-t border-card-border pt-3">{drawer}</div>}
        </div>
      )}
    </section>
  );
}
