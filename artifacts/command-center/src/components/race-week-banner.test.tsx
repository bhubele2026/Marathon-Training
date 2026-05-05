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
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const useGetRaceWeekMock = vi.fn();
const setRaceResultMutate = vi.fn();

vi.mock("@workspace/api-client-react", () => ({
  useGetRaceWeek: (...args: unknown[]) => useGetRaceWeekMock(...args),
  useSetRaceWeekChecklistItem: () => ({ mutate: vi.fn(), isPending: false }),
  useSetRaceResult: (opts: { mutation?: { onSuccess?: () => void } } = {}) => ({
    mutate: (vars: unknown) => {
      setRaceResultMutate(vars);
      opts.mutation?.onSuccess?.();
    },
    isPending: false,
  }),
  getGetRaceWeekQueryKey: () => ["/race-week"],
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
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
  setRaceResultMutate.mockReset();
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

describe("RaceWeekBanner — sibling Distance + Fueling tiles toned per race kind (Task #233)", () => {
  // The Distance and Fueling chips share the race-day stat row with
  // the louder Target Pace chip. Task #233 adds a hairline accent
  // (border + eyebrow-label color from the same HR_ZONE_TONES bucket)
  // so the trio reads as one race-kind unit. The full bg wash is
  // reserved for Target Pace so the pace chip still anchors the row.
  it("5K race day → Z5 red border accent on Distance + Fueling, no full bg wash", () => {
    setupRaceDay({ distanceMi: 3.1, description: "RACE DAY — 5K.", targetPace: "10:30" });
    render(<RaceWeekBanner />);
    for (const id of ["race-day-distance", "race-day-fueling"]) {
      const chip = screen.getByTestId(id);
      expect(chip.getAttribute("data-accent-zone-bucket")).toBe("5");
      expect(chip.getAttribute("data-zone-bucket")).toBeNull();
      expect(chip.className).toContain("border-red-500/40");
      // Hairline only — keep the muted background, no full bg wash.
      expect(chip.className).toContain("bg-background/60");
      expect(chip.className).not.toContain("bg-red-500/10");
      // Eyebrow label picks up the toned color rather than muted.
      const eyebrow = chip.querySelector("p");
      expect(eyebrow).not.toBeNull();
      expect(eyebrow!.className).toContain("text-red-700");
      expect(eyebrow!.className).not.toContain("text-muted-foreground");
    }
  });

  it("10K race day → Z4 orange border accent on Distance + Fueling", () => {
    setupRaceDay({ distanceMi: 6.2, description: "RACE DAY — 10K.", targetPace: "11:00" });
    render(<RaceWeekBanner />);
    for (const id of ["race-day-distance", "race-day-fueling"]) {
      const chip = screen.getByTestId(id);
      expect(chip.getAttribute("data-accent-zone-bucket")).toBe("4");
      expect(chip.className).toContain("border-orange-500/40");
      expect(chip.className).not.toContain("bg-orange-500/10");
    }
  });

  it("Half marathon race day → Z3 amber border accent on Distance + Fueling", () => {
    setupRaceDay({ distanceMi: 13.1, description: "RACE DAY — Half." });
    render(<RaceWeekBanner />);
    for (const id of ["race-day-distance", "race-day-fueling"]) {
      const chip = screen.getByTestId(id);
      expect(chip.getAttribute("data-accent-zone-bucket")).toBe("3");
      expect(chip.className).toContain("border-amber-500/40");
      expect(chip.className).not.toContain("bg-amber-500/10");
    }
  });

  it("Marathon race day → Z3 amber border accent on Distance + Fueling", () => {
    setupRaceDay({ distanceMi: 26.2, description: "RACE DAY — Marathon." });
    render(<RaceWeekBanner />);
    for (const id of ["race-day-distance", "race-day-fueling"]) {
      const chip = screen.getByTestId(id);
      expect(chip.getAttribute("data-accent-zone-bucket")).toBe("3");
      expect(chip.className).toContain("border-amber-500/40");
    }
  });

  it("falls back to muted tone on Distance + Fueling when racePlan distance isn't a real race kind", () => {
    setupRaceDay({ distanceMi: 8, description: "RACE DAY — Custom." });
    render(<RaceWeekBanner />);
    for (const id of ["race-day-distance", "race-day-fueling"]) {
      const chip = screen.getByTestId(id);
      expect(chip.getAttribute("data-accent-zone-bucket")).toBeNull();
      expect(chip.className).toContain("border-border");
      expect(chip.className).not.toMatch(/border-(amber|orange|red)-500\/40/);
    }
  });
});

describe("RaceWeekBanner — post-race result form / summary (Task #40)", () => {
  function setupPostRace(raceResult: unknown = null, daysAfterRace = 2) {
    useGetRaceWeekMock.mockReturnValue({
      data: {
        inWindow: true,
        isRaceDay: false,
        racePassed: true,
        daysToRace: 0,
        hoursToRace: 0,
        daysAfterRace,
        racePlan: null,
        raceResult,
        checklist: [],
      },
      isLoading: false,
    });
  }

  it("renders the empty form when no result has been logged yet", () => {
    setupPostRace(null);
    render(<RaceWeekBanner />);
    expect(screen.getByTestId("race-result-form")).toBeTruthy();
    expect(screen.queryByTestId("race-result-summary")).toBeNull();

    fireEvent.change(screen.getByTestId("input-finish-time"), {
      target: { value: "2:14:08" },
    });
    fireEvent.change(screen.getByTestId("input-placement-overall"), {
      target: { value: "312" },
    });
    fireEvent.click(screen.getByTestId("felt-rating-4"));
    fireEvent.submit(screen.getByTestId("race-result-form"));

    expect(setRaceResultMutate).toHaveBeenCalledTimes(1);
    expect(setRaceResultMutate.mock.calls[0][0]).toEqual({
      data: {
        finishTime: "2:14:08",
        placementOverall: 312,
        placementTotal: null,
        feltRating: 4,
        notes: null,
      },
    });
  });

  it("renders the saved summary when a result is present and supports re-opening for edit", () => {
    setupPostRace({
      raceDate: "2027-05-02",
      finishTime: "2:14:08",
      placementOverall: 312,
      placementTotal: 1804,
      feltRating: 4,
      notes: "Held the pace.",
      recordedAt: "2027-05-02T18:00:00.000Z",
      updatedAt: "2027-05-02T18:00:00.000Z",
    });
    render(<RaceWeekBanner />);
    const summary = screen.getByTestId("race-result-summary");
    expect(summary).toBeTruthy();
    expect(screen.getByTestId("race-result-finish-time").textContent).toContain(
      "2:14:08",
    );
    expect(screen.getByTestId("race-result-placement").textContent).toContain(
      "312 / 1804",
    );
    expect(screen.getByTestId("race-result-felt").textContent).toContain("4 / 5");
    expect(screen.getByTestId("race-result-notes").textContent).toContain(
      "Held the pace.",
    );

    fireEvent.click(screen.getByTestId("edit-race-result"));
    expect(screen.getByTestId("race-result-form")).toBeTruthy();
    expect(
      (screen.getByTestId("input-finish-time") as HTMLInputElement).value,
    ).toBe("2:14:08");
  });

  it("shows phased recovery guidance based on daysAfterRace", () => {
    setupPostRace(null, 2);
    const { rerender } = render(<RaceWeekBanner />);
    expect(screen.getByTestId("recovery-phase-1")).toBeTruthy();
    expect(screen.queryByTestId("recovery-phase-2")).toBeNull();

    setupPostRace(null, 6);
    rerender(<RaceWeekBanner />);
    expect(screen.getByTestId("recovery-phase-2")).toBeTruthy();

    setupPostRace(null, 10);
    rerender(<RaceWeekBanner />);
    expect(screen.getByTestId("recovery-phase-3")).toBeTruthy();
  });
});
