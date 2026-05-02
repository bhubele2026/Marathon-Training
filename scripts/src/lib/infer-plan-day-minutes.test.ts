// Tests for the per-row inference used by the strength_min / cardio_min /
// run_min backfill. The cases below mirror the actual seed descriptions
// produced by the plan generator so we have confidence the regexes will
// hit on real production rows. Ambiguous cases must return null so the
// caller leaves the column untouched.

import { describe, it, expect } from "vitest";
import { classifySession, inferPlanDayMinutes } from "./infer-plan-day-minutes";

describe("inferPlanDayMinutes", () => {
  it("returns all zeros for rest days regardless of description", () => {
    expect(
      inferPlanDayMinutes({
        sessionType: "Rest",
        equipment: "Off / Rest",
        description: "Full rest day. Optional 20 min walk, foam roll, mobility, hydrate.",
        distanceMi: null,
        pace: null,
        isRest: true,
      }),
    ).toEqual({ strengthMin: 0, cardioMin: 0, runMin: 0 });
  });

  it("infers lift + cardio for a Tonal + Bike day", () => {
    expect(
      inferPlanDayMinutes({
        sessionType: "Strength + Cardio",
        equipment: "Tonal",
        description:
          "Heavy upper-body Tonal (45 min, push/pull at 80-85% effort), then 25 min easy Peloton Bike spin",
        distanceMi: null,
        pace: null,
        isRest: false,
      }),
    ).toEqual({ strengthMin: 45, cardioMin: 25, runMin: 0 });
  });

  it("infers lift + cardio for a Tonal + Row day", () => {
    expect(
      inferPlanDayMinutes({
        sessionType: "Strength + Cardio",
        equipment: "Tonal",
        description:
          "Heavy lower-body Tonal (45 min, squat/hinge/lunge at 80-85% effort), then 25 min steady Peloton Row",
        distanceMi: null,
        pace: null,
        isRest: false,
      }),
    ).toEqual({ strengthMin: 45, cardioMin: 25, runMin: 0 });
  });

  it("infers lift + run for a Tread run + Tonal accessory day (run minutes from distance × pace)", () => {
    expect(
      inferPlanDayMinutes({
        sessionType: "Run + Accessory",
        equipment: "Peloton Tread",
        description:
          "Easy aerobic Tread run (1.5 mi, fully conversational pace), then 25 min Tonal core + accessory work (no heavy lifting)",
        distanceMi: 1.5,
        pace: "14:30",
        isRest: false,
      }),
    ).toEqual({ strengthMin: 25, cardioMin: 0, runMin: 22 });
  });

  it("infers run-only for a long-run day with no lift mention", () => {
    expect(
      inferPlanDayMinutes({
        sessionType: "Long Run",
        equipment: "Peloton Tread",
        description:
          "Long run/walk (2 mi): easy walk-run intervals, build aerobic durability. NO lift today.",
        distanceMi: 2,
        pace: "15:00",
        isRest: false,
      }),
    // 2 mi × 15:00/mi = 30 min exactly. (The canonical generator produces
    // 32 because it adds a small walk-buffer; the inference path used by
    // the backfill is intentionally a strict distance × pace calculation
    // and only fires when the column is currently NULL, so it cannot
    // overwrite a pre-existing canonical value like 32.)
    ).toEqual({ strengthMin: 0, cardioMin: 0, runMin: 30 });
  });

  it("infers lift-only when there is no run/cardio signal", () => {
    expect(
      inferPlanDayMinutes({
        sessionType: "Strength",
        equipment: "Tonal",
        description: "Heavy lower-body Tonal (50 min, squat/hinge focus)",
        distanceMi: null,
        pace: null,
        isRest: false,
      }),
    ).toEqual({ strengthMin: 50, cardioMin: 0, runMin: 0 });
  });

  it("returns null for the lift bucket when Tonal is mentioned but no NN-min phrase is parseable", () => {
    const out = inferPlanDayMinutes({
      sessionType: "Strength + Cardio",
      equipment: "Tonal",
      description: "Heavy upper-body Tonal session, then 25 min Peloton Bike spin",
      distanceMi: null,
      pace: null,
      isRest: false,
    });
    // Lift is present but ambiguous -> null. Cardio is unambiguous -> 25.
    // Run is clearly absent -> 0.
    expect(out.strengthMin).toBeNull();
    expect(out.cardioMin).toBe(25);
    expect(out.runMin).toBe(0);
  });

  it("returns null for the run bucket when distance is set but pace is missing", () => {
    const out = inferPlanDayMinutes({
      sessionType: "Long Run",
      equipment: "Peloton Tread",
      description: "Long run/walk (3 mi): easy intervals.",
      distanceMi: 3,
      pace: null,
      isRest: false,
    });
    expect(out.runMin).toBeNull();
    expect(out.strengthMin).toBe(0);
    expect(out.cardioMin).toBe(0);
  });
});

describe("classifySession", () => {
  it("classifies rest days as 'rest' regardless of description", () => {
    expect(
      classifySession({
        sessionType: "Rest",
        equipment: "Off / Rest",
        description: "Full rest day. Optional 20 min walk.",
        distanceMi: null,
        pace: null,
        isRest: true,
      }),
    ).toBe("rest");
  });

  it("classifies any row with a treadmill / outdoor equipment or run session type as 'run-led'", () => {
    expect(
      classifySession({
        sessionType: "Long Run",
        equipment: "Peloton Tread",
        description: "long run",
        distanceMi: 5,
        pace: "12:00",
        isRest: false,
      }),
    ).toBe("run-led");

    expect(
      classifySession({
        sessionType: "Run + Accessory",
        equipment: "Peloton Tread",
        description: "run + Tonal core",
        distanceMi: 1.5,
        pace: "14:30",
        isRest: false,
      }),
    ).toBe("run-led");
  });

  it("classifies Tonal / lift / cross-train rows as 'strength-cardio'", () => {
    expect(
      classifySession({
        sessionType: "Strength + Cardio",
        equipment: "Tonal",
        description:
          "Heavy upper-body Tonal (45 min, push/pull), then 25 min Peloton Bike",
        distanceMi: null,
        pace: null,
        isRest: false,
      }),
    ).toBe("strength-cardio");
  });
});
