import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { buildNutritionPlanView } from "@workspace/plan-knowledge";
import { NutritionPlanCard } from "./nutrition-plan-card";

afterEach(cleanup);

describe("buildNutritionPlanView (Phase 15)", () => {
  it("derives a structured plan with per-meal protein that sums to the target", () => {
    // A recomp baseline (the numbers a plan persists + the day-target reads back).
    const view = buildNutritionPlanView({
      calorieTarget: 2400,
      proteinTargetG: 200,
      carbsTargetG: 240,
      fatTargetG: 70,
      goalKind: "recomp",
      bodyweightLb: 200,
    });

    // It does NOT invent its own targets — it reflects the plan's (the trace).
    expect(view.calorieTarget).toBe(2400);
    expect(view.proteinTargetG).toBe(200);

    // Protein is split across 3–4 meals and the per-meal grams sum back to the
    // daily target exactly (no protein lost/created in the scaffold).
    expect(view.mealsPerDay).toBeGreaterThanOrEqual(3);
    expect(view.mealsPerDay).toBeLessThanOrEqual(4);
    const proteinSum = view.meals.reduce((s, m) => s + m.proteinG, 0);
    expect(proteinSum).toBe(200);
    expect(view.proteinPerMealG).toBeGreaterThan(0);

    // Exactly one meal is anchored near the session.
    expect(view.meals.filter((m) => m.anchorNearSession)).toHaveLength(1);

    // Per-lb guidance surfaces when bodyweight is known.
    expect(view.proteinPerLbG).toBeCloseTo(1.0, 1);
    expect(view.guidance).toContain("200 g protein");
  });

  it("flexes carbs with training load while holding calories and protein", () => {
    const view = buildNutritionPlanView({
      calorieTarget: 2400,
      proteinTargetG: 200,
      carbsTargetG: 240,
      fatTargetG: 70,
      goalKind: "fat_loss",
    });
    // Training day carbs are higher than rest day; fat absorbs the swing.
    expect(view.trainingDay.carbsG).toBeGreaterThan(view.restDay.carbsG);
    expect(view.restDay.fatG).toBeGreaterThan(view.trainingDay.fatG);
    // Calories hold roughly steady across both day types (carbs↔fat trade).
    const trainCal = 200 * 4 + view.trainingDay.carbsG * 4 + view.trainingDay.fatG * 9;
    const restCal = 200 * 4 + view.restDay.carbsG * 4 + view.restDay.fatG * 9;
    expect(Math.abs(trainCal - restCal)).toBeLessThanOrEqual(15);
    expect(view.goalLabel).toBe("Fat loss");
  });

  it("authors a viewable plan for a 5k (race) goal's targets", () => {
    const view = buildNutritionPlanView({
      calorieTarget: 2600,
      proteinTargetG: 170,
      carbsTargetG: 320,
      fatTargetG: 75,
      goalKind: "race",
    });
    expect(view.goalLabel).toBe("Race build");
    expect(view.meals.reduce((s, m) => s + m.proteinG, 0)).toBe(170);
    expect(view.carbsPct).toBeGreaterThan(0);
  });
});

describe("<NutritionPlanCard />", () => {
  it("renders the meal scaffold + anchor badge from real targets", () => {
    render(
      <NutritionPlanCard
        calorieTarget={2400}
        proteinTargetG={200}
        carbsTargetG={240}
        fatTargetG={70}
        goalKind="recomp"
      />,
    );
    expect(screen.getByTestId("nutrition-plan-card")).toBeTruthy();
    expect(screen.getByTestId("plan-meal-0")).toBeTruthy();
    // One meal flagged near the session.
    expect(screen.getByText("near session")).toBeTruthy();
    expect(screen.getByText(/g protein is the floor/i)).toBeTruthy();
  });

  it("renders nothing until targets exist (page CTA owns the empty state)", () => {
    const { container } = render(
      <NutritionPlanCard
        calorieTarget={null}
        proteinTargetG={null}
        carbsTargetG={null}
        fatTargetG={null}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});
