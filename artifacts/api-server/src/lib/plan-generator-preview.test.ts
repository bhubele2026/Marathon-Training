// Asserts that `previewWeeklyMileage` agrees with `generatePlanFromConfig`
// on `weekly.planned_miles` and `long_run_mi` for every focus type. The
// preview helper drives the Phase Planner sparklines / mileage curve, so
// any drift between preview and actual generation would mislead runners
// when they compare configurations before clicking Apply.

import { describe, expect, it } from "vitest";
import {
  FOCUS_TYPES,
  generatePlanFromConfig,
  previewWeeklyMileage,
  type FocusType,
  type PhaseBlock,
} from "@workspace/plan-generator";

// 36 user-block weeks + 16-week Marathon-Specific tail = 52 weeks total.
// startDate Mon 2026-05-04 → marathonDate Sun 2027-05-02 spans exactly 52
// weeks, lining up with the canonical campaign window.
const START = "2026-05-04";
const RACE = "2027-05-02";

function configFor(focus: FocusType): {
  blocks: PhaseBlock[];
  startDate: string;
  marathonDate: string;
} {
  const block: PhaseBlock = {
    focusType: focus,
    weeks: 36,
    customName: focus === "Custom" ? "Custom Block" : null,
    customNotes: null,
  };
  return { blocks: [block], startDate: START, marathonDate: RACE };
}

describe("previewWeeklyMileage matches generatePlanFromConfig", () => {
  for (const focus of FOCUS_TYPES) {
    if (focus === "Marathon-Specific") continue; // tail is appended automatically
    it(`agrees on planned_miles + long_run_mi for ${focus}`, () => {
      const config = configFor(focus);
      const preview = previewWeeklyMileage(config.blocks, {
        appendMarathonTail: true,
      });
      const generated = generatePlanFromConfig(config);
      expect(preview.length).toBe(generated.weekly.length);
      for (let i = 0; i < preview.length; i++) {
        const p = preview[i]!;
        const g = generated.weekly[i]!;
        expect(p.week).toBe(g.week);
        // planned_miles uses 1-decimal rounding in the generator; preview
        // does the same. Equality (not approx) is the contract.
        expect(p.totalMi).toBe(g.planned_miles);
        expect(p.longRunMi).toBe(g.long_run_mi);
      }
    });
  }

  it("Recovery weeks set qualityMi to 0 (Friday becomes a rest day)", () => {
    const preview = previewWeeklyMileage(
      [
        { focusType: "Recovery", weeks: 4, customName: null, customNotes: null },
      ],
      { appendMarathonTail: false },
    );
    expect(preview.length).toBe(4);
    for (const w of preview) {
      expect(w.qualityMi).toBe(0);
      // Recovery recipe: easy=2, long=4 → total=6.
      expect(w.totalMi).toBe(6);
    }
  });

  it("appends the auto-pinned 16-week Marathon-Specific tail by default", () => {
    const preview = previewWeeklyMileage([
      { focusType: "Base", weeks: 4, customName: null, customNotes: null },
    ]);
    expect(preview.length).toBe(20);
    expect(preview[preview.length - 1]!.focusType).toBe("Marathon-Specific");
    expect(preview[preview.length - 1]!.isRaceWeek).toBe(true);
    // Race week long-run == 26.2 mi marathon.
    expect(preview[preview.length - 1]!.longRunMi).toBe(26.2);
  });

  // Task #176: the user-block parity loop above explicitly skips
  // Marathon-Specific (it's the auto-pinned tail, not a user-pickable
  // focus). Task #172 changed Wed pace + session_type inside the tail
  // without touching distance, but a future regression that *does* tweak
  // the Wed mileage formula in the generator without mirroring it in the
  // preview helper would silently desync the Phase Planner sparkline /
  // mileage curve from what Apply produces. Pin parity for the
  // auto-pinned tail directly with an empty-blocks 16-week config so any
  // such drift fails loudly.
  it("agrees on planned_miles + long_run_mi for the auto-pinned Marathon-Specific tail", () => {
    // Mon 2026-05-04 → Sun 2026-08-23 is exactly 16 weeks: the entire
    // span is the auto-pinned Marathon-Specific tail (sum of user
    // blocks must equal totalWeeks - 16 = 0).
    const config = {
      blocks: [] as PhaseBlock[],
      startDate: "2026-05-04",
      marathonDate: "2026-08-23",
    };
    const preview = previewWeeklyMileage(config.blocks, {
      appendMarathonTail: true,
    });
    const generated = generatePlanFromConfig(config);
    expect(preview.length).toBe(16);
    expect(generated.weekly.length).toBe(16);
    for (let i = 0; i < preview.length; i++) {
      const p = preview[i]!;
      const g = generated.weekly[i]!;
      expect(p.week).toBe(g.week);
      // Every week in this config is the auto-pinned tail.
      expect(p.focusType).toBe("Marathon-Specific");
      expect(g.phase).toBe("Marathon-Specific");
      expect(p.totalMi).toBe(g.planned_miles);
      expect(p.longRunMi).toBe(g.long_run_mi);
    }
    // Sanity: the final week is the race week with the 26.2 mi marathon.
    expect(preview[preview.length - 1]!.isRaceWeek).toBe(true);
    expect(preview[preview.length - 1]!.longRunMi).toBe(26.2);
  });
});

