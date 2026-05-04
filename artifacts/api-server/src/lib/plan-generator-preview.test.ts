// Asserts that `previewWeeklyMileage` agrees with `generatePlanFromConfig`
// on `weekly.planned_miles` and `long_run_mi` for every focus type. The
// preview helper drives the Phase Planner sparklines / mileage curve, so
// any drift between preview and actual generation would mislead runners
// when they compare configurations before clicking Apply.

import { describe, expect, it } from "vitest";
import {
  expandConfigToPlanRows,
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

  // Task #179 / Task #182: entries-mode (templates own their own
  // taper / race week — NO auto-pinned 16w Marathon-Specific tail) is
  // the second planner mode and has its own preview path. The Phase
  // Planner sparkline renders `previewWeeklyMileage(expandedBlocks,
  // { appendMarathonTail: false })`, while Apply runs
  // `generatePlanFromConfig(config)` with `entries: [...]`. Task #176
  // pinned parity for the legacy blocks-only path; this case mirrors
  // that defense for entries-mode so a future tweak to a template
  // recipe (or to `expandEntriesToBlocksWithGaps`) can't silently
  // drift the sparkline from what Apply produces.
  //
  // Race-week parity: Task #182 stopped `generatePlanFromConfig` from
  // forcing a 26.2 mi marathon onto the campaign-final Sunday in
  // entries-mode (the policy mirror of `appendMarathonTail:
  // !isEntriesMode && isMarathonMode` in the Phase Planner). For an
  // 8-week Higdon Novice 5K plan, both the preview and the generator
  // now run the trailing Taper block's recipe straight through to
  // race week — preview and Apply agree on every week's
  // planned_miles + long_run_mi. Strict per-week parity covers the
  // entire span (including the final week) so any future regression
  // that resurrects the marathon substitution outside marathon-mode —
  // or breaks it inside marathon-mode — fails loudly here.
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
    // Strict per-week parity for EVERY week, race week included. The
    // preview helper's recipe-driven mileage MUST match exactly what
    // the generator's `buildWeekDays` pipeline emits via the same
    // recipe. Any future tweak to a template recipe (or to
    // `expandEntriesToBlocksWithGaps`) — or any regression that
    // re-introduces the 26.2 mi marathon substitution on a 5K plan's
    // final Sunday — will fail this assertion.
    for (let i = 0; i < preview.length; i++) {
      const p = preview[i]!;
      const g = generated.weekly[i]!;
      expect(p.week).toBe(g.week);
      expect(p.totalMi).toBe(g.planned_miles);
      expect(p.longRunMi).toBe(g.long_run_mi);
    }
    // Pin the campaign-final week's expected values directly so a
    // future regression that drifts BOTH preview and generator in
    // lock-step (e.g. accidentally re-enabling marathon-substitution
    // on both sides) is still caught. Trailing Taper block, week 1 of
    // 1 → recipe formulas give long=10, easy=3, quality=3
    // (totalMi 16). NO marathon substitution on either side.
    const lastPreview = preview[preview.length - 1]!;
    const lastGenerated = generated.weekly[generated.weekly.length - 1]!;
    expect(lastPreview.longRunMi).toBe(10);
    expect(lastPreview.totalMi).toBe(16);
    expect(lastGenerated.long_run_mi).toBe(10);
    expect(lastGenerated.planned_miles).toBe(16);
  });

  // Task #184: an entries-mode plan whose LAST entry is a marathon
  // template (raceKind === "marathon") must still end on a real RACE
  // DAY Sunday — the trailing week's long-run jumps to the 26.2 mi
  // marathon distance and Saturday flips to "Race Prep". Task #182
  // suppressed marathon-substitution for ALL entries-mode plans so a
  // 5K Sunday wouldn't get a forced marathon, but that left runners
  // who picked the Pfitz 18w marathon template ending their plan on
  // the Taper recipe's natural ~4 mi long Sunday instead of the
  // 26.2 mi marathon they trained for. The fix re-enables the
  // campaign-final race-day branch ONLY when the last entry is a
  // marathon template.
  //
  // Strict per-week parity (preview vs generator) covers the entire
  // span — including the race week — so any future regression that
  // either suppresses marathon-substitution again on marathon
  // entries plans, or accidentally re-introduces it on non-marathon
  // entries plans (covered by the 5K case above), fails loudly.
  it("ends an entries-mode marathon plan on a 26.2 mi RACE DAY Sunday", () => {
    // Mon 2026-05-04 → Sun 2026-09-06 is exactly 18 weeks: a vanilla
    // Pfitz 18w marathon template at its `defaultWeeks` of 18.
    const entries: TemplateEntry[] = [
      {
        templateId: "marathon_pfitz_18_70",
        weeks: 18,
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
      marathonDate: "2026-09-06",
      blocks: expandedBlocks,
      entries,
    };
    const preview = previewWeeklyMileage(expandedBlocks, {
      appendMarathonTail: false,
      entriesEndOnMarathonRace: true,
    });
    const generated = generatePlanFromConfig(config);
    expect(preview.length).toBe(18);
    expect(generated.weekly.length).toBe(18);
    // Strict per-week parity for EVERY week, race week included. The
    // preview helper's recipe-driven mileage MUST match what the
    // generator's `buildWeekDays` pipeline emits via the same recipe.
    for (let i = 0; i < preview.length; i++) {
      const p = preview[i]!;
      const g = generated.weekly[i]!;
      expect(p.week).toBe(g.week);
      expect(p.totalMi).toBe(g.planned_miles);
      expect(p.longRunMi).toBe(g.long_run_mi);
    }
    // Pin the campaign-final week's race-day expectations directly.
    // Both preview and generator must agree on a 26.2 mi marathon
    // long-run on the trailing Sunday and flip `isRaceWeek` true.
    const lastPreview = preview[preview.length - 1]!;
    const lastGenerated = generated.weekly[generated.weekly.length - 1]!;
    expect(lastPreview.isRaceWeek).toBe(true);
    expect(lastPreview.longRunMi).toBe(26.2);
    expect(lastGenerated.long_run_mi).toBe(26.2);
    // The generator's daily rows expose the actual session_type chips
    // shown in the calendar — Sat must be "Race Prep" and Sun must
    // be "Race". Lock both directly so a future regression that
    // breaks the buildWeekDays race-day branch (or skips the Sat
    // override) also fails this test.
    const lastWeekDays = generated.daily.filter(
      (d) => d.week === lastGenerated.week,
    );
    const sat = lastWeekDays.find((d) => d.day === "Sat");
    const sun = lastWeekDays.find((d) => d.day === "Sun");
    expect(sat).toBeDefined();
    expect(sun).toBeDefined();
    expect(sat!.session_type).toBe("Race Prep");
    expect(sun!.session_type).toBe("Race");
  });

  // Task #192: an entries-mode plan whose LAST entry is a hybrid
  // marathon template (`marathon_hybrid` — raceKind === "marathon"
  // after #192 flips it from "none") must end on the SAME race-day
  // pattern as the recipe-driven Pfitz marathon above: trailing Sat
  // = "Race Prep", trailing Sun = 26.2 mi "Race". Before #192 the
  // hybrid pipeline (`buildHybridWeekDays`) ignored the `isRaceWeek`
  // flag entirely, so a marathon_hybrid plan ended on whatever its
  // schedule slotted for the trailing Sun (a hybrid long run, a
  // lift, or even rest depending on slider position) — runners who
  // chose the hybrid path trained for a marathon but never saw a
  // 26.2 mi RACE DAY on their calendar.
  //
  // Strict per-week parity (preview vs generator) covers the entire
  // span — including the race week — so any future regression that
  // either (a) drops the Sat/Sun race-week override in
  // `buildHybridWeekDays`, (b) flips `marathon_hybrid` raceKind back
  // to "none", or (c) breaks the race-week branch in
  // `previewWeeklyMileage`'s hybrid path fails loudly here.
  it("ends an entries-mode hybrid marathon plan on a 26.2 mi RACE DAY Sunday", () => {
    // Mon 2026-05-04 → Sun 2026-09-06 is exactly 18 weeks: a vanilla
    // marathon_hybrid template at its `defaultWeeks` of 18.
    const entries: TemplateEntry[] = [
      {
        templateId: "marathon_hybrid",
        weeks: 18,
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
      marathonDate: "2026-09-06",
      blocks: expandedBlocks,
      entries,
    };
    const preview = previewWeeklyMileage(expandedBlocks, {
      appendMarathonTail: false,
      entriesEndOnMarathonRace: true,
    });
    const generated = generatePlanFromConfig(config);
    expect(preview.length).toBe(18);
    expect(generated.weekly.length).toBe(18);
    // Strict per-week parity for EVERY week, race week included. The
    // preview helper's hybrid mileage MUST match what the generator's
    // `buildHybridWeekDays` pipeline emits via the same schedule.
    for (let i = 0; i < preview.length; i++) {
      const p = preview[i]!;
      const g = generated.weekly[i]!;
      expect(p.week).toBe(g.week);
      expect(p.totalMi).toBe(g.planned_miles);
      expect(p.longRunMi).toBe(g.long_run_mi);
    }
    // Pin the campaign-final week's race-day expectations directly.
    // Both preview and generator must agree on a 26.2 mi marathon
    // long-run on the trailing Sunday and flip `isRaceWeek` true.
    const lastPreview = preview[preview.length - 1]!;
    const lastGenerated = generated.weekly[generated.weekly.length - 1]!;
    expect(lastPreview.isRaceWeek).toBe(true);
    expect(lastPreview.longRunMi).toBe(26.2);
    expect(lastGenerated.long_run_mi).toBe(26.2);
    // The generator's daily rows expose the actual session_type chips
    // shown in the calendar — Sat must be "Race Prep" and Sun must
    // be "Race", regardless of what the hybrid schedule's canonical
    // Sat/Sun slot would have been (lift, run, or rest). Lock both
    // directly so a future regression that breaks the
    // `buildHybridWeekDays` race-week override (or drops it for one
    // of the two days) also fails this test.
    const lastWeekDays = generated.daily.filter(
      (d) => d.week === lastGenerated.week,
    );
    const sat = lastWeekDays.find((d) => d.day === "Sat");
    const sun = lastWeekDays.find((d) => d.day === "Sun");
    expect(sat).toBeDefined();
    expect(sun).toBeDefined();
    expect(sat!.session_type).toBe("Race Prep");
    expect(sun!.session_type).toBe("Race");
    // Pin the marathon distance and the absence of any run miles on
    // race-eve Saturday so a future regression that swaps the order
    // (Sat = marathon, Sun = race prep) or shrinks the marathon
    // distance also fails here.
    expect(sun!.distance_mi).toBe(26.2);
    expect(sat!.distance_mi).toBeNull();
    expect(sat!.run_min).toBe(0);
  });

  // Task #184 regression: a multi-entry campaign whose marathon entry
  // is NOT the trailing entry (e.g. a marathon followed by a recovery
  // 5K) must NOT inject a stray 26.2 mi RACE DAY Sunday at the
  // marathon entry's boundary. Only the campaign-final entry can earn
  // the race-day branch — and only if it's marathon-classified itself.
  //
  // The per-entry pipeline (`expandConfigToPlanRows` →
  // `generatePlanFromConfigPerEntry`) builds synthetic single-entry
  // configs for every entry, so without the
  // `endsOnMarathonRaceDayOverride: false` guard for non-final
  // entries, the synthetic marathon config would auto-classify itself
  // as ending on a marathon and inject a 26.2 mi Sunday at the
  // mid-campaign boundary. Pin both the absence of the mid-campaign
  // race day AND the absence of the campaign-final race day (since
  // the trailing entry here is a 5K, not a marathon).
  it("does NOT inject a mid-campaign race day when a marathon entry is followed by another entry", () => {
    // Pfitz 18w marathon (race date 2026-09-06) followed by a Higdon
    // Novice 5K starting the next week. Total span 18 + 8 = 26 weeks.
    const entries: TemplateEntry[] = [
      {
        templateId: "marathon_pfitz_18_70",
        weeks: 18,
        customName: null,
        customNotes: null,
      },
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
      // 26 weeks: Mon 2026-05-04 → Sun 2026-11-01.
      marathonDate: "2026-11-01",
      blocks: expandedBlocks,
      entries,
    };
    const { weekly, taggedDaily } = expandConfigToPlanRows(config);
    expect(weekly.length).toBe(26);
    // The marathon entry occupies weeks 1..18 — week 18's Sunday
    // would be the mid-campaign boundary if the gate fired
    // incorrectly. Pin its long-run mileage to the Pfitz template's
    // natural taper Sunday (NOT 26.2) and its session_type to the
    // recipe's normal long-run session, NOT "Race".
    const marathonBoundaryWeek = weekly.find((w) => w.week === 18)!;
    expect(marathonBoundaryWeek).toBeDefined();
    expect(marathonBoundaryWeek.long_run_mi).not.toBe(26.2);
    const week18Sun = taggedDaily
      .map((t) => t.row)
      .find((d) => d.week === 18 && d.day === "Sun");
    expect(week18Sun).toBeDefined();
    expect(week18Sun!.session_type).not.toBe("Race");
    // The campaign-final entry is a 5K (not marathon), so the
    // trailing week 26 must ALSO not earn a 26.2 mi race day — the
    // 5K's Taper recipe rolls straight through.
    const lastWeek = weekly[weekly.length - 1]!;
    expect(lastWeek.week).toBe(26);
    expect(lastWeek.long_run_mi).not.toBe(26.2);
    const week26Sun = taggedDaily
      .map((t) => t.row)
      .find((d) => d.week === 26 && d.day === "Sun");
    expect(week26Sun).toBeDefined();
    expect(week26Sun!.session_type).not.toBe("Race");
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
