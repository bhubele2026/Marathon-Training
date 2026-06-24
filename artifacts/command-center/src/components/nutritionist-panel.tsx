import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
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
} from "lucide-react";

// The AI Nutritionist surface. One component, two variants:
//   - variant="today": a compact daily verdict (headline + protein chip + the
//     coach's one-liner) with a link into the full read.
//   - variant="full":  the deep-dive on the Nutrition page (protein verdict,
//     body-comp diagnosis, fuelling, hydration, sodium, key moves).
//
// Hand-fetched like the rest of the nutrition slice (not in openapi.yaml).
// Reads GET /api/nutritionist/analysis, which is server-cached by inputHash so
// both variants hit the same cheap cached row until the metrics actually move.

type ProteinStatus = "too_little" | "on_point" | "too_much";
type DeficitStatus = "under_floor" | "aggressive" | "appropriate" | "surplus" | "unknown";

export type NutritionistReport = {
  weeks: number;
  weeksElapsed: number;
  headline: string;
  protein: {
    status: ProteinStatus;
    avgProteinG: number | null;
    targetProteinG: number | null;
    gPerLb: number | null;
    hitRate: number | null;
    detail: string;
    distributionTip: string;
  };
  bodyComp: {
    currentWeightLb: number | null;
    bodyFatPct: number | null;
    leanMassLb: number | null;
    fatMassLb: number | null;
    leanMassChangeLb: number | null;
    fatMassChangeLb: number | null;
    weightChangeLb: number | null;
    inchesChange: number | null;
    trend: string;
    whatYouShouldSee: string;
    whyYouMayNotBe: string;
  };
  deficit: {
    status: DeficitStatus;
    avgCalories: number | null;
    calorieTarget: number | null;
    safeFloorKcal: number;
    detail: string;
  };
  today: string;
  hydration: string;
  sodium: string;
  keyMoves: string[];
  confidence: "low" | "medium" | "high";
  dataGaps: string[];
  narrative: string;
  generatedAt?: string;
  cached?: boolean;
};

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export function nutritionistQueryKey(weeks: number): [string, number] {
  return ["/api/nutritionist/analysis", weeks];
}

const PROTEIN_LABEL: Record<ProteinStatus, string> = {
  too_little: "Protein low",
  on_point: "Protein on point",
  too_much: "Protein high",
};

// Semantic status tone. on-track/good = accent; health flags (too little /
// under floor) = a caution tint; everything else neutral.
function statusTone(s: ProteinStatus | DeficitStatus): {
  cls: string;
  Icon: typeof CheckCircle2;
} {
  switch (s) {
    case "on_point":
    case "appropriate":
      return { cls: "text-primary border-primary/30 bg-primary/10", Icon: CheckCircle2 };
    case "too_little":
    case "under_floor":
    case "aggressive":
      return { cls: "text-destructive border-destructive/30 bg-destructive/10", Icon: AlertTriangle };
    default:
      return { cls: "text-muted-foreground border-border bg-muted/50", Icon: Info };
  }
}

