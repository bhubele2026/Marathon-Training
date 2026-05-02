import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mockSetLocation = vi.fn();
vi.mock("wouter", () => ({
  useLocation: () => ["/planner", mockSetLocation] as const,
}));

const mockPutMutate = vi.fn();
const mockApplyMutate = vi.fn();
const mockUseGet = vi.fn();
const mockUsePut = vi.fn();
const mockUseApply = vi.fn();

vi.mock("@workspace/api-client-react", () => ({
  useGetPlannerConfig: () => mockUseGet(),
  usePutPlannerConfig: () => mockUsePut(),
  useApplyPlannerConfig: () => mockUseApply(),
  getGetPlannerConfigQueryKey: () => ["planner-config"],
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/lib/invalidate-mission-queries", () => ({
  invalidateMissionRelatedQueries: vi.fn(),
}));

import Planner from "./planner";

function renderPlanner() {
  mockUseGet.mockReturnValue({ data: { config: null }, isLoading: false });
  mockUsePut.mockReturnValue({ mutate: mockPutMutate, isPending: false });
  mockUseApply.mockReturnValue({ mutate: mockApplyMutate, isPending: false });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Planner />
    </QueryClientProvider>,
  );
}

describe("Planner timeline math", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders calendar end dates per block (Mon..Sun) anchored on the start date", () => {
    renderPlanner();

    // Default config: start 2026-05-04, blocks Base 18 + Time on Feet 18 +
    // auto-pinned Marathon-Specific 16 = 52 weeks ending 2027-05-02.
    const preview = screen.getByTestId("planner-preview");
    const dateSpans = within(preview).getAllByTestId("planner-preview-dates");
    // Three rows: Base, Time on Feet, Marathon-Specific.
    expect(dateSpans).toHaveLength(3);

    // Base: weeks 1..18 -> 2026-05-04 → 2026-09-06.
    expect(dateSpans[0]?.textContent).toContain("2026-05-04");
    expect(dateSpans[0]?.textContent).toContain("2026-09-06");
    // Marathon-Specific: weeks 37..52 -> 2027-01-11 → 2027-05-02.
    expect(dateSpans[2]?.textContent).toContain("2027-01-11");
    expect(dateSpans[2]?.textContent).toContain("2027-05-02");
  });

  it("Apply confirm flow saves the draft, then triggers apply, then routes to /plan", () => {
    renderPlanner();

    // Open the confirm dialog and click "Regenerate".
    fireEvent.click(screen.getByTestId("planner-apply"));
    fireEvent.click(screen.getByTestId("planner-confirm-apply"));

    // PUT was called with the current draft (default config).
    expect(mockPutMutate).toHaveBeenCalledTimes(1);
    const [putArgs, putHandlers] = mockPutMutate.mock.calls[0]!;
    expect(putArgs.data.startDate).toBe("2026-05-04");
    expect(putArgs.data.marathonDate).toBe("2027-05-02");
    expect(putArgs.data.blocks).toHaveLength(2);

    // Simulate PUT success — that should kick off apply, then onSuccess
    // routes to /plan.
    putHandlers.onSuccess({});
    expect(mockApplyMutate).toHaveBeenCalledTimes(1);
    const [, applyHandlers] = mockApplyMutate.mock.calls[0]!;
    applyHandlers.onSuccess({
      weeksSeeded: 52,
      daysSeeded: 364,
      workoutsPreserved: 0,
      measurementsPreserved: 0,
      undoSnapshotsWiped: 0,
      totalWeeks: 52,
    });

    expect(mockSetLocation).toHaveBeenCalledWith("/plan");
  });
});
