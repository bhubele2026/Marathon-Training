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
