// Asserts that `previewWeeklyMileage` agrees with `generatePlanFromConfig`
// on `weekly.planned_miles` and `long_run_mi` for every focus type. The
// preview helper drives the Phase Planner sparklines / mileage curve, so
// any drift between preview and actual generation would mislead runners
// when they compare configurations before clicking Apply.

import { describe, expect, it } from "vitest";
import {
  expandEntriesToBlocksWithGaps,
  FOCUS_TYPES,
  generatePlanFromConfig,
  previewWeeklyMileage,
  type FocusType,
  type PhaseBlock,
  type TemplateEntry,
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

  // Task #179: entries-mode (templates own their own taper / race week —
  // NO auto-pinned 16w Marathon-Specific tail) is the second planner
  // mode and has its own preview path. The Phase Planner sparkline
  // renders `previewWeeklyMileage(expandedBlocks, { appendMarathonTail:
  // false })`, while Apply runs `generatePlanFromConfig(config)` with
  // `entries: [...]`. Task #176 pinned parity for the legacy
  // blocks-only path; this case mirrors that defense for entries-mode
  // so a future tweak to a template recipe (or to
  // `expandEntriesToBlocksWithGaps`) can't silently drift the
  // sparkline from what Apply produces.
  //
  // Race-week note: in entries-mode `previewWeeklyMileage` is called
  // with `appendMarathonTail: false` (templates own their own taper),
  // so the preview never substitutes the 26.2 mi marathon long run on
  // the campaign-final week — it just runs the trailing block's
  // recipe through to the end. `generatePlanFromConfig` still treats
  // `weekNumber === totalWeeks` as race day and overrides Sun's long
  // run with `MARATHON_DISTANCE_MI`. That campaign-final override is a
  // generator-side contract for marathon-mode entries plans (which
  // always END on a marathon Sunday), so we assert strict per-week
  // parity for weeks 1..N-1 and document the race-week override
  // separately. Future drift in any other week — or a change to the
  // race-week override itself — will fail loudly here.
  it("agrees on planned_miles + long_run_mi for an entries-mode template plan", () => {
    // Mon 2026-05-04 → Sun 2026-06-28 is exactly 8 weeks: a vanilla
    // Higdon Novice 5K run at its `defaultWeeks` of 8. The template
    // owns its own taper (Base + Taper expansion) — NO auto-pinned
    // 16w Marathon-Specific tail is appended in entries-mode.
    const entries: TemplateEntry[] = [
      {
        templateId: "higdon_5k_novice",
        weeks: 8,
        customName: null,
        customNotes: null,
      },
    ];
    const expandedBlocks = expandEntriesToBlocksWithGaps(
      entries,
      "2026-05-04",
    );
    const config = {
      startDate: "2026-05-04",
      marathonDate: "2026-06-28",
      blocks: expandedBlocks,
      entries,
    };
    const preview = previewWeeklyMileage(expandedBlocks, {
      appendMarathonTail: false,
    });
    const generated = generatePlanFromConfig(config);
    expect(preview.length).toBe(8);
    expect(generated.weekly.length).toBe(8);
    // Sanity: the template's tail block actually rolled through (drives
    // the Taper recipe on the final week, not the auto-pinned
    // Marathon-Specific tail).
    expect(preview[preview.length - 1]!.focusType).toBe("Taper");
    expect(generated.weekly[generated.weekly.length - 1]!.phase).toBe(
      "Taper",
    );
    // Strict per-week parity for every non-race week. The preview
    // helper's recipe-driven mileage MUST match exactly what the
    // generator's `buildWeekDays` pipeline emits via the same recipe.
    // Any future tweak to a template recipe (or to
    // `expandEntriesToBlocksWithGaps`) that changes one but not the
    // other will fail this assertion.
    for (let i = 0; i < preview.length - 1; i++) {
      const p = preview[i]!;
      const g = generated.weekly[i]!;
      expect(p.week).toBe(g.week);
      expect(p.totalMi).toBe(g.planned_miles);
      expect(p.longRunMi).toBe(g.long_run_mi);
    }
    // Campaign-final race-week override: pin BOTH sides so a future
    // change to either the preview's race-week handling or the
    // generator's `isRaceWeek` substitution surfaces here. Today the
    // preview runs the trailing block's recipe straight through (no
    // marathon substitution because `appendMarathonTail: false`) while
    // the generator overrides Sun's long run with the 26.2 mi marathon
    // and rolls Wed/Fri easy + sharpener miles in alongside it.
    const lastPreview = preview[preview.length - 1]!;
    const lastGenerated = generated.weekly[generated.weekly.length - 1]!;
    expect(lastPreview.week).toBe(lastGenerated.week);
    // Preview side: trailing Taper block, week 1 of 1 → recipe formulas
    // give long=10, easy=3, quality=3 (totalMi 16). NO marathon
    // substitution.
    expect(lastPreview.longRunMi).toBe(10);
    expect(lastPreview.totalMi).toBe(16);
    // Generator side: race-week override pins Sun to the 26.2 mi
    // marathon and Wed/Fri keep their Taper-recipe easy + sharpener
    // miles (3 + 3) → 32.2 mi planned, long_run 26.2.
    expect(lastGenerated.long_run_mi).toBe(26.2);
    expect(lastGenerated.planned_miles).toBe(32.2);
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
