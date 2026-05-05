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
  RACE_DAY_SPECS,
  expandCustomHybrid,
  expandEntriesToBlocks,
  generatePlanFromConfig,
  getTemplateById,
  hybridMixSpec,
  hybridPhase,
  previewHybridWeek,
  previewWeeklyMileage,
  validatePlannerConfig,
  type DailyRow,
  type HybridFitnessLevel,
  type HybridMixPosition,
  type PhaseBlock,
  type PlanRaceKind,
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

// ---------------------------------------------------------------------
// Task #154 — phased custom_hybrid expansion (base / build / taper)
// ---------------------------------------------------------------------
// custom_hybrid plans now expand into mesocycles based on length:
//   - n <  12 weeks: single Custom block (legacy v1 layout)
//   - 12-15 weeks:   Hybrid Base + Hybrid Build
//   - n ≥  16 weeks: Hybrid Base + Hybrid Build + 2-week Hybrid Taper
// Each phase block carries a `[hybrid-phase:base|build|taper]` sentinel
// alongside the existing `[hybrid-mix:...]` sentinels. Mileage and lift
// load progress meaningfully across phases (build > base, taper < build,
// lift load 0.85x base / 1.0x build / 0.7x taper). Saved single-block
// hybrid campaigns (no phase sentinel) must continue to render with the
// v1 ramp.

describe("hybridPhase sentinel parser", () => {
  it("parses each of the three phase tokens", () => {
    expect(hybridPhase("[hybrid-phase:base]")).toBe("base");
    expect(hybridPhase("[hybrid-phase:build]")).toBe("build");
    expect(hybridPhase("[hybrid-phase:taper]")).toBe("taper");
  });

  it("extracts the phase tag when merged with other hybrid sentinels", () => {
    const merged =
      "[hybrid-phase:build]; [hybrid-mix:balanced] [hybrid-days:5] [hybrid-level:intermediate]";
    expect(hybridPhase(merged)).toBe("build");
  });

  it("returns null for missing / blank / unknown phase values", () => {
    expect(hybridPhase(null)).toBeNull();
    expect(hybridPhase(undefined)).toBeNull();
    expect(hybridPhase("")).toBeNull();
    expect(hybridPhase("[hybrid-mix:balanced]")).toBeNull();
    expect(hybridPhase("[hybrid-phase:peak]")).toBeNull();
    expect(hybridPhase("[hybrid-phase:]")).toBeNull();
  });
});

