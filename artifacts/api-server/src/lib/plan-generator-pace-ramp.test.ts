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

  it("walkRunDescription() pure helper still exists for back-compat (composeWalkRun unit-test surface)", () => {
    expect(STARTING_PACE_SEC).toBeGreaterThan(WALK_RUN_PACE_THRESHOLD_SEC);
    expect(walkRunDescription(1.0)).toMatch(
      /^\d+ x \(2:00 walk @ 18:00\/mi \+ 1:00 jog @ 14:00\/mi\)(?: \+ \d+:00 (?:walk|jog) @ (?:18:00|14:00)\/mi)? on Peloton Tread$/,
    );
  });
});
