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

const OVERVIEW = {
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
};

function renderWith(weeks: unknown) {
  mockOverview.mockReturnValue({
    data: OVERVIEW,
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
