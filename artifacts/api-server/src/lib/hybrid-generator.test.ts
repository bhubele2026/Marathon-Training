// Permanent regression coverage for the custom-hybrid plan generator
// (Task #150). Locks in the contract that the slider-based hybrid
// builder honors:
//
//   - the `[hybrid-mix:<position>] [hybrid-days:<n>] [hybrid-level:<lvl>]`
//     sentinel format `hybridMixSpec` parses out of a Custom block's
//     customNotes,
//   - the canonical 7-day schedule per slider position (lift/run/rest
//     counts and the Sunday long-run preservation),
//   - days/week trim from 7 down to 3 for run-leaning blends keeps the
//     long run in place,
//   - mileage progression ramps monotonically across the block and
//     scales with fitness level (beginner < intermediate < advanced),
//   - `previewWeeklyMileage` matches the actual weekly miles emitted by
//     `generatePlanFromConfig` for hybrid blocks at every slider stop.
//
// Indirect coverage: `buildHybridWeekDays`, `pickHybridSchedule`,
// `hybridMileage`, and `countHybridRunsInSchedule` are not exported,
// so we exercise them through `generatePlanFromConfig` (Custom block
// + sentinel) and `previewWeeklyMileage` / `previewHybridWeek`.

import { describe, expect, it } from "vitest";
import {
  HYBRID_DEFAULT_DAYS_PER_WEEK,
  HYBRID_MAX_DAYS_PER_WEEK,
  HYBRID_MIN_DAYS_PER_WEEK,
  HYBRID_POSITIONS_ORDERED,
  generatePlanFromConfig,
  hybridMixSpec,
  previewHybridWeek,
  previewWeeklyMileage,
  type DailyRow,
  type HybridFitnessLevel,
  type HybridMixPosition,
  type PlannerConfig,
} from "@workspace/plan-generator";

// 2026-01-05 is a Monday. Hybrid block + auto-pinned 16-week
// Marathon-Specific tail completes the campaign on a Sunday so
// validation passes — same trick the primary-machine tests use.
function hybridBlockConfig(opts: {
  blockWeeks: number;
  position: HybridMixPosition;
  daysPerWeek?: number;
  level?: HybridFitnessLevel;
}): PlannerConfig {
  const { blockWeeks, position, daysPerWeek, level } = opts;
  const total = blockWeeks + 16;
  const startMs = Date.parse("2026-01-05T00:00:00Z");
  const endMs = startMs + (total * 7 - 1) * 86400000;
  const marathonDate = new Date(endMs).toISOString().slice(0, 10);
  const noteBits = [`[hybrid-mix:${position}]`];
  if (daysPerWeek != null) noteBits.push(`[hybrid-days:${daysPerWeek}]`);
  if (level != null) noteBits.push(`[hybrid-level:${level}]`);
  return {
    startDate: "2026-01-05",
    marathonDate,
    blocks: [
      {
        focusType: "Custom",
        weeks: blockWeeks,
        customName: "Hybrid Block",
        customNotes: noteBits.join(" "),
      },
    ],
  };
}

function hybridDaysOnly(blockWeeks: number, daily: DailyRow[]): DailyRow[] {
  return daily.filter((d) => d.week >= 1 && d.week <= blockWeeks);
}

// Categorize a day inside a hybrid block based on the canonical
// session_type values `buildHybridWeekDays` emits.
function classify(d: DailyRow): "rest" | "lift" | "run" {
  if (d.is_rest || d.session_type === "Rest") return "rest";
  if (
    d.session_type === "Strength" ||
    d.session_type === "Strength (Accessory)"
  ) {
    return "lift";
  }
  return "run";
}

