import { describe, it, expect } from "vitest";
import {
  clampWeeklyRate,
  weeklyWeightStatus,
  targetWeightForWeek,
  MAX_GAIN_RATE_LB_PER_WK,
} from "./weekly-weight";

describe("clampWeeklyRate", () => {
  it("leaves a safe loss rate alone", () => {
    // 200 lb → safe rate = min(2.0, 2.0) = 2.0 lb/wk. -1.0 is well under.
    const c = clampWeeklyRate(-1.0, 200);
    expect(c.rateLb).toBe(-1.0);
    expect(c.clamped).toBe(false);
    expect(c.note).toBeNull();
  });

  it("clamps an unsafe loss rate to the safe maximum + notes it", () => {
    // 150 lb → safe = min(1.5, 2.0) = 1.5 lb/wk. Asking for -3 should clamp.
    const c = clampWeeklyRate(-3, 150);
    expect(c.rateLb).toBe(-1.5);
    expect(c.clamped).toBe(true);
    expect(c.note).toMatch(/safe/i);
  });

  it("never lets loss exceed the 2 lb/wk absolute cap even for a heavy client", () => {
    // 300 lb → 1% = 3 lb but capped at 2.0. Asking -2.5 clamps to -2.0.
    const c = clampWeeklyRate(-2.5, 300);
    expect(c.rateLb).toBe(-2.0);
    expect(c.clamped).toBe(true);
  });

  it("caps gains at the lean-bulk rate", () => {
    const c = clampWeeklyRate(1.5, 180);
    expect(c.rateLb).toBe(MAX_GAIN_RATE_LB_PER_WK);
    expect(c.clamped).toBe(true);
  });

  it("treats 0 as maintenance", () => {
    expect(clampWeeklyRate(0, 180)).toEqual({ rateLb: 0, clamped: false, note: null });
  });
});

describe("targetWeightForWeek", () => {
  it("projects linearly from the start weight", () => {
    expect(
      targetWeightForWeek({ startWeightLb: 200, rateLb: -1, goalWeightLb: 180 }, 4),
    ).toBe(196);
  });

  it("clamps so it never overshoots the goal (loss)", () => {
    // -1/wk for 30 weeks from 200 would be 170, but goal is 180 → clamp at 180.
    expect(
      targetWeightForWeek({ startWeightLb: 200, rateLb: -1, goalWeightLb: 180 }, 30),
    ).toBe(180);
  });
});

describe("weeklyWeightStatus", () => {
  it("computes the current-week target + on-track when ahead of plan", () => {
    // Anchor 2 weeks ago at 200, losing 1/wk. End of current week (week 3) = 197.
    const s = weeklyWeightStatus({
      startWeightLb: 200,
      rateLb: -1,
      goalWeightLb: 185,
      anchorDateISO: "2026-06-01",
      todayISO: "2026-06-15", // 14 days = 2 whole weeks elapsed
      latestActualLb: 196, // ahead of the 197 target
    });
    expect(s.weekIndex).toBe(2);
    expect(s.currentWeekTargetLb).toBe(197);
    expect(s.varianceLb).toBe(-1); // 196 - 197
    expect(s.onTrack).toBe(true);
  });

  it("flags off-track when above the loss target beyond tolerance", () => {
    const s = weeklyWeightStatus({
      startWeightLb: 200,
      rateLb: -1,
      goalWeightLb: 185,
      anchorDateISO: "2026-06-01",
      todayISO: "2026-06-15",
      latestActualLb: 200, // way above the 197 target
    });
    expect(s.onTrack).toBe(false);
  });

  it("returns null on-track when there's no actual weight yet", () => {
    const s = weeklyWeightStatus({
      startWeightLb: 200,
      rateLb: -1,
      goalWeightLb: 185,
      anchorDateISO: "2026-06-01",
      todayISO: "2026-06-15",
      latestActualLb: null,
    });
    expect(s.onTrack).toBeNull();
    expect(s.varianceLb).toBeNull();
  });
});