describe("previewWeeklyMileage exposes wedSteady matching the generator (task #175)", () => {
  // The plan calendar week strip and the Phase Planner sparklines both
  // surface an amber-400 Z3 "Steady" marker on the same weeks the
  // generator emits a Steady Run + Accessory Wed. Source-of-truth for
  // both surfaces is `WeekMileagePreview.wedSteady`, so it must agree
  // exactly with `daily[i].session_type === "Steady Run + Accessory"`
  // on the corresponding Wed row from `generatePlanFromConfig`. Any
  // drift would mislead runners about which weeks earn the Z3 stimulus.
  it("flags the Marathon-Specific tail's non-cutback / non-race-week Weds as steady", () => {
    // 4-week Base block + 16-week auto-pinned Marathon-Specific tail.
    const cfg = configFor("Base");
    const preview = previewWeeklyMileage(cfg.blocks, {
      appendMarathonTail: true,
    });
    const generated = generatePlanFromConfig(cfg);

    // The 4-week Base block uses the easy Wed recipe — every preview
    // entry inside that block must report wedSteady=false.
    for (const w of preview.filter((p) => p.focusType === "Base")) {
      expect(w.wedSteady, `base w${w.week}`).toBe(false);
    }

    // Every Marathon-Specific tail week's wedSteady must match the
    // actual `session_type` the generator wrote for that week's Wed.
    const tail = preview.filter((p) => p.focusType === "Marathon-Specific");
    expect(tail.length).toBeGreaterThan(0);
    for (const w of tail) {
      const wed = generated.daily.find(
        (d) => d.week === w.week && d.day === "Wed",
      );
      expect(wed, `w${w.week} wed row`).toBeDefined();
      const expected = wed!.session_type === "Steady Run + Accessory";
      expect(w.wedSteady, `w${w.week}`).toBe(expected);
    }

    // Sanity: at least one cutback week (every 4th, weekInBlock=4/8/12)
    // and the trailing race week (weekInBlock=16) must report false so
    // the rule isn't accidentally always-true on the tail.
    const tailRaceWeek = tail.find((w) => w.isRaceWeek);
    expect(tailRaceWeek?.wedSteady).toBe(false);
    const tailCutback = tail.find((w) => w.isCutback);
    expect(tailCutback?.wedSteady).toBe(false);
    // And at least one non-cutback non-race week must be steady so we
    // know the chip will actually fire on the calendar.
    expect(tail.some((w) => w.wedSteady)).toBe(true);
  });

  it("never flags Base / Time on Feet / Speed / Recovery weeks as steady", () => {
    // Recipes without `wedKind: "Steady"` must always report false.
    for (const focus of ["Base", "Time on Feet", "Speed"] as const) {
      const cfg = configFor(focus);
      const preview = previewWeeklyMileage(cfg.blocks, {
        appendMarathonTail: false,
      });
      for (const w of preview) {
        expect(w.wedSteady, `${focus} w${w.week}`).toBe(false);
      }
    }
    // Recovery doesn't even emit a Friday quality day, but its Wed is
    // also easy — verify wedSteady stays false there too.
    const recovery = previewWeeklyMileage(
      [{ focusType: "Recovery", weeks: 4, customName: null, customNotes: null }],
      { appendMarathonTail: false },
    );
    for (const w of recovery) {
      expect(w.wedSteady).toBe(false);
    }
  });
});