describe("hybridMixSpec sentinel parser", () => {
  it("parses position + days + level when all sentinels are present", () => {
    expect(
      hybridMixSpec("[hybrid-mix:balanced] [hybrid-days:4] [hybrid-level:advanced]"),
    ).toEqual({
      position: "balanced",
      daysPerWeek: 4,
      level: "advanced",
    });
  });

  it("extracts sentinels even when wrapped in extra prose / customName brackets", () => {
    const merged =
      "Hybrid Block: 12 weeks; [hybrid-mix:run_primary] [hybrid-days:6] [hybrid-level:intermediate] runner-supplied notes";
    expect(hybridMixSpec(merged)).toEqual({
      position: "run_primary",
      daysPerWeek: 6,
      level: "intermediate",
    });
  });

  it("falls back to defaults when only the mix sentinel is present", () => {
    expect(hybridMixSpec("[hybrid-mix:lift_primary]")).toEqual({
      position: "lift_primary",
      daysPerWeek: HYBRID_DEFAULT_DAYS_PER_WEEK,
      level: "beginner",
    });
  });

  it("clamps daysPerWeek into the published [min,max] range", () => {
    expect(
      hybridMixSpec("[hybrid-mix:balanced] [hybrid-days:1]")?.daysPerWeek,
    ).toBe(HYBRID_MIN_DAYS_PER_WEEK);
    expect(
      hybridMixSpec("[hybrid-mix:balanced] [hybrid-days:99]")?.daysPerWeek,
    ).toBe(HYBRID_MAX_DAYS_PER_WEEK);
  });

  it("ignores unknown level values and falls back to beginner", () => {
    const spec = hybridMixSpec(
      "[hybrid-mix:balanced] [hybrid-days:5] [hybrid-level:elite]",
    );
    expect(spec?.level).toBe("beginner");
  });

  it("returns null for missing / blank / unrelated notes", () => {
    expect(hybridMixSpec(null)).toBeNull();
    expect(hybridMixSpec(undefined)).toBeNull();
    expect(hybridMixSpec("")).toBeNull();
    expect(hybridMixSpec("no sentinel here")).toBeNull();
    expect(hybridMixSpec("[primary-machine:bike] PZ Beginner")).toBeNull();
    expect(hybridMixSpec("[lift-primary:upper] Tonal block")).toBeNull();
  });

  it("returns null when the mix position is not one of the 5 published stops", () => {
    expect(hybridMixSpec("[hybrid-mix:moderate]")).toBeNull();
    expect(hybridMixSpec("[hybrid-mix:]")).toBeNull();
  });

  it("registers exactly the 5 ordered slider stops", () => {
    expect([...HYBRID_POSITIONS_ORDERED]).toEqual([
      "lift_primary",
      "lift_leaning",
      "balanced",
      "run_leaning",
      "run_primary",
    ]);
  });
});

describe("buildHybridWeekDays — canonical 7-day schedule per slider position", () => {
  // Expected (lift, run, rest) counts at the canonical schedule for
  // each slider stop with no days/week override (the schedule files
  // start with these counts; pickHybridSchedule trims/pads to match
  // the runner's pick).
  const expectedCanonical: Record<
    HybridMixPosition,
    { lifts: number; runs: number; rests: number; longRun: boolean }
  > = {
    lift_primary: { lifts: 4, runs: 1, rests: 2, longRun: false },
    lift_leaning: { lifts: 3, runs: 2, rests: 2, longRun: false },
    balanced: { lifts: 3, runs: 3, rests: 1, longRun: true },
    run_leaning: { lifts: 2, runs: 4, rests: 1, longRun: true },
    run_primary: { lifts: 2, runs: 4, rests: 1, longRun: true },
  };

  for (const position of HYBRID_POSITIONS_ORDERED) {
    it(`${position}: emits the expected lift/run/rest counts and Sunday long-run flag`, () => {
      // Pin daysPerWeek to the canonical session count so trim/pad
      // doesn't mutate the schedule for this assertion.
      const want = expectedCanonical[position];
      const cfg = hybridBlockConfig({
        blockWeeks: 8,
        position,
        daysPerWeek: want.lifts + want.runs,
      });
      const { daily } = generatePlanFromConfig(cfg);
      // Use week 1 (no cutbacks land there) for the canonical
      // schedule shape — same dispatch path as every other week,
      // just with full-volume mileage so the runs are easy to
      // identify.
      const weekOne = hybridDaysOnly(8, daily).filter((d) => d.week === 1);
      expect(weekOne, "exactly 7 days for week 1").toHaveLength(7);

      let lifts = 0;
      let runs = 0;
      let rests = 0;
      for (const d of weekOne) {
        const k = classify(d);
        if (k === "lift") lifts += 1;
        else if (k === "run") runs += 1;
        else rests += 1;
      }
      expect({ lifts, runs, rests }).toEqual({
        lifts: want.lifts,
        runs: want.runs,
        rests: want.rests,
      });

      // Sunday long-run preservation: positions that have a long run
      // in the canonical schedule must place it on Sunday with a
      // session_type of "Long Run" and a non-zero distance_mi.
      const sun = weekOne.find((d) => d.day === "Sun")!;
      if (want.longRun) {
        expect(sun.session_type, `${position} Sun session_type`).toBe(
          "Long Run",
        );
        expect(sun.distance_mi, `${position} Sun distance`).toBeGreaterThan(0);
        expect(sun.run_min, `${position} Sun run_min`).toBeGreaterThan(0);
      } else {
        expect(sun.session_type, `${position} Sun session_type`).not.toBe(
          "Long Run",
        );
      }
    });
  }
});

