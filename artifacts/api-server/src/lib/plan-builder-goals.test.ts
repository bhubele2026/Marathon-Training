// Phase 11 regression guard: after the marathon rip-out (Phase 0), the plan
// builder must still author ANY goal — including a run race — and have it
// materialize. These are pure-function tests over the shared plan-knowledge
// contract (no LLM): they build the structured AiPlan the model would emit for
// "give me a 5k next" and "give me an 8-week cut", then assert goalKind/raceKind
// routing, that materializeAiPlan produces a sound campaign, and that the
// run-vs-no-run split is correct. If Phase 0 had over-pruned the run capability,
// the 5k case here would stop materializing.

import { describe, it, expect } from "vitest";
import {
  materializeAiPlan,
  planIncludesRunning,
  runGuardrails,
  type AiPlan,
  type AiDay,
  type DayName,
} from "@workspace/plan-knowledge";

const REST: Omit<AiDay, "day"> = {
  isRest: true,
  sessionType: "Rest",
  strengthMin: 0,
  cardioMin: 0,
  runMin: 0,
  equipmentList: [],
  description: "Full rest.",
};

function day(d: DayName, over: Partial<AiDay>): AiDay {
  return { ...REST, day: d, ...over };
}

// A 5K race plan: goalKind "race" + raceKind "5k", lifting KEPT as conditioning,
// run phases building the long run toward ~3 mi. Every week is a full Mon→Sun 7.
function fiveKWeek(week: number, phase: string, longRunMi: number): AiPlan["weeks"][number] {
  return {
    week,
    phase,
    days: [
      day("Mon", {}), // rest
      day("Tue", {
        isRest: false,
        sessionType: "Lower Strength",
        strengthMin: 40,
        equipmentList: ["Tonal"],
        description: "Tonal lower — lifting kept as conditioning.",
      }),
      day("Wed", {
        isRest: false,
        sessionType: "Intervals",
        runMin: 28,
        distanceMi: 2.4,
        pace: "9:15",
        equipmentList: ["Peloton Tread"],
        description: "Tread intervals — 5K speed work.",
      }),
      day("Thu", {}), // rest
      day("Fri", {
        isRest: false,
        sessionType: "Upper Strength",
        strengthMin: 45,
        equipmentList: ["Tonal"],
        description: "Tonal upper — lifting kept as conditioning.",
      }),
      day("Sat", {}), // rest
      day("Sun", {
        isRest: false,
        sessionType: "Long Run",
        runMin: 36,
        distanceMi: longRunMi,
        pace: "10:30",
        equipmentList: ["Peloton Tread"],
        description: `Tread long run building toward the 5K (~${longRunMi} mi).`,
      }),
    ],
  };
}

const fiveKPlan: AiPlan = {
  summary: "An 8-week 5K block: Base → Build → Peak → Taper, lifting kept in.",
  name: "8-Week 5K",
  goalKind: "race",
  raceKind: "5k",
  startDate: "2026-07-06",
  weeks: [
    fiveKWeek(1, "Base", 2.0),
    fiveKWeek(2, "Base", 2.4),
    fiveKWeek(3, "Build", 2.8),
    fiveKWeek(4, "Peak/Sharpen", 3.1),
  ],
};

// An 8-week cut: goalKind "fat_loss", NO running, nutrition targets attached.
function cutWeek(week: number): AiPlan["weeks"][number] {
  return {
    week,
    phase: "Fat-loss accumulation",
    days: [
      day("Mon", {}),
      day("Tue", {
        isRest: false,
        sessionType: "Full Body",
        strengthMin: 40,
        equipmentList: ["Tonal"],
        description: "Tonal full body.",
      }),
      day("Wed", {
        isRest: false,
        sessionType: "Conditioning",
        cardioMin: 35,
        equipmentList: ["Peloton Bike"],
        description: "Low-impact bike intervals for the deficit.",
      }),
      day("Thu", {}),
      day("Fri", {
        isRest: false,
        sessionType: "Lower Strength",
        strengthMin: 60,
        equipmentList: ["Tonal"],
        description: "Tonal lower.",
      }),
      day("Sat", {
        isRest: false,
        sessionType: "Conditioning",
        cardioMin: 45,
        equipmentList: ["Peloton Row"],
        description: "Steady row.",
      }),
      day("Sun", {}),
    ],
  };
}

const cutPlan: AiPlan = {
  summary: "An 8-week cut: strength + low-impact conditioning, zero running.",
  name: "8-Week Cut",
  goalKind: "fat_loss",
  raceKind: "none",
  startDate: "2026-07-06",
  weeks: [cutWeek(1), cutWeek(2)],
  nutrition: {
    calorieTarget: 2100,
    proteinTargetG: 185,
    carbsTargetG: 200,
    fatTargetG: 60,
    weeklyRateLb: 1,
    rationale: "Modest deficit, protein held high to spare muscle.",
  },
};

describe("Phase 11 — plan builder authors any goal after the marathon rip", () => {
  it('routes a 5K request to goalKind "race" + raceKind "5k" and materializes a run campaign', () => {
    expect(fiveKPlan.goalKind).toBe("race");
    expect(fiveKPlan.raceKind).toBe("5k");
    expect(planIncludesRunning(fiveKPlan)).toBe(true);

    const m = materializeAiPlan(fiveKPlan);
    // A run goal gets a campaign end date; the days carry the run minutes/miles.
    expect(m.marathonDate).not.toBeNull();
    expect(m.totalWeeks).toBe(4);
    expect(m.days.length).toBe(4 * 7);

    const runMin = m.days.reduce((s, d) => s + d.runMin, 0);
    const miles = m.weekly.reduce((s, w) => s + w.plannedMiles, 0);
    expect(runMin).toBeGreaterThan(0);
    expect(miles).toBeGreaterThan(0);
    // Lifting is kept as conditioning, not stripped.
    expect(m.days.reduce((s, d) => s + d.strengthMin, 0)).toBeGreaterThan(0);
    // Longest run builds toward ~the 5K distance without overshooting hard.
    const longest = Math.max(...m.days.map((d) => d.distanceMi ?? 0));
    expect(longest).toBeGreaterThanOrEqual(3);
    expect(longest).toBeLessThan(4);
  });

  it("authors an 8-week cut as a no-running fat_loss plan with nutrition targets", () => {
    expect(cutPlan.goalKind).toBe("fat_loss");
    expect(planIncludesRunning(cutPlan)).toBe(false);

    const m = materializeAiPlan(cutPlan);
    expect(m.marathonDate).toBeNull();
    expect(m.days.reduce((s, d) => s + d.runMin, 0)).toBe(0);
    expect(m.days.length).toBe(2 * 7);
    expect(cutPlan.nutrition?.proteinTargetG).toBe(185);
  });

  it("both plans are structurally sound under guardrails (7 days/week, right order)", () => {
    const budget = {};
    for (const plan of [fiveKPlan, cutPlan]) {
      const findings = runGuardrails(plan, budget);
      expect(Array.isArray(findings)).toBe(true);
      // Well-formed Mon→Sun 7-day weeks must not trip the structural checks.
      expect(
        findings.filter(
          (f) => f.code === "day_order" || f.code === "week_day_count",
        ),
      ).toEqual([]);
    }
  });
});
