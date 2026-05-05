// Task #228: unit coverage for the pure pace-personalization helper.
// Pairs with the integration coverage in routes/plan.test.ts that
// verifies the API actually plumbs `personalizedRacePace` onto race-day
// Sun rows in /plan/weeks/:week and /plan/today.

import { describe, it, expect } from "vitest";
import { RACE_DAY_SPECS } from "@workspace/plan-generator";
import {
  DEFAULT_LOOKBACK_WEEKS,
  MIN_QUALITY_SAMPLE,
  isQualityRunSession,
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
