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
      // Task #191: pass the trailing entry's race kind so preview's
      // campaign-final week matches the generator's race-day Sunday.
      // Without this, preview's final long-run would be the Taper
      // recipe's natural ~10 mi while the generator emits a 3.1 mi
      // 5K race day — breaking parity.
      entriesRaceKind: "5k",
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
    // breaks task #191's per-kind race-day substitution (e.g.
    // re-pinning the 26.2 mi marathon distance for ALL race kinds)
    // — will fail this assertion.
    for (let i = 0; i < preview.length; i++) {
      const p = preview[i]!;
      const g = generated.weekly[i]!;
      expect(p.week).toBe(g.week);
      expect(p.totalMi).toBe(g.planned_miles);
      expect(p.longRunMi).toBe(g.long_run_mi);
    }
    // Pin the campaign-final week's expected values directly. Task
    // #191 makes a 5K trailing entry end on a 3.1 mi RACE DAY Sunday
    // (not the Taper recipe's natural ~10 mi long run). Both preview
    // and generator must agree on the substituted long-run AND the
    // resulting totalMi (easy + quality + 3.1).
    const lastPreview = preview[preview.length - 1]!;
    const lastGenerated = generated.weekly[generated.weekly.length - 1]!;
    expect(lastPreview.isRaceWeek).toBe(true);
    expect(lastPreview.longRunMi).toBe(3.1);
    expect(lastGenerated.long_run_mi).toBe(3.1);
    // The marathon distance must NOT leak into a 5K race-day Sunday
    // — defends against a future regression that re-pins
    // `MARATHON_DISTANCE_MI` for all race kinds.
    expect(lastPreview.longRunMi).not.toBe(26.2);
    expect(lastGenerated.long_run_mi).not.toBe(26.2);
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

  // Task #198: the hybrid marathon race week (Mon-Fri) used to come
  // from the schedule's normal lift/run/rest layout, scaled only by
  // the hybrid phase taper scalar (0.7x). That left runners with a
  // heavier race week than non-hybrid marathon plans, which taper
  // Tue/Thu lifts down (or drop one entirely) and shrink the Wed/Fri
  // runs to a short easy + tune-up. The fix force-overrides Mon-Fri
  // to a fixed light taper pattern (Mon rest, light Tue mobility +
  // bike, 3 mi Wed easy, Thu rest, 2 mi Fri tune-up) so a hybrid
  // marathon plan's race week feels comparable to Pfitz's race week
  // in load + minutes. Sat/Sun overrides from #192 stay intact.
  //
  // Strict per-week parity (preview vs generator) covers the entire
  // span — including the race week — and the per-day session_type +
  // load/distance pins below lock the new race-week shape. A future
  // regression that re-introduces a heavy lift on Tue/Thu, lengthens
  // the Wed/Fri runs, or drops the Mon/Thu rest fails loudly here.
  it("auto-shortens the trailing taper on a hybrid marathon race week (Task #198)", () => {
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
    // After #198 the preview hard-codes race-week mileage to 3 + 2 +
    // 26.2 (Wed easy + Fri tune-up + Sun marathon) so any drift in
    // either direction is caught here.
    for (let i = 0; i < preview.length; i++) {
      const p = preview[i]!;
      const g = generated.weekly[i]!;
      expect(p.week).toBe(g.week);
      expect(p.totalMi).toBe(g.planned_miles);
      expect(p.longRunMi).toBe(g.long_run_mi);
    }
    // Pin the campaign-final week's race-week mileage directly so a
    // future regression that drifts BOTH preview and generator in
    // lock-step (e.g. swapping back to schedule-driven Mon-Fri runs)
    // is still caught.
    const lastPreview = preview[preview.length - 1]!;
    expect(lastPreview.isRaceWeek).toBe(true);
    // Wed (3 mi easy) + Fri (2 mi tune-up) + Sun (26.2 mi) = 31.2 mi.
    expect(lastPreview.totalMi).toBe(31.2);
    expect(lastPreview.longRunMi).toBe(26.2);

    // Per-day race-week shape pins: Mon + Thu must both be Rest, Tue
    // must be a light maintenance Strength + Cardio (load 40), Wed
    // must be a 3 mi Aerobic Base run, Fri must be a 2 mi Sharpener
    // tune-up. Sat = Race Prep, Sun = 26.2 mi Race (preserved from
    // #192).
    const lastWeekDays = generated.daily.filter((d) => d.week === 18);
    const byDay = (day: string) =>
      lastWeekDays.find((d) => d.day === day)!;

    const mon = byDay("Mon");
    expect(mon.is_rest).toBe(true);
    expect(mon.session_type).toBe("Rest");
    expect(mon.total_load).toBe(0);

    const tue = byDay("Tue");
    expect(tue.session_type).toBe("Strength + Cardio");
    expect(tue.is_rest).toBe(false);
    expect(tue.run_min).toBe(0);
    // Light maintenance — total_load is fixed at 40 (load 25 + 15
    // min cardio), substantially below the hybrid block's typical
    // heavy lift day (60+ load even with the taper-phase scalar).
    expect(tue.total_load).toBe(40);
    expect(tue.strength_load).toBe(25);
    expect(tue.cardio_min).toBe(15);

    const wed = byDay("Wed");
    expect(wed.session_type).toBe("Aerobic Base");
    expect(wed.distance_mi).toBe(3.0);
    expect(wed.strength_load).toBe(0);
    expect(wed.run_min).toBeGreaterThan(0);

    const thu = byDay("Thu");
    expect(thu.is_rest).toBe(true);
    expect(thu.session_type).toBe("Rest");
    expect(thu.total_load).toBe(0);

    const fri = byDay("Fri");
    expect(fri.session_type).toBe("Sharpener");
    expect(fri.distance_mi).toBe(2.0);
    expect(fri.strength_load).toBe(0);
    expect(fri.run_min).toBeGreaterThan(0);

    // Sat = Race Prep, Sun = Race (preserved from #192). Re-assert
    // here so a future regression that breaks ANY of the seven
    // race-week day overrides — Mon-Fri (this task) or Sat/Sun
    // (Task #192) — fails loudly in the same test.
    expect(byDay("Sat").session_type).toBe("Race Prep");
    expect(byDay("Sun").session_type).toBe("Race");
    expect(byDay("Sun").distance_mi).toBe(26.2);

    // Race-week Mon-Fri total_load must stay well below the
    // pre-#198 typical hybrid race week (which ran ~140-240 in load
    // depending on slider position). Pin a comfortable upper bound
    // (150) so any future tweak that re-introduces a heavy lift on
    // Tue/Thu or fattens the Wed/Fri runs fails loudly.
    const monFriLoad = ["Mon", "Tue", "Wed", "Thu", "Fri"].reduce(
      (s, d) => s + (byDay(d).total_load || 0),
      0,
    );
    expect(monFriLoad).toBeLessThanOrEqual(150);
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
  // Task #191: half / 10K / 5K entries plans must end on a real race
  // Sunday at the matching distance (13.1 / 6.2 / 3.1 mi) — not on
  // the trailing Taper recipe's natural ~4 mi long run. Each case
  // pins:
  //   1. Strict per-week parity between `previewWeeklyMileage` and
  //      `generatePlanFromConfig.weekly` for every week including
  //      the race week, so the Phase Planner sparkline matches what
  //      Apply emits.
  //   2. The campaign-final week's `isRaceWeek` and `longRunMi` /
  //      `long_run_mi` against the race kind's canonical distance.
  //   3. The generator's daily rows: Sat must flip to "Race Prep"
  //      and Sun must be "Race" with the exact `distance_mi` and a
  //      description that begins with "RACE DAY — <kind label>".
  // Any future regression that suppresses the race-day branch on
  // half / 10K / 5K, or swaps in the wrong distance / description,
  // fails loudly here.
  const RACE_KIND_CASES: Array<{
    name: string;
    templateId: string;
    weeks: number;
    marathonDate: string;
    raceDistanceMi: number;
    descriptionPrefix: string;
  }> = [
    {
      name: "half",
      // Higdon Intermediate-1 half-marathon at its `defaultWeeks` of
      // 12. Mon 2026-05-04 → Sun 2026-07-26 spans 12 weeks.
      templateId: "half_marathon",
      weeks: 12,
      marathonDate: "2026-07-26",
      raceDistanceMi: 13.1,
      descriptionPrefix: "RACE DAY — Half (13.1 mi)",
    },
    {
      name: "10K",
      // Higdon Intermediate 10K at its `defaultWeeks` of 10. Mon
      // 2026-05-04 → Sun 2026-07-12 spans 10 weeks.
      templateId: "10k_higdon_int",
      weeks: 10,
      marathonDate: "2026-07-12",
      raceDistanceMi: 6.2,
      descriptionPrefix: "RACE DAY — 10K (6.2 mi)",
    },
    {
      name: "5K",
      // Higdon Novice 5K at its `defaultWeeks` of 8. Mon 2026-05-04
      // → Sun 2026-06-28 spans 8 weeks.
      templateId: "higdon_5k_novice",
      weeks: 8,
      marathonDate: "2026-06-28",
      raceDistanceMi: 3.1,
      descriptionPrefix: "RACE DAY — 5K (3.1 mi)",
    },
  ];

  for (const tc of RACE_KIND_CASES) {
    it(`ends an entries-mode ${tc.name} plan on a ${tc.raceDistanceMi} mi RACE DAY Sunday`, () => {
      const entries: TemplateEntry[] = [
        {
          templateId: tc.templateId,
          weeks: tc.weeks,
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
        marathonDate: tc.marathonDate,
        blocks: expandedBlocks,
        entries,
      };
      const preview = previewWeeklyMileage(expandedBlocks, {
        appendMarathonTail: false,
        entriesRaceKind: tc.name === "half"
          ? "half"
          : tc.name === "10K"
            ? "10k"
            : "5k",
      });
      const generated = generatePlanFromConfig(config);
      expect(preview.length).toBe(tc.weeks);
      expect(generated.weekly.length).toBe(tc.weeks);
      // Strict per-week parity for EVERY week, race week included.
      for (let i = 0; i < preview.length; i++) {
        const p = preview[i]!;
        const g = generated.weekly[i]!;
        expect(p.week).toBe(g.week);
        expect(p.totalMi).toBe(g.planned_miles);
        expect(p.longRunMi).toBe(g.long_run_mi);
      }
      // Campaign-final week: race-day Sunday at the matching
      // distance. Both preview + generator must agree, and the
      // recipe's natural Taper long-run (3-4 mi) is replaced by
      // the race distance.
      const lastPreview = preview[preview.length - 1]!;
      const lastGenerated = generated.weekly[generated.weekly.length - 1]!;
      expect(lastPreview.isRaceWeek).toBe(true);
      expect(lastPreview.longRunMi).toBe(tc.raceDistanceMi);
      expect(lastGenerated.long_run_mi).toBe(tc.raceDistanceMi);
      // Daily rows for the trailing week: Sat="Race Prep",
      // Sun="Race" with the exact `distance_mi` and the per-kind
      // description prefix.
      const lastWeekDays = generated.daily.filter(
        (d) => d.week === lastGenerated.week,
      );
      const sat = lastWeekDays.find((d) => d.day === "Sat");
      const sun = lastWeekDays.find((d) => d.day === "Sun");
      expect(sat).toBeDefined();
      expect(sun).toBeDefined();
      expect(sat!.session_type).toBe("Race Prep");
      expect(sun!.session_type).toBe("Race");
      expect(sun!.distance_mi).toBe(tc.raceDistanceMi);
      expect(sun!.description.startsWith(tc.descriptionPrefix)).toBe(true);
      // Marathon distance must NOT leak into a non-marathon
      // race-day Sunday — defends against a future regression that
      // re-pins `MARATHON_DISTANCE_MI` for all kinds.
      expect(sun!.distance_mi).not.toBe(26.2);
    });
  }

  it("does NOT inject a mid-campaign race day when a marathon entry is followed by another entry", () => {
    // Pfitz 18w marathon (race date 2026-09-06) followed by a
    // custom_hybrid block (raceKind === "none") starting the next
    // week. Trailing entry is intentionally a non-race hybrid so
    // the test pins TWO invariants in one campaign:
    //   (a) mid-campaign suppression — the marathon entry at weeks
    //       1..18 must NOT inject a 26.2 mi race-day Sunday at the
    //       boundary (week 18). Owned by the per-entry pipeline's
    //       `endsOnMarathonRaceDayOverride: false` for non-final
    //       entries (task #184).
    //   (b) non-race trailing — the trailing custom_hybrid entry
    //       has raceKind="none", so the campaign-final week must
    //       ALSO not earn a race-day Sunday (task #191's per-kind
    //       gate must skip "none"-kind trailing entries).
    //
    // NOTE: marathon_hybrid was raceKind="none" pre-#192 and made
    // a natural trailing entry here, but #192 flipped it to
    // raceKind="marathon" (so a hybrid marathon plan ends on a
    // 26.2 mi race-day Sunday — see the dedicated test above), and
    // #200 extended that to all hybrid race kinds (5K/10K hybrid).
    // custom_hybrid is now the canonical non-race hybrid template
    // since it explicitly carries raceKind="none".
    // Total span 18 + 8 = 26 weeks (custom_hybrid defaultWeeks=8).
    const entries: TemplateEntry[] = [
      {
        templateId: "marathon_pfitz_18_70",
        weeks: 18,
        customName: null,
        customNotes: null,
      },
      {
        templateId: "custom_hybrid",
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
    // The campaign-final entry is custom_hybrid (raceKind="none"),
    // so the trailing week 26 must ALSO not earn a race day at any
    // distance — the hybrid pipeline's internal phase scalar handles
    // its own trailing taper.
    const lastWeek = weekly[weekly.length - 1]!;
    expect(lastWeek.week).toBe(26);
    expect(lastWeek.long_run_mi).not.toBe(26.2);
    expect(lastWeek.long_run_mi).not.toBe(13.1);
    expect(lastWeek.long_run_mi).not.toBe(6.2);
    expect(lastWeek.long_run_mi).not.toBe(3.1);
    const week26Sun = taggedDaily
      .map((t) => t.row)
      .find((d) => d.week === 26 && d.day === "Sun");
    expect(week26Sun).toBeDefined();
    expect(week26Sun!.session_type).not.toBe("Race");
  });

  // Task #200: an entries-mode plan whose LAST entry is a hybrid
  // 5K / 10K template (`5k_hybrid_balanced` — classified "5k" via
  // its goalDistance default; `10k_hybrid_balanced` — classified
  // "10k") must end on the SAME race-day pattern as its
  // recipe-driven counterpart at the matching distance: trailing
  // Sat = "Race Prep", trailing Sun = `<distance>` mi "Race".
  // Before #200 the hybrid pipeline (`buildHybridWeekDays`)
  // hardcoded a 26.2 mi marathon Sunday for the race-week override
  // (originally introduced in #192 for `marathon_hybrid`), so a
  // hybrid 5K or hybrid 10K plan ended on a stray 26.2 mi marathon
  // Sunday — runners who chose the hybrid path for a 5K or 10K
  // trained for that distance but saw a marathon on race day.
  //
  // Strict per-week parity (preview vs generator) covers the entire
  // span — including the race week — so any future regression that
  // either (a) drops the per-kind RACE_DAY_SPECS lookup in
  // `buildHybridWeekDays`, (b) re-pins MARATHON_DISTANCE_MI for the
  // hybrid race-week override, or (c) breaks the per-kind branch in
  // `previewWeeklyMileage`'s hybrid path fails loudly here.
  const HYBRID_RACE_KIND_CASES: Array<{
    name: string;
    templateId: string;
    weeks: number;
    marathonDate: string;
    raceDistanceMi: number;
    descriptionPrefix: string;
    previewRaceKind: "5k" | "10k";
  }> = [
    {
      name: "10K hybrid",
      // 10k_hybrid_balanced at its `defaultWeeks` of 10. Mon
      // 2026-05-04 → Sun 2026-07-12 spans 10 weeks.
      templateId: "10k_hybrid_balanced",
      weeks: 10,
      marathonDate: "2026-07-12",
      raceDistanceMi: 6.2,
      descriptionPrefix: "RACE DAY — 10K (6.2 mi)",
      previewRaceKind: "10k",
    },
    {
      name: "5K hybrid",
      // 5k_hybrid_balanced at its `defaultWeeks` of 8. Mon
      // 2026-05-04 → Sun 2026-06-28 spans 8 weeks.
      templateId: "5k_hybrid_balanced",
      weeks: 8,
      marathonDate: "2026-06-28",
      raceDistanceMi: 3.1,
      descriptionPrefix: "RACE DAY — 5K (3.1 mi)",
      previewRaceKind: "5k",
    },
  ];

  for (const tc of HYBRID_RACE_KIND_CASES) {
    it(`ends an entries-mode ${tc.name} plan on a ${tc.raceDistanceMi} mi RACE DAY Sunday`, () => {
      const entries: TemplateEntry[] = [
        {
          templateId: tc.templateId,
          weeks: tc.weeks,
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
        marathonDate: tc.marathonDate,
        blocks: expandedBlocks,
        entries,
      };
      const preview = previewWeeklyMileage(expandedBlocks, {
        appendMarathonTail: false,
        entriesRaceKind: tc.previewRaceKind,
      });
      const generated = generatePlanFromConfig(config);
      expect(preview.length).toBe(tc.weeks);
      expect(generated.weekly.length).toBe(tc.weeks);
      // Strict per-week parity for EVERY week, race week included.
      // The preview helper's hybrid race-week branch MUST agree
      // with what the generator's `buildHybridWeekDays` pipeline
      // emits when the per-kind race-day spec is wired through.
      for (let i = 0; i < preview.length; i++) {
        const p = preview[i]!;
        const g = generated.weekly[i]!;
        expect(p.week).toBe(g.week);
        expect(p.totalMi).toBe(g.planned_miles);
        expect(p.longRunMi).toBe(g.long_run_mi);
      }
      // Campaign-final week: race-day Sunday at the matching
      // distance. Both preview + generator must agree.
      const lastPreview = preview[preview.length - 1]!;
      const lastGenerated = generated.weekly[generated.weekly.length - 1]!;
      expect(lastPreview.isRaceWeek).toBe(true);
      expect(lastPreview.longRunMi).toBe(tc.raceDistanceMi);
      expect(lastGenerated.long_run_mi).toBe(tc.raceDistanceMi);
      // Daily rows for the trailing week: Sat="Race Prep",
      // Sun="Race" with the exact `distance_mi` and the per-kind
      // description prefix.
      const lastWeekDays = generated.daily.filter(
        (d) => d.week === lastGenerated.week,
      );
      const sat = lastWeekDays.find((d) => d.day === "Sat");
      const sun = lastWeekDays.find((d) => d.day === "Sun");
      expect(sat).toBeDefined();
      expect(sun).toBeDefined();
      expect(sat!.session_type).toBe("Race Prep");
      expect(sun!.session_type).toBe("Race");
      expect(sun!.distance_mi).toBe(tc.raceDistanceMi);
      expect(sun!.description.startsWith(tc.descriptionPrefix)).toBe(true);
      // Marathon distance must NOT leak into a non-marathon hybrid
      // race-day Sunday — defends against a regression that
      // re-pins MARATHON_DISTANCE_MI in the hybrid race-week
      // override.
      expect(sun!.distance_mi).not.toBe(26.2);
      expect(sat!.distance_mi).toBeNull();
      expect(sat!.run_min).toBe(0);
    });
  }
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
