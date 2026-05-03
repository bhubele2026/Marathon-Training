import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("wouter", () => ({
  useParams: () => ({ week: "1" }),
  useLocation: () => ["/plan/1", vi.fn()] as const,
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetPlanWeek: vi.fn(),
  useListWorkouts: () => ({ data: [] }),
  useResetPlanDay: () => ({ mutate: vi.fn(), isPending: false }),
  useResetPlanWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useUndoPlanReset: () => ({ mutate: vi.fn(), isPending: false }),
  getGetPlanWeekQueryKey: () => ["plan-week"],
  getListWorkoutsQueryKey: () => ["workouts"],
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/hooks/use-mission-actions", () => ({
  useMissionActions: () => ({
    openLog: vi.fn(),
    openEdit: vi.fn(),
    requestDelete: vi.fn(),
    requestSkip: vi.fn(),
    crushIt: vi.fn(),
    isDeleting: false,
    isCrushing: false,
    dialogs: null,
  }),
}));

vi.mock("@/lib/invalidate-mission-queries", () => ({
  invalidateMissionRelatedQueries: vi.fn(),
}));

import { useGetPlanWeek } from "@workspace/api-client-react";
import WeekDetail from "./week-detail";

const mockWeek = vi.mocked(useGetPlanWeek);

function renderWith(week: unknown) {
  mockWeek.mockReturnValue({
    data: week,
    isLoading: false,
  } as unknown as ReturnType<typeof useGetPlanWeek>);
  return render(<WeekDetail />);
}

describe("Week detail — bike/row cardio summary (task #109)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows actual / planned cardio minutes on bike-only weeks", () => {
    renderWith({
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
      actualCardio: 95,
      completedSessions: 1,
      totalSessions: 3,
      missedSessions: 0,
      dominantCardioEquipment: "Peloton Bike",
      days: [],
    });
    const headline = screen.getByTestId("week-volume-cardio-actual");
    expect(headline.textContent).toContain("95 / 180 min cardio");
    // Task #112: partial cardio actual → amber tint.
    expect(headline.getAttribute("data-adherence")).toBe("in-progress");
    expect(headline.className).toContain("amber");
    expect(screen.queryByTestId("week-volume-miles")).toBeNull();
  });

  it("colors the cardio headline green when the runner hits planned minutes", () => {
    renderWith({
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
      actualCardio: 180,
      completedSessions: 3,
      totalSessions: 3,
      missedSessions: 0,
      dominantCardioEquipment: "Peloton Bike",
      days: [],
    });
    const headline = screen.getByTestId("week-volume-cardio-actual");
    expect(headline.getAttribute("data-adherence")).toBe("met");
    expect(headline.className).toContain("emerald");
  });

  it("keeps a future cardio week neutral (0 actual)", () => {
    renderWith({
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
      days: [],
    });
    const headline = screen.getByTestId("week-volume-cardio-actual");
    expect(headline.getAttribute("data-adherence")).toBe("neutral");
    expect(headline.className).not.toContain("emerald");
    expect(headline.className).not.toContain("amber");
  });

  it("keeps the mileage headline on run-based weeks", () => {
    renderWith({
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
      days: [],
    });
    const headline = screen.getByTestId("week-volume-miles");
    expect(headline).toBeTruthy();
    // Task #112: 12 / 20 planned miles → amber tint.
    expect(headline.getAttribute("data-adherence")).toBe("in-progress");
    expect(headline.className).toContain("amber");
    expect(screen.queryByTestId("week-volume-cardio-actual")).toBeNull();
  });

  it("colors the mileage headline green when planned miles are met", () => {
    renderWith({
      week: 2,
      phase: "Run Block",
      startDate: "2026-05-11",
      endDate: "2026-05-17",
      plannedStrength: 0,
      plannedCardio: 0,
      plannedTotalLoad: 0,
      plannedMiles: 20,
      longRunMi: 8,
      actualMiles: 21,
      actualCardio: 0,
      completedSessions: 4,
      totalSessions: 4,
      missedSessions: 0,
      dominantCardioEquipment: null,
      days: [],
    });
    const headline = screen.getByTestId("week-volume-miles");
    expect(headline.getAttribute("data-adherence")).toBe("met");
    expect(headline.className).toContain("emerald");
  });
});
