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

describe("Plan page — Reset Entire Plan now wipes to empty (no undo)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("opens a 'Plan cleared' toast WITHOUT an Undo button after a successful reset, and invalidates queries so EmptyPlanState surfaces", () => {
    renderPlan();

    fireEvent.click(screen.getByTestId("button-reset-plan"));
    const confirmInput = screen.getByTestId("input-confirm-reset-plan");
    fireEvent.change(confirmInput, { target: { value: "RESET PLAN" } });

    fireEvent.click(screen.getByTestId("button-confirm-reset-plan"));
    expect(resetPlanMutate).toHaveBeenCalledTimes(1);
    const [, options] = resetPlanMutate.mock.calls[0] as [
      unknown,
      { onSuccess?: (data: unknown) => void },
    ];
    expect(options.onSuccess).toBeTypeOf("function");

    // Server now always returns null undoToken / undoExpiresInSeconds.
    act(() => {
      options.onSuccess!({
        daysReset: 5,
        weeksReset: 2,
        daysTotal: 5,
        undoToken: null,
        undoExpiresInSeconds: null,
      });
    });

    expect(screen.getByText("Plan cleared")).toBeTruthy();
    expect(
      screen.getByText(/5 days across 2 weeks cleared/i),
    ).toBeTruthy();
    // No Undo button anymore — Reset Entire Plan is destructive without undo.
    expect(screen.queryByTestId("button-undo-reset-plan")).toBeNull();
    // The undo mutation hook is never invoked from the Reset Entire Plan path.
    expect(undoPlanResetMutate).not.toHaveBeenCalled();
    // The success path invalidates queries so hasPlan flips and the
    // EmptyPlanState CTA surfaces across /, /today, /plan.
    expect(invalidateQueriesSpy).toHaveBeenCalled();
  });

  it("shows a 'Nothing to reset' toast when the plan tables were already empty", () => {
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