describe("expandCustomHybrid — phased mesocycle expansion", () => {
  it("short plans (< 12 weeks) expand to one Custom block with no phase tag", () => {
    for (const n of [1, 4, 8, 11]) {
      const blocks = expandCustomHybrid(n);
      expect(blocks, `${n} weeks → 1 block`).toHaveLength(1);
      const b = blocks[0]!;
      expect(b.focusType).toBe("Custom");
      expect(b.weeks).toBe(n);
      expect(b.customName).toBe("Custom Hybrid");
      // No phase sentinel = legacy v1 single-block ramp.
      expect(hybridPhase(b.customNotes ?? null)).toBeNull();
    }
  });

  it("medium plans (12-15 weeks) expand to base + build (no taper)", () => {
    for (const n of [12, 13, 14, 15]) {
      const blocks = expandCustomHybrid(n);
      expect(blocks, `${n} weeks → 2 blocks`).toHaveLength(2);
      expect(blocks.map((b) => b.customName)).toEqual([
        "Hybrid Base",
        "Hybrid Build",
      ]);
      expect(hybridPhase(blocks[0]!.customNotes ?? null)).toBe("base");
      expect(hybridPhase(blocks[1]!.customNotes ?? null)).toBe("build");
      // No taper at this length.
      expect(blocks.find((b) => b.customName === "Hybrid Taper")).toBeUndefined();
    }
  });

  it("long plans (≥ 16 weeks) expand to base + build + 2-week taper", () => {
    for (const n of [16, 18, 20, 24]) {
      const blocks = expandCustomHybrid(n);
      expect(blocks, `${n} weeks → 3 blocks`).toHaveLength(3);
      expect(blocks.map((b) => b.customName)).toEqual([
        "Hybrid Base",
        "Hybrid Build",
        "Hybrid Taper",
      ]);
      expect(hybridPhase(blocks[0]!.customNotes ?? null)).toBe("base");
      expect(hybridPhase(blocks[1]!.customNotes ?? null)).toBe("build");
      expect(hybridPhase(blocks[2]!.customNotes ?? null)).toBe("taper");
      // Taper is always exactly 2 weeks.
      expect(blocks[2]!.weeks).toBe(2);
    }
  });

  it("week counts always sum back to the requested input n", () => {
    for (let n = 0; n <= 26; n++) {
      const blocks = expandCustomHybrid(n);
      const sum = blocks.reduce((s, b) => s + b.weeks, 0);
      expect(sum, `${n} weeks → blocks sum`).toBe(n);
    }
  });

  it("entry-merge stamps the mix sentinel onto every phase block", () => {
    // An entry-level custom_hybrid pick (the runner picks the slider
    // config once on the entry, not per-block). expandEntriesToBlocks
    // must merge the entry's customNotes into every phase block so
    // both the phase sentinel AND the mix sentinel are present on
    // each block — otherwise base/taper blocks would lose their mix
    // and fall back to the lift_primary defaults.
    const blocks = expandEntriesToBlocks([
      {
        templateId: "custom_hybrid",
        weeks: 18,
        customName: "My Hybrid Build",
        customNotes:
          "[hybrid-mix:balanced] [hybrid-days:5] [hybrid-level:intermediate]",
      },
    ]);
    expect(blocks).toHaveLength(3);
    // Block 0 takes the entry-level customName override; blocks 1+
    // keep their phase-default names so the runner can see the
    // periodization at a glance.
    expect(blocks[0]!.customName).toBe("My Hybrid Build");
    expect(blocks[1]!.customName).toBe("Hybrid Build");
    expect(blocks[2]!.customName).toBe("Hybrid Taper");
    for (const b of blocks) {
      const spec = hybridMixSpec(b.customNotes ?? null);
      expect(spec, `block ${b.customName} has mix spec`).not.toBeNull();
      expect(spec!.position).toBe("balanced");
      expect(spec!.daysPerWeek).toBe(5);
      expect(spec!.level).toBe("intermediate");
      // Phase sentinel survives the merge too.
      expect(hybridPhase(b.customNotes ?? null)).not.toBeNull();
    }
  });

  it("entry-merged custom_hybrid plan_weeks expose hybrid-phase mesocycle labels", () => {
    // Task #163: even when block 0's customName is overridden by the
    // entry-level label, the generated plan_weeks must still surface
    // "Hybrid Base" / "Hybrid Build" / "Hybrid Taper" as the phase so
    // the dashboard chip + /plan timeline group / color-band the
    // hybrid mesocycles distinctly. The phase label is derived from
    // the `[hybrid-phase:...]` sentinel that survives the entry merge.
    const entryBlocks = expandEntriesToBlocks([
      {
        templateId: "custom_hybrid",
        weeks: 18,
        customName: "My Hybrid Build",
        customNotes:
          "[hybrid-mix:balanced] [hybrid-days:5] [hybrid-level:intermediate]",
      },
    ]);
    expect(entryBlocks[0]!.customName).toBe("My Hybrid Build");
    // Feed those merged blocks through the generator in legacy
    // blocks-mode — same shape the server persists after entries-mode
    // expansion — and check what phase the plan_weeks rows end up with.
    const total = 18 + 16; // 18-week hybrid + 16-week marathon tail
    const startMs = Date.parse("2026-01-05T00:00:00Z");
    const endMs = startMs + (total * 7 - 1) * 86400000;
    const marathonDate = new Date(endMs).toISOString().slice(0, 10);
    const plan = generatePlanFromConfig({
      startDate: "2026-01-05",
      marathonDate,
      blocks: entryBlocks,
    });
    const phases = plan.weekly.slice(0, 18).map((w) => w.phase);
    // First chunk → Hybrid Base (NOT "My Hybrid Build"), then Build, then Taper.
    const distinct = Array.from(new Set(phases));
    expect(distinct).toEqual(["Hybrid Base", "Hybrid Build", "Hybrid Taper"]);
    // 18-week split: base = floor((18 - 2) / 2) = 8, build = 8, taper = 2
    expect(phases.filter((p) => p === "Hybrid Base")).toHaveLength(8);
    expect(phases.filter((p) => p === "Hybrid Build")).toHaveLength(8);
    expect(phases.filter((p) => p === "Hybrid Taper")).toHaveLength(2);
    // Per-day descriptions on the first block still carry the runner's
    // entry-level customName tag so the customSuffix isn't lost.
    const week1Days = plan.daily.filter((d) => d.week === 1);
    expect(week1Days.length).toBeGreaterThan(0);
    const tagged = week1Days.some((d) => d.description.includes("[My Hybrid Build"));
    expect(tagged).toBe(true);
  });

  it("custom_hybrid template's expand() routes through expandCustomHybrid", () => {
    // Template registry layer wires the phased expansion in. Pulling
    // the template by id and calling expand() must produce the same
    // shape as expandCustomHybrid directly.
    const tpl = getTemplateById("custom_hybrid");
    expect(tpl).not.toBeUndefined();
    expect(tpl!.expand(8)).toEqual(expandCustomHybrid(8));
    expect(tpl!.expand(12)).toEqual(expandCustomHybrid(12));
    expect(tpl!.expand(18)).toEqual(expandCustomHybrid(18));
  });
});

