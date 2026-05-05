// Task #228: unit coverage for the pure pace-personalization helper.
// Pairs with the integration coverage in routes/plan.test.ts that
// verifies the API actually plumbs `personalizedRacePace` onto race-day
// Sun rows in /plan/weeks/:week and /plan/today.

import { describe, it, expect } from "vitest";
import { RACE_DAY_SPECS } from "@workspace/plan-generator";
import {
  DEFAULT_LOOKBACK_WEEKS,
  MIN_QUALITY_SAMPLE,
  isPersonalizableQualityPlanDay,
  isQualityRunSession,
  personalizeQualityPace,
  personalizeRacePace,
} from "./personalized-race-pace";

describe("isQualityRunSession", () => {
  it("matches the generator's canonical quality session types", () => {
    expect(isQualityRunSession("Tempo Run")).toBe(true);
    expect(isQualityRunSession("Sharpener")).toBe(true);
    expect(isQualityRunSession("Speed")).toBe(true);
    // A logged Race counts as the highest-quality data point.
    expect(isQualityRunSession("Race")).toBe(true);
  });

  it("matches hand-edited / lowercase variants", () => {
    expect(isQualityRunSession("threshold intervals")).toBe(true);
    expect(isQualityRunSession("VO2 repeats")).toBe(true);
    expect(isQualityRunSession("10K race-pace")).toBe(true);
    expect(isQualityRunSession("race pace tempo")).toBe(true);
  });

  it("excludes easy aerobic sessions so they don't drag the average", () => {
    expect(isQualityRunSession("Long Run")).toBe(false);
    expect(isQualityRunSession("Aerobic Base")).toBe(false);
    expect(isQualityRunSession("Recovery")).toBe(false);
    expect(isQualityRunSession("Rest")).toBe(false);
    expect(isQualityRunSession(null)).toBe(false);
    expect(isQualityRunSession(undefined)).toBe(false);
    expect(isQualityRunSession("")).toBe(false);
  });
});

describe("personalizeRacePace", () => {
  it("falls back to the catalog when fewer than MIN_QUALITY_SAMPLE paces exist", () => {
    const result = personalizeRacePace({
      raceKind: "marathon",
      qualityPaces: ["10:00", "10:30"], // 2 < 3
    });
    expect(result.source).toBe("catalog");
    expect(result.pace).toBe(RACE_DAY_SPECS.marathon.pace);
    expect(result.sampleSize).toBe(0);
    expect(result.basisPaceSeconds).toBeNull();
    expect(result.lookbackWeeks).toBe(DEFAULT_LOOKBACK_WEEKS);
  });

  it("falls back to the catalog when no parseable paces exist", () => {
    const result = personalizeRacePace({
      raceKind: "half",
      qualityPaces: [null, undefined, "not a pace", ""],
    });
    expect(result.source).toBe("catalog");
    expect(result.pace).toBe(RACE_DAY_SPECS.half.pace);
    expect(result.sampleSize).toBe(0);
  });

  it("personalizes marathon pace with a +30s/mi offset off the avg quality pace", () => {
    // (600 + 630 + 660) / 3 = 630s = 10:30 avg, + 30s marathon offset = 11:00.
    const result = personalizeRacePace({
      raceKind: "marathon",
      qualityPaces: ["10:00", "10:30", "11:00"],
    });
    expect(result.source).toBe("personalized");
    expect(result.pace).toBe("11:00");
    expect(result.sampleSize).toBe(3);
    expect(result.basisPaceSeconds).toBe(630);
  });

  it("personalizes half pace with a +10s/mi offset", () => {
    // 600s avg, + 10s = 610s = 10:10
    const result = personalizeRacePace({
      raceKind: "half",
      qualityPaces: ["10:00", "10:00", "10:00"],
    });
    expect(result.source).toBe("personalized");
    expect(result.pace).toBe("10:10");
    expect(result.basisPaceSeconds).toBe(600);
  });

  it("personalizes 10K with a -5s/mi offset (slightly faster than tempo)", () => {
    // 600s avg, -5s = 595s = 9:55
    const result = personalizeRacePace({
      raceKind: "10k",
      qualityPaces: ["10:00", "10:00", "10:00"],
    });
    expect(result.source).toBe("personalized");
    expect(result.pace).toBe("9:55");
  });

  it("personalizes 5K with a -25s/mi offset (VO2 effort, much faster than tempo)", () => {
    // 600s avg, -25s = 575s = 9:35
    const result = personalizeRacePace({
      raceKind: "5k",
      qualityPaces: ["10:00", "10:00", "10:00"],
    });
    expect(result.source).toBe("personalized");
    expect(result.pace).toBe("9:35");
  });

  it("ignores unparseable entries but keeps personalizing on the parseable rest", () => {
    // 3 valid: 600, 630, 660 -> avg 630s -> +30 = 660 = 11:00
    const result = personalizeRacePace({
      raceKind: "marathon",
      qualityPaces: ["10:00", "10:30", "11:00", "garbage", null],
    });
    expect(result.source).toBe("personalized");
    expect(result.sampleSize).toBe(3);
    expect(result.pace).toBe("11:00");
  });

  it("requires at least MIN_QUALITY_SAMPLE parseable entries (constant is 3)", () => {
    expect(MIN_QUALITY_SAMPLE).toBe(3);
    const result = personalizeRacePace({
      raceKind: "marathon",
      qualityPaces: ["10:00", "10:30", "garbage"], // only 2 parse
    });
    expect(result.source).toBe("catalog");
  });

  it("falls back to the catalog when the personalized result is implausibly fast", () => {
    // 3 paces averaging 3:00/mi (180s) is impossible for any runner;
    // we'd rather print the catalog than a typo-shaped pace.
    const result = personalizeRacePace({
      raceKind: "5k",
      qualityPaces: ["3:00", "3:00", "3:00"],
    });
    expect(result.source).toBe("catalog");
    expect(result.pace).toBe(RACE_DAY_SPECS["5k"].pace);
  });

  it("respects an explicit lookbackWeeks override and reflects it in the response", () => {
    const result = personalizeRacePace({
      raceKind: "marathon",
      qualityPaces: ["10:00", "10:30", "11:00"],
      lookbackWeeks: 4,
    });
    expect(result.lookbackWeeks).toBe(4);
  });
});

