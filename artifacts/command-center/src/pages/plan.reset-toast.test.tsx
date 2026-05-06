import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  act,
} from "@testing-library/react";

// Capture mutate calls so the test can drive the reset → toast → undo flow
// end-to-end. The hoisted refs let the vi.mock factory close over the same
// vi.fn() instances the test asserts against.
const { resetPlanMutate, undoPlanResetMutate } = vi.hoisted(() => ({
  resetPlanMutate: vi.fn(),
  undoPlanResetMutate: vi.fn(),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/plan", vi.fn()] as const,
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetPlanOverview: () => ({
    data: {
      currentWeek: 1,
      currentPhase: "Aerobic Base",
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
      hasPlan: true,
    },
    isLoading: false,
  }),
  useListPlanWeeks: () => ({
    data: [
      {
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
      },
    ],
    isLoading: false,
  }),
  useResetPlan: () => ({ mutate: resetPlanMutate, isPending: false }),
  useUndoPlanReset: () => ({ mutate: undoPlanResetMutate, isPending: false }),
  useFullResetPlan: () => ({ mutate: vi.fn(), isPending: false }),
  useGetPlanWeek: () => ({ data: undefined, isLoading: false }),
  getGetPlanWeekQueryKey: (week: number) => ["plan-week", week],
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/lib/invalidate-mission-queries", () => ({
  invalidateMissionRelatedQueries: vi.fn(),
}));

import Plan from "./plan";
import { Toaster } from "@/components/ui/toaster";

function renderPlan() {
  return render(
    <>
      <Plan />
      <Toaster />
    </>,
  );
}

describe("Plan page — reset → toast → undo end-to-end (task #69)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("opens the toast with an Undo button after a successful plan reset, and clicking Undo posts the captured token", () => {
    renderPlan();

    // 1. Open the confirmation dialog.
    fireEvent.click(screen.getByTestId("button-reset-plan"));

    // 2. Type the confirm phrase to enable the action button.
    const confirmInput = screen.getByTestId("input-confirm-reset-plan");
    fireEvent.change(confirmInput, { target: { value: "RESET PLAN" } });

    // 3. Confirm the reset and capture the mutate options so we can simulate
    //    the API response.
    fireEvent.click(screen.getByTestId("button-confirm-reset-plan"));
    expect(resetPlanMutate).toHaveBeenCalledTimes(1);
    const [, options] = resetPlanMutate.mock.calls[0] as [
      unknown,
      { onSuccess?: (data: unknown) => void },
    ];
    expect(options.onSuccess).toBeTypeOf("function");

    // 4. Drive the success callback as the API would, then assert the toast
    //    surfaces with both the descriptive copy and the live Undo button.
    act(() => {
      options.onSuccess!({
        daysReset: 5,
        weeksReset: 2,
        undoToken: "tok-abc-123",
        undoExpiresInSeconds: 30,
      });
    });

    expect(screen.getByText("Plan reset")).toBeTruthy();
    expect(
      screen.getByText(/5 days across 2 weeks restored/i),
    ).toBeTruthy();
    const undoButton = screen.getByTestId("button-undo-reset-plan");
    expect(undoButton.textContent).toMatch(/Undo \(\d+s\)/);

    // 5. Click Undo and verify it dispatches the captured token to the
    //    /api/plan/reset/undo endpoint via useUndoPlanReset.
    fireEvent.click(undoButton);
    expect(undoPlanResetMutate).toHaveBeenCalledTimes(1);
    const [body] = undoPlanResetMutate.mock.calls[0] as [
      { data: { undoToken: string } },
    ];
    expect(body).toEqual({ data: { undoToken: "tok-abc-123" } });
  });
});
