import { describe, expect, it } from "vitest";
import { sessionVerdict } from "./session-verdict";

describe("sessionVerdict", () => {
  it("returns null when there's nothing to judge", () => {
    expect(sessionVerdict({ plannedMin: 0, actualMin: 0 })).toBeNull();
    expect(sessionVerdict({ plannedMin: null, actualMin: null })).toBeNull();
  });

  it("grades a full session as complete", () => {
    const v = sessionVerdict({ plannedMin: 50, actualMin: 50, seed: 1 });
    expect(v?.bucket).toBe("complete");
    expect(v?.ratio).toBe(1);
    expect(v?.line).toBeTruthy();
  });

  it("treats a small shortfall (90%+) as complete, not close", () => {
    expect(sessionVerdict({ plannedMin: 50, actualMin: 46 })?.bucket).toBe("complete");
  });

  it("grades noticeably more than planned as over", () => {
    expect(sessionVerdict({ plannedMin: 50, actualMin: 65 })?.bucket).toBe("over");
  });

  it("grades a near miss as close", () => {
    expect(sessionVerdict({ plannedMin: 50, actualMin: 35 })?.bucket).toBe("close");
  });

  it("grades a big shortfall as short", () => {
    expect(sessionVerdict({ plannedMin: 50, actualMin: 20 })?.bucket).toBe("short");
  });

  it("flags a planned-but-not-done day as skipped", () => {
    const v = sessionVerdict({ plannedMin: 50, actualMin: 0 });
    expect(v?.bucket).toBe("skipped");
    expect(v?.ratio).toBe(0);
  });

  it("flags an off-plan session as a bonus", () => {
    const v = sessionVerdict({ plannedMin: 0, actualMin: 40 });
    expect(v?.bucket).toBe("bonus");
    expect(v?.ratio).toBeNull();
  });

  it("picks a stable variant from the seed", () => {
    const a = sessionVerdict({ plannedMin: 50, actualMin: 50, seed: 7 });
    const b = sessionVerdict({ plannedMin: 50, actualMin: 50, seed: 7 });
    expect(a?.line).toBe(b?.line);
  });
});
