import { describe, it, expect } from "vitest";
import {
  computePlannedLoad,
  computeFallbackAdjustment,
  clampAdjustment,
  balanceFatG,
  proteinBumpForLoad,
  MAX_CAL_DELTA,
  MAX_CARB_DELTA,
  MAX_PROTEIN_BUMP,
  type BaselineMacros,
} from "./nutrition-engine";

const BASE: BaselineMacros = { cal: 2400, protein: 220, carbs: 230, fat: 70 };

describe("computePlannedLoad", () => {
  it("returns 0 for a rest day", () => {
    expect(
      computePlannedLoad({ isRest: true, strengthMin: 45, runMin: 30 }),
    ).toBe(0);
  });

  it("returns 0 for an empty/all-null day", () => {
    expect(computePlannedLoad({})).toBe(0);
  });

  it("weights strength heaviest, then run, then cardio", () => {
    const strength = computePlannedLoad({ strengthMin: 60 });
    const run = computePlannedLoad({ runMin: 60 });
    const cardio = computePlannedLoad({ cardioMin: 60 });
    expect(strength).toBeGreaterThan(run);
    expect(run).toBeGreaterThan(cardio);
  });

  it("sums buckets", () => {
    // 45 strength * 1.5 + 25 cardio * 0.8 = 67.5 + 20 = 87.5
    expect(
      computePlannedLoad({ strengthMin: 45, cardioMin: 25, runMin: 0 }),
    ).toBe(87.5);
  });
});

describe("computeFallbackAdjustment", () => {
  it("rest day lowers calories and carbs, protein steady", () => {
    const rest = computeFallbackAdjustment(BASE, 0, { source: "planned" });
    expect(rest.delta.cal).toBeLessThan(0);
    expect(rest.delta.carbs).toBeLessThan(0);
    expect(rest.delta.protein).toBe(0);
    expect(rest.adjusted.protein).toBe(BASE.protein);
    expect(rest.rationale).toMatch(/rest|maintenance/i);
  });

  it("skipped session lowers calories with a skip rationale", () => {
    const skip = computeFallbackAdjustment(BASE, 0, {
      source: "actual",
      skipped: true,
    });
    expect(skip.delta.cal).toBeLessThan(0);
    expect(skip.delta.protein).toBe(0);
    expect(skip.rationale).toMatch(/skip/i);
  });

  it("a heavy lift day is HIGHER calories + carbs than a rest day, with a small protein bump", () => {
    const rest = computeFallbackAdjustment(BASE, 0, { source: "planned" });
    const heavy = computeFallbackAdjustment(BASE, 120, { source: "planned" });
    expect(heavy.adjusted.cal).toBeGreaterThan(rest.adjusted.cal);
    expect(heavy.delta.cal).toBeGreaterThan(0);
    // Carbs are the lever — heavier day carries more carbs than a rest day.
    expect(heavy.adjusted.carbs).toBeGreaterThan(rest.adjusted.carbs);
    // Protein is anchored: rest day never drops it; heavy day gets only a small
    // bump, never a wild swing.
    expect(rest.delta.protein).toBe(0);
    expect(heavy.delta.protein).toBeGreaterThan(0);
    expect(heavy.delta.protein).toBeLessThanOrEqual(MAX_PROTEIN_BUMP);
  });

  it("balances fat so macros sum to the calorie target", () => {
    const day = computeFallbackAdjustment(BASE, 120, { source: "planned" });
    const kcalFromMacros =
      day.adjusted.protein * 4 + day.adjusted.carbs * 4 + day.adjusted.fat * 9;
    // Within rounding of a gram of fat.
    expect(Math.abs(kcalFromMacros - day.adjusted.cal)).toBeLessThanOrEqual(9);
  });

  it("protein does not swing wildly across rest / typical / heavy days", () => {
    const rest = computeFallbackAdjustment(BASE, 0, { source: "planned" });
    const typical = computeFallbackAdjustment(BASE, 60, { source: "planned" });
    const heavy = computeFallbackAdjustment(BASE, 130, { source: "planned" });
    const proteins = [rest, typical, heavy].map((d) => d.adjusted.protein);
    const spread = Math.max(...proteins) - Math.min(...proteins);
    expect(spread).toBeLessThanOrEqual(MAX_PROTEIN_BUMP);
  });

  it("a lighter-than-typical logged session lowers calories vs the planned heavy day", () => {
    const plannedHeavy = computeFallbackAdjustment(BASE, 100, {
      source: "planned",
    });
    const actualShort = computeFallbackAdjustment(BASE, 30, {
      source: "actual",
    });
    expect(actualShort.adjusted.cal).toBeLessThan(plannedHeavy.adjusted.cal);
  });

  it("clamps the calorie swing to the configured bound", () => {
    const huge = computeFallbackAdjustment(BASE, 100000, { source: "planned" });
    expect(Math.abs(huge.delta.cal)).toBeLessThanOrEqual(MAX_CAL_DELTA);
  });
});

describe("clampAdjustment", () => {
  it("bounds AI deltas and keeps protein near steady", () => {
    const { adjusted, delta } = clampAdjustment(BASE, {
      calDelta: 5000,
      carbDelta: 5000,
      proteinDelta: 200,
    });
    expect(delta.cal).toBeLessThanOrEqual(MAX_CAL_DELTA);
    expect(delta.carbs).toBeLessThanOrEqual(MAX_CARB_DELTA);
    // Protein is anchored: never below the floor, at most a small bump.
    expect(adjusted.protein).toBeGreaterThanOrEqual(BASE.protein);
    expect(adjusted.protein - BASE.protein).toBeLessThanOrEqual(MAX_PROTEIN_BUMP);
  });

  it("never reduces protein below the floor even if the AI proposes a cut", () => {
    const { adjusted } = clampAdjustment(BASE, {
      calDelta: -300,
      carbDelta: -75,
      proteinDelta: -50,
    });
    expect(adjusted.protein).toBe(BASE.protein);
  });

  it("balances fat to the calorie target", () => {
    const { adjusted } = clampAdjustment(BASE, { calDelta: 300, carbDelta: 70 });
    const kcal = adjusted.protein * 4 + adjusted.carbs * 4 + adjusted.fat * 9;
    expect(Math.abs(kcal - adjusted.cal)).toBeLessThanOrEqual(9);
  });
});

describe("balanceFatG", () => {
  it("fills the remaining calories as fat", () => {
    // 2000 - 200*4 - 200*4 = 400 kcal → 44 g fat
    expect(balanceFatG(2000, 200, 200)).toBe(44);
  });
  it("never goes negative", () => {
    expect(balanceFatG(1000, 200, 200)).toBe(0);
  });
});

describe("proteinBumpForLoad", () => {
  it("is zero on rest/typical/light days and ramps on heavy days", () => {
    expect(proteinBumpForLoad(0, true)).toBe(0);
    expect(proteinBumpForLoad(60, false)).toBe(0);
    expect(proteinBumpForLoad(40, false)).toBe(0);
    expect(proteinBumpForLoad(120, false)).toBeGreaterThan(0);
    expect(proteinBumpForLoad(100000, false)).toBe(MAX_PROTEIN_BUMP);
  });
});
