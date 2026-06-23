import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Beef,
  Flame,
  Activity,
  Droplet,
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
//     body-comp diagnosis, fuelling, key moves, confidence + data gaps).
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
  hydration: string;
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

// Health-flag statuses get a warm/amber treatment; good ones get the primary
// accent; neutral ones stay muted.
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
      return { cls: "text-amber-500 border-amber-500/30 bg-amber-500/10", Icon: AlertTriangle };
    default:
      return { cls: "text-muted-foreground border-border bg-muted/40", Icon: Info };
  }
}

function fmtSigned(n: number | null, unit: string): string {
  if (n == null) return "—";
  const s = n > 0 ? `+${n}` : `${n}`;
  return `${s}${unit}`;
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
    staleTime: 5 * 60_000,
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
        className="border-primary/20 bg-primary/5 border-l-4 border-l-primary"
        data-testid="card-nutritionist-today"
      >
        <CardContent className="p-5 space-y-2">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Stethoscope className="h-5 w-5 text-primary" />
              <p className="text-sm font-bold tracking-wider text-primary">Nutritionist</p>
              <Chip status={data.protein.status} />
            </div>
            <Link
              href="/nutrition"
              className="inline-flex items-center gap-1 text-xs font-bold tracking-wider text-primary hover:underline"
              data-testid="link-nutritionist-full"
            >
              Full analysis <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <p className="text-sm text-foreground font-medium">{data.headline}</p>
          {data.narrative && (
            <p className="text-sm text-muted-foreground">{data.narrative}</p>
          )}
        </CardContent>
      </Card>
    );
  }

  // --- Full deep-dive (Nutrition page) ------------------------------------
  const bc = data.bodyComp;
  const hasLeanFat = bc.leanMassLb != null && bc.fatMassLb != null;
  return (
    <Card
      className="border-primary/20 bg-primary/5 border-l-4 border-l-primary"
      data-testid="card-nutritionist-full"
    >
      <CardContent className="p-6 space-y-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Stethoscope className="h-5 w-5 text-primary" />
            <p className="text-sm font-bold tracking-wider text-primary">AI Nutritionist</p>
          </div>
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
            last {data.weeksElapsed || data.weeks} wk · confidence {data.confidence}
          </span>
        </div>

        <p className="text-lg font-extrabold leading-snug text-foreground">{data.headline}</p>

        {/* PROTEIN */}
        <section className="space-y-2" data-testid="section-nutritionist-protein">
          <div className="flex items-center gap-2 flex-wrap">
            <Beef className="h-4 w-4 text-primary" />
            <span className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
              Protein
            </span>
            <Chip status={data.protein.status} />
            {data.protein.gPerLb != null && (
              <span className="text-xs font-bold tabular-nums text-foreground">
                {data.protein.gPerLb} g/lb
              </span>
            )}
            {data.protein.avgProteinG != null && data.protein.targetProteinG != null && (
              <span className="text-xs text-muted-foreground tabular-nums">
                {Math.round(data.protein.avgProteinG)} / {data.protein.targetProteinG} g avg
                {data.protein.hitRate != null
                  ? ` · hit ${Math.round(data.protein.hitRate * 100)}% of days`
                  : ""}
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground">{data.protein.detail}</p>
          <p className="text-xs text-muted-foreground/80 italic">{data.protein.distributionTip}</p>
        </section>

        {/* BODY COMPOSITION */}
        <section className="space-y-2" data-testid="section-nutritionist-bodycomp">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            <span className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
              Body composition
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3">
            <Stat label="Weight" value={bc.currentWeightLb != null ? `${bc.currentWeightLb} lb` : "—"} sub={fmtSigned(bc.weightChangeLb, " lb")} />
            <Stat label="Body fat" value={bc.bodyFatPct != null ? `${bc.bodyFatPct}%` : "—"} />
            <Stat
              label="Lean mass"
              value={hasLeanFat ? `${bc.leanMassLb} lb` : "—"}
              sub={fmtSigned(bc.leanMassChangeLb, " lb")}
            />
            <Stat
              label="Fat mass"
              value={hasLeanFat ? `${bc.fatMassLb} lb` : "—"}
              sub={fmtSigned(bc.fatMassChangeLb, " lb")}
            />
          </div>
          <Read label="Where you are" text={bc.trend} />
          <Read label="What you should see" text={bc.whatYouShouldSee} />
          <Read label="Why you may not be" text={bc.whyYouMayNotBe} emphasis />
        </section>

        {/* FUELLING */}
        <section className="space-y-2" data-testid="section-nutritionist-deficit">
          <div className="flex items-center gap-2 flex-wrap">
            <Flame className="h-4 w-4 text-primary" />
            <span className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
              Fuelling
            </span>
            <Chip status={data.deficit.status} />
            {data.deficit.avgCalories != null && (
              <span className="text-xs text-muted-foreground tabular-nums">
                {Math.round(data.deficit.avgCalories)}
                {data.deficit.calorieTarget != null ? ` / ${data.deficit.calorieTarget}` : ""} kcal avg
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground">{data.deficit.detail}</p>
        </section>

        {/* HYDRATION */}
        {data.hydration && (
          <section className="space-y-2" data-testid="section-nutritionist-hydration">
            <div className="flex items-center gap-2">
              <Droplet className="h-4 w-4 text-primary" />
              <span className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
                Hydration
              </span>
            </div>
            <p className="text-sm text-muted-foreground">{data.hydration}</p>
          </section>
        )}

        {/* KEY MOVES */}
        {data.keyMoves.length > 0 && (
          <section className="space-y-1.5" data-testid="section-nutritionist-moves">
            <span className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
              Do this next
            </span>
            <ul className="space-y-1">
              {data.keyMoves.map((m, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-foreground">
                  <ArrowRight className="h-3.5 w-3.5 text-primary mt-1 shrink-0" />
                  <span>{m}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {data.dataGaps.length > 0 && (
          <p className="text-xs text-muted-foreground/80 border-t border-border pt-3">
            <span className="font-bold">Sharpen this read: </span>
            {data.dataGaps.join(" · ")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="text-lg font-extrabold tabular-nums leading-none text-foreground">{value}</span>
      {sub && sub !== "—" && (
        <span className="text-[11px] tabular-nums text-muted-foreground">{sub}</span>
      )}
    </div>
  );
}

function Read({ label, text, emphasis }: { label: string; text: string; emphasis?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <p className={"text-sm " + (emphasis ? "text-foreground font-medium" : "text-muted-foreground")}>
        {text}
      </p>
    </div>
  );
}
