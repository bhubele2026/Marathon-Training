import { describe, it, expect } from "vitest";
import {
  addDaysISO,
  isMonday,
  isSunday,
  weekdayIndex,
  materializeAiPlan,
  runGuardrails,
  planIncludesRunning,
  type AiPlan,
  type AiDay,
  type AiWeek,
} from "@workspace/plan-knowledge";

// 2026-05-04 is the campaign-start Monday referenced in replit.md.
const MON = "2026-05-04";

function day(partial: Partial<AiDay> & { day: string }): AiDay {
  return {
    isRest: false,
    sessionType: "Strength + Cardio",
    strengthMin: 30,
    cardioMin: 0,
    runMin: 0,
    distanceMi: null,
    pace: null,
    equipmentList: ["Tonal"],
    description: "",
    ...partial,
  };
}

// A clean, contract-respecting week under the FIXED cadence (Mon rest;
// Tue-Thu SHORT 30-50; Fri-Sun LONG 60-90; >=30 lift on training days;
// valid paces; 11 mi/week).
function cleanWeek(week: number, phase = "Base"): AiWeek {
  return {
    week,
    phase,
    days: [
      day({ day: "Mon", isRest: true, sessionType: "Rest", strengthMin: 0, equipmentList: [] }),
      day({ day: "Tue", strengthMin: 30, cardioMin: 15, equipmentList: ["Tonal", "Peloton Bike"] }), // 45
      day({
        day: "Wed",
        strengthMin: 30,
        runMin: 18,
        distanceMi: 3,
        pace: "12:30",
        equipmentList: ["Peloton Tread", "Tonal"],
      }), // 48
      day({ day: "Thu", strengthMin: 30, cardioMin: 15, equipmentList: ["Tonal", "Peloton Row"] }), // 45
      day({
        day: "Fri",
        strengthMin: 30,
        runMin: 35,
        distanceMi: 3,
        pace: "11:30",
        equipmentList: ["Peloton Tread", "Tonal"],
      }), // 65
      day({ day: "Sat", strengthMin: 40, cardioMin: 25, equipmentList: ["Tonal", "Peloton Bike"] }), // 65
      day({
        day: "Sun",
        sessionType: "Long Run",
        strengthMin: 30,
        runMin: 50,
        distanceMi: 5,
        pace: "13:00",
        equipmentList: ["Peloton Tread", "Tonal"],
      }), // 80
    ],
  };
}

