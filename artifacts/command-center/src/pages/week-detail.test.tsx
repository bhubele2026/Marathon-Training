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
    expect(screen.queryByTestId("week-volume-miles")).toBeNull();
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
    expect(screen.getByTestId("week-volume-miles")).toBeTruthy();
    expect(screen.queryByTestId("week-volume-cardio-actual")).toBeNull();
  });
});
