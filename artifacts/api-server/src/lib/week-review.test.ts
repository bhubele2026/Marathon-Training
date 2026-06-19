import { describe, it, expect } from "vitest";
import { summarizeFood, summarizeWeight } from "./week-review";

describe("summarizeFood", () => {
  const target = { calories: 2000, protein: 180, carbs: 200, fat: 60 };

  it("averages logged days and counts over/under + protein hit-rate", () => {
    const days = [
      { calories: 1800, proteinG: 190, carbsG: 180, fatG: 55 }, // under cal, protein hit
      { calories: 2200, proteinG: 150, carbsG: 220, fatG: 70 }, // over cal, protein miss
      { calories: null, proteinG: null, carbsG: null, fatG: null }, // not logged
    ];
    const s = summarizeFood(days, target);
    expect(s.daysLogged).toBe(2);
    expect(s.avgCalories).toBe(2000);
    expect(s.avgProtein).toBe(170);
    expect(s.daysOverCalories).toBe(1);
    expect(s.daysUnderCalories).toBe(1);
    expect(s.proteinHitRate).toBe(0.5);
  });

  it("handles no logged days", () => {
    const s = summarizeFood(
      [{ calories: null, proteinG: null, carbsG: null, fatG: null }],
      target,
    );
    expect(s.daysLogged).toBe(0);
    expect(s.avgCalories).toBeNull();
    expect(s.proteinHitRate).toBeNull();
  });
});

describe("summarizeWeight", () => {
  it("on track when loss meets the goal", () => {
    // start 200, end 199 = -1 actual; goal -0.75 → lost more than target → on track.
    const s = summarizeWeight(200, 199, -0.75);
    expect(s.actualChangeLb).toBe(-1);
    expect(s.onTrack).toBe(true);
  });

  it("off track when loss falls short of the goal", () => {
    // start 200, end 200 = 0 change; goal -0.75 → didn't lose → off track.
    const s = summarizeWeight(200, 200, -0.75);
    expect(s.actualChangeLb).toBe(0);
    expect(s.onTrack).toBe(false);
  });

  it("null on-track without a goal or without both weigh-ins", () => {
    expect(summarizeWeight(200, 199, null).onTrack).toBeNull();
    expect(summarizeWeight(null, 199, -0.75).onTrack).toBeNull();
  });
});
