import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import type {
  NutritionistReport,
  NutritionInsight,
  InsightStatus,
} from "@/components/insights/types";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionHeader } from "@/components/studio/section-header";
import { StatReadout } from "@/components/studio/stat-readout";
import { CoachNote } from "@/components/studio/coach-note";
import {
  Clock,
  Stethoscope,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  Info,
  ChevronDown,
} from "lucide-react";

// The AI Nutritionist surface. One component, two variants:
//   - variant="today": a compact daily verdict (headline + status chip + the
//     coach's one-liner) with a link into the full read.
//   - variant="full":  the deep-dive on the Nutrition page — one card per
//     structured insight (target-vs-actual + a one-line caption, the longer
//     reasoning behind a "why"), plus the key moves.
//
// Hand-fetched like the rest of the nutrition slice (not in openapi.yaml). The
// response shape is the shared @workspace/db NutritionistReport — the engine
// owns every NUMBER, the AI owns only the caption/detail words.
//
// NOTE: this is the Phase-A structural adaptation to the insight model; the
// fully visual-first rebuild (charts via the insight kit) lands in Phase C.

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export function nutritionistQueryKey(weeks: number): [string, number] {
  return ["/api/nutritionist/analysis", weeks];
}

// Semantic status tone. ahead/on_track/appropriate = good; under/over = a health
// flag; attention/early = caution.
function statusTone(s: InsightStatus): { cls: string; Icon: typeof CheckCircle2 } {
  switch (s) {
    case "ahead":
    case "on_track":
    case "appropriate":
      return { cls: "text-primary border-primary/30 bg-primary/10", Icon: CheckCircle2 };
    case "under":
    case "over":
      return { cls: "text-destructive border-destructive/30 bg-destructive/10", Icon: AlertTriangle };
    default:
      return { cls: "text-[hsl(var(--warning))] border-[hsl(var(--warning))]/30 bg-[hsl(var(--warning))]/10", Icon: Info };
  }
}

function Chip({ status, label }: { status: InsightStatus; label?: string }) {
  const { cls, Icon } = statusTone(status);
  return (
    <span
      className={
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider " +
        cls
      }
    >
      <Icon className="h-3 w-3" />
      {label ?? status.replace(/_/g, " ")}
    </span>
  );
}

function fmtActualTarget(ins: NutritionInsight): string | null {
  if (ins.actual == null) return null;
  const a = Math.round(ins.actual);
  const t = ins.target != null ? ` / ${Math.round(ins.target)}` : "";
  return `${a}${t} ${ins.unit}`;
}