describe("hybridMileage phase ramp — build > base, taper < build at the same week", () => {
  // Use previewHybridWeek with the new `phase` opt to read mileage
  // values without having to plumb through generatePlanFromConfig. The
  // preview uses the same hybridMileage call the generator does, so any
  // drift would surface here first.
  function totals(opts: {
    position: HybridMixPosition;
    phase: "base" | "build" | "taper" | null;
    weekInBlock: number;
    blockWeeks: number;
  }): number {
    const p = previewHybridWeek(
      { position: opts.position, daysPerWeek: 5, level: "intermediate" },
      {
        weekInBlock: opts.weekInBlock,
        blockWeeks: opts.blockWeeks,
        phase: opts.phase,
      },
    );
    return p.totals.miles;
  }

  it("at week 1 of each phase: build mileage strictly exceeds base mileage", () => {
    // Week 1 (t=0): base starts at 1.5 mi per intensity, build starts
    // at 0.6 * peak. For every position whose 0.6*peak exceeds 1.5
    // (every position except lift_primary's tiny easy/quality peaks),
    // build's week-1 mileage must be greater than base's week-1.
    for (const position of [
      "lift_leaning",
      "balanced",
      "run_leaning",
      "run_primary",
    ] as HybridMixPosition[]) {
      const base = totals({ position, phase: "base", weekInBlock: 1, blockWeeks: 6 });
      const build = totals({ position, phase: "build", weekInBlock: 1, blockWeeks: 6 });
      expect(build, `${position} week 1 build > base`).toBeGreaterThan(base);
    }
  });

  it("at the final week of each phase: build peaks, taper drops below build peak", () => {
    // Final week of base ≈ 0.6 * peak; final week of build ≈ peak;
    // final week of taper ≈ 0.5 * peak. Build must outrun base, and
    // taper must finish below build.
    for (const position of [
      "balanced",
      "run_leaning",
      "run_primary",
    ] as HybridMixPosition[]) {
      const baseEnd = totals({ position, phase: "base", weekInBlock: 6, blockWeeks: 6 });
      const buildEnd = totals({ position, phase: "build", weekInBlock: 6, blockWeeks: 6 });
      const taperEnd = totals({ position, phase: "taper", weekInBlock: 2, blockWeeks: 2 });
      expect(buildEnd, `${position} build end > base end`).toBeGreaterThan(baseEnd);
      expect(taperEnd, `${position} taper end < build end`).toBeLessThan(buildEnd);
    }
  });

  it("null phase preserves the legacy single-block ramp", () => {
    // Same (position, level, weekInBlock, blockWeeks) with phase=null
    // must equal what previewHybridWeek emitted before Task #154 (no
    // opts.phase). The default opts.phase is null, so calling without
    // it and calling with `phase: null` must agree byte-for-byte.
    for (const position of HYBRID_POSITIONS_ORDERED) {
      for (const w of [1, 4, 8]) {
        const noPhase = previewHybridWeek(
          { position, daysPerWeek: 5, level: "intermediate" },
          { weekInBlock: w, blockWeeks: 8 },
        ).totals.miles;
        const explicitNull = previewHybridWeek(
          { position, daysPerWeek: 5, level: "intermediate" },
          { weekInBlock: w, blockWeeks: 8, phase: null },
        ).totals.miles;
        expect(explicitNull, `${position} week ${w}`).toBe(noPhase);
      }
    }
  });
});