describe("pickHybridSchedule — days/week trim preserves the long run on run-leaning blends", () => {
  // For balanced / run_leaning / run_primary the canonical schedules
  // place the long run on Sunday. As the runner trims days/week
  // (7 → 6 → 5 → 4 → 3) the trim priority must keep the long run
  // intact every step of the way.
  const longRunPositions: HybridMixPosition[] = [
    "balanced",
    "run_leaning",
    "run_primary",
  ];

  for (const position of longRunPositions) {
    it(`${position}: long run survives when trimming from 7 → 3 days/week`, () => {
      for (let days = 7; days >= 3; days--) {
        const cfg = hybridBlockConfig({
          blockWeeks: 8,
          position,
          daysPerWeek: days,
        });
        const { daily } = generatePlanFromConfig(cfg);
        const weekOne = hybridDaysOnly(8, daily).filter((d) => d.week === 1);
        const sessionCount = weekOne.filter((d) => !d.is_rest).length;
        expect(sessionCount, `${position} @ ${days} days/week sessions`).toBe(
          days,
        );
        const sun = weekOne.find((d) => d.day === "Sun")!;
        expect(
          sun.session_type,
          `${position} @ ${days} days/week Sun session_type`,
        ).toBe("Long Run");
        expect(
          sun.distance_mi,
          `${position} @ ${days} days/week Sun distance`,
        ).toBeGreaterThan(0);
      }
    });
  }

  it("lift_primary trims by dropping a lift day (no long run to preserve)", () => {
    // lift_primary canonical = 4 lifts + 1 run = 5 sessions. Trim
    // to 4 days/week and confirm the dropped day is a lift (not the
    // sole easy run) — the lift_primary position has no long run
    // so the keepLong rule does not apply.
    const cfg = hybridBlockConfig({
      blockWeeks: 8,
      position: "lift_primary",
      daysPerWeek: 4,
    });
    const { daily } = generatePlanFromConfig(cfg);
    const weekOne = hybridDaysOnly(8, daily).filter((d) => d.week === 1);
    const lifts = weekOne.filter((d) => classify(d) === "lift").length;
    const runs = weekOne.filter((d) => classify(d) === "run").length;
    expect(lifts).toBe(3);
    expect(runs).toBe(1);
  });

  it("pads to 7 days/week by adding easy runs on otherwise-rest days", () => {
    // run_primary canonical = 6 sessions. Pad to 7 should add one
    // easy run; the long run on Sunday must remain a long run.
    const cfg = hybridBlockConfig({
      blockWeeks: 8,
      position: "run_primary",
      daysPerWeek: 7,
    });
    const { daily } = generatePlanFromConfig(cfg);
    const weekOne = hybridDaysOnly(8, daily).filter((d) => d.week === 1);
    expect(weekOne.filter((d) => d.is_rest)).toHaveLength(0);
    const sun = weekOne.find((d) => d.day === "Sun")!;
    expect(sun.session_type).toBe("Long Run");
  });
});

describe("hybridMileage — ramps monotonically and scales with fitness level", () => {
  const blockWeeks = 12;

  // Use previewHybridWeek (the published read-only preview) to read
  // the mileage values per week-in-block without re-implementing the
  // underlying ramp formula in the test.
  function totalMiles(
    position: HybridMixPosition,
    level: HybridFitnessLevel,
    weekInBlock: number,
  ): number {
    return previewHybridWeek(
      { position, daysPerWeek: 5, level },
      { weekInBlock, blockWeeks },
    ).totals.miles;
  }

  it("non-cutback weeks ramp monotonically (>=) for run-leaning positions", () => {
    for (const position of [
      "balanced",
      "run_leaning",
      "run_primary",
    ] as HybridMixPosition[]) {
      let prev = -Infinity;
      for (let w = 1; w <= blockWeeks; w++) {
        // Cutbacks land every 4th week-in-block (weekInBlock % 4 === 0).
        if (w % 4 === 0) continue;
        const miles = totalMiles(position, "intermediate", w);
        expect(
          miles,
          `${position} non-cutback week ${w} miles (>= prev ${prev})`,
        ).toBeGreaterThanOrEqual(prev);
        prev = miles;
      }
    }
  });

  it("cutback weeks shave volume vs the prior non-cutback week", () => {
    // Week 4 is a cutback in a 12-week block; week 3 is the prior
    // ramp week. Cutback factor is 0.7 in hybridMileage so week 4
    // must be strictly less than week 3 for run-leaning blends
    // (the rest of the runs all share the same week-3 ramp).
    for (const position of [
      "balanced",
      "run_leaning",
      "run_primary",
    ] as HybridMixPosition[]) {
      const w3 = totalMiles(position, "intermediate", 3);
      const w4 = totalMiles(position, "intermediate", 4);
      expect(w4, `${position} cutback week 4 < non-cutback week 3`).toBeLessThan(
        w3,
      );
    }
  });

  it("advanced > intermediate > beginner mileage at the same week-in-block", () => {
    // Week 6 of a 12-week block: well past the start so the level
    // scalar is the dominant input. Compare for every position that
    // generates non-zero mileage.
    for (const position of HYBRID_POSITIONS_ORDERED) {
      const beg = totalMiles(position, "beginner", 6);
      const inter = totalMiles(position, "intermediate", 6);
      const adv = totalMiles(position, "advanced", 6);
      expect(beg, `${position} beg < inter`).toBeLessThan(inter);
      expect(inter, `${position} inter < adv`).toBeLessThan(adv);
    }
  });

  it("run_primary peaks higher than lift_primary (per published peak miles)", () => {
    // Final non-cutback week of a 12-week block — week 11 (week 12
    // is also non-cutback because % 4 !== 0, but week 11 is fine to
    // demonstrate the ranking holds at the upper tail of the ramp).
    const liftPrimary = totalMiles("lift_primary", "intermediate", 11);
    const runPrimary = totalMiles("run_primary", "intermediate", 11);
    expect(runPrimary).toBeGreaterThan(liftPrimary);
  });
});

