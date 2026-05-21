// Task #367: the backfill must regenerate run-card rows using the
// runner's APPLIED starting pace + daily budget, not the generator's
// defaults. Without that, re-running backfill on a campaign that was
// applied with e.g. startingPaceSec=1020 (a 17:00/mi couch-to-5k
// starter) would silently rewrite pace/minute/distance fields to
// default-pace values. These tests pin the config-rebuild step.

import { describe, it, expect } from "vitest";
import {
  expandConfigToPlanRows,
  type DailyBudgetOverride,
} from "@workspace/plan-generator";
import {
  buildConfigFromApplied,
  type AppliedConfigRow,
} from "./backfill-pace-target-cards";

const baseRow: AppliedConfigRow = {
  appliedStartDate: "2026-05-04",
  appliedMarathonDate: "2026-07-05", // 9 weeks
  appliedBlocks: [],
  appliedEntries: [{ templateId: "couch_to_5k", weeks: 9 }],
  appliedStartingPaceSec: null,
  appliedGoalEndingPaceSec: null,
  appliedDailyBudget: null,
};

describe("buildConfigFromApplied (Task #367 backfill config rebuild)", () => {
  it("carries appliedStartingPaceSec into the rebuilt PlannerConfig", () => {
    const cfg = buildConfigFromApplied({
      ...baseRow,
      appliedStartingPaceSec: 1020,
    });
    expect(cfg.startingPaceSec).toBe(1020);
  });

  it("carries appliedDailyBudget into the rebuilt PlannerConfig", () => {
    const budget: DailyBudgetOverride = {
      weekdayMin: 50,
      weekdayMax: 80,
      weekendMin: 60,
    };
    const cfg = buildConfigFromApplied({
      ...baseRow,
      appliedDailyBudget: budget,
    });
    expect(cfg.dailyBudget).toEqual(budget);
  });

  it("nulls round-trip when applied columns are absent", () => {
    const cfg = buildConfigFromApplied(baseRow);
    expect(cfg.startingPaceSec).toBeNull();
    expect(cfg.dailyBudget).toBeNull();
  });

  it("regenerated W1 Wed run row honors applied starting pace end-to-end", () => {
    // The whole point of the fix: feeding the rebuilt config into the
    // live generator produces rows pinned to the runner's pace, not
    // the default ladder.
    const cfg = buildConfigFromApplied({
      ...baseRow,
      appliedStartingPaceSec: 1020,
    });
    const { taggedDaily } = expandConfigToPlanRows(cfg);
    const w1Wed = taggedDaily.find(
      (r) =>
        r.row.week === 1 &&
        r.row.day === "Wed" &&
        (r.row.run_min ?? 0) > 0,
    );
    expect(w1Wed, "C25K W1 Wed run row").toBeDefined();
    expect(w1Wed!.row.pace).toBe("17:00");
    const dist = w1Wed!.row.distance_mi ?? 0;
    const expectedMin = Math.max(1, Math.round((dist * 1020) / 60));
    expect(
      Math.abs((w1Wed!.row.run_min ?? 0) - expectedMin),
    ).toBeLessThanOrEqual(1);
  });

  it("regenerated rows under default pace differ from custom-pace rows (regression guard)", () => {
    // Sanity check: if buildConfigFromApplied silently dropped the
    // custom pace (the pre-fix bug), this test would fail because the
    // two generations would produce identical rows.
    const defaultCfg = buildConfigFromApplied(baseRow);
    const customCfg = buildConfigFromApplied({
      ...baseRow,
      appliedStartingPaceSec: 1020,
    });
    const defaultRow = expandConfigToPlanRows(defaultCfg).taggedDaily.find(
      (r) => r.row.week === 1 && r.row.day === "Wed" && (r.row.run_min ?? 0) > 0,
    );
    const customRow = expandConfigToPlanRows(customCfg).taggedDaily.find(
      (r) => r.row.week === 1 && r.row.day === "Wed" && (r.row.run_min ?? 0) > 0,
    );
    expect(defaultRow).toBeDefined();
    expect(customRow).toBeDefined();
    expect(customRow!.row.pace).not.toBe(defaultRow!.row.pace);
  });
});