// ---------------------------------------------------------------------
// Task #208 — race-week preview branch (Task #203) generator-level
// regression. Pins the contract that `previewHybridWeek` honors when
// called with `isRaceWeek: true`: the trailing Saturday is forced to a
// `race-prep` slot, the trailing Sunday is forced to a `race` slot at
// the matching `RACE_DAY_SPECS[raceKind].distanceMi`, totals.miles
// includes the race-day mileage, and the override is suppressed when
// `isRaceWeek` is false. Independent of the React UI test in Task #203
// so future refactors of `buildHybridWeekDays` (the runtime sibling
// the preview mirrors) cannot drift the preview without breaking a
// generator-level test.
describe("previewHybridWeek race-week branch — Sat race-prep, Sun race day", () => {
  // Use a balanced 5-day/week intermediate spec so the trailing Sat/Sun
  // slots are normally a lift / long-run pair — that way the override
  // visibly replaces real session content (not rest days).
  const baseSpec = {
    position: "balanced" as HybridMixPosition,
    daysPerWeek: 5,
    level: "intermediate" as HybridFitnessLevel,
  };

  // RACE_DAY_SPECS covers every non-"none" PlanRaceKind. Iterate them
  // all so a future race kind addition forces a deliberate test update
  // instead of silently skipping coverage.
  const raceKinds: Exclude<PlanRaceKind, "none">[] = [
    "marathon",
    "half",
    "10k",
    "5k",
  ];

  for (const raceKind of raceKinds) {
    it(`${raceKind}: trailing Sat → race-prep, Sun → race at ${RACE_DAY_SPECS[raceKind].distanceMi} mi`, () => {
      const preview = previewHybridWeek(baseSpec, {
        blockWeeks: 8,
        isRaceWeek: true,
        raceKind,
      });
      expect(preview.isRaceWeek).toBe(true);

      // HYBRID_DAY_LABELS goes Mon..Sun, so idx 5 = Sat, idx 6 = Sun.
      const sat = preview.slots[5]!;
      const sun = preview.slots[6]!;
      expect(sat.day).toBe("Sat");
      expect(sun.day).toBe("Sun");
      expect(sat.kind).toBe("race-prep");
      expect(sun.kind).toBe("race");

      // Sun race slot must carry the matching distance from RACE_DAY_SPECS,
      // not a generated easy/long-run mileage.
      if (sun.kind !== "race") throw new Error("expected race slot");
      expect(sun.miles).toBe(RACE_DAY_SPECS[raceKind].distanceMi);

      // Totals.miles must include the race distance (lower-bound: even
      // if every other slot was a rest, totals.miles is at least the
      // race day's distance). Real previews add easy-run mileage on
      // top, so use a `>=` assertion to stay robust to future schedule
      // tweaks while still catching a missing race-day contribution.
      expect(preview.totals.miles).toBeGreaterThanOrEqual(
        RACE_DAY_SPECS[raceKind].distanceMi,
      );
      // Race day counts as one of `runs` so the summary line stays
      // meaningful for the campaign-final week.
      expect(preview.totals.runs).toBeGreaterThanOrEqual(1);
    });
  }

  it("isRaceWeek: false suppresses the override (canonical typical-week shape)", () => {
    // Same spec, marathon raceKind, but isRaceWeek explicitly false.
    // Trailing Sat/Sun must NOT be race-prep / race — they fall back
    // to the schedule's normal slots (balanced 5d/wk lands a long run
    // on Sun) and `isRaceWeek` on the returned preview must be false.
    const preview = previewHybridWeek(baseSpec, {
      blockWeeks: 8,
      isRaceWeek: false,
      raceKind: "marathon",
    });
    expect(preview.isRaceWeek).toBe(false);
    for (const slot of preview.slots) {
      expect(slot.kind).not.toBe("race-prep");
      expect(slot.kind).not.toBe("race");
    }
    // Sunday is the long run for run-leaning blends — totals.miles
    // must therefore stay well below a marathon distance. (Pin a
    // generous ceiling that still rules out a stray race-day overlay.)
    expect(preview.totals.miles).toBeLessThan(
      RACE_DAY_SPECS.marathon.distanceMi,
    );
  });

  it("raceKind: 'none' suppresses the override even when isRaceWeek is true", () => {
    // The doc-string for opts.raceKind says "none" gates off the
    // override (mirrors `buildHybridWeekDays`'s race-week guard).
    // `previewHybridWeek` resolves `isRaceWeek` to false in this case
    // so the trailing Sat/Sun stay in their canonical schedule slots.
    const preview = previewHybridWeek(baseSpec, {
      blockWeeks: 8,
      isRaceWeek: true,
      raceKind: "none",
    });
    expect(preview.isRaceWeek).toBe(false);
    for (const slot of preview.slots) {
      expect(slot.kind).not.toBe("race-prep");
      expect(slot.kind).not.toBe("race");
    }
  });
});

