import { describe, it, expect } from "vitest";
import {
  computePlannedLoad,
  computeFallbackAdjustment,
  clampAdjustment,
  MAX_CAL_DELTA,
  MAX_CARB_DELTA,
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

  it("a heavy lift day is HIGHER calories than a rest day", () => {
    const rest = computeFallbackAdjustment(BASE, 0, { source: "planned" });
    const heavy = computeFallbackAdjustment(BASE, 120, { source: "planned" });
    expect(heavy.adjusted.cal).toBeGreaterThan(rest.adjusted.cal);
    expect(heavy.delta.cal).toBeGreaterThan(0);
    // Protein never drifts in either case.
    expect(heavy.delta.protein).toBe(0);
    expect(rest.delta.protein).toBe(0);
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
    // Protein clamp keeps the recomp floor intact (≤15 g nudge).
    expect(adjusted.protein - BASE.protein).toBeLessThanOrEqual(15);
  });
});
