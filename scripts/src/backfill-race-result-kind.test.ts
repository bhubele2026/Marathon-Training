// Unit tests for the race-result kind backfill (task #320). The pure
// classifier wraps the shared `detectRaceKind` helper — exhaustive
// coverage for that helper lives next to the helper itself; here we
// just spot-check that the wrapper handles the missing-plan_day case
// and forwards the description-then-distance fallback chain.

import { describe, expect, it } from "vitest";
import { classifyRaceKind } from "./backfill-race-result-kind";

describe("classifyRaceKind", () => {
  it("returns null when no plan_day exists at the race date", () => {
    expect(classifyRaceKind(null)).toBeNull();
  });

  it("returns null when the plan_day is not a recognised race day", () => {
    expect(
      classifyRaceKind({
        distanceMi: 10,
        description: "Long aerobic run (10 mi): conversational pace.",
        sessionType: "Long Run",
      }),
    ).toBeNull();
  });

  it("classifies a half-marathon race day from the description prefix", () => {
    expect(
      classifyRaceKind({
        distanceMi: 13.1,
        description: "RACE DAY — Half Marathon. Execute the plan, trust the build.",
        sessionType: "Race",
      }),
    ).toBe("half");
  });

  it("falls back to distance when the description prefix has been stripped", () => {
    expect(
      classifyRaceKind({
        distanceMi: 26.2,
        description: "Marathon today — go get it.",
        sessionType: "Race",
      }),
    ).toBe("marathon");
  });

  it("classifies a 5K race day", () => {
    expect(
      classifyRaceKind({
        distanceMi: 3.1,
        description: "RACE DAY — 5K. Sharp and short.",
        sessionType: "Race",
      }),
    ).toBe("5k");
  });

  it("classifies a 10K race day", () => {
    expect(
      classifyRaceKind({
        distanceMi: 6.2,
        description: "RACE DAY — 10K. Settle in fast.",
        sessionType: "Race",
      }),
    ).toBe("10k");
  });

  it("returns null for a 13.1 mi long run that is NOT a race session", () => {
    // Without an explicit race signal a stray 13.1 mi long run must not
    // mis-classify as a half-marathon race day.
    expect(
      classifyRaceKind({
        distanceMi: 13.1,
        description: "Long aerobic run (13.1 mi): conversational pace.",
        sessionType: "Long Run",
      }),
    ).toBeNull();
  });
});
