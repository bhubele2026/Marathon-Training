// Task #335: stacked 5-template @ 16:00/mi pace ramp + walk-run on-ramp.
import { describe, expect, it } from "vitest";
import {
  expandConfigToPlanRows,
  parseMmSsPace,
  walkRunDescription,
  DEFAULT_STARTING_PACE_SEC,
  WALK_RUN_PACE_THRESHOLD_SEC,
  WALK_RUN_MAX_ENTRY_LOCAL_WEEK,
  type PlannerConfig,
  type TemplateEntry,
} from "@workspace/plan-generator";

const START = "2026-05-04"; // Mon
// 5 entries * 8 weeks = 40 weeks → Sunday 2027-02-07.
const RACE = "2027-02-07";

const ENTRIES: TemplateEntry[] = [
  { templateId: "5k_strength_lite", weeks: 8 },
  { templateId: "10k_strength_lite", weeks: 8 },
  { templateId: "5k_strength_lite", weeks: 8 },
  { templateId: "10k_strength_lite", weeks: 8 },
  { templateId: "5k_strength_lite", weeks: 8 },
];

const STARTING_PACE_SEC = 960; // 16:00/mi — slower than walk-run threshold.

// Task #361: walk-run description may carry an optional 1-2 min
// walk-or-jog tail so the interval sum honors the recipe-prescribed
// RUN minutes within the 0.05 mi distance tolerance.
const WALK_RUN_REGEX =
  /\d+ x \(2:00 walk @ 18:00\/mi \+ 1:00 jog @ 14:00\/mi\)(?: \+ \d+:00 (?:walk|jog) @ (?:18:00|14:00)\/mi)? on Peloton Tread/;

function makeConfig(): PlannerConfig {
  return {
    startDate: START,
    marathonDate: RACE,
    blocks: [],
    entries: ENTRIES,
    startingPaceSec: STARTING_PACE_SEC,
  };
}

