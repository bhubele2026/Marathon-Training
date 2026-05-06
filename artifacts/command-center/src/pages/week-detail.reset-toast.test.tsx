import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  act,
} from "@testing-library/react";

const { resetPlanWeekMutate, undoPlanResetMutate } = vi.hoisted(() => ({
  resetPlanWeekMutate: vi.fn(),
  undoPlanResetMutate: vi.fn(),
}));

vi.mock("wouter", () => ({
  useParams: () => ({ week: "1" }),
  useLocation: () => ["/plan/1", vi.fn()] as const,
  useSearch: () => "",
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetPlanWeek: () => ({
    data: {
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
      days: [],
    },
    isLoading: false,
  }),
  useListWorkouts: () => ({ data: [] }),
  useResetPlanDay: () => ({ mutate: vi.fn(), isPending: false }),
  useResetPlanWeek: () => ({ mutate: resetPlanWeekMutate, isPending: false }),
  useUndoPlanReset: () => ({ mutate: undoPlanResetMutate, isPending: false }),
  // Task #308: week-detail now reads useGetPlanOverview +
  // useListPlannerConfigs to drive the first-run redirect. Default to
  // hasPlan=true and a non-empty configs list so the redirect never
  // fires from this test surface.
  useGetPlanOverview: () => ({
    data: { hasPlan: true },
    isError: false,
  }),
  useListPlannerConfigs: () => ({
    data: { configs: [{ id: 1 }] },
    isError: false,
  }),
  useGetUserPreferences: () => ({
    data: { runTargetingMode: "effort", maxHr: 200, restingHr: null },
  }),
  getGetPlanWeekQueryKey: () => ["plan-week"],
  getListWorkoutsQueryKey: () => ["workouts"],
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
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

import WeekDetail from "./week-detail";
import { Toaster } from "@/components/ui/toaster";

describe("Week detail — reset week → toast → undo end-to-end (task #69)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("opens the toast with an Undo button after a successful week reset, and clicking Undo posts the captured token", () => {
    render(
      <>
        <WeekDetail />
        <Toaster />
      </>,
    );

    // 1. Open the bulk-reset confirmation dialog.
    fireEvent.click(screen.getByTestId("button-reset-week"));

    // 2. Confirm the reset, capturing the mutate options so the test can
    //    drive the success branch as the API would.
    fireEvent.click(screen.getByTestId("button-confirm-reset-week"));
    expect(resetPlanWeekMutate).toHaveBeenCalledTimes(1);
    const [args, options] = resetPlanWeekMutate.mock.calls[0] as [
      { week: number },
      { onSuccess?: (data: unknown) => void },
    ];
    expect(args).toEqual({ week: 1 });
    expect(options.onSuccess).toBeTypeOf("function");

    act(() => {
      options.onSuccess!({
        daysReset: 3,
        weeksReset: 1,
        undoToken: "tok-week-xyz",
        undoExpiresInSeconds: 30,
      });
    });

    // 3. Toast surfaces with the week-specific copy + the Undo countdown.
    expect(screen.getByText("Week reset")).toBeTruthy();
    expect(
      screen.getByText(/3 days in week 1 restored to the original plan/i),
    ).toBeTruthy();
    const undoButton = screen.getByTestId("button-undo-reset-week");
    expect(undoButton.textContent).toMatch(/Undo \(\d+s\)/);

    // 4. Clicking Undo posts the captured token to /api/plan/reset/undo.
    fireEvent.click(undoButton);
    expect(undoPlanResetMutate).toHaveBeenCalledTimes(1);
    const [body] = undoPlanResetMutate.mock.calls[0] as [
      { data: { undoToken: string } },
    ];
    expect(body).toEqual({ data: { undoToken: "tok-week-xyz" } });
  });
});
