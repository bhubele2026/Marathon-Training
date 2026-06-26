import { type ReactNode, useState } from "react";
import { ChevronRight } from "lucide-react";
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
  const tone = pill?.tone ?? statusToPillTone(status);
  const pillSpec: PillSpec = pill ?? { tone, ...defaultPillLabel(status) };
  return (
    <section
      className={cn(
        "rounded-2xl border border-card-border bg-card p-4 shadow-card transition-transform duration-150 hover:-translate-y-0.5",
        className,
      )}
      data-testid={`tile-${name.toLowerCase().replace(/[^a-z]+/g, "-")}`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="font-display text-[15px] font-bold tracking-tight text-foreground">{name}</h3>
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
