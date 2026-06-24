import { describe, expect, it } from "vitest";
import { adherenceStatus, adherenceTextClass } from "./adherence";

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
