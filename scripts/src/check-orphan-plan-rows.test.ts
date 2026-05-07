import { describe, it, expect } from "vitest";
import { isOrphanPlanRowsViolation } from "./check-orphan-plan-rows";

describe("isOrphanPlanRowsViolation", () => {
  it("returns false when an applied config exists, even if plan tables are populated", () => {
    expect(
      isOrphanPlanRowsViolation({
        appliedConfigCount: 1,
        weeksCount: 52,
        daysCount: 364,
      }),
    ).toBe(false);
  });

  it("returns false when no applied config exists and plan tables are empty (Task #307 contract)", () => {
    expect(
      isOrphanPlanRowsViolation({
        appliedConfigCount: 0,
        weeksCount: 0,
        daysCount: 0,
      }),
    ).toBe(false);
  });

  it("returns true when plan_weeks has rows but no applied config exists", () => {
    expect(
      isOrphanPlanRowsViolation({
        appliedConfigCount: 0,
        weeksCount: 52,
        daysCount: 0,
      }),
    ).toBe(true);
  });

  it("returns true when plan_days has rows but no applied config exists", () => {
    expect(
      isOrphanPlanRowsViolation({
        appliedConfigCount: 0,
        weeksCount: 0,
        daysCount: 364,
      }),
    ).toBe(true);
  });

  it("returns true when both plan tables have rows but no applied config exists", () => {
    expect(
      isOrphanPlanRowsViolation({
        appliedConfigCount: 0,
        weeksCount: 52,
        daysCount: 364,
      }),
    ).toBe(true);
  });
});
