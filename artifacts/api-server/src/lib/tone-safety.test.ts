// Phase 6 — tone safety check. The persona's supportive-flip is driven by a
// SAFETY SIGNAL injected into the coach prompt when the data shows under-eating
// or rapid weight loss. These tests verify the signal (and its explicit
// "drop the sarcasm / be warm" instruction) fires EXACTLY when it should — so a
// struggling week can never get the tough-love treatment. The model's
// compliance with the signal is engineered via the persona rails (guarded by
// persona tests); here we prove the trigger itself is correct.

import { describe, it, expect } from "vitest";
import { buildDataSummary, buildSummaryData, type DayInputs } from "./coach-voice";
import type { WeekReview } from "../routes/week-review";

const SUPPORTIVE = /drop the sarcasm|be warm|warm/i;
const SIGNAL = /SAFETY SIGNAL/;

function day(over: Partial<DayInputs> = {}): DayInputs {
  return {
    date: "2026-06-19",
    target: { calories: 2200, protein: 190, carbs: 220, fat: 70 },
    actual: { calories: 2000, protein: 180, carbs: 210, fat: 65 },
    planned: { sessionType: "Lower", isRest: false, minutes: 45, lifting: true, description: "Tonal lower" },
    loggedWorkouts: 1,
    loggedMinutes: 45,
    sex: "male",
    ...over,
  };
}

describe("daily tone safety (buildDataSummary)", () => {
  it("does NOT flip supportive on a normal day", () => {
    const txt = buildDataSummary(day());
    expect(txt).not.toMatch(SIGNAL);
  });

  it("FLIPS supportive when today's intake is below the safe floor", () => {
    const txt = buildDataSummary(
      day({ actual: { calories: 900, protein: 90, carbs: 80, fat: 30 }, sex: "male" }),
    );
    expect(txt).toMatch(SIGNAL);
    expect(txt).toMatch(SUPPORTIVE);
  });

  it("uses the female floor for a female client", () => {
    // 1300 is above the male floor (1500? no — 1300 < 1500) ... use 1250: below
    // female floor (1200)? 1250 > 1200, so NOT flagged for female but flagged
    // for male. Confirms sex-specific floor wiring.
    const female = buildDataSummary(
      day({ actual: { calories: 1250, protein: 90, carbs: 100, fat: 40 }, sex: "female" }),
    );
    const male = buildDataSummary(
      day({ actual: { calories: 1250, protein: 90, carbs: 100, fat: 40 }, sex: "male" }),
    );
    expect(female).not.toMatch(SIGNAL); // 1250 > 1200 female floor
    expect(male).toMatch(SIGNAL); // 1250 < 1500 male floor
  });
});

function review(over: Partial<WeekReview> = {}): WeekReview {
  return {
    weekStart: "2026-06-15",
    weekEnd: "2026-06-21",
    food: {
      daysLogged: 6,
      avgCalories: 2050,
      avgProtein: 185,
      avgCarbs: 210,
      avgFat: 68,
      target: { calories: 2200, protein: 190, carbs: 220, fat: 70 },
      daysOverCalories: 1,
      daysUnderCalories: 5,
      proteinHitRate: 0.8,
    },
    workouts: {
      planned: 4,
      done: 3,
      skipped: 1,
      minutesPlanned: 180,
      minutesDone: 140,
      missedDays: ["2026-06-18"],
      liftingPlanned: 4,
      liftingDone: 3,
    },
    weight: { startLb: 200, endLb: 199, actualChangeLb: -1, goalChangeLb: -0.75, onTrack: true },
    ...over,
  };
}

describe("weekly tone safety (buildSummaryData)", () => {
  it("does NOT flip supportive on a normal week", () => {
    expect(buildSummaryData(review(), "male")).not.toMatch(SIGNAL);
  });

  it("FLIPS supportive when average intake is below the safe floor", () => {
    const txt = buildSummaryData(
      review({
        food: { ...review().food, avgCalories: 1100 },
      }),
      "male",
    );
    expect(txt).toMatch(SIGNAL);
    expect(txt).toMatch(SUPPORTIVE);
  });

  it("FLIPS supportive on rapid weekly weight loss", () => {
    const txt = buildSummaryData(
      review({
        weight: { startLb: 200, endLb: 196, actualChangeLb: -4, goalChangeLb: -0.75, onTrack: true },
      }),
      "male",
    );
    expect(txt).toMatch(SIGNAL);
    expect(txt).toMatch(/warm|concerned|do NOT praise/i);
  });
});
