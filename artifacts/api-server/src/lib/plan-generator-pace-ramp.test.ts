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

const WALK_RUN_REGEX =
  /\d+ x \(2:00 walk @ 18:00\/mi \+ 1:00 jog @ 14:00\/mi\) on Peloton Tread/;

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

  it("ramps easy pace continuously week-over-week (~3.75 sec/mi/week, ~30 per 8 weeks) across stacked entries", () => {
    const { taggedDaily } = expandConfigToPlanRows(makeConfig());
    const easyByWeek: number[] = [];
    for (let w = 1; w <= 40; w++) {
      const p = easyPaceForWeek(taggedDaily, w);
      expect(p, `easy pace for week ${w}`).not.toBeNull();
      easyByWeek.push(p!);
    }
    for (let i = 1; i < easyByWeek.length; i++) {
      expect(
        easyByWeek[i],
        `week ${i + 1} should not be slower than week ${i}`,
      ).toBeLessThanOrEqual(easyByWeek[i - 1]);
    }
    for (let i = 1; i < easyByWeek.length; i++) {
      const delta = easyByWeek[i - 1] - easyByWeek[i];
      expect(
        delta,
        `week ${i + 1} step from week ${i} should be at most 4 sec/mi`,
      ).toBeLessThanOrEqual(4);
    }
    expect(easyByWeek[0] - easyByWeek[7]).toBeGreaterThanOrEqual(25);
    expect(easyByWeek[8] - easyByWeek[15]).toBeGreaterThanOrEqual(25);
    expect(easyByWeek[16] - easyByWeek[23]).toBeGreaterThanOrEqual(25);
    expect(easyByWeek[32]).toBeLessThanOrEqual(840);
  });

  it("entry seams are continuous — no jump beyond per-week ramp rate", () => {
    const { taggedDaily } = expandConfigToPlanRows(makeConfig());
    for (const seamLastWeek of [8, 16, 24, 32]) {
      const before = easyPaceForWeek(taggedDaily, seamLastWeek);
      const after = easyPaceForWeek(taggedDaily, seamLastWeek + 1);
      expect(before).not.toBeNull();
      expect(after).not.toBeNull();
      const delta = before! - after!;
      expect(
        delta,
        `seam jump at weeks ${seamLastWeek}→${seamLastWeek + 1}`,
      ).toBeGreaterThanOrEqual(0);
      expect(
        delta,
        `seam jump at weeks ${seamLastWeek}→${seamLastWeek + 1}`,
      ).toBeLessThanOrEqual(4);
    }
  });

  it("emits walk-run on-ramp on the first 2 weeks of EACH stacked entry while effective pace > 14:00/mi", () => {
    const { taggedDaily } = expandConfigToPlanRows(makeConfig());
    const expectedWalkRunStarts = [1, 9, 17, 25];
    for (const startWeek of expectedWalkRunStarts) {
      for (let dw = 0; dw < WALK_RUN_MAX_ENTRY_LOCAL_WEEK; dw++) {
        const week = startWeek + dw;
        const runRows = taggedDaily.filter(
          (r) => r.row.week === week && (r.row.run_min ?? 0) > 0,
        );
        expect(
          runRows.some((r) => WALK_RUN_REGEX.test(r.row.description ?? "")),
          `expected walk-run on-ramp in week ${week} (entry-start ${startWeek})`,
        ).toBe(true);
      }
    }
    for (let dw = 0; dw < WALK_RUN_MAX_ENTRY_LOCAL_WEEK; dw++) {
      const week = 33 + dw;
      const runRows = taggedDaily.filter(
        (r) => r.row.week === week && (r.row.run_min ?? 0) > 0,
      );
      for (const r of runRows) {
        expect(WALK_RUN_REGEX.test(r.row.description ?? "")).toBe(false);
      }
    }
    const inEntryOnRamp = (campaignWeek: number) =>
      expectedWalkRunStarts.some(
        (s) => campaignWeek >= s && campaignWeek < s + WALK_RUN_MAX_ENTRY_LOCAL_WEEK,
      );
    for (const r of taggedDaily) {
      if ((r.row.run_min ?? 0) > 0 && !inEntryOnRamp(r.row.week)) {
        expect(WALK_RUN_REGEX.test(r.row.description ?? "")).toBe(false);
      }
    }
  });

  it("walk-run rows lead the equipment chip rail with Peloton Tread", () => {
    const { taggedDaily } = expandConfigToPlanRows(makeConfig());
    const week1Runs = taggedDaily.filter(
      (r) =>
        r.row.week === 1 &&
        (r.row.run_min ?? 0) > 0 &&
        WALK_RUN_REGEX.test(r.row.description ?? ""),
    );
    expect(week1Runs.length).toBeGreaterThan(0);
    for (const r of week1Runs) {
      const list = r.row.equipment_list ?? [];
      expect(list.length).toBeGreaterThan(0);
      expect(list[0]).toBe("Peloton Tread");
      expect(r.row.equipment).toBe(list[0]);
    }
  });

  it("falls back to DEFAULT_STARTING_PACE_SEC (14:30) when starting pace is unset", () => {
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
    expect(week1Runs.some((r) => WALK_RUN_REGEX.test(r.row.description ?? "")))
      .toBe(true);
    const week9Runs = taggedDaily.filter(
      (r) => r.row.week === 9 && (r.row.run_min ?? 0) > 0,
    );
    for (const r of week9Runs) {
      expect(WALK_RUN_REGEX.test(r.row.description ?? "")).toBe(false);
    }
  });

  it("WALK_RUN_PACE_THRESHOLD_SEC + walkRunDescription stay in lockstep", () => {
    expect(STARTING_PACE_SEC).toBeGreaterThan(WALK_RUN_PACE_THRESHOLD_SEC);
    expect(walkRunDescription(1.0)).toMatch(
      /^\d+ x \(2:00 walk @ 18:00\/mi \+ 1:00 jog @ 14:00\/mi\) on Peloton Tread$/,
    );
  });
});
