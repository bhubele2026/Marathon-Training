import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// Stub the generated React Query hooks the page imports. The page only
// reads the `data` and `isLoading` shape off the query result, so we
// return the bare minimum each test needs. `useGetUserPreferences` is
// what `RunTargetLine` reads to pick the user's chosen run-targeting
// mode — fixed to "effort" so the asserted label/text is deterministic.
vi.mock("@workspace/api-client-react", () => ({
  useListWorkouts: vi.fn(),
  useDeleteWorkout: () => ({ mutate: vi.fn() }),
  useGetUserPreferences: () => ({ data: { runTargetingMode: "effort" } }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>(
    "@tanstack/react-query",
  );
  return { ...actual, useQueryClient: () => ({ invalidateQueries: vi.fn() }) };
});

vi.mock("@/components/workout-form", () => ({
  WorkoutForm: () => <div data-testid="workout-form-stub" />,
}));

import { useListWorkouts } from "@workspace/api-client-react";
import Log from "./log";

const mockedUseListWorkouts = vi.mocked(useListWorkouts);

function makeWorkout(over: Record<string, unknown> = {}) {
  return {
    id: 100,
    planDayId: 42,
    date: "2026-04-01",
    sessionType: "Long Run",
    equipment: "Outdoor Run",
    equipmentList: ["Outdoor Run"],
    durationMin: 60,
    strengthMin: null,
    cardioMin: null,
    runMin: 60,
    totalMin: 60,
    distanceMi: 6,
    pace: "10:00",
    avgHr: 145,
    rpe: 6,
    strengthLoad: null,
    totalLoad: 100,
    notes: null,
    timeOfDay: null,
    modality: null,
    prescribedRunTarget: null,
    createdAt: "2026-04-01T12:00:00Z",
    ...over,
  };
}

function renderWithWorkouts(rows: Array<ReturnType<typeof makeWorkout>>) {
  mockedUseListWorkouts.mockReturnValue({
    data: rows,
    isLoading: false,
  } as unknown as ReturnType<typeof useListWorkouts>);
  return render(<Log />);
}

describe("Training Log — prescribed run target column (Task #140)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the prescribed run target line next to the actuals when the joined plan day is a run-shaped session", () => {
    renderWithWorkouts([
      makeWorkout({
        id: 100,
        prescribedRunTarget: {
          sessionType: "Long Run",
          week: 4,
          runMin: 60,
          distanceMi: 6,
          pace: "10:00",
        },
      }),
    ]);

    const target = screen.getByTestId("log-row-100-run-target");
    // Surface the user's chosen mode tag so they remember what they're
    // looking at — mocked to "effort" above.
    expect(target.getAttribute("data-run-targeting-mode")).toBe("effort");
    expect(target.textContent).toContain("Effort");
  });

  it("does NOT render a prescribed run target line for rows without a joined plan day (off-plan / quick-logged Lifestyle)", () => {
    renderWithWorkouts([
      makeWorkout({ id: 101, prescribedRunTarget: null }),
    ]);

    expect(screen.queryByTestId("log-row-101-run-target")).toBeNull();
  });

  it("does NOT render a prescribed run target line when the joined plan day is a non-run session (rest / strength / cardio)", () => {
    // RunTargetLine returns null when `isRunSession` is false, even if a
    // prescribedRunTarget snapshot is present. This keeps the table cell
    // tidy on Strength / Cardio days that happen to have a planDayId.
    renderWithWorkouts([
      makeWorkout({
        id: 102,
        sessionType: "Strength + Cardio",
        runMin: null,
        distanceMi: null,
        pace: null,
        prescribedRunTarget: {
          sessionType: "Strength + Cardio",
          week: 4,
          runMin: null,
          distanceMi: null,
          pace: null,
        },
      }),
    ]);

    expect(screen.queryByTestId("log-row-102-run-target")).toBeNull();
  });
});
