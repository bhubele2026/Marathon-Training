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
  type AiStrengthBlock,
  type MovementPattern,
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

describe("materializeAiPlan — Phase 1 (real strength model)", () => {
  it("carries strength blocks through onto the materialized day", () => {
    const plan: AiPlan = {
      summary: "s",
      name: "Recomp",
      goalKind: "recomp",
      startDate: MON,
      weeks: [
        {
          week: 1,
          phase: "Lower",
          days: [
            day({ day: "Mon", isRest: true, strengthMin: 0, equipmentList: [] }),
            day({
              day: "Tue",
              sessionType: "Lower A",
              strengthMin: 40,
              strengthBlocks: [
                {
                  movement: "Back Squat",
                  pattern: "squat",
                  sets: 4,
                  reps: "6",
                  loadType: "percent_1rm",
                  loadValue: 75,
                },
                {
                  movement: "Romanian Deadlift",
                  pattern: "hinge",
                  sets: 3,
                  reps: "8-10",
                  loadType: "rir",
                  loadValue: 2,
                },
              ],
            }),
            day({ day: "Wed", strengthMin: 35 }),
            day({ day: "Thu", strengthMin: 35 }),
            day({ day: "Fri", strengthMin: 60 }),
            day({ day: "Sat", strengthMin: 60 }),
            day({ day: "Sun", strengthMin: 60 }),
          ],
        },
      ],
    };
    const out = materializeAiPlan(plan);
    const tue = out.days.find((d) => d.day === "Tue")!;
    expect(tue.strengthBlocks).toHaveLength(2);
    expect(tue.strengthBlocks![0].movement).toBe("Back Squat");
    // A day with no blocks normalizes to null (not an empty array).
    const wed = out.days.find((d) => d.day === "Wed")!;
    expect(wed.strengthBlocks).toBeNull();
  });

  it("snaps a non-Monday start to the Monday on/before", () => {
    const plan: AiPlan = {
      summary: "s",
      name: "Recomp",
      goalKind: "recomp",
      startDate: "2026-05-06", // a Wednesday
      weeks: [cleanWeek(1)],
    };
    const out = materializeAiPlan(plan);
    expect(out.startDate).toBe(MON); // 2026-05-04, the Monday before
    expect(out.days[0].date).toBe(MON);
  });

  it("a recomp plan (no race) has a null marathonDate", () => {
    const plan: AiPlan = {
      summary: "s",
      name: "Recomp",
      goalKind: "recomp",
      startDate: MON,
      weeks: [cleanWeek(1), cleanWeek(2)],
    };
    expect(materializeAiPlan(plan).marathonDate).toBeNull();
  });
});

