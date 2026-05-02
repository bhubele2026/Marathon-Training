import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, act } from "@testing-library/react";

vi.mock("@workspace/api-client-react", () => ({
  useCreateWorkout: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  }),
  useUpdateWorkout: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  }),
  useDeleteWorkout: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/lib/invalidate-mission-queries", () => ({
  invalidateMissionRelatedQueries: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const workoutFormSpy = vi.fn();
vi.mock("@/components/workout-form", () => ({
  WorkoutForm: (props: { open: boolean; initial?: { equipmentList?: string[]; equipment?: string } }) => {
    workoutFormSpy(props);
    return props.open ? (
      <div data-testid="workout-form-stub">
        {(props.initial?.equipmentList ?? []).map((eq, i) => (
          <span key={i} data-testid={`form-initial-eq-${i}`}>{eq}</span>
        ))}
      </div>
    ) : null;
  },
}));

import { useMissionActions, type MissionContext } from "./use-mission-actions";

function Harness({ ctx }: { ctx: MissionContext }) {
  const { openLog, dialogs } = useMissionActions();
  return (
    <>
      <button data-testid="open-log" onClick={() => openLog(ctx)}>open</button>
      {dialogs}
    </>
  );
}

afterEach(() => {
  cleanup();
  workoutFormSpy.mockClear();
});

describe("useMissionActions.openLog", () => {
  it("propagates plan.equipmentList into the manual log form initial values", () => {
    const ctx: MissionContext = {
      date: "2026-05-05",
      plan: {
        id: 42,
        date: "2026-05-05",
        equipment: "Tonal",
        equipmentList: ["Tonal", "Peloton Bike"],
        sessionType: "Strength + Cardio",
        strengthMin: 30,
        cardioMin: 25,
        runMin: null,
        totalMin: 55,
        distanceMi: null,
        totalLoad: 60,
      } as unknown as MissionContext["plan"],
      loggedWorkout: null,
      suggestions: null,
    };
    render(<Harness ctx={ctx} />);
    act(() => {
      screen.getByTestId("open-log").click();
    });
    expect(screen.getByTestId("workout-form-stub")).toBeTruthy();
    expect(screen.getByTestId("form-initial-eq-0").textContent).toBe("Tonal");
    expect(screen.getByTestId("form-initial-eq-1").textContent).toBe("Peloton Bike");
    const lastCall = workoutFormSpy.mock.calls.at(-1)![0];
    expect(lastCall.initial.equipmentList).toEqual(["Tonal", "Peloton Bike"]);
    expect(lastCall.initial.equipment).toBe("Tonal");
  });

  it("falls back to [equipment] when plan has no equipmentList (legacy plan-day rows)", () => {
    const ctx: MissionContext = {
      date: "2026-05-06",
      plan: {
        id: 43,
        date: "2026-05-06",
        equipment: "Peloton Tread",
        equipmentList: null,
        sessionType: "Run",
        strengthMin: null,
        cardioMin: 30,
        runMin: 30,
        totalMin: 30,
        distanceMi: 3.1,
        totalLoad: null,
      } as unknown as MissionContext["plan"],
      loggedWorkout: null,
      suggestions: null,
    };
    render(<Harness ctx={ctx} />);
    act(() => {
      screen.getByTestId("open-log").click();
    });
    expect(screen.getByTestId("form-initial-eq-0").textContent).toBe("Peloton Tread");
    expect(screen.queryByTestId("form-initial-eq-1")).toBeNull();
    const lastCall = workoutFormSpy.mock.calls.at(-1)![0];
    expect(lastCall.initial.equipmentList).toEqual(["Peloton Tread"]);
  });
});