describe("Task #335: stacked pace ramp from 16:00/mi", () => {
  function easyPaceForWeek(
    taggedDaily: ReturnType<typeof expandConfigToPlanRows>["taggedDaily"],
    week: number,
  ): number | null {
    const row =
      taggedDaily.find(
        (r) =>
          r.row.week === week &&
          r.row.day === "Wed" &&
          (r.row.pace ?? "") !== "" &&
          (r.row.run_min ?? 0) > 0,
      ) ??
      taggedDaily.find(
        (r) =>
          r.row.week === week &&
          !r.row.is_rest &&
          (r.row.pace ?? "") !== "" &&
          (r.row.run_min ?? 0) > 0,
      );
    if (!row) return null;
    return parseMmSsPace(row.row.pace ?? null);
  }

  // Task #365: race-kind transitions at stacked-entry seams introduce
  // a small step in displayed easy pace (10K is +5 sec slower than
  // 5K; half +15; marathon +25 — Daniels/Pfitz aligned). The
  // underlying ramp is still continuous; the per-week delta tests
  // below skip the known race-kind seam weeks where the displayed
  // pace legitimately steps by the offset delta.
  const RACE_KIND_SEAMS = new Set([8, 16, 24, 32]);
  // |easyOff(10k) − easyOff(5k)| = 5 sec/mi.
  const MAX_RACE_KIND_SEAM_STEP = 5;

  it("ramps easy pace continuously week-over-week (~3.75 sec/mi/week, ~30 per 8 weeks) across stacked entries", () => {
    const { taggedDaily } = expandConfigToPlanRows(makeConfig());
    const easyByWeek: number[] = [];
    for (let w = 1; w <= 40; w++) {
      const p = easyPaceForWeek(taggedDaily, w);
      expect(p, `easy pace for week ${w}`).not.toBeNull();
      easyByWeek.push(p!);
    }
    for (let i = 1; i < easyByWeek.length; i++) {
      const prevWeek = i; // 1-indexed week of easyByWeek[i-1]
      const allowSeamStep = RACE_KIND_SEAMS.has(prevWeek);
      const slack = allowSeamStep ? MAX_RACE_KIND_SEAM_STEP : 0;
      expect(
        easyByWeek[i],
        `week ${i + 1} should not be slower than week ${i} by more than ${slack}`,
      ).toBeLessThanOrEqual(easyByWeek[i - 1] + slack);
    }
    for (let i = 1; i < easyByWeek.length; i++) {
      const delta = easyByWeek[i - 1] - easyByWeek[i];
      const prevWeek = i;
      const cap = RACE_KIND_SEAMS.has(prevWeek) ? 4 + MAX_RACE_KIND_SEAM_STEP : 4;
      expect(
        delta,
        `week ${i + 1} step from week ${i} should be at most ${cap} sec/mi`,
      ).toBeLessThanOrEqual(cap);
    }
    // Within-entry ramp (no race-kind seam crossings): 5K → 5K stays
    // pure-ramp. The 10K → 10K cohort starts +5 above same-week 5K
    // pace so its absolute pace is shifted but its 8-week delta is
    // still ≥25.
    expect(easyByWeek[0] - easyByWeek[7]).toBeGreaterThanOrEqual(25);
    expect(easyByWeek[8] - easyByWeek[15]).toBeGreaterThanOrEqual(25);
    expect(easyByWeek[16] - easyByWeek[23]).toBeGreaterThanOrEqual(25);
    // W33 is the start of entry #5 (5K, offset 0). After 32 weeks of
    // ramp the underlying easy pace is well under 14:30; with offset
    // 0 the displayed pace stays ≤ 840 (14:00/mi).
    expect(easyByWeek[32]).toBeLessThanOrEqual(840);
  });

  it("entry seams are continuous up to the race-kind offset delta", () => {
    const { taggedDaily } = expandConfigToPlanRows(makeConfig());
    for (const seamLastWeek of [8, 16, 24, 32]) {
      const before = easyPaceForWeek(taggedDaily, seamLastWeek);
      const after = easyPaceForWeek(taggedDaily, seamLastWeek + 1);
      expect(before).not.toBeNull();
      expect(after).not.toBeNull();
      const delta = before! - after!;
      // Race-kind offset can step the displayed pace either way by
      // up to MAX_RACE_KIND_SEAM_STEP sec/mi (5K↔10K). The
      // underlying ramp is monotonic; the displayed seam jump just
      // reflects the configured offset delta.
      expect(
        Math.abs(delta),
        `seam jump at weeks ${seamLastWeek}→${seamLastWeek + 1} (race-kind offset)`,
      ).toBeLessThanOrEqual(4 + MAX_RACE_KIND_SEAM_STEP);
    }
  });

  // Task #365: walk-run on-ramp cards are retired. The pace ramp +
  // entry seam continuity tests above still pin the underlying ramp
  // math; below we pin the new contract — every run day's
  // description is a pace-target sentence and walk-run interval prose
  // never appears at runtime even on entry-start weeks where the
  // legacy gate would have fired.
  const PACE_TARGET_REGEX =
    /(Easy|Long|Tempo|Steady|Sharpener|Race-pace|Threshold) run: \d+ min @ \d{1,2}:\d{2}\/mi \(~\d+(?:\.\d+)? mi\)/;

  it("emits pace-target sentences (not walk-run intervals) on every run day, including entry-start weeks", () => {
    const { taggedDaily } = expandConfigToPlanRows(makeConfig());
    const entryStartWeeks = [1, 9, 17, 25, 33];
    for (const startWeek of entryStartWeeks) {
      for (let dw = 0; dw < WALK_RUN_MAX_ENTRY_LOCAL_WEEK; dw++) {
        const week = startWeek + dw;
        const runRows = taggedDaily.filter(
          (r) => r.row.week === week && (r.row.run_min ?? 0) > 0,
        );
        for (const r of runRows) {
          expect(
            WALK_RUN_REGEX.test(r.row.description ?? ""),
            `W${week} ${r.row.day}: walk-run prose should never appear at runtime`,
          ).toBe(false);
          expect(
            PACE_TARGET_REGEX.test(r.row.description ?? ""),
            `W${week} ${r.row.day}: description should be a pace-target sentence — got "${r.row.description}"`,
          ).toBe(true);
        }
      }
    }
  });

  it("falls back to DEFAULT_STARTING_PACE_SEC (14:30) when starting pace is unset, still no walk-run prose", () => {
    expect(DEFAULT_STARTING_PACE_SEC).toBe(870);
    const { taggedDaily } = expandConfigToPlanRows({
      startDate: START,
      marathonDate: RACE,
      blocks: [],
      entries: ENTRIES,
    });
    const week1Runs = taggedDaily.filter(
      (r) => r.row.week === 1 && (r.row.run_min ?? 0) > 0,
    );
    expect(week1Runs.length).toBeGreaterThan(0);
    for (const r of week1Runs) {
      expect(WALK_RUN_REGEX.test(r.row.description ?? "")).toBe(false);
      expect(PACE_TARGET_REGEX.test(r.row.description ?? "")).toBe(true);
    }
  });

  // Task #367: run-card minutes are derived from distance × ramped
  // pace (no 20-min floor, no hardcoded per-mile constants). The
  // invariant: |run_min − round(distance_mi × paceSec / 60)| ≤ 1 for
  // every non-walk-run run row whose description is a pace-target
  // sentence carrying the same pace as the row.
  it("Task #367: run_min ≈ distance × paceSec / 60 (no floor, honors ramped pace) for every pace-target run row", () => {
    // Use a starting pace below WALK_RUN_PACE_THRESHOLD_SEC (840) so
    // composeWalkRun() never overrides the natural minutes — the
    // invariant only holds for non-walk-run rows. Walk-run composition
    // is a separate cardio-bucket concern (Task #361/#365).
    const { taggedDaily } = expandConfigToPlanRows({
      startDate: START,
      marathonDate: RACE,
      blocks: [],
      entries: ENTRIES,
      startingPaceSec: 810, // 13:30/mi, < 840 threshold
    });
    // The strength-floor enforcer pads Fri-quality days (lift 0 → 30
    // min) and steals from run minutes to keep the Fri budget ≤ 75 —
    // that's a separate composition concern, not the per-row math.
    // Pin the formula on Wed/Sun where the recipe's own lift block
    // already meets the floor and run minutes are not budget-trimmed.
    const runRows = taggedDaily.filter(
      (r) =>
        (r.row.day === "Wed" || r.row.day === "Sun") &&
        (r.row.run_min ?? 0) > 0 &&
        (r.row.distance_mi ?? 0) > 0 &&
        (r.row.pace ?? "") !== "" &&
        PACE_TARGET_REGEX.test(r.row.description ?? ""),
    );
    expect(runRows.length).toBeGreaterThan(0);
    for (const r of runRows) {
      const paceSec = parseMmSsPace(r.row.pace ?? null);
      expect(paceSec, `row W${r.row.week} ${r.row.day} has pace`).not.toBeNull();
      const expected = Math.max(
        1,
        Math.round((r.row.distance_mi ?? 0) * paceSec! / 60),
      );
      expect(
        Math.abs((r.row.run_min ?? 0) - expected),
        `W${r.row.week} ${r.row.day}: run_min=${r.row.run_min} should be ~${expected} (dist=${r.row.distance_mi}, pace=${r.row.pace})`,
      ).toBeLessThanOrEqual(1);
    }
  });

  // Task #367: a configured startingPaceSec slower than the recipe
  // floor should be honored end-to-end. C25K's recipe easy floor is
  // 15:00/mi (900 sec); 17:00 (1020) is slower, so it must win.
  it("Task #367: configured startingPaceSec=1020 (17:00) on couch_to_5k wins over recipe floor in week 1", () => {
    // couch_to_5k 9 weeks → race date 9 weeks after START.
    const c25kRace = "2026-07-05"; // 2026-05-04 Mon + 9 weeks → Sun 2026-07-05
    const { taggedDaily } = expandConfigToPlanRows({
      startDate: START,
      marathonDate: c25kRace,
      blocks: [],
      entries: [{ templateId: "couch_to_5k", weeks: 9 }],
      startingPaceSec: 1020,
    });
    const week1Easy = taggedDaily.find(
      (r) =>
        r.row.week === 1 &&
        r.row.day === "Wed" &&
        (r.row.run_min ?? 0) > 0,
    );
    expect(week1Easy, "C25K W1 Wed easy row").toBeDefined();
    // Exact pace must round-trip 17:00. Allow at most the 5 sec/mi
    // race-kind easy offset (5K = +0, but the assertion stays robust
    // if someone adjusts the table later).
    expect(week1Easy!.row.pace).toBe("17:00");
    const paceSec = parseMmSsPace(week1Easy!.row.pace ?? null);
    expect(paceSec).toBe(1020);
    // And the row's minutes match the new formula: ceil to 1 of
    // dist × 1020 / 60.
    const expectedMin = Math.max(
      1,
      Math.round((week1Easy!.row.distance_mi ?? 0) * 1020 / 60),
    );
    expect(
      Math.abs((week1Easy!.row.run_min ?? 0) - expectedMin),
    ).toBeLessThanOrEqual(1);
  });

  // Task #367: when the runner leaves starting pace blank, generation
  // should anchor to the FIRST block's recipe.easyPace, not the global
  // 14:30/mi default. couch_to_5k expands to the C25K recipe whose
  // easyPace is 15:00/mi, so a blank starting pace must produce W1
  // easy at 15:00 (5k race-kind offset = +0).
  it("Task #367: null startingPaceSec defaults to first recipe.easyPace baseline", () => {
    const { taggedDaily } = expandConfigToPlanRows({
      startDate: START,
      marathonDate: "2026-07-05", // 9 weeks
      blocks: [],
      entries: [{ templateId: "couch_to_5k", weeks: 9 }],
      // startingPaceSec intentionally omitted
    });
    const w1Wed = taggedDaily.find(
      (r) =>
        r.row.week === 1 &&
        r.row.day === "Wed" &&
        (r.row.run_min ?? 0) > 0,
    );
    expect(w1Wed).toBeDefined();
    // C25K recipe easyPace 15:00 + 5K race offset 0 = 15:00. Crucially
    // NOT 14:30 (DEFAULT_STARTING_PACE_SEC) — proves null-start is
    // anchored to the recipe, not the global default.
    expect(w1Wed!.row.pace).toBe("15:00");
  });

  it("Task #367: null startingPaceSec on a marathon plan still anchors at the recipe baseline, not 14:30", () => {
    // The "marathon" template's first block uses a recipe whose
    // easyPace ≤ 13:30/mi. With marathon race-kind offset (+25 sec)
    // the W1 easy pace should be ≤ 13:55 — strictly faster than the
    // 14:30 DEFAULT (which would yield ~14:55 with offset). Proves
    // the null-start fallback is recipe-anchored, not default-anchored.
    const { taggedDaily } = expandConfigToPlanRows({
      startDate: START,
      marathonDate: "2026-09-06", // 18 weeks
      blocks: [],
      entries: [{ templateId: "marathon", weeks: 18 }],
    });
    const w1Wed = taggedDaily.find(
      (r) =>
        r.row.week === 1 &&
        r.row.day === "Wed" &&
        (r.row.run_min ?? 0) > 0 &&
        (r.row.pace ?? "") !== "",
    );
    expect(w1Wed).toBeDefined();
    const paceSec = parseMmSsPace(w1Wed!.row.pace ?? null);
    expect(paceSec).not.toBeNull();
    // Strictly faster than (DEFAULT 870 + marathon offset 25 = 895 =
    // 14:55) — proves we're not silently anchored to the default.
    expect(paceSec!).toBeLessThan(895);
  });

  // Task #367: pin the formula on a hybrid path too. half_hybrid_balanced
  // exercises buildHybridWeekDays (separate from buildWeekDays), so this
  // catches any divergence between the two run-card generator paths.
  it("Task #367: hybrid path also honors run_min ≈ distance × paceSec / 60 on long-run Sundays", () => {
    const { taggedDaily } = expandConfigToPlanRows({
      startDate: START,
      marathonDate: "2026-07-26", // 12 weeks → Sun 2026-07-26
      blocks: [],
      entries: [{ templateId: "half_hybrid_balanced", weeks: 12 }],
      startingPaceSec: 810,
    });
    const longRows = taggedDaily.filter(
      (r) =>
        r.row.day === "Sun" &&
        (r.row.run_min ?? 0) > 0 &&
        (r.row.distance_mi ?? 0) > 0 &&
        (r.row.pace ?? "") !== "" &&
        PACE_TARGET_REGEX.test(r.row.description ?? ""),
    );
    expect(longRows.length).toBeGreaterThan(0);
    for (const r of longRows) {
      const paceSec = parseMmSsPace(r.row.pace ?? null);
      expect(paceSec).not.toBeNull();
      const expected = Math.max(
        1,
        Math.round((r.row.distance_mi ?? 0) * paceSec! / 60),
      );
      expect(
        Math.abs((r.row.run_min ?? 0) - expected),
        `hybrid W${r.row.week} Sun: run_min=${r.row.run_min} should be ~${expected} (dist=${r.row.distance_mi}, pace=${r.row.pace})`,
      ).toBeLessThanOrEqual(1);
    }
  });

  it("walkRunDescription() pure helper still exists for back-compat (composeWalkRun unit-test surface)", () => {
    expect(STARTING_PACE_SEC).toBeGreaterThan(WALK_RUN_PACE_THRESHOLD_SEC);
    expect(walkRunDescription(1.0)).toMatch(
      /^\d+ x \(2:00 walk @ 18:00\/mi \+ 1:00 jog @ 14:00\/mi\)(?: \+ \d+:00 (?:walk|jog) @ (?:18:00|14:00)\/mi)? on Peloton Tread$/,
    );
  });
});
