// Render tests for the prescribed-run target line. Locks in the
// Task #227 race-week pace chip behavior: when a `zoneBucket` prop is
// supplied (race-day Sun on dashboard / Today / week-detail), the
// prominent chip wrapper picks up the matching HR_ZONE_TONES tone
// (border + background + eyebrow label color) instead of the generic
// `border-primary/30 bg-primary/5` primary tone the chip has used
// since Task #134.
//
// We mock the run-targeting-mode hook so the chip renders without a
// QueryClient, then assert on the `data-zone-bucket` attribute and
// the wrapper class string for each race kind.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/hooks/use-run-targeting-mode", () => ({
  useRunTargetingMode: () => "pace",
  useMaxHr: () => null,
  useRestingHr: () => null,
  useHrZoneModel: () => "five_zone_max",
}));

import { RunTargetLine } from "./run-target-line";

afterEach(() => {
  cleanup();
});

describe("RunTargetLine — generic prominent chip (no zoneBucket)", () => {
  it("uses the legacy primary border + bg when no zoneBucket is supplied", () => {
    render(
      <RunTargetLine
        sessionType="Easy Run"
        week={4}
        runMin={30}
        distanceMi={3}
        pace="9:30"
        variant="prominent"
        testId="t-target"
      />,
    );
    const chip = screen.getByTestId("t-target");
    expect(chip.className).toContain("border-primary/30");
    expect(chip.className).toContain("bg-primary/5");
    expect(chip.getAttribute("data-zone-bucket")).toBeNull();
  });
});

describe("RunTargetLine — race-week pace chip toned per race kind (Task #227)", () => {
  // Build a race-day-shaped row. Pace value drifts per race kind to
  // mirror RACE_DAY_SPECS so the chip text reads like the real chip
  // does in production.
  function renderRaceChip(opts: {
    distanceMi: number;
    pace: string;
    zoneBucket: 1 | 2 | 3 | 4 | 5;
  }) {
    render(
      <RunTargetLine
        sessionType="Race"
        week={18}
        runMin={Math.round(opts.distanceMi * 11)}
        distanceMi={opts.distanceMi}
        pace={opts.pace}
        variant="prominent"
        testId="race-target"
        zoneBucket={opts.zoneBucket}
      />,
    );
    return screen.getByTestId("race-target");
  }

  it("marathon → Z3 amber tone", () => {
    const chip = renderRaceChip({ distanceMi: 26.2, pace: "11:30", zoneBucket: 3 });
    expect(chip.getAttribute("data-zone-bucket")).toBe("3");
    expect(chip.className).toContain("border-warning/40");
    expect(chip.className).toContain("bg-warning/10");
    // Legacy primary tone must NOT leak through when toned.
    expect(chip.className).not.toContain("border-primary/30");
    expect(chip.className).not.toContain("bg-primary/5");
    // Pace text still flows through to `-primary`.
    expect(screen.getByTestId("race-target-primary").textContent).toContain("11:30/mi");
  });

  it("half → Z3 amber tone (paired with marathon as race-pace per task #227 brief)", () => {
    const chip = renderRaceChip({ distanceMi: 13.1, pace: "11:30", zoneBucket: 3 });
    expect(chip.getAttribute("data-zone-bucket")).toBe("3");
    expect(chip.className).toContain("border-warning/40");
    expect(chip.className).toContain("bg-warning/10");
  });

  it("10K → Z4 orange tone (threshold)", () => {
    const chip = renderRaceChip({ distanceMi: 6.2, pace: "11:00", zoneBucket: 4 });
    expect(chip.getAttribute("data-zone-bucket")).toBe("4");
    expect(chip.className).toContain("border-warning/40");
    expect(chip.className).toContain("bg-warning/10");
    expect(screen.getByTestId("race-target-primary").textContent).toContain("11:00/mi");
  });

  it("5K → Z5 red tone (VO2)", () => {
    const chip = renderRaceChip({ distanceMi: 3.1, pace: "10:30", zoneBucket: 5 });
    expect(chip.getAttribute("data-zone-bucket")).toBe("5");
    expect(chip.className).toContain("border-red-500/40");
    expect(chip.className).toContain("bg-red-500/10");
    expect(screen.getByTestId("race-target-primary").textContent).toContain("10:30/mi");
  });

  it("renders a one-line zone-vocabulary caption decoding the tone (task #234)", () => {
    // Each toned chip surfaces a short hint using the same Z3/Z4/Z5 +
    // threshold/VO2 vocabulary used by the Settings preview so the
    // colors stop looking decorative — runners learn red 5K means
    // "hard / VO2 effort" while amber marathon means "settle in".
    renderRaceChip({ distanceMi: 3.1, pace: "10:30", zoneBucket: 5 });
    const hint5k = screen.getByTestId("race-target-zone-hint");
    expect(hint5k.textContent).toContain("Z5");
    expect(hint5k.textContent?.toLowerCase()).toContain("vo2");
    cleanup();

    renderRaceChip({ distanceMi: 6.2, pace: "11:00", zoneBucket: 4 });
    const hint10k = screen.getByTestId("race-target-zone-hint");
    expect(hint10k.textContent).toContain("Z4");
    expect(hint10k.textContent?.toLowerCase()).toContain("threshold");
    cleanup();

    renderRaceChip({ distanceMi: 26.2, pace: "11:30", zoneBucket: 3 });
    const hintMar = screen.getByTestId("race-target-zone-hint");
    expect(hintMar.textContent).toContain("Z3");
  });

  it("does NOT render a zone-vocabulary caption on the untoned generic chip (task #234)", () => {
    render(
      <RunTargetLine
        sessionType="Easy Run"
        week={4}
        runMin={30}
        distanceMi={3}
        pace="9:30"
        variant="prominent"
        testId="generic-target"
      />,
    );
    expect(screen.queryByTestId("generic-target-zone-hint")).toBeNull();
  });

  it("eyebrow label switches from text-primary to the toned label color", () => {
    renderRaceChip({ distanceMi: 3.1, pace: "10:30", zoneBucket: 5 });
    // The "Run Target · Pace" eyebrow lives inside the chip; locate it
    // by text and assert the toned label class won out over text-primary.
    const chip = screen.getByTestId("race-target");
    const eyebrow = chip.querySelector("p");
    expect(eyebrow).not.toBeNull();
    expect(eyebrow!.className).toContain("text-red-700");
    expect(eyebrow!.className).toContain("dark:text-red-300");
    expect(eyebrow!.className).not.toContain("text-primary");
  });
});