describe("dates", () => {
  it("knows Monday and Sunday", () => {
    expect(isMonday(MON)).toBe(true);
    expect(weekdayIndex(MON)).toBe(0);
    expect(isSunday("2026-05-10")).toBe(true);
    expect(weekdayIndex("2026-05-10")).toBe(6);
  });

  it("adds days across month boundaries", () => {
    expect(addDaysISO(MON, 6)).toBe("2026-05-10");
    expect(addDaysISO(MON, 13)).toBe("2026-05-17");
    expect(addDaysISO("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("materializeAiPlan", () => {
  const plan: AiPlan = {
    summary: "s",
    name: "Test",
    raceKind: "10k",
    startDate: MON,
    weeks: [cleanWeek(1), cleanWeek(2)],
  };
  const out = materializeAiPlan(plan);

  it("emits one row per day with computed ISO dates", () => {
    expect(out.days).toHaveLength(14);
    expect(out.days[0].date).toBe(MON); // W1 Mon
    expect(out.days[6].date).toBe("2026-05-10"); // W1 Sun
    expect(out.days[7].date).toBe("2026-05-11"); // W2 Mon
  });

  it("derives equipment scalar from equipmentList[0]", () => {
    const tue = out.days.find((d) => d.day === "Tue" && d.week === 1)!;
    expect(tue.equipment).toBe("Tonal");
    const mon = out.days[0];
    expect(mon.equipment).toBe("Off / Rest"); // rest day, empty list
  });

  it("aggregates weekly mileage + long run", () => {
    expect(out.weekly).toHaveLength(2);
    expect(out.weekly[0].plannedMiles).toBeCloseTo(11);
    expect(out.weekly[0].longRunMi).toBe(5);
    expect(out.weekly[0].startDate).toBe(MON);
    expect(out.weekly[0].endDate).toBe("2026-05-10");
  });

  it("anchors marathonDate on the final Sunday for races, null otherwise", () => {
    expect(out.marathonDate).toBe("2026-05-17"); // W2 Sun
    const noRace = materializeAiPlan({ ...plan, raceKind: "none" });
    expect(noRace.marathonDate).toBeNull();
  });
});

describe("planIncludesRunning (R1)", () => {
  it("is false for a no-race (recomp default) plan and true for a run race", () => {
    expect(planIncludesRunning({ raceKind: "none" })).toBe(false);
    expect(planIncludesRunning({ raceKind: "5k" })).toBe(true);
    expect(planIncludesRunning({ raceKind: "marathon" })).toBe(true);
  });
  it("honors an explicit includesRunning override", () => {
    expect(planIncludesRunning({ raceKind: "5k" }, { includesRunning: false })).toBe(false);
    expect(planIncludesRunning({ raceKind: "none" }, { includesRunning: true })).toBe(true);
  });
});

describe("runGuardrails", () => {
  it("passes a contract-respecting plan with no findings", () => {
    const plan: AiPlan = {
      summary: "s",
      name: "Clean",
      raceKind: "10k",
      startDate: MON,
      weeks: [cleanWeek(1), cleanWeek(2)],
    };
    expect(runGuardrails(plan, {})).toHaveLength(0);
  });

  it("flags start-not-Monday, Monday work, rest-with-work, over-budget, bad pace", () => {
    const plan: AiPlan = {
      summary: "s",
      name: "Dirty",
      raceKind: "none",
      startDate: "2026-05-05", // a Tuesday
      weeks: [
        {
          week: 1,
          phase: "Base",
          days: [
            // Monday marked rest but carrying work -> two findings.
            day({ day: "Mon", isRest: true, strengthMin: 30, cardioMin: 30 }),
            day({ day: "Tue", strengthMin: 60, cardioMin: 40 }), // total 100 > 75
            day({ day: "Wed", runMin: 30, distanceMi: 3, pace: "oops" }),
            day({ day: "Thu" }),
            day({ day: "Fri" }),
            day({ day: "Sat" }),
            day({ day: "Sun", strengthMin: 30, runMin: 60, distanceMi: 6, pace: "13:00" }),
          ],
        },
      ],
    };
    const codes = new Set(runGuardrails(plan, {}).map((g) => g.code));
    expect(codes.has("start_not_monday")).toBe(true);
    expect(codes.has("monday_not_rest")).toBe(true);
    expect(codes.has("rest_not_rest")).toBe(true);
    expect(codes.has("over_budget")).toBe(true);
    expect(codes.has("bad_pace_format")).toBe(true);
  });

  it("R1: flags running on a no-run-goal (recomp default) plan", () => {
    // raceKind "none" => includesRunning is false (the recomp default).
    // A week that programs a Long Run / miles / run minutes must be flagged.
    const plan: AiPlan = {
      summary: "s",
      name: "Recomp drifting to running",
      raceKind: "none",
      startDate: MON,
      weeks: [
        {
          week: 1,
          phase: "Strength",
          days: [
            day({ day: "Mon", isRest: true, sessionType: "Rest", strengthMin: 0, equipmentList: [] }),
            day({ day: "Tue", strengthMin: 35, cardioMin: 15 }),
            day({ day: "Wed", strengthMin: 35, cardioMin: 15 }),
            day({ day: "Thu", strengthMin: 35, cardioMin: 15 }),
            day({ day: "Fri", strengthMin: 40, cardioMin: 30 }),
            // A stray Long Run with miles — should be flagged.
            day({
              day: "Sat",
              sessionType: "Long Run",
              strengthMin: 30,
              runMin: 50,
              distanceMi: 5,
              pace: "13:00",
            }),
            day({ day: "Sun", strengthMin: 40, cardioMin: 30 }),
          ],
        },
      ],
    };
    const findings = runGuardrails(plan, {});
    const codes = findings.map((g) => g.code);
    expect(codes).toContain("running_without_run_goal");
    const flagged = findings.find((g) => g.code === "running_without_run_goal")!;
    expect(flagged.level).toBe("warn");
    expect(flagged.day).toBe("Sat");
  });

  it("R1: does NOT flag running when a run goal IS set", () => {
    // raceKind "5k" => includesRunning is true; a Long Run is expected.
    const plan: AiPlan = {
      summary: "s",
      name: "5K plan",
      raceKind: "5k",
      startDate: MON,
      weeks: [cleanWeek(1)],
    };
    const codes = runGuardrails(plan, {}).map((g) => g.code);
    expect(codes).not.toContain("running_without_run_goal");
  });

  it("R1: includesRunning override forces the running flag off even with miles", () => {
    // A run-race plan whose flag is explicitly overridden to false would be
    // flagged — proves the override is honored (single authoritative flag).
    const plan: AiPlan = {
      summary: "s",
      name: "Overridden",
      raceKind: "5k",
      startDate: MON,
      weeks: [cleanWeek(1)],
    };
    const codes = runGuardrails(plan, {}, { includesRunning: false }).map((g) => g.code);
    expect(codes).toContain("running_without_run_goal");
  });

  it("flags a too-aggressive week-to-week mileage jump", () => {
    const small = cleanWeek(1); // 11 mi
    const big = cleanWeek(2);
    // Push week 2 long run way up so weekly mileage jumps > 15%.
    big.days[6].distanceMi = 20;
    const plan: AiPlan = {
      summary: "s",
      name: "Jump",
      raceKind: "half",
      startDate: MON,
      weeks: [small, big],
    };
    const codes = runGuardrails(plan, {}).map((g) => g.code);
    expect(codes).toContain("mileage_jump");
  });
});