describe("previewWeeklyMileage matches generatePlanFromConfig for hybrid blocks", () => {
  // Iterate every slider position with the default 5 days/week and
  // intermediate level — the same shape the builder card produces
  // when a runner first lands on it. Confirms the Phase Planner
  // sparkline mirrors what the generator emits at apply-time.
  for (const position of HYBRID_POSITIONS_ORDERED) {
    it(`${position}: preview totalMi == weekly.planned_miles for every week`, () => {
      const blockWeeks = 8;
      const cfg = hybridBlockConfig({
        blockWeeks,
        position,
        daysPerWeek: 5,
        level: "intermediate",
      });
      const generated = generatePlanFromConfig(cfg);
      const preview = previewWeeklyMileage(cfg.blocks, {
        appendMarathonTail: true,
      });
      // Preview length lines up with full plan length (block + tail).
      expect(preview.length).toBe(generated.weekly.length);

      for (let i = 0; i < blockWeeks; i++) {
        const p = preview[i]!;
        const w = generated.weekly[i]!;
        // planned_miles is r1-rounded inside the daily generator; the
        // preview sums already-r1 mileage values so a 0.1 mi spread
        // can appear on weeks where the run counts are >1. Allow a
        // 0.2 mi tolerance to absorb that without masking real drift.
        expect(
          Math.abs(p.totalMi - w.planned_miles),
          `${position} week ${p.week}: preview ${p.totalMi} vs planned ${w.planned_miles}`,
        ).toBeLessThanOrEqual(0.2);
      }
    });
  }

  it("respects days/week when scaling preview mileage (run_primary 7 vs 3 days/week)", () => {
    const blockWeeks = 8;
    const fullCfg = hybridBlockConfig({
      blockWeeks,
      position: "run_primary",
      daysPerWeek: 7,
      level: "intermediate",
    });
    const trimCfg = hybridBlockConfig({
      blockWeeks,
      position: "run_primary",
      daysPerWeek: 3,
      level: "intermediate",
    });
    const fullPreview = previewWeeklyMileage(fullCfg.blocks, {
      appendMarathonTail: false,
    }).slice(0, blockWeeks);
    const trimPreview = previewWeeklyMileage(trimCfg.blocks, {
      appendMarathonTail: false,
    }).slice(0, blockWeeks);
    const fullTotal = fullPreview.reduce((s, w) => s + w.totalMi, 0);
    const trimTotal = trimPreview.reduce((s, w) => s + w.totalMi, 0);
    // Trimming from 7 → 3 days/week drops easy run slots, so total
    // mileage MUST drop too (the long run alone can't make up the
    // difference once 3+ easy / quality slots are removed).
    expect(trimTotal).toBeLessThan(fullTotal);
  });

  it("lift_primary preview mileage stays low (peak easy ~2.5 mi, no long run)", () => {
    // Lift-primary at default 5 days/week emits one easy run per
    // week, capped at ~2.5mi * 1.0 (intermediate) at peak. Total
    // weekly preview miles for an 8-week block must stay under a
    // generous 3 mi/week ceiling so the curve never accidentally
    // matches a run-primary block.
    const cfg = hybridBlockConfig({
      blockWeeks: 8,
      position: "lift_primary",
      daysPerWeek: 5,
      level: "intermediate",
    });
    const preview = previewWeeklyMileage(cfg.blocks, {
      appendMarathonTail: false,
    });
    for (const wk of preview) {
      expect(wk.totalMi, `week ${wk.week}`).toBeLessThanOrEqual(3);
    }
  });
});