describe("runGuardrails — Phase 5 strength model", () => {
  const block = (
    movement: string,
    pattern: MovementPattern,
    over: Partial<AiStrengthBlock> = {},
  ): AiStrengthBlock => ({
    movement,
    pattern,
    sets: 3,
    reps: "8-10",
    loadType: "rir",
    loadValue: 2,
    ...over,
  });

  // A balanced training day with real blocks, fitting the SHORT window.
  function liftDay(dayName: AiDay["day"], blocks: AiStrengthBlock[]): AiDay {
    return day({ day: dayName, sessionType: "Lift", strengthMin: 40, cardioMin: 0, strengthBlocks: blocks });
  }

  function recompWeek(week: number, prog: number): AiWeek {
    // load climbs with `prog` so weeks differ (progression).
    return {
      week,
      phase: "Accumulation",
      days: [
        day({ day: "Mon", isRest: true, sessionType: "Rest", strengthMin: 0, equipmentList: [] }),
        liftDay("Tue", [
          block("Back Squat", "squat", { loadType: "percent_1rm", loadValue: 70 + prog }),
          block("Bench Press", "horizontal_push", { loadType: "percent_1rm", loadValue: 70 + prog }),
          block("Barbell Row", "horizontal_pull"),
          block("Plank", "core", { loadType: "bodyweight", loadValue: null }),
        ]),
        day({ day: "Wed", isRest: true, sessionType: "Rest", strengthMin: 0, equipmentList: [] }),
        liftDay("Thu", [
          block("Deadlift", "hinge", { loadType: "percent_1rm", loadValue: 70 + prog }),
          block("Overhead Press", "vertical_push"),
          block("Pull-up", "vertical_pull", { loadType: "bodyweight", loadValue: null }),
        ]),
        day({ day: "Fri", isRest: true, sessionType: "Rest", strengthMin: 0, equipmentList: [] }),
        day({ day: "Sat", isRest: true, sessionType: "Rest", strengthMin: 0, equipmentList: [] }),
        day({ day: "Sun", isRest: true, sessionType: "Rest", strengthMin: 0, equipmentList: [] }),
      ],
    };
  }

  it("passes a balanced, progressing strength plan with no strength findings", () => {
    const plan: AiPlan = {
      summary: "s",
      name: "Recomp",
      goalKind: "recomp",
      startDate: MON,
      weeks: [recompWeek(1, 0), recompWeek(2, 5)],
    };
    const codes = runGuardrails(plan, {}).map((g) => g.code);
    expect(codes).not.toContain("strength_day_no_blocks");
    expect(codes).not.toContain("weekly_movement_imbalance");
    expect(codes).not.toContain("no_progression");
    expect(codes).not.toContain("implausible_block");
  });

  it("flags a lifting day that has minutes but no blocks (new-model plan)", () => {
    const w = recompWeek(1, 0);
    // Strip blocks off Tue but keep the lifting minutes.
    w.days[1] = day({ day: "Tue", sessionType: "Lift", strengthMin: 40 });
    const plan: AiPlan = { summary: "s", name: "x", goalKind: "recomp", startDate: MON, weeks: [w, recompWeek(2, 5)] };
    expect(runGuardrails(plan, {}).map((g) => g.code)).toContain("strength_day_no_blocks");
  });

  it("flags an all-push week (no pull / no legs)", () => {
    const pushOnly: AiWeek = {
      week: 1,
      phase: "Accumulation",
      days: [
        day({ day: "Mon", isRest: true, sessionType: "Rest", strengthMin: 0, equipmentList: [] }),
        liftDay("Tue", [
          block("Bench Press", "horizontal_push"),
          block("Incline Press", "horizontal_push"),
          block("Overhead Press", "vertical_push"),
          block("Triceps Press", "horizontal_push"),
        ]),
        day({ day: "Wed", isRest: true, sessionType: "Rest", strengthMin: 0, equipmentList: [] }),
        day({ day: "Thu", isRest: true, sessionType: "Rest", strengthMin: 0, equipmentList: [] }),
        day({ day: "Fri", isRest: true, sessionType: "Rest", strengthMin: 0, equipmentList: [] }),
        day({ day: "Sat", isRest: true, sessionType: "Rest", strengthMin: 0, equipmentList: [] }),
        day({ day: "Sun", isRest: true, sessionType: "Rest", strengthMin: 0, equipmentList: [] }),
      ],
    };
    const plan: AiPlan = { summary: "s", name: "x", goalKind: "recomp", startDate: MON, weeks: [pushOnly] };
    expect(runGuardrails(plan, {}).map((g) => g.code)).toContain("weekly_movement_imbalance");
  });

  it("flags identical weeks as no progression + absurd loads", () => {
    const plan: AiPlan = {
      summary: "s",
      name: "x",
      goalKind: "recomp",
      startDate: MON,
      weeks: [recompWeek(1, 0), recompWeek(1, 0)], // same prog -> identical
    };
    expect(runGuardrails(plan, {}).map((g) => g.code)).toContain("no_progression");

    const absurd = recompWeek(1, 0);
    absurd.days[1] = liftDay("Tue", [
      block("Back Squat", "squat", { sets: 30, loadType: "percent_1rm", loadValue: 250 }),
      block("Barbell Row", "horizontal_pull"),
      block("Deadlift", "hinge"),
      block("Plank", "core", { loadType: "bodyweight", loadValue: null }),
    ]);
    const plan2: AiPlan = { summary: "s", name: "x", goalKind: "recomp", startDate: MON, weeks: [absurd, recompWeek(2, 5)] };
    expect(runGuardrails(plan2, {}).map((g) => g.code)).toContain("implausible_block");
  });

  it("leaves legacy minute-only plans alone (no strength findings)", () => {
    // No blocks anywhere -> the strength-model checks are skipped entirely.
    const plan: AiPlan = {
      summary: "s",
      name: "Legacy",
      raceKind: "10k",
      startDate: MON,
      weeks: [cleanWeek(1), cleanWeek(2)],
    };
    const codes = runGuardrails(plan, {}).map((g) => g.code);
    expect(codes).not.toContain("strength_day_no_blocks");
    expect(codes).not.toContain("weekly_movement_imbalance");
  });
});

