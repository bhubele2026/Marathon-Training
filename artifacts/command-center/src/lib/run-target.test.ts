import { describe, expect, it } from "vitest";
import {
  formatRunTarget,
  getHrZoneModelDef,
  hrZoneBpmRange,
  hrZoneLabel,
  resolveHrZoneModel,
} from "./run-target";

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
      bucket: 2,
    });
    expect(
      formatRunTarget("hr_zones", { ...baseInput, maxHr: null }),
    ).toEqual({ primary: "Zone 2", modeLabel: "HR Zone", bucket: 2 });
  });

  it("appends the personalized BPM range when maxHr is set", () => {
    expect(
      formatRunTarget("hr_zones", { ...baseInput, maxHr: 200 }),
    ).toEqual({
      primary: "Zone 2 · 120-140 bpm",
      modeLabel: "HR Zone",
      bucket: 2,
    });
  });

  it("uses the same intensity bucket for hard sessions", () => {
    // tempo / threshold maps to bucket 4 (80-90% of max).
    expect(
      formatRunTarget("hr_zones", {
        ...baseInput,
        sessionType: "tempo run",
        maxHr: 200,
      }),
    ).toEqual({
      primary: "Zone 4 · 160-180 bpm",
      modeLabel: "HR Zone",
      bucket: 4,
    });
  });

  it("falls back to the generic label when maxHr is out of range", () => {
    expect(
      formatRunTarget("hr_zones", { ...baseInput, maxHr: 50 }),
    ).toEqual({ primary: "Zone 2", modeLabel: "HR Zone", bucket: 2 });
  });

  it("uses Karvonen ranges when both maxHr and restingHr are set (Task #146)", () => {
    expect(
      formatRunTarget("hr_zones", {
        ...baseInput,
        maxHr: 200,
        restingHr: 50,
      }),
    ).toEqual({
      primary: "Zone 2 · 140-155 bpm",
      modeLabel: "HR Zone",
      bucket: 2,
    });
  });

  it("falls back to % of max when only maxHr is set (restingHr null)", () => {
    expect(
      formatRunTarget("hr_zones", {
        ...baseInput,
        maxHr: 200,
        restingHr: null,
      }),
    ).toEqual({
      primary: "Zone 2 · 120-140 bpm",
      modeLabel: "HR Zone",
      bucket: 2,
    });
  });

  // Task #165: callers on Today and the expanded plan card use the
  // returned bucket to look up `HR_ZONE_COLORS[bucket]` for the colored
  // swatch shown next to "Zone N · …". Locking it in so the buckets
  // stay aligned with the Settings preview ramp (1=grey, 2=green,
  // 3=yellow, 4=orange, 5=red).
  // Task #158 — alternate zone models
  describe("alternate HR zone models", () => {
    it("five_zone_max stays the default and matches the legacy ranges", () => {
      // Bucket 2 = Zone 2 = 60-70% of 200 = 120-140 — same as the
      // baseline test above, but routed through the explicit model
      // parameter to lock in equivalence.
      expect(hrZoneBpmRange(2, 200, null, "five_zone_max")).toEqual({
        low: 120,
        high: 140,
      });
      expect(hrZoneLabel(2, "five_zone_max")).toBe("Zone 2");
    });

    it("friel_7_zone exposes 7 zones and renders Friel zone labels", () => {
      const def = getHrZoneModelDef("friel_7_zone");
      expect(def.zones.map((z) => z.label)).toEqual([
        "Zone 1",
        "Zone 2",
        "Zone 3",
        "Zone 4",
        "Zone 5a",
        "Zone 5b",
        "Zone 5c",
      ]);
      // intensityBucket("tempo run") = 4 → Friel Zone 4 (84-88% max).
      expect(
        formatRunTarget("hr_zones", {
          sessionType: "tempo run",
          week: 4,
          runMin: 30,
          maxHr: 200,
          hrZoneModel: "friel_7_zone",
        }),
      ).toEqual({
        primary: "Zone 4 · 168-176 bpm",
        modeLabel: "HR Zone",
        bucket: 4,
      });
      // bucket 5 (vo2/intervals) is mapped to Z5b, not Z5c.
      expect(hrZoneLabel(5, "friel_7_zone")).toBe("Zone 5b");
    });

    it("polarized_3_zone collapses easy/long to Z1 and tempo to Z2", () => {
      // Easy run (bucket 2) → Polarized Z1.
      expect(
        formatRunTarget("hr_zones", {
          sessionType: "easy run",
          week: 4,
          runMin: 30,
          maxHr: 200,
          hrZoneModel: "polarized_3_zone",
        }).primary,
      ).toBe("Z1 Easy · 100-160 bpm");
      // Tempo run (bucket 4) → Polarized Z2.
      expect(hrZoneLabel(4, "polarized_3_zone")).toBe("Z2 Threshold");
      // VO2 (bucket 5) → Polarized Z3.
      expect(hrZoneLabel(5, "polarized_3_zone")).toBe("Z3 Hard");
    });

    it("coggan_5_zone uses Coggan-style names", () => {
      expect(hrZoneLabel(1, "coggan_5_zone")).toBe("Z1 Active Recovery");
      expect(hrZoneLabel(4, "coggan_5_zone")).toBe("Z4 Threshold");
      // Karvonen still applies — Coggan Z4 is 85-94% of HRR over a
      // 200/50 athlete = 50 + (150 * .85)..50 + (150 * .94) = 178-191.
      expect(hrZoneBpmRange(4, 200, 50, "coggan_5_zone")).toEqual({
        low: 178,
        high: 191,
      });
    });

    it("resolveHrZoneModel falls back to five_zone_max for null/unknown values", () => {
      expect(resolveHrZoneModel(null)).toBe("five_zone_max");
      expect(resolveHrZoneModel(undefined)).toBe("five_zone_max");
      // Casts a bogus string to satisfy the union; we want runtime
      // resilience, not a compile error.
      expect(
        resolveHrZoneModel("nonsense" as unknown as Parameters<typeof resolveHrZoneModel>[0]),
      ).toBe("five_zone_max");
    });
  });

  it("returns the intensity bucket so HR-zone callers can color the swatch", () => {
    expect(
      formatRunTarget("hr_zones", { ...baseInput, sessionType: "recovery jog" })
        .bucket,
    ).toBe(1);
    expect(formatRunTarget("hr_zones", baseInput).bucket).toBe(2);
    expect(
      formatRunTarget("hr_zones", { ...baseInput, sessionType: "tempo run" })
        .bucket,
    ).toBe(4);
    expect(
      formatRunTarget("hr_zones", { ...baseInput, sessionType: "vo2 intervals" })
        .bucket,
    ).toBe(5);
  });
});
