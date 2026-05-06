import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("wouter", () => ({
  useLocation: () => ["/plan", vi.fn()] as const,
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetPlanOverview: vi.fn(),
  useListPlanWeeks: vi.fn(),
  useResetPlan: () => ({ mutate: vi.fn(), isPending: false }),
  useUndoPlanReset: () => ({ mutate: vi.fn(), isPending: false }),
  useFullResetPlan: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/lib/invalidate-mission-queries", () => ({
  invalidateMissionRelatedQueries: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

import {
  useGetPlanOverview,
  useListPlanWeeks,
} from "@workspace/api-client-react";
import Plan from "./plan";

const mockOverview = vi.mocked(useGetPlanOverview);
const mockWeeks = vi.mocked(useListPlanWeeks);

// `raceKind` is widened explicitly so per-test overrides can pin it to
// any of the four canonical race kinds (or null) without the inferred
// type narrowing it to just `null`.
const OVERVIEW: {
  currentWeek: number;
  currentPhase: string;
  totalWeeks: number;
  weeksRemaining: number;
  raceDate: string;
  startDate: string;
  startWeight: number;
  currentWeight: number;
  goalWeight: number;
  weeklyMilesTarget: number;
  longRunTarget: number;
  raceKind: "marathon" | "half" | "10k" | "5k" | null;
  activeConfigName: string;
  hasPlan: boolean;
} = {
  hasPlan: true,
  currentWeek: 1,
  currentPhase: "Bike Block",
  totalWeeks: 2,
  weeksRemaining: 1,
  raceDate: "2027-05-02",
  startDate: "2026-05-04",
  startWeight: 280,
  currentWeight: 270,
  goalWeight: 210,
  weeklyMilesTarget: 0,
  longRunTarget: 0,
  raceKind: null,
  activeConfigName: "Workout Plan",
};

function renderWith(
  weeks: unknown,
  overviewOverrides: Partial<typeof OVERVIEW> = {},
) {
  mockOverview.mockReturnValue({
    data: { ...OVERVIEW, ...overviewOverrides },
    isLoading: false,
  } as unknown as ReturnType<typeof useGetPlanOverview>);
  mockWeeks.mockReturnValue({
    data: weeks,
    isLoading: false,
  } as unknown as ReturnType<typeof useListPlanWeeks>);
  return render(<Plan />);
}

describe("Plan page — bike/row cardio summary (task #109)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows actual / planned cardio minutes on bike-only weeks", () => {
    renderWith([
      {
        week: 1,
        phase: "Bike Block",
        startDate: "2026-05-04",
        endDate: "2026-05-10",
        plannedStrength: 0,
        plannedCardio: 180,
        plannedTotalLoad: 0,
        plannedMiles: 0,
        longRunMi: 0,
        actualMiles: 0,
        actualCardio: 120,
        completedSessions: 2,
        totalSessions: 3,
        missedSessions: 0,
        dominantCardioEquipment: "Peloton Bike",
      },
    ]);
    const headline = screen.getByTestId("week-volume-cardio-actual-1");
    expect(headline.textContent).toContain("120 / 180 min cardio");
    // Task #112: in-progress (some actual, below planned) → amber tint.
    expect(headline.getAttribute("data-adherence")).toBe("in-progress");
    expect(headline.className).toContain("amber");
    // Mileage headline must not render on a cardio-only week.
    expect(screen.queryByTestId("week-volume-miles-1")).toBeNull();
  });

  it("colors the cardio headline green when planned cardio minutes are met", () => {
    renderWith([
      {
        week: 1,
        phase: "Bike Block",
        startDate: "2026-05-04",
        endDate: "2026-05-10",
        plannedStrength: 0,
        plannedCardio: 180,
        plannedTotalLoad: 0,
        plannedMiles: 0,
        longRunMi: 0,
        actualMiles: 0,
        actualCardio: 200,
        completedSessions: 3,
        totalSessions: 3,
        missedSessions: 0,
        dominantCardioEquipment: "Peloton Bike",
      },
    ]);
    const headline = screen.getByTestId("week-volume-cardio-actual-1");
    expect(headline.getAttribute("data-adherence")).toBe("met");
    expect(headline.className).toContain("emerald");
  });

  it("leaves a future cardio week neutral (0 actual, planned > 0)", () => {
    renderWith([
      {
        week: 1,
        phase: "Bike Block",
        startDate: "2026-05-04",
        endDate: "2026-05-10",
        plannedStrength: 0,
        plannedCardio: 180,
        plannedTotalLoad: 0,
        plannedMiles: 0,
        longRunMi: 0,
        actualMiles: 0,
        actualCardio: 0,
        completedSessions: 0,
        totalSessions: 3,
        missedSessions: 0,
        dominantCardioEquipment: "Peloton Bike",
      },
    ]);
    const headline = screen.getByTestId("week-volume-cardio-actual-1");
    expect(headline.getAttribute("data-adherence")).toBe("neutral");
    expect(headline.className).not.toContain("emerald");
    expect(headline.className).not.toContain("amber");
  });

  it("keeps the mileage headline on run-based weeks (no cardio actual/planned)", () => {
    renderWith([
      {
        week: 2,
        phase: "Run Block",
        startDate: "2026-05-11",
        endDate: "2026-05-17",
        plannedStrength: 0,
        plannedCardio: 0,
        plannedTotalLoad: 0,
        plannedMiles: 20,
        longRunMi: 8,
        actualMiles: 12,
        actualCardio: 0,
        completedSessions: 1,
        totalSessions: 4,
        missedSessions: 0,
        dominantCardioEquipment: null,
      },
    ]);
    const headline = screen.getByTestId("week-volume-miles-2");
    expect(headline).toBeTruthy();
    // Task #112: 12 of 20 planned mi → in-progress tint.
    expect(headline.getAttribute("data-adherence")).toBe("in-progress");
    expect(headline.className).toContain("amber");
    expect(screen.queryByTestId("week-volume-cardio-actual-2")).toBeNull();
  });

  it("shows a long-run chip under the mileage headline on run weeks (task #115)", () => {
    renderWith([
      {
        week: 2,
        phase: "Run Block",
        startDate: "2026-05-11",
        endDate: "2026-05-17",
        plannedStrength: 0,
        plannedCardio: 0,
        plannedTotalLoad: 0,
        plannedMiles: 20,
        longRunMi: 8,
        actualMiles: 12,
        actualCardio: 0,
        completedSessions: 1,
        totalSessions: 4,
        missedSessions: 0,
        dominantCardioEquipment: null,
      },
    ]);
    const chip = screen.getByTestId("week-volume-miles-chip-2");
    expect(chip.textContent).toContain("Long Run 8.00 mi");
  });

  it("falls back to a session count chip on run weeks with no long run (task #115)", () => {
    renderWith([
      {
        week: 3,
        phase: "Run Block",
        startDate: "2026-05-18",
        endDate: "2026-05-24",
        plannedStrength: 0,
        plannedCardio: 0,
        plannedTotalLoad: 0,
        plannedMiles: 5,
        longRunMi: 0,
        actualMiles: 0,
        actualCardio: 0,
        completedSessions: 0,
        totalSessions: 3,
        missedSessions: 0,
        dominantCardioEquipment: null,
      },
    ]);
    const chip = screen.getByTestId("week-volume-miles-chip-3");
    expect(chip.textContent).toContain("3 Sessions");
  });

  it("does not render the run-week chip on bike/row weeks (task #115)", () => {
    renderWith([
      {
        week: 1,
        phase: "Bike Block",
        startDate: "2026-05-04",
        endDate: "2026-05-10",
        plannedStrength: 0,
        plannedCardio: 180,
        plannedTotalLoad: 0,
        plannedMiles: 0,
        longRunMi: 0,
        actualMiles: 0,
        actualCardio: 120,
        completedSessions: 2,
        totalSessions: 3,
        missedSessions: 0,
        dominantCardioEquipment: "Peloton Bike",
      },
    ]);
    expect(screen.queryByTestId("week-volume-miles-chip-1")).toBeNull();
  });

  it("renders the amber Steady chip on weeks where wedSteady=true (task #175)", () => {
    // Two run weeks side-by-side: one with a Steady Wed (Marathon-Specific
    // non-cutback), one with the canonical easy Wed. The chip must show
    // up only on the steady week so runners can see at a glance which
    // weeks earn the Z3 stimulus — and use the same amber-400 swatch
    // HR_ZONE_COLORS[3] uses for the Run Target chip on Today / Week
    // Detail so Z3 reads the same everywhere in the app.
    renderWith([
      {
        week: 5,
        phase: "Marathon-Specific",
        startDate: "2026-06-01",
        endDate: "2026-06-07",
        plannedStrength: 0,
        plannedCardio: 0,
        plannedTotalLoad: 0,
        plannedMiles: 30,
        longRunMi: 14,
        actualMiles: 0,
        actualCardio: 0,
        completedSessions: 0,
        totalSessions: 5,
        missedSessions: 0,
        dominantCardioEquipment: null,
        wedSteady: true,
      },
      {
        week: 8,
        phase: "Marathon-Specific",
        startDate: "2026-06-22",
        endDate: "2026-06-28",
        plannedStrength: 0,
        plannedCardio: 0,
        plannedTotalLoad: 0,
        plannedMiles: 22,
        longRunMi: 10,
        actualMiles: 0,
        actualCardio: 0,
        completedSessions: 0,
        totalSessions: 5,
        missedSessions: 0,
        dominantCardioEquipment: null,
        // Cutback week: the Wed eases so the chip must NOT show.
        wedSteady: false,
      },
    ]);
    const chip = screen.getByTestId("badge-steady-week-5");
    expect(chip.textContent).toContain("Steady");
    // Same amber-400 swatch HR_ZONE_COLORS[3] uses for the Run Target
    // chip — drift would visually disconnect the calendar from Today.
    expect(chip.className).toContain("amber");
    expect(screen.queryByTestId("badge-steady-week-8")).toBeNull();
  });

  it("does not render the Steady chip when wedSteady is null/false (task #175)", () => {
    // Empty / freshly seeded weeks come back with wedSteady=null; legacy
    // backends that haven't shipped the field yet send undefined. Either
    // way the chip must stay dormant so we don't accidentally light it
    // up on every week of the calendar.
    renderWith([
      {
        week: 1,
        phase: "Base",
        startDate: "2026-05-04",
        endDate: "2026-05-10",
        plannedStrength: 0,
        plannedCardio: 0,
        plannedTotalLoad: 0,
        plannedMiles: 12,
        longRunMi: 4,
        actualMiles: 0,
        actualCardio: 0,
        completedSessions: 0,
        totalSessions: 4,
        missedSessions: 0,
        dominantCardioEquipment: null,
        wedSteady: null,
      },
    ]);
    expect(screen.queryByTestId("badge-steady-week-1")).toBeNull();
  });

  it("colors the mileage headline green when planned miles are met", () => {
    renderWith([
      {
        week: 2,
        phase: "Run Block",
        startDate: "2026-05-11",
        endDate: "2026-05-17",
        plannedStrength: 0,
        plannedCardio: 0,
        plannedTotalLoad: 0,
        plannedMiles: 20,
        longRunMi: 8,
        actualMiles: 22,
        actualCardio: 0,
        completedSessions: 4,
        totalSessions: 4,
        missedSessions: 0,
        dominantCardioEquipment: null,
      },
    ]);
    const headline = screen.getByTestId("week-volume-miles-2");
    expect(headline.getAttribute("data-adherence")).toBe("met");
    expect(headline.className).toContain("emerald");
  });
});

describe("Plan page — header title from active planner config name (task #244)", () => {
  // Task #244 stops hardcoding the /plan header title from raceKind
  // and reads it directly from `overview.activeConfigName` — whatever
  // the runner named their planner config. The subtitle still flips
  // between "Weeks to Race Day" (race-anchored) and "Weeks Remaining"
  // (non-race) based on raceKind / phase ladder so race countdowns
  // are preserved.
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const stubWeek = {
    week: 1,
    phase: "Aerobic Base",
    startDate: "2026-05-04",
    endDate: "2026-05-10",
    plannedStrength: 0,
    plannedCardio: 0,
    plannedTotalLoad: 0,
    plannedMiles: 20,
    longRunMi: 6,
    actualMiles: 0,
    actualCardio: 0,
    completedSessions: 0,
    totalSessions: 4,
    missedSessions: 0,
    dominantCardioEquipment: null,
  };

  it("uses the active planner config's name verbatim as the header title", () => {
    renderWith([stubWeek], {
      raceKind: "5k",
      activeConfigName: "My Custom 5K Push",
    });
    const title = screen.getByTestId("plan-header-title");
    expect(title.textContent).toBe("My Custom 5K Push");
    expect(title.getAttribute("data-race-kind")).toBe("5k");
  });

  it("flips the subtitle to 'Weeks to Race Day' on race-anchored plans", () => {
    renderWith([stubWeek], {
      raceKind: "half",
      activeConfigName: "Half Marathon Build",
    });
    expect(screen.getByTestId("plan-header-title").textContent).toBe(
      "Half Marathon Build",
    );
    const subtitle = screen.getByTestId("plan-header-subtitle");
    expect(subtitle.textContent).toContain("Weeks to Race Day");
    expect(subtitle.textContent).not.toContain("Weeks Remaining");
  });

  it("falls back to the Marathon-Specific phase signal for the subtitle when raceKind is missing", () => {
    // A stale cached /plan/overview that pre-dates raceKind must
    // still treat the auto-pinned Marathon-Specific tail as a race
    // signal so the marathon countdown copy survives.
    renderWith([{ ...stubWeek, phase: "Marathon-Specific" }], {
      raceKind: null,
      activeConfigName: "Marathon Mission",
    });
    expect(screen.getByTestId("plan-header-title").textContent).toBe(
      "Marathon Mission",
    );
    expect(screen.getByTestId("plan-header-subtitle").textContent).toContain(
      "Weeks to Race Day",
    );
  });

  it("uses 'Weeks Remaining' framing on tonal-first / non-race plans", () => {
    renderWith([stubWeek], {
      raceKind: null,
      activeConfigName: "Tonal Upper 8wk",
    });
    const title = screen.getByTestId("plan-header-title");
    expect(title.textContent).toBe("Tonal Upper 8wk");
    expect(title.getAttribute("data-race-kind")).toBe("");
    const subtitle = screen.getByTestId("plan-header-subtitle");
    expect(subtitle.textContent).toContain("Weeks Remaining");
    expect(subtitle.textContent).toContain("Ends");
  });

  it("falls back to 'Workout Plan' when the active config name is empty", () => {
    renderWith([stubWeek], { raceKind: null, activeConfigName: "" });
    expect(screen.getByTestId("plan-header-title").textContent).toBe(
      "Workout Plan",
    );
  });
});
