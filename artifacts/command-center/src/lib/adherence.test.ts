import { describe, expect, it } from "vitest";
import {
  adherenceStatus,
  adherenceTextClass,
  entryLoad,
  loadFromMinutes,
  detectSubstitution,
} from "./adherence";

describe("adherenceStatus", () => {
  it("returns 'met' when actual meets the planned target", () => {
    expect(adherenceStatus(180, 180)).toBe("met");
  });

  it("returns 'met' when actual exceeds the planned target", () => {
    expect(adherenceStatus(200, 180)).toBe("met");
  });

  it("returns 'in-progress' when actual is between 0 and planned", () => {
    expect(adherenceStatus(120, 180)).toBe("in-progress");
  });

  it("returns 'neutral' on an untouched future-style week (0 actual, planned > 0)", () => {
    expect(adherenceStatus(0, 180)).toBe("neutral");
  });

  it("returns 'neutral' when there is no planned target", () => {
    expect(adherenceStatus(45, 0)).toBe("neutral");
  });

  it("treats null/undefined as 0", () => {
    expect(adherenceStatus(null, 30)).toBe("neutral");
    expect(adherenceStatus(undefined, undefined)).toBe("neutral");
    expect(adherenceStatus(15, null)).toBe("neutral");
  });
});

describe("adherenceTextClass", () => {
  it("uses an emerald tone for met targets", () => {
    expect(adherenceTextClass("met")).toContain("success");
  });

  it("uses an amber tone for in-progress targets", () => {
    expect(adherenceTextClass("in-progress")).toContain("warning");
  });

  it("returns an empty class for neutral so the headline inherits the default color", () => {
    expect(adherenceTextClass("neutral")).toBe("");
  });
});

describe("loadFromMinutes / entryLoad", () => {
  it("weights strength heaviest, run next, cardio lightest", () => {
    expect(loadFromMinutes({ strengthMin: 10 })).toBeCloseTo(15);
    expect(loadFromMinutes({ runMin: 10 })).toBeCloseTo(10);
    expect(loadFromMinutes({ cardioMin: 10 })).toBeCloseTo(8);
  });

  it("prefers the server-computed totalLoad when present", () => {
    expect(entryLoad({ totalLoad: 72, strengthMin: 1 })).toBe(72);
  });

  it("falls back to weighted minute buckets, then to flat total/duration", () => {
    expect(entryLoad({ strengthMin: 20 })).toBeCloseTo(30);
    expect(entryLoad({ totalMin: 25 })).toBe(25);
    expect(entryLoad({ durationMin: 18 })).toBe(18);
    expect(entryLoad({})).toBe(0);
  });
});

describe("detectSubstitution", () => {
  it("flags a met day done through a different modality mix (cardio plan → lift + run)", () => {
    expect(
      detectSubstitution(
        { cardioMin: 40 },
        { strengthMin: 10.6, runMin: 30 },
        45.9 / 32, // met
      ),
    ).toBe(true);
  });

  it("does NOT flag substitution when the day fell short on load", () => {
    expect(
      detectSubstitution({ cardioMin: 40 }, { strengthMin: 10 }, 0.4),
    ).toBe(false);
  });

  it("does NOT flag substitution when the modality mix matches the plan", () => {
    expect(
      detectSubstitution({ strengthMin: 40 }, { strengthMin: 42 }, 1.05),
    ).toBe(false);
  });

  it("returns false when either side logged nothing", () => {
    expect(detectSubstitution({}, { strengthMin: 30 }, 1)).toBe(false);
    expect(detectSubstitution({ cardioMin: 40 }, {}, 1)).toBe(false);
  });
});
