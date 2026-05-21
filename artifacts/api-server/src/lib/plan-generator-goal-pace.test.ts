// Task #375: lock in the Task #373 goal ending pace anchor.
//
// These tests pin the contract on `computeEffectivePace`:
//   - With NO goal/total → legacy fixed-rate ramp (RAMP_SEC_PER_WEEK).
//   - With both anchors  → linear interpolation from start (week 1) to
//                          goal (week total).
//   - total = 1          → degenerate case, falls back to legacy ramp.
//   - week = 1           → exactly the starting pace (modulo floors).
//   - week = total       → exactly the goal pace (modulo floors).
//   - week > total       → clamped at the goal (t = 1).
import { describe, expect, it } from "vitest";
import {
  computeEffectivePace,
  RAMP_SEC_PER_WEEK,
} from "@workspace/plan-generator";

// Floors chosen well below the values under test so they never clamp.
const EASY_FLOOR = 360;
const LONG_FLOOR = 360;
const TEMPO_FLOOR = 300;

describe("computeEffectivePace — goal ending pace anchor (Task #373)", () => {
  it("falls back to the legacy fixed-rate ramp when no opts are provided", () => {
    const start = 900;
    const w1 = computeEffectivePace(start, 1, EASY_FLOOR, LONG_FLOOR, TEMPO_FLOOR);
    const w9 = computeEffectivePace(start, 9, EASY_FLOOR, LONG_FLOOR, TEMPO_FLOOR);
    expect(w1.easySec).toBe(start);
    // 8 weeks elapsed at RAMP_SEC_PER_WEEK → easy = start - 8 * slope
    expect(w9.easySec).toBe(Math.round(start - 8 * RAMP_SEC_PER_WEEK));
  });

  it("falls back to the legacy ramp when goalEndingPaceSec is null", () => {
    const start = 900;
    const legacy = computeEffectivePace(
      start,
      9,
      EASY_FLOOR,
      LONG_FLOOR,
      TEMPO_FLOOR,
    );
    const withNullGoal = computeEffectivePace(
      start,
      9,
      EASY_FLOOR,
      LONG_FLOOR,
      TEMPO_FLOOR,
      { goalEndingPaceSec: null, totalCampaignWeeks: 26 },
    );
    expect(withNullGoal.easySec).toBe(legacy.easySec);
  });

  it("falls back to the legacy ramp when totalCampaignWeeks is null", () => {
    const start = 900;
    const legacy = computeEffectivePace(
      start,
      9,
      EASY_FLOOR,
      LONG_FLOOR,
      TEMPO_FLOOR,
    );
    const withNullTotal = computeEffectivePace(
      start,
      9,
      EASY_FLOOR,
      LONG_FLOOR,
      TEMPO_FLOOR,
      { goalEndingPaceSec: 600, totalCampaignWeeks: null },
    );
    expect(withNullTotal.easySec).toBe(legacy.easySec);
  });

  it("falls back to the legacy ramp when totalCampaignWeeks = 1 (no interp window)", () => {
    const start = 900;
    const legacy = computeEffectivePace(
      start,
      1,
      EASY_FLOOR,
      LONG_FLOOR,
      TEMPO_FLOOR,
    );
    const degenerate = computeEffectivePace(
      start,
      1,
      EASY_FLOOR,
      LONG_FLOOR,
      TEMPO_FLOOR,
      { goalEndingPaceSec: 600, totalCampaignWeeks: 1 },
    );
    expect(degenerate.easySec).toBe(legacy.easySec);
  });

  it("at week = 1 returns the starting pace when both anchors are set", () => {
    const start = 900;
    const goal = 600;
    const out = computeEffectivePace(
      start,
      1,
      EASY_FLOOR,
      LONG_FLOOR,
      TEMPO_FLOOR,
      { goalEndingPaceSec: goal, totalCampaignWeeks: 26 },
    );
    expect(out.easySec).toBe(start);
  });

  it("at week = totalCampaignWeeks returns the goal pace when both anchors are set", () => {
    const start = 900;
    const goal = 600;
    const total = 26;
    const out = computeEffectivePace(
      start,
      total,
      EASY_FLOOR,
      LONG_FLOOR,
      TEMPO_FLOOR,
      { goalEndingPaceSec: goal, totalCampaignWeeks: total },
    );
    expect(out.easySec).toBe(goal);
  });

  it("linearly interpolates between the two anchors at the midpoint", () => {
    const start = 900;
    const goal = 600;
    const total = 11; // midpoint = week 6
    const mid = computeEffectivePace(
      start,
      6,
      EASY_FLOOR,
      LONG_FLOOR,
      TEMPO_FLOOR,
      { goalEndingPaceSec: goal, totalCampaignWeeks: total },
    );
    // (6 - 1) / (11 - 1) = 0.5 → exactly halfway between 900 and 600.
    expect(mid.easySec).toBe(750);
  });

  it("clamps at the goal pace when campaignWeek runs past totalCampaignWeeks", () => {
    const start = 900;
    const goal = 600;
    const total = 10;
    const past = computeEffectivePace(
      start,
      total + 5,
      EASY_FLOOR,
      LONG_FLOOR,
      TEMPO_FLOOR,
      { goalEndingPaceSec: goal, totalCampaignWeeks: total },
    );
    expect(past.easySec).toBe(goal);
  });

  it("derives long = easy + 30 and tempo = easy − 60 from the interpolated easy", () => {
    const start = 900;
    const goal = 600;
    const total = 11;
    const mid = computeEffectivePace(
      start,
      6,
      EASY_FLOOR,
      LONG_FLOOR,
      TEMPO_FLOOR,
      { goalEndingPaceSec: goal, totalCampaignWeeks: total },
    );
    expect(mid.easySec).toBe(750);
    expect(mid.longSec).toBe(780);
    expect(mid.tempoSec).toBe(690);
  });

  it("still honors the easy floor when interpolation would drop below it", () => {
    const start = 900;
    const goal = 400; // well below the easy floor below
    const out = computeEffectivePace(start, 10, 600, 600, 540, {
      goalEndingPaceSec: goal,
      totalCampaignWeeks: 10,
    });
    expect(out.easySec).toBe(600);
  });
});
