import { describe, it, expect } from "vitest";
import { computeSafety, enforceSafeClamps } from "./nutrition-safety";

// Pure, DB-free coverage of the science-safe weight-loss guardrails added to
// computeBaselineTargets. These don't touch the DB or the AI, so they run as
// real logic tests (unlike the route tests that need DATABASE_URL).

describe("computeSafety — safe-rate math + safety note", () => {
  it("flags an aggressive goal as unsafe and clamps to the safe rate", () => {
    // Lose 30 lb in 6 weeks at 230 lb → implied 5 lb/wk; safe ~2 lb/wk (capped).
    const s = computeSafety(230, "male", { goalWeightLb: 200, timeframeWeeks: 6 });
    expect(s).not.toBeNull();
    expect(s!.ok).toBe(false);
    expect(s!.impliedRateLbPerWk).toBeCloseTo(5, 1);
    // Safe rate is min(1% of 230 = 2.3, absolute cap 2.0) = 2.0.
    expect(s!.safeRateLbPerWk).toBeCloseTo(2.0, 1);
    expect(s!.projectedDateISO).toBeTruthy();
    expect(s!.message.toLowerCase()).toContain("safe");
  });

  it("affirms a safe goal pace", () => {
    // Lose 10 lb in 12 weeks at 200 lb → ~0.83 lb/wk; safe up to 2 lb/wk.
    const s = computeSafety(200, "male", { goalWeightLb: 190, timeframeWeeks: 12 });
    expect(s).not.toBeNull();
    expect(s!.ok).toBe(true);
    expect(s!.impliedRateLbPerWk).toBeCloseTo(0.8, 1);
  });

  it("affirms + projects a date when a goal has no timeframe", () => {
    const s = computeSafety(220, "male", { goalWeightLb: 200 });
    expect(s).not.toBeNull();
    expect(s!.ok).toBe(true);
    expect(s!.impliedRateLbPerWk).toBeNull();
    expect(s!.projectedDateISO).toBeTruthy();
  });

  it("returns null when there is no loss goal (recomp / maintenance)", () => {
    expect(computeSafety(200, "male", {})).toBeNull();
    // At/below goal → nothing to pace.
    expect(computeSafety(190, "male", { goalWeightLb: 200 })).toBeNull();
  });

  it("respects an explicit desired weekly rate that is unsafe", () => {
    const s = computeSafety(180, "female", {
      goalWeightLb: 150,
      desiredWeeklyRateLb: 4,
    });
    expect(s!.ok).toBe(false);
    expect(s!.impliedRateLbPerWk).toBeCloseTo(4, 1);
    // 1% of 180 = 1.8 < 2.0 cap → safe rate 1.8.
    expect(s!.safeRateLbPerWk).toBeCloseTo(1.8, 1);
  });
});

describe("enforceSafeClamps — calorie floor + protein floor", () => {
  const base = {
    calorieTarget: 1000,
    proteinTargetG: 80,
    carbsTargetG: 80,
    fatTargetG: 30,
    rationale: "",
  };

  it("raises a sub-floor calorie target to the male floor and pads carbs", () => {
    const out = enforceSafeClamps(base, 200, "male", 1.5);
    expect(out.calorieTarget).toBe(1500); // floor
    // 500 extra kcal / 4 → +125 g carbs.
    expect(out.carbsTargetG).toBe(80 + 125);
  });

  it("uses the female floor", () => {
    const out = enforceSafeClamps(base, 160, "female", 1.0);
    expect(out.calorieTarget).toBe(1200);
  });

  it("raises protein to the muscle-sparing floor (~0.8 g/lb)", () => {
    const out = enforceSafeClamps(base, 250, "male", 1.5);
    // 0.8 * 250 = 200 g floor; base 80 < 200.
    expect(out.proteinTargetG).toBe(200);
  });

  it("leaves safe targets unchanged", () => {
    const safe = {
      calorieTarget: 2400,
      proteinTargetG: 200,
      carbsTargetG: 250,
      fatTargetG: 70,
      rationale: "",
    };
    const out = enforceSafeClamps(safe, 230, "male", 1.5);
    expect(out.calorieTarget).toBe(2400);
    expect(out.proteinTargetG).toBe(200);
    expect(out.carbsTargetG).toBe(250);
  });
});