describe("runGuardrails — lifting frequency (program days/week)", () => {
  const ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
  function weekWith(liftDays: string[]): AiWeek {
    return {
      week: 1,
      phase: "Accumulation",
      days: ORDER.map((dn) =>
        dn !== "Mon" && liftDays.includes(dn)
          ? day({ day: dn, sessionType: "Lift", strengthMin: 40 })
          : day({ day: dn, isRest: true, sessionType: "Rest", strengthMin: 0, equipmentList: [] }),
      ),
    };
  }
  // House of Volume = 4 days/week in the library.
  const anchored = (week: AiWeek): AiPlan => ({
    summary: "s",
    name: "x",
    goalKind: "recomp",
    tonalProgram: "House of Volume",
    startDate: MON,
    weeks: [week],
  });

  it("flags a week with MORE Tonal days than the program's frequency (the padding bug)", () => {
    const codes = runGuardrails(
      anchored(weekWith(["Tue", "Wed", "Thu", "Fri", "Sat", "Sun"])),
      {},
    ).map((g) => g.code);
    expect(codes).toContain("lifting_frequency_mismatch");
  });

  it("passes when the lifting-day count matches the program frequency (4)", () => {
    const codes = runGuardrails(
      anchored(weekWith(["Tue", "Thu", "Sat", "Sun"])),
      {},
    ).map((g) => g.code);
    expect(codes).not.toContain("lifting_frequency_mismatch");
  });

  it("does NOT count a conditioning-only day toward the lifting frequency", () => {
    const w = weekWith(["Tue", "Thu", "Sat", "Sun"]); // 4 lift days
    // Add a Bike conditioning day on Wed (no Tonal) — still 4 lifting days.
    w.days = w.days.map((d) =>
      d.day === "Wed"
        ? day({ day: "Wed", sessionType: "Conditioning", strengthMin: 0, cardioMin: 40, equipmentList: ["Peloton Bike"] })
        : d,
    );
    const codes = runGuardrails(anchored(w), {}).map((g) => g.code);
    expect(codes).not.toContain("lifting_frequency_mismatch");
  });

  it("ignores frequency when no program is anchored", () => {
    const w = weekWith(["Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    const plan: AiPlan = { summary: "s", name: "x", goalKind: "recomp", startDate: MON, weeks: [w] };
    expect(runGuardrails(plan, {}).map((g) => g.code)).not.toContain(
      "lifting_frequency_mismatch",
    );
  });

  it("honors an explicit client-stated frequency via opts", () => {
    const w = weekWith(["Tue", "Thu", "Sat", "Sun"]); // 4 lift days
    const plan: AiPlan = { summary: "s", name: "x", goalKind: "recomp", startDate: MON, weeks: [w] };
    // Client said 3 days/week — 4 scheduled should flag.
    expect(
      runGuardrails(plan, {}, { liftDaysPerWeek: 3 }).map((g) => g.code),
    ).toContain("lifting_frequency_mismatch");
  });
});

describe("planIncludesRunning — Phase 1 goalKind", () => {
  it("is false for a recomp plan with no raceKind set", () => {
    expect(planIncludesRunning({ goalKind: "recomp" })).toBe(false);
    expect(planIncludesRunning({ goalKind: "strength", raceKind: null })).toBe(false);
  });
  it("is true when goalKind is race", () => {
    expect(planIncludesRunning({ goalKind: "race", raceKind: "5k" })).toBe(true);
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

  it("flags Monday work, rest-with-work, over-budget, bad pace", () => {
    const plan: AiPlan = {
      summary: "s",
      name: "Dirty",
      raceKind: "none",
      startDate: "2026-05-05", // a Tuesday (no longer flagged — server snaps it)
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
    // start_not_monday was removed: startDate need not be a Monday; the server
    // snaps it to the Monday on/before, so a non-Monday start is not a finding.
    expect(codes.has("start_not_monday")).toBe(false);
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