// Task #236: unit coverage for the day-of-week + sessionType matcher
// that gates the prescribed-pace overlay onto the generator's Wed
// steady (Z3) and Fri tempo / threshold / race-pace slots — i.e. the
// rows the generator seeds with `tempoPace`. The W51 taper Sharpener
// (seeded with easyPace) and W52 Race Shakeout (also easyPace) are
// intentionally excluded so the tempo-average overlay never converts
// a taper / shake-out into a tempo prescription.
describe("isPersonalizableQualityPlanDay", () => {
  it("matches Wed Steady Run + Accessory (case-insensitive)", () => {
    expect(
      isPersonalizableQualityPlanDay({ day: "Wed", sessionType: "Steady Run + Accessory" }),
    ).toBe(true);
    expect(
      isPersonalizableQualityPlanDay({ day: "Wed", sessionType: "steady run + accessory" }),
    ).toBe(true);
    expect(
      isPersonalizableQualityPlanDay({ day: "Wed", sessionType: "STEADY RUN + ACCESSORY" }),
    ).toBe(true);
  });

  it("matches every tempo-seeded Fri quality variant the generator emits", () => {
    expect(isPersonalizableQualityPlanDay({ day: "Fri", sessionType: "Tempo Run" })).toBe(true);
    expect(
      isPersonalizableQualityPlanDay({ day: "Fri", sessionType: "Threshold Intervals" }),
    ).toBe(true);
    expect(
      isPersonalizableQualityPlanDay({ day: "Fri", sessionType: "Race-Pace Workout" }),
    ).toBe(true);
  });

  it("excludes Fri easy-paced variants the generator seeds (Sharpener, Race Shakeout, Aerobic Base)", () => {
    // Sharpener (W51 taper) and Race Shakeout (W52) are seeded with
    // `easyPace` in lib/plan-generator/src/index.ts:347 / :354 — the
    // tempo-average overlay would replace the taper recovery target
    // with a tempo-paced prescription if these matched. Cutback-week
    // Fridays surface as "Aerobic Base" (line :297/:304/:313/:322)
    // and are also easyPace.
    expect(isPersonalizableQualityPlanDay({ day: "Fri", sessionType: "Sharpener" })).toBe(false);
    expect(
      isPersonalizableQualityPlanDay({ day: "Fri", sessionType: "Race Shakeout" }),
    ).toBe(false);
    expect(isPersonalizableQualityPlanDay({ day: "Fri", sessionType: "Aerobic Base" })).toBe(false);
  });

  it("rejects the right day with the wrong sessionType", () => {
    // Wed only matches Steady Run + Accessory — a hand-edited Tempo on
    // Wed is intentionally NOT personalized (the offset model only
    // holds inside the Wed/Fri rhythm the recipe seeds).
    expect(isPersonalizableQualityPlanDay({ day: "Wed", sessionType: "Tempo Run" })).toBe(false);
    expect(isPersonalizableQualityPlanDay({ day: "Wed", sessionType: "Long Run" })).toBe(false);
    expect(isPersonalizableQualityPlanDay({ day: "Wed", sessionType: "Rest" })).toBe(false);
    // Fri only matches the three tempo-seeded variants — a
    // hand-edited Steady Run + Accessory on Fri is NOT personalized.
    expect(
      isPersonalizableQualityPlanDay({ day: "Fri", sessionType: "Steady Run + Accessory" }),
    ).toBe(false);
    expect(isPersonalizableQualityPlanDay({ day: "Fri", sessionType: "Long Run" })).toBe(false);
  });

  it("rejects every other day-of-week regardless of sessionType", () => {
    for (const day of ["Mon", "Tue", "Thu", "Sat", "Sun"]) {
      expect(isPersonalizableQualityPlanDay({ day, sessionType: "Tempo Run" })).toBe(false);
      expect(
        isPersonalizableQualityPlanDay({ day, sessionType: "Steady Run + Accessory" }),
      ).toBe(false);
    }
  });
});