function Chip({ status }: { status: ProteinStatus | DeficitStatus }) {
  const { cls, Icon } = statusTone(status);
  const label =
    status in PROTEIN_LABEL
      ? PROTEIN_LABEL[status as ProteinStatus]
      : status.replace(/_/g, " ");
  return (
    <span
      className={
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider " +
        cls
      }
    >
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

// A delta string + tone for a body-comp stat. `goodDown` = moving down is the
// win (weight / fat mass on a cut); for lean mass, up is the win.
function deltaFor(
  change: number | null,
  goodDown: boolean,
): { value: string; tone: "success" | "neutral" | "destructive" } | undefined {
  if (change == null || change === 0) return undefined;
  const good = goodDown ? change < 0 : change > 0;
  const sign = change > 0 ? "+" : "";
  return { value: `${sign}${change}`, tone: good ? "success" : "neutral" };
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
              <Chip status={data.protein.status} />
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
          {/* Mid-day pace coaching takes priority when the day's open. */}
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
  const bc = data.bodyComp;
  const hasLeanFat = bc.leanMassLb != null && bc.fatMassLb != null;
  const p = data.protein;
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

        {/* PROTEIN */}
        <section className="space-y-2" data-testid="section-nutritionist-protein">
          <SectionHeader eyebrow="Protein" action={<Chip status={p.status} />} />
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            {p.gPerLb != null && (
              <span className="tabular-nums text-lg font-semibold tabular-nums text-foreground">
                {p.gPerLb}
                <span className="ml-1 text-[13px] font-medium text-muted-foreground">g/lb</span>
              </span>
            )}
            {p.avgProteinG != null && p.targetProteinG != null && (
              <span className="tabular-nums text-[13px] tabular-nums text-muted-foreground">
                {Math.round(p.avgProteinG)} / {p.targetProteinG} g avg
                {p.hitRate != null ? ` · hit ${Math.round(p.hitRate * 100)}% of days` : ""}
              </span>
            )}
          </div>
          <p className="min-w-0 text-sm leading-relaxed text-muted-foreground">{p.detail}</p>
          <p className="min-w-0 text-[13px] italic leading-relaxed text-muted-foreground/80">
            {p.distributionTip}
          </p>
        </section>

        {/* BODY COMPOSITION */}
        <section className="space-y-3" data-testid="section-nutritionist-bodycomp">
          <SectionHeader eyebrow="Body composition" />
          <div className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4">
            <StatReadout
              label="Weight"
              value={bc.currentWeightLb != null ? bc.currentWeightLb : "—"}
              unit={bc.currentWeightLb != null ? "lb" : undefined}
              delta={deltaFor(bc.weightChangeLb, true)}
            />
            {bc.bodyFatPct != null ? (
              <StatReadout label="Body fat" value={bc.bodyFatPct} unit="%" />
            ) : (
              <div className="flex flex-col gap-1">
                <span className="font-display text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  Body fat
                </span>
                <Link
                  href="/measurements"
                  className="text-[13px] font-medium text-primary hover:underline"
                >
                  Log to track →
                </Link>
              </div>
            )}
            <StatReadout
              label="Lean mass"
              value={hasLeanFat ? (bc.leanMassLb as number) : "—"}
              unit={hasLeanFat ? "lb" : undefined}
              delta={deltaFor(bc.leanMassChangeLb, false)}
            />
            <StatReadout
              label="Fat mass"
              value={hasLeanFat ? (bc.fatMassLb as number) : "—"}
              unit={hasLeanFat ? "lb" : undefined}
              delta={deltaFor(bc.fatMassChangeLb, true)}
            />
          </div>
          <Read label="Where you are" text={bc.trend} />
          <Read label="What you should see" text={bc.whatYouShouldSee} />
          <Read label="Why you may not be" text={bc.whyYouMayNotBe} emphasis />
        </section>

        {/* FUELLING */}
        <section className="space-y-2" data-testid="section-nutritionist-deficit">
          <SectionHeader
            eyebrow="Fuelling"
            action={
              data.deficit.status !== "unknown" ? <Chip status={data.deficit.status} /> : undefined
            }
          />
          {data.deficit.avgCalories != null && (
            <span className="tabular-nums text-[13px] tabular-nums text-muted-foreground">
              {Math.round(data.deficit.avgCalories)}
              {data.deficit.calorieTarget != null ? ` / ${data.deficit.calorieTarget}` : ""} kcal avg
            </span>
          )}
          <p className="min-w-0 text-sm leading-relaxed text-muted-foreground">{data.deficit.detail}</p>
        </section>

        {/* HYDRATION */}
        {data.hydration && (
          <section className="space-y-2" data-testid="section-nutritionist-hydration">
            <SectionHeader eyebrow="Hydration" />
            <p className="min-w-0 text-sm leading-relaxed text-muted-foreground">{data.hydration}</p>
          </section>
        )}

        {/* SODIUM */}
        {data.sodium && (
          <section className="space-y-2" data-testid="section-nutritionist-sodium">
            <SectionHeader eyebrow="Sodium" />
            <p className="min-w-0 text-sm leading-relaxed text-muted-foreground">{data.sodium}</p>
          </section>
        )}

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

function Read({ label, text, emphasis }: { label: string; text: string; emphasis?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-display text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </span>
      <p
        className={
          "min-w-0 text-sm leading-relaxed " +
          (emphasis ? "font-medium text-foreground" : "text-muted-foreground")
        }
      >
        {text}
      </p>
    </div>
  );
}
