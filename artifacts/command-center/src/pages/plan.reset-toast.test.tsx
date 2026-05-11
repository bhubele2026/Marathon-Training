import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  act,
} from "@testing-library/react";

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
  useListPlannerConfigs: () => ({
    data: { configs: [{ id: 1 }] },
    isError: false,
  }),
  useResetPlan: () => ({ mutate: resetPlanMutate, isPending: false }),
  useUndoPlanReset: () => ({ mutate: undoPlanResetMutate, isPending: false }),
  useFullResetPlan: () => ({ mutate: vi.fn(), isPending: false }),
  useGetPlanWeek: () => ({ data: undefined, isLoading: false }),
  getGetPlanWeekQueryKey: (week: number) => ["plan-week", week],
}));

const invalidateQueriesSpy = vi.fn();
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: invalidateQueriesSpy }),
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

describe("Plan page — Reset Entire Plan wipes plan with ~30s undo", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("opens a 'Plan cleared' toast WITH an Undo button after a successful reset, and dispatches the token when clicked", () => {
    renderPlan();

    fireEvent.click(screen.getByTestId("button-reset-plan"));
    fireEvent.change(screen.getByTestId("input-confirm-reset-plan"), {
      target: { value: "RESET PLAN" },
    });

    fireEvent.click(screen.getByTestId("button-confirm-reset-plan"));
    expect(resetPlanMutate).toHaveBeenCalledTimes(1);
    const [, options] = resetPlanMutate.mock.calls[0] as [
      unknown,
      { onSuccess?: (data: unknown) => void },
    ];
    expect(options.onSuccess).toBeTypeOf("function");

    act(() => {
      options.onSuccess!({
        daysReset: 5,
        weeksReset: 2,
        daysTotal: 5,
        undoToken: "tok-abc",
        undoExpiresInSeconds: 30,
      });
    });

    expect(screen.getByText("Plan cleared")).toBeTruthy();
    expect(
      screen.getByText(/5 days across 2 weeks cleared/i),
    ).toBeTruthy();
    // Success path invalidates queries so hasPlan flips and the
    // EmptyPlanState CTA surfaces across /, /today, /plan.
    expect(invalidateQueriesSpy).toHaveBeenCalled();

    // Undo button is present and dispatches the token to the undo mutation.
    const undoBtn = screen.getByTestId("button-undo-reset-plan");
    fireEvent.click(undoBtn);
    expect(undoPlanResetMutate).toHaveBeenCalledTimes(1);
    const [undoArgs] = undoPlanResetMutate.mock.calls[0] as [
      { data: { undoToken: string } },
      unknown,
    ];
    expect(undoArgs.data.undoToken).toBe("tok-abc");
  });

  it("shows a 'Nothing to reset' toast and no Undo button when the plan tables were already empty", () => {
    renderPlan();

    fireEvent.click(screen.getByTestId("button-reset-plan"));
    fireEvent.change(screen.getByTestId("input-confirm-reset-plan"), {
      target: { value: "RESET PLAN" },
    });
    fireEvent.click(screen.getByTestId("button-confirm-reset-plan"));

    const [, options] = resetPlanMutate.mock.calls[0] as [
      unknown,
      { onSuccess?: (data: unknown) => void },
    ];
    act(() => {
      options.onSuccess!({
        daysReset: 0,
        weeksReset: 0,
        daysTotal: 0,
        undoToken: null,
        undoExpiresInSeconds: null,
      });
    });

    expect(screen.getByText("Nothing to reset")).toBeTruthy();
    expect(screen.queryByTestId("button-undo-reset-plan")).toBeNull();
  });
});
