// Phase 15. The VIEWABLE personalized nutrition plan tile. Promotes the four
// persisted daily targets (which trace to the active plan's goal + a safe deficit)
// into structured guidance: macro split, how to spread protein across the day,
// how carbs/fat flex with training load, and a simple meal scaffold. Pure
// presentation over `buildNutritionPlanView` — no fetching, no math here.

import { UtensilsCrossed, Sparkles } from "lucide-react";
import { buildNutritionPlanView, type GoalKind } from "@workspace/plan-knowledge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CoachNote } from "@/components/studio";

export interface NutritionPlanCardProps {
  calorieTarget: number | null;
  proteinTargetG: number | null;
  carbsTargetG: number | null;
  fatTargetG: number | null;
  goalKind?: GoalKind | null;
  bodyweightLb?: number | null;
}

const MACRO_DOT: Record<string, string> = {
  protein: "bg-[hsl(var(--chart-2))]",
  carbs: "bg-[hsl(var(--chart-3))]",
  fat: "bg-[hsl(var(--chart-4))]",
};

export function NutritionPlanCard(props: NutritionPlanCardProps) {
  const {
    calorieTarget,
    proteinTargetG,
    carbsTargetG,
    fatTargetG,
    goalKind,
    bodyweightLb,
  } = props;

  // Need real targets to show a plan; otherwise the page's "calculate targets"
  // CTA already covers the empty state, so render nothing.
  if (
    calorieTarget == null ||
    calorieTarget <= 0 ||
    proteinTargetG == null ||
    proteinTargetG <= 0
  ) {
    return null;
  }

  const plan = buildNutritionPlanView({
    calorieTarget,
    proteinTargetG,
    carbsTargetG: carbsTargetG ?? 0,
    fatTargetG: fatTargetG ?? 0,
    goalKind: goalKind ?? null,
    bodyweightLb: bodyweightLb ?? null,
  });

  return (
    <Card data-testid="nutrition-plan-card">
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <div className="min-w-0">
          <CardTitle className="font-display text-lg tracking-tight">
            Your nutrition plan
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {goalKind ? `${plan.goalLabel} · ` : ""}
            from your plan targets · {plan.mealsPerDay} meals
          </p>
        </div>
        <UtensilsCrossed className="size-5 shrink-0 text-muted-foreground" />
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Macro summary */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <PlanStat label="Calories" value={`${plan.calorieTarget}`} unit="kcal" />
          <PlanStat
            label="Protein"
            value={`${plan.proteinTargetG}`}
            unit={`g · ${plan.proteinPct}%`}
            dot="protein"
          />
          <PlanStat
            label="Carbs"
            value={`${plan.carbsTargetG}`}
            unit={`g · ${plan.carbsPct}%`}
            dot="carbs"
          />
          <PlanStat
            label="Fat"
            value={`${plan.fatTargetG}`}
            unit={`g · ${plan.fatPct}%`}
            dot="fat"
          />
        </div>

        {/* Protein distribution / meal scaffold */}
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            Protein across the day · ~{plan.proteinPerMealG} g a meal
            {plan.proteinPerLbG ? ` (${plan.proteinPerLbG} g/lb)` : ""}
          </p>
          <ul className="space-y-1.5">
            {plan.meals.map((m, i) => (
              <li
                key={i}
                data-testid={`plan-meal-${i}`}
                className="flex items-center justify-between gap-3 rounded-xl bg-secondary/60 px-3 py-2"
              >
                <span className="flex min-w-0 items-center gap-2 text-sm">
                  <span className="truncate font-medium">{m.name}</span>
                  {m.anchorNearSession && (
                    <Badge variant="azure" data-testid={`plan-meal-anchor-${i}`}>
                      near session
                    </Badge>
                  )}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {m.proteinG}p · {m.carbsG}c · {m.fatG}f
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* Training vs rest day carb/fat flex */}
        <div className="grid grid-cols-2 gap-3">
          <DayFlex
            label="Training day"
            carbs={plan.trainingDay.carbsG}
            fat={plan.trainingDay.fatG}
            tone="azure"
          />
          <DayFlex
            label="Rest day"
            carbs={plan.restDay.carbsG}
            fat={plan.restDay.fatG}
            tone="neutral"
          />
        </div>

        <CoachNote icon={Sparkles} tone="accent">
          {plan.guidance}
        </CoachNote>
      </CardContent>
    </Card>
  );
}

function PlanStat({
  label,
  value,
  unit,
  dot,
}: {
  label: string;
  value: string;
  unit: string;
  dot?: keyof typeof MACRO_DOT;
}) {
  return (
    <div className="rounded-xl bg-secondary/40 p-3">
      <div className="flex items-center gap-1.5">
        {dot && <span className={`size-2 rounded-full ${MACRO_DOT[dot]}`} />}
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {label}
        </span>
      </div>
      <div className="mt-1 font-display text-xl font-bold tabular-nums tracking-tight">
        {value}
      </div>
      <div className="text-xs text-muted-foreground">{unit}</div>
    </div>
  );
}

function DayFlex({
  label,
  carbs,
  fat,
  tone,
}: {
  label: string;
  carbs: number;
  fat: number;
  tone: "azure" | "neutral";
}) {
  return (
    <div className="rounded-xl border border-card-border p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        <Badge variant={tone}>{carbs}g carbs</Badge>
      </div>
      <p className="mt-1 text-xs tabular-nums text-muted-foreground">
        {carbs} g carbs · {fat} g fat · protein holds
      </p>
    </div>
  );
}
