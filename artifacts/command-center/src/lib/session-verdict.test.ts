import { describe, expect, it } from "vitest";
import { sessionVerdict, dayVerdict } from "./session-verdict";
import { entryLoad, detectSubstitution } from "./adherence";

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

describe("dayVerdict (load-aware, substitution-tolerant)", () => {
  // THE owner's complaint scenario: a 40-min conditioning plan day (planned as
  // cardio, 0 strength / 0 run) satisfied by a 10.6-min strength block + a
  // 30-min run. Per-fragment grading would call BOTH "fell short" against the
  // 40-min day. It must read as ONE met day, and as a substitution.
  it("credits a 10.6-min lift + 30-min run on a 40-min conditioning day as one met day, substituted", () => {
    const planned = { strengthMin: 0, cardioMin: 40, runMin: 0 };
    const actualBuckets = { strengthMin: 10.6, cardioMin: 0, runMin: 30 };
    const plannedLoad = entryLoad({ ...planned }); // 40 * 0.8 = 32
    const actualLoad =
      entryLoad({ strengthMin: 10.6, cardioMin: 0, runMin: 0 }) + // 15.9
      entryLoad({ strengthMin: 0, cardioMin: 0, runMin: 30 }); // 30  -> 45.9
    const substituted = detectSubstitution(
      planned,
      actualBuckets,
      actualLoad / plannedLoad,
    );
    expect(substituted).toBe(true);

    const v = dayVerdict({
      plannedLoad,
      actualLoad,
      plannedMin: 40,
      actualMin: 40.6,
      substituted,
      seed: 1,
    });
    // Met (not short/skipped) and flagged as work-done-your-way.
    expect(v?.bucket).toBe("complete");
    expect(v?.headline).toBe("Did the work");
    expect(v?.line).toBeTruthy();
  });

  it("does NOT punish a split day that meets the plan (two fragments, one met day)", () => {
    // 50 planned strength-min day done as two lifts (20 + 30 min).
    const v = dayVerdict({
      plannedLoad: 50 * 1.5,
      actualLoad: 20 * 1.5 + 30 * 1.5,
      plannedMin: 50,
      actualMin: 50,
      substituted: false,
      seed: 2,
    });
    expect(v?.bucket).toBe("complete");
  });

  it("still calls a genuinely short DAY short (sass only when the aggregate falls short)", () => {
    const v = dayVerdict({
      plannedLoad: 60,
      actualLoad: 18,
      plannedMin: 40,
      actualMin: 12,
      substituted: false,
      seed: 3,
    });
    expect(v?.bucket).toBe("short");
    expect(v?.headline).toBe("Fell short");
  });

  it("treats minutes as a band: met volume counts even if weighted load dips", () => {
    // Full minute volume but all in the lightest modality → load ratio < 0.9,
    // yet the minute band carries it to complete.
    const v = dayVerdict({
      plannedLoad: 60, // e.g. a 40-min strength day
      actualLoad: 40 * 0.8, // 40 min cardio = 32 load, ratio 0.53
      plannedMin: 40,
      actualMin: 40,
      substituted: false,
      seed: 4,
    });
    expect(v?.bucket).toBe("complete");
  });

  it("a substitution that falls short is still short (no free pass)", () => {
    const v = dayVerdict({
      plannedLoad: 60,
      actualLoad: 20,
      plannedMin: 40,
      actualMin: 14,
      substituted: true, // detectSubstitution would be false here, but guard anyway
      seed: 5,
    });
    expect(v?.bucket).toBe("short");
  });
});