describe("phased custom_hybrid generates progressing lift load + mileage", () => {
  // End-to-end: build a phased 18-week custom_hybrid plan and confirm
  // the daily rows the generator emits show the lift-load phase
  // scalar (base 0.85x, build 1.0x, taper 0.7x). This exercises the
  // full templates → expand → entry-merge → buildHybridWeekDays path.
  // Uses blocks-mode (the auto-pinned 16w Marathon-Specific tail is
  // appended by the validator) and seeds `blocks` with the result of
  // expandEntriesToBlocks([custom_hybrid, 18w]) so each phase block
  // already carries both the phase sentinel and the merged mix
  // sentinel, mirroring what the planner UI persists.
  function makePhasedConfig(): PlannerConfig {
    // 18-week hybrid + 16-week marathon-specific tail = 34 weeks.
    // Start on a Monday so the marathon lands on a Sunday.
    const total = 18 + 16;
    const startMs = Date.parse("2026-01-05T00:00:00Z");
    const endMs = startMs + (total * 7 - 1) * 86400000;
    const marathonDate = new Date(endMs).toISOString().slice(0, 10);
    const blocks = expandEntriesToBlocks([
      {
        templateId: "custom_hybrid",
        weeks: 18,
        customName: "Hybrid Build",
        customNotes:
          "[hybrid-mix:balanced] [hybrid-days:5] [hybrid-level:intermediate]",
      },
    ]);
    return {
      startDate: "2026-01-05",
      marathonDate,
      blocks,
    };
  }

  it("validates and regenerates without errors at 18 weeks", () => {
    const cfg = makePhasedConfig();
    const issues = validatePlannerConfig(cfg);
    // Hybrid 18w (3 phase blocks) + auto-pinned 16w marathon tail
    // covers the full campaign cleanly — no validation issues.
    expect(issues, `validate issues: ${JSON.stringify(issues)}`).toEqual([]);
    const { daily, weekly } = generatePlanFromConfig(cfg);
    expect(weekly.length).toBe(34);
    // 7 days per week, daily.length === weeks * 7
    expect(daily.length).toBe(34 * 7);
  });

  it("lift load follows the phase scalar (base ≈ 0.85x build, taper ≈ 0.7x build)", () => {
    const cfg = makePhasedConfig();
    const { daily } = generatePlanFromConfig(cfg);
    // Phase block boundaries for 18w hybrid: taper=2, remaining=16,
    // base=8, build=8 → base weeks 1-8, build weeks 9-16, taper
    // weeks 17-18. Pick a non-cutback week-in-block from each phase
    // (cutbacks land every 4th week-in-block) and grab the first
    // heavy lift day to compare loads.
    function firstHeavyLoad(weekNumber: number): number {
      const wkRows = daily.filter((d) => d.week === weekNumber);
      const heavy = wkRows.find((d) => d.session_type === "Strength");
      expect(
        heavy,
        `week ${weekNumber} has a heavy Strength day`,
      ).not.toBeUndefined();
      return heavy!.strength_load ?? 0;
    }
    // Week 3 is in base (weekInBlock 3, non-cutback).
    // Week 11 is in build (weekInBlock 3 of build block, non-cutback).
    // Week 17 is in taper (weekInBlock 1 of taper, non-cutback).
    const baseLoad = firstHeavyLoad(3);
    const buildLoad = firstHeavyLoad(11);
    const taperLoad = firstHeavyLoad(17);

    expect(baseLoad, "base load > 0").toBeGreaterThan(0);
    expect(buildLoad, "build load > base load").toBeGreaterThan(baseLoad);
    expect(taperLoad, "taper load < build load").toBeLessThan(buildLoad);
    // Approximate ratios — loads are rounded to whole pounds so allow
    // a +/- 1 lb slack on each side.
    expect(baseLoad).toBeGreaterThanOrEqual(Math.round(buildLoad * 0.85) - 1);
    expect(baseLoad).toBeLessThanOrEqual(Math.round(buildLoad * 0.85) + 1);
    expect(taperLoad).toBeGreaterThanOrEqual(Math.round(buildLoad * 0.7) - 1);
    expect(taperLoad).toBeLessThanOrEqual(Math.round(buildLoad * 0.7) + 1);
  });

  it("legacy single-block hybrid (no phase sentinel) still validates and regenerates", () => {
    // 8-week custom_hybrid → single Custom block, no phase. This is
    // the v1 layout that saved campaigns rely on; mileage and load
    // must use the original ramp (phaseLoadScalar = 1.0) so saved
    // plans regenerate identically to before Task #154.
    const cfg = hybridBlockConfig({
      blockWeeks: 8,
      position: "balanced",
      daysPerWeek: 5,
      level: "intermediate",
    });
    const issues = validatePlannerConfig(cfg);
    expect(issues, `validate issues: ${JSON.stringify(issues)}`).toEqual([]);
    const { daily, weekly } = generatePlanFromConfig(cfg);
    // 8w hybrid + 16w marathon tail = 24w.
    expect(weekly.length).toBe(24);
    // The single-block hybrid has no phase tag, so its first heavy
    // lift load must equal the v1 baseline (60 lb * intermediate
    // scalar 1.0 * cutFactor 1.0 = 60). Pull from week 1 to avoid
    // any cutback-week ambiguity.
    const wk1Heavy = daily.find(
      (d) => d.week === 1 && d.session_type === "Strength",
    );
    expect(wk1Heavy, "week 1 has a heavy Strength day").not.toBeUndefined();
    expect(wk1Heavy!.strength_load).toBe(60);
  });
});
