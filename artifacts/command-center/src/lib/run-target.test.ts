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

  // Task #146 — Karvonen / heart-rate-reserve formula:
  //   bpm = ((maxHr - restingHr) * pct) + restingHr
  describe("Karvonen (HR reserve) when restingHr is provided", () => {
    it("computes ranges via the HR reserve formula when both HRs are set", () => {
      // maxHr=200, restingHr=50 → reserve=150.
      // Zone 2 = 60-70% reserve + 50 = 140-155.
      expect(hrZoneBpmRange(2, 200, 50)).toEqual({ low: 140, high: 155 });
      // Zone 4 = 80-90% reserve + 50 = 170-185.
      expect(hrZoneBpmRange(4, 200, 50)).toEqual({ low: 170, high: 185 });
    });

    it("ignores restingHr that's outside the realistic range", () => {
      // restingHr=20 is below the floor → fall back to % of max (60-70% of 200 = 120-140).
      expect(hrZoneBpmRange(2, 200, 20)).toEqual({ low: 120, high: 140 });
      // restingHr=150 is above the ceiling → fall back to % of max.
      expect(hrZoneBpmRange(2, 200, 150)).toEqual({ low: 120, high: 140 });
    });

    it("ignores restingHr that isn't strictly less than maxHr", () => {
      // restingHr >= maxHr would produce nonsense → fall back.
      expect(hrZoneBpmRange(2, 100, 100)).toEqual({ low: 60, high: 70 });
      expect(hrZoneBpmRange(2, 100, 110)).toEqual({ low: 60, high: 70 });
    });

    it("treats null/undefined restingHr as the legacy % of max model", () => {
      expect(hrZoneBpmRange(2, 200, null)).toEqual({ low: 120, high: 140 });
      expect(hrZoneBpmRange(2, 200, undefined)).toEqual({ low: 120, high: 140 });
    });

    it("still returns null when maxHr itself is missing or out of range", () => {
      expect(hrZoneBpmRange(2, null, 50)).toBeNull();
      expect(hrZoneBpmRange(2, 50, 40)).toBeNull();
    });
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

  it("uses Karvonen ranges when both maxHr and restingHr are set (Task #146)", () => {
    expect(
      formatRunTarget("hr_zones", {
        ...baseInput,
        maxHr: 200,
        restingHr: 50,
      }),
    ).toEqual({ primary: "Zone 2 · 140-155 bpm", modeLabel: "HR Zone" });
  });

  it("falls back to % of max when only maxHr is set (restingHr null)", () => {
    expect(
      formatRunTarget("hr_zones", {
        ...baseInput,
        maxHr: 200,
        restingHr: null,
      }),
    ).toEqual({ primary: "Zone 2 · 120-140 bpm", modeLabel: "HR Zone" });
  });
});