// Task #236: unit coverage for the prescribed-pace personalizer.
// Same averaging + plausibility clamp as personalizeRacePace, but
// with NO per-kind offset and the row's catalog `pace` as the
// fallback (passed in by the route layer).
describe("personalizeQualityPace", () => {
  it("falls back to the supplied catalog pace when fewer than MIN_QUALITY_SAMPLE paces exist", () => {
    const result = personalizeQualityPace({
      qualityPaces: ["10:00", "10:30"], // 2 < 3
      catalogPace: "10:45",
    });
    expect(result.source).toBe("catalog");
    expect(result.pace).toBe("10:45");
    expect(result.sampleSize).toBe(0);
    expect(result.basisPaceSeconds).toBeNull();
    expect(result.lookbackWeeks).toBe(DEFAULT_LOOKBACK_WEEKS);
  });

  it("falls back to the supplied catalog pace when no parseable paces exist", () => {
    const result = personalizeQualityPace({
      qualityPaces: [null, undefined, "garbage", ""],
      catalogPace: "10:30",
    });
    expect(result.source).toBe("catalog");
    expect(result.pace).toBe("10:30");
    expect(result.sampleSize).toBe(0);
  });

  it("personalizes off the avg quality pace with NO per-kind offset", () => {
    // (600 + 630 + 660) / 3 = 630s = 10:30. No offset is applied for
    // the Wed steady / Fri tempo prescribed pace.
    const result = personalizeQualityPace({
      qualityPaces: ["10:00", "10:30", "11:00"],
      catalogPace: "10:45",
    });
    expect(result.source).toBe("personalized");
    expect(result.pace).toBe("10:30");
    expect(result.sampleSize).toBe(3);
    expect(result.basisPaceSeconds).toBe(630);
  });

  it("ignores unparseable entries but keeps personalizing on the parseable rest", () => {
    const result = personalizeQualityPace({
      qualityPaces: ["10:00", "10:30", "11:00", "garbage", null],
      catalogPace: "10:45",
    });
    expect(result.source).toBe("personalized");
    expect(result.sampleSize).toBe(3);
    expect(result.pace).toBe("10:30");
  });

  it("requires at least MIN_QUALITY_SAMPLE parseable entries", () => {
    expect(MIN_QUALITY_SAMPLE).toBe(3);
    const result = personalizeQualityPace({
      qualityPaces: ["10:00", "10:30", "garbage"],
      catalogPace: "10:45",
    });
    expect(result.source).toBe("catalog");
    expect(result.pace).toBe("10:45");
  });

  it("falls back to the catalog pace when the personalized result is implausibly fast", () => {
    const result = personalizeQualityPace({
      qualityPaces: ["3:00", "3:00", "3:00"],
      catalogPace: "10:30",
    });
    expect(result.source).toBe("catalog");
    expect(result.pace).toBe("10:30");
  });

  it("respects an explicit lookbackWeeks override and reflects it in the response", () => {
    const result = personalizeQualityPace({
      qualityPaces: ["10:00", "10:30", "11:00"],
      catalogPace: "10:45",
      lookbackWeeks: 4,
    });
    expect(result.lookbackWeeks).toBe(4);
  });
});
