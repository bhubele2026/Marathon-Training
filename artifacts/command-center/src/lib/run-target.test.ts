import { describe, expect, it } from "vitest";
import { formatRunTarget, hrZoneBpmRange } from "./run-target";

describe("hrZoneBpmRange", () => {
  it("returns null when maxHr is missing", () => {
    expect(hrZoneBpmRange(2, null)).toBeNull();
    expect(hrZoneBpmRange(2, undefined)).toBeNull();
  });

  it("returns null when maxHr is outside the realistic range", () => {
    expect(hrZoneBpmRange(2, 50)).toBeNull();
    expect(hrZoneBpmRange(2, 250)).toBeNull();
    expect(hrZoneBpmRange(2, Number.NaN)).toBeNull();
  });

  it("computes BPM ranges using the % of max model", () => {
    // maxHr = 200 makes the math obvious: each zone is a clean 20 bpm wide.
    expect(hrZoneBpmRange(1, 200)).toEqual({ low: 100, high: 120 });
    expect(hrZoneBpmRange(2, 200)).toEqual({ low: 120, high: 140 });
    expect(hrZoneBpmRange(3, 200)).toEqual({ low: 140, high: 160 });
    expect(hrZoneBpmRange(4, 200)).toEqual({ low: 160, high: 180 });
    expect(hrZoneBpmRange(5, 200)).toEqual({ low: 180, high: 200 });
  });

  it("rounds to whole BPM values", () => {
    // maxHr = 185 → Zone 2 = 60-70% = 111-129.5 → 111-130
    expect(hrZoneBpmRange(2, 185)).toEqual({ low: 111, high: 130 });
  });
});

describe("formatRunTarget hr_zones mode", () => {
  const baseInput = {
    sessionType: "easy run",
    week: 4,
    runMin: 30,
  };

  it("renders the generic Zone N label when no maxHr is configured", () => {
    expect(formatRunTarget("hr_zones", baseInput)).toEqual({
      primary: "Zone 2",
      modeLabel: "HR Zone",
    });
    expect(
      formatRunTarget("hr_zones", { ...baseInput, maxHr: null }),
    ).toEqual({ primary: "Zone 2", modeLabel: "HR Zone" });
  });

  it("appends the personalized BPM range when maxHr is set", () => {
    expect(
      formatRunTarget("hr_zones", { ...baseInput, maxHr: 200 }),
    ).toEqual({ primary: "Zone 2 · 120-140 bpm", modeLabel: "HR Zone" });
  });

  it("uses the same intensity bucket for hard sessions", () => {
    // tempo / threshold maps to bucket 4 (80-90% of max).
    expect(
      formatRunTarget("hr_zones", {
        ...baseInput,
        sessionType: "tempo run",
        maxHr: 200,
      }),
    ).toEqual({ primary: "Zone 4 · 160-180 bpm", modeLabel: "HR Zone" });
  });

  it("falls back to the generic label when maxHr is out of range", () => {
    expect(
      formatRunTarget("hr_zones", { ...baseInput, maxHr: 50 }),
    ).toEqual({ primary: "Zone 2", modeLabel: "HR Zone" });
  });
});
