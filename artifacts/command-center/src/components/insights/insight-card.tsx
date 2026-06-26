import { type ReactNode, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ChevronDown, CheckCircle2, AlertTriangle, Info, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  type NutritionInsight,
  type InsightStatus,
  statusTone,
} from "@/components/insights/types";

// InsightCard — the visual-first / words-a-tap-away container for one insight:
//   header (label + status pill) → the visual (children) → the one-line caption
//   → a "Why" disclosure holding the longer reasoning.
// The visual is passed as children so the same card frames a BulletMetric, a
// TrendVsGoal, a RecompTrajectory, etc.

export interface InsightCardProps {
  insight: NutritionInsight;
  children?: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}

const STATUS_META: Record<
  InsightStatus,
  { label: string; Icon: typeof CheckCircle2 }
> = {
  ahead: { label: "ahead", Icon: CheckCircle2 },
  on_track: { label: "on track", Icon: CheckCircle2 },
  appropriate: { label: "on point", Icon: CheckCircle2 },
  attention: { label: "watch", Icon: Info },
  early: { label: "early", Icon: Info },
  under: { label: "under", Icon: AlertTriangle },
  over: { label: "over", Icon: AlertTriangle },
};

const TONE_CLS: Record<ReturnType<typeof statusTone>, string> = {
  success: "text-[hsl(var(--success))] border-[hsl(var(--success))]/30 bg-[hsl(var(--success))]/10",
  warning: "text-[hsl(var(--warning))] border-[hsl(var(--warning))]/30 bg-[hsl(var(--warning))]/10",
  destructive: "text-[hsl(var(--destructive))] border-[hsl(var(--destructive))]/30 bg-[hsl(var(--destructive))]/10",
};

export function StatusPill({ status, className }: { status: InsightStatus; className?: string }) {
  const meta = STATUS_META[status];
  const { Icon } = meta;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider",
        TONE_CLS[statusTone(status)],
        className,
      )}
    >
      <Icon className="h-3 w-3" />
      {meta.label}
    </span>
  );
}

export function InsightCard({ insight, children, defaultOpen = false, className }: InsightCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  const reduced = useReducedMotion();
  // A small, tasteful celebratory state when a read is in a good place: a soft
  // success-tinted border + a sparkle by the pill, with a calm one-time fade-in
  // (instant under reduced motion). No bouncing, no noise.
  const winning = insight.status === "ahead" || insight.status === "on_track";
  return (
    <section
      className={cn(
        "rounded-2xl border bg-card p-5 space-y-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)]",
        winning ? "border-[hsl(var(--success))]/35" : "border-border",
        className,
      )}
      data-testid={`insight-card-${insight.id}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 font-display text-sm font-semibold tracking-tight text-foreground">
          {insight.label}
          {winning && (
            <motion.span
              initial={reduced ? { opacity: 1 } : { opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={reduced ? { duration: 0 } : { duration: 0.4, ease: "easeOut" }}
              aria-hidden="true"
              data-testid={`insight-win-${insight.id}`}
            >
              <Sparkles className="h-3.5 w-3.5 text-[hsl(var(--success))]" />
            </motion.span>
          )}
        </span>
        <StatusPill status={insight.status} />
      </div>

      {children && <div>{children}</div>}

      <p className="min-w-0 text-sm font-medium leading-relaxed text-foreground">{insight.caption}</p>

      {insight.detail && (
        <div>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-1 rounded text-[12px] font-semibold uppercase tracking-wider text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            data-testid={`insight-why-${insight.id}`}
            aria-expanded={open}
          >
            Why <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
          </button>
          {open && (
            <p className="mt-1.5 min-w-0 text-sm leading-relaxed text-muted-foreground">{insight.detail}</p>
          )}
        </div>
      )}
    </section>
  );
}