export function NutritionistPanel({
  variant = "full",
  weeks = 8,
}: {
  variant?: "today" | "full";
  weeks?: number;
}) {
  const { data, isLoading } = useQuery({
    queryKey: nutritionistQueryKey(weeks),
    queryFn: () => getJson<NutritionistReport>(`/api/nutritionist/analysis?weeks=${weeks}`),
    // Shortish so the read refreshes as the day's food logs in (the server
    // re-runs the analysis only when the inputs actually changed, so refetching
    // is cheap when nothing's new). Also refetch when the tab regains focus.
    staleTime: 45_000,
    refetchOnWindowFocus: true,
  });

  if (isLoading) {
    return (
      <Card data-testid={`card-nutritionist-${variant}-loading`}>
        <CardContent className="p-6">
          <Skeleton className={variant === "today" ? "h-14 w-full" : "h-48 w-full"} />
        </CardContent>
      </Card>
    );
  }
  if (!data) return null;

  const insights = data.insights ?? [];
  const protein = insights.find((i) => i.id === "protein");

  // --- Compact daily verdict (Today page) ---------------------------------
  if (variant === "today") {
    return (
      <Card
        variant="flush"
        className="border-l-2 border-l-primary bg-[hsl(var(--accent)/0.05)]"
        data-testid="card-nutritionist-today"
      >
        <CardContent className="p-5 space-y-2">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex min-w-0 items-center gap-2">
              <Stethoscope className="h-5 w-5 shrink-0 text-primary" />
              <span className="font-display text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Nutritionist
              </span>
              {protein && <Chip status={protein.status} label={`Protein ${protein.status.replace(/_/g, " ")}`} />}
            </div>
            <Link
              href="/nutrition"
              className="inline-flex shrink-0 items-center gap-1 rounded-md text-xs font-semibold tracking-wide text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              data-testid="link-nutritionist-full"
            >
              Full analysis <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <p className="text-sm font-medium text-foreground">{data.headline}</p>
          {data.today ? (
            <p className="min-w-0 text-sm leading-relaxed text-muted-foreground">{data.today}</p>
          ) : (
            data.narrative && (
              <p className="min-w-0 text-sm leading-relaxed text-muted-foreground">{data.narrative}</p>
            )
          )}
        </CardContent>
      </Card>
    );
  }

  // --- Full deep-dive (Nutrition page) ------------------------------------
  return (
    <Card
      variant="flush"
      className="border-l-2 border-l-primary bg-[hsl(var(--accent)/0.04)] dark:bg-[hsl(var(--accent)/0.07)]"
      data-testid="card-nutritionist-full"
    >
      <CardContent className="space-y-6 p-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Stethoscope className="h-5 w-5 text-primary" />
            <span className="font-display text-base font-semibold tracking-tight text-foreground">
              AI Nutritionist
            </span>
          </div>
          <span className="font-display text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            last {data.weeksElapsed || data.weeks} wk · confidence {data.confidence}
          </span>
        </div>

        {/* Headline in the coach's voice. */}
        <CoachNote icon={Stethoscope}>{data.headline}</CoachNote>

        {/* TODAY (in progress) — pace coaching, shown only while the day is open. */}
        {data.today && (
          <section className="space-y-2" data-testid="section-nutritionist-today">
            <SectionHeader eyebrow="Today so far" />
            <CoachNote icon={Clock}>{data.today}</CoachNote>
          </section>
        )}

        {/* INSIGHTS — one block per structured read. */}
        {insights.map((ins) => (
          <InsightBlock key={ins.id} insight={ins} />
        ))}

        {/* DO THIS NEXT */}
        {data.keyMoves.length > 0 && (
          <section className="space-y-2" data-testid="section-nutritionist-moves">
            <SectionHeader eyebrow="Do this next" />
            <ul className="space-y-1.5">
              {data.keyMoves.map((m, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-foreground">
                  <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-primary" />
                  <span className="min-w-0 leading-relaxed">{m}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {data.dataGaps.length > 0 && (
          <p className="min-w-0 border-t border-border pt-3 text-[13px] leading-relaxed text-muted-foreground/80">
            <span className="font-semibold">Sharpen this read: </span>
            {data.dataGaps.join(" · ")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function InsightBlock({ insight: ins }: { insight: NutritionInsight }) {
  const [open, setOpen] = useState(false);
  const at = fmtActualTarget(ins);
  return (
    <section className="space-y-2" data-testid={`section-nutritionist-${ins.id}`}>
      <SectionHeader eyebrow={ins.label} action={<Chip status={ins.status} />} />

      {/* Body-comp shows the four stat tiles; everything else shows actual/target. */}
      {ins.id === "bodycomp" && ins.bodyStats ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4">
          {ins.bodyStats.map((s) => {
            const good =
              s.change == null || s.change === 0 || s.goodDirection === "either"
                ? "neutral"
                : (s.goodDirection === "down" ? s.change < 0 : s.change > 0)
                  ? "success"
                  : "neutral";
            return (
              <StatReadout
                key={s.key}
                label={s.label}
                value={s.value != null ? s.value : "—"}
                unit={s.value != null ? s.unit : undefined}
                delta={
                  s.change != null && s.change !== 0
                    ? { value: `${s.change > 0 ? "+" : ""}${s.change}`, tone: good as "success" | "neutral" }
                    : undefined
                }
              />
            );
          })}
        </div>
      ) : (
        at && (
          <span className="tabular-nums text-[13px] text-muted-foreground">
            {at} avg
            {ins.daysHit != null && ins.daysLogged ? ` · on target ${ins.daysHit}/${ins.daysLogged} days` : ""}
          </span>
        )
      )}

      <p className="min-w-0 text-sm font-medium leading-relaxed text-foreground">{ins.caption}</p>

      {ins.detail && (
        <div>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-1 text-[12px] font-semibold uppercase tracking-wider text-primary hover:underline"
            data-testid={`button-why-${ins.id}`}
            aria-expanded={open}
          >
            Why <ChevronDown className={"h-3 w-3 transition-transform " + (open ? "rotate-180" : "")} />
          </button>
          {open && (
            <p className="mt-1 min-w-0 text-sm leading-relaxed text-muted-foreground">{ins.detail}</p>
          )}
        </div>
      )}
    </section>
  );
}
