// Render tests for the dashboard race-week banner — specifically the
// race-day hero's "Target Pace" stat tile. Task #227 tones that tile
// in the runner's race-kind zone color (5K→VO2 red, 10K→threshold
// orange, marathon/half→race-pace amber) so the dashboard chip stays
// in lockstep with the prescribed pace chip on Today / week-detail.
//
// We mock the api-client-react hooks so the banner can render without
// a QueryClient + server, and feed it a `racePlan` shaped like the
// /race-week response for each race kind.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const useGetRaceWeekMock = vi.fn();

vi.mock("@workspace/api-client-react", () => ({
  useGetRaceWeek: (...args: unknown[]) => useGetRaceWeekMock(...args),
  useSetRaceWeekChecklistItem: () => ({ mutate: vi.fn(), isPending: false }),
  getGetRaceWeekQueryKey: () => ["/race-week"],
}));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>(
    "@tanstack/react-query",
  );
  return {
    ...actual,
    useQueryClient: () => ({
      getQueryData: vi.fn(),
      setQueryData: vi.fn(),
      cancelQueries: vi.fn(),
      invalidateQueries: vi.fn(),
    }),
  };
});

import { RaceWeekBanner } from "./race-week-banner";

afterEach(() => {
  cleanup();
  useGetRaceWeekMock.mockReset();
});

function setupRaceDay(opts: {
  distanceMi: number;
  description: string;
  targetPace?: string | null;
}) {
  useGetRaceWeekMock.mockReturnValue({
    data: {
      inWindow: true,
      isRaceDay: true,
      racePassed: false,
      daysToRace: 0,
      hoursToRace: 0,
      racePlan: {
        distanceMi: opts.distanceMi,
        description: opts.description,
        targetPace: opts.targetPace ?? "11:30",
        fuelingNote: "Per plan",
      },
      checklist: [],
    },
    isLoading: false,
  });
}

describe("RaceWeekBanner — race-day Target Pace tile (Task #227)", () => {
  it("5K race day → Z5 red tone on the Target Pace chip", () => {
    setupRaceDay({ distanceMi: 3.1, description: "RACE DAY — 5K.", targetPace: "10:30" });
    render(<RaceWeekBanner />);
    const chip = screen.getByTestId("race-day-target-pace");
    expect(chip.getAttribute("data-zone-bucket")).toBe("5");
    expect(chip.className).toContain("border-red-500/40");
    expect(chip.className).toContain("bg-red-500/10");
    // Generic muted card surface must NOT leak through when toned.
    expect(chip.className).not.toContain("bg-background/60");
    expect(chip.className).not.toContain("border-border");
    expect(chip.textContent).toContain("10:30/mi");
  });

  it("10K race day → Z4 orange tone on the Target Pace chip", () => {
    setupRaceDay({ distanceMi: 6.2, description: "RACE DAY — 10K.", targetPace: "11:00" });
    render(<RaceWeekBanner />);
    const chip = screen.getByTestId("race-day-target-pace");
    expect(chip.getAttribute("data-zone-bucket")).toBe("4");
    expect(chip.className).toContain("border-orange-500/40");
    expect(chip.className).toContain("bg-orange-500/10");
  });

  it("Half marathon race day → Z3 amber tone (paired with marathon as race-pace)", () => {
    setupRaceDay({ distanceMi: 13.1, description: "RACE DAY — Half." });
    render(<RaceWeekBanner />);
    const chip = screen.getByTestId("race-day-target-pace");
    expect(chip.getAttribute("data-zone-bucket")).toBe("3");
    expect(chip.className).toContain("border-amber-500/40");
    expect(chip.className).toContain("bg-amber-500/10");
  });

  it("Marathon race day → Z3 amber tone", () => {
    setupRaceDay({ distanceMi: 26.2, description: "RACE DAY — Marathon." });
    render(<RaceWeekBanner />);
    const chip = screen.getByTestId("race-day-target-pace");
    expect(chip.getAttribute("data-zone-bucket")).toBe("3");
    expect(chip.className).toContain("border-amber-500/40");
    expect(chip.className).toContain("bg-amber-500/10");
  });

  it("falls back to the generic muted tone when racePlan distance doesn't match a real race kind", () => {
    // Defensive fallback: if the API ever returns a non-canonical
    // distance (legacy / hand-edited row), the chip should still
    // render but without a zone tone (no data-zone-bucket attribute,
    // no zone color class). The generic background/border kicks in.
    setupRaceDay({ distanceMi: 8, description: "RACE DAY — Custom." });
    render(<RaceWeekBanner />);
    const chip = screen.getByTestId("race-day-target-pace");
    expect(chip.getAttribute("data-zone-bucket")).toBeNull();
    expect(chip.className).toContain("bg-background/60");
    expect(chip.className).toContain("border-border");
    // None of the zone-color classes should appear.
    expect(chip.className).not.toMatch(/border-(amber|orange|red)-500\/40/);
  });
});
