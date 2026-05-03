import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mockSetLocation = vi.fn();
vi.mock("wouter", () => ({
  useLocation: () => ["/planner", mockSetLocation] as const,
}));

const mockListPlannerConfigs = vi.fn();
const mockGetPlannerConfig = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockDuplicate = vi.fn();
const mockActivate = vi.fn();
const mockApply = vi.fn();

const updateMutate = vi.fn();
const applyMutate = vi.fn();
const activateMutate = vi.fn();

vi.mock("@workspace/api-client-react", () => ({
  useListPlannerConfigs: () => mockListPlannerConfigs(),
  useGetPlannerConfig: () => mockGetPlannerConfig(),
  useCreatePlannerConfig: () => mockCreate(),
  useUpdatePlannerConfig: () => mockUpdate(),
  useDeletePlannerConfig: () => mockDelete(),
  useDuplicatePlannerConfig: () => mockDuplicate(),
  useActivatePlannerConfig: () => mockActivate(),
  useApplyPlannerConfig: () => mockApply(),
  getListPlannerConfigsQueryKey: () => ["planner-configs"],
  getGetPlannerConfigQueryKey: (id: number) => ["planner-config", id],
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/lib/invalidate-mission-queries", () => ({
  invalidateMissionRelatedQueries: vi.fn(),
}));

import Planner from "./planner";

const SAMPLE_CONFIG = {
  id: 1,
  name: "Spring 2027",
  isActive: true,
  startDate: "2026-05-04",
  marathonDate: "2027-05-02",
  blocks: [
    { focusType: "Base", weeks: 18, customName: null, customNotes: null },
    { focusType: "Time on Feet", weeks: 18, customName: null, customNotes: null },
  ],
  notes: null,
  updatedAt: "2026-05-04T00:00:00.000Z",
  lastAppliedAt: null,
};

function renderPlanner(
  opts: {
    config?: Partial<typeof SAMPLE_CONFIG>;
    updatePending?: boolean;
    applyPending?: boolean;
  } = {},
) {
  const cfg = { ...SAMPLE_CONFIG, ...(opts.config ?? {}) };
  mockListPlannerConfigs.mockReturnValue({
    data: {
      configs: [
        {
          id: cfg.id,
          name: cfg.name,
          isActive: cfg.isActive,
          startDate: cfg.startDate,
          marathonDate: cfg.marathonDate,
          updatedAt: cfg.updatedAt,
          lastAppliedAt: cfg.lastAppliedAt,
        },
      ],
      activeId: cfg.id,
    },
    isLoading: false,
  });
  mockGetPlannerConfig.mockReturnValue({
    data: cfg,
    isLoading: false,
  });
  mockCreate.mockReturnValue({ mutate: vi.fn(), isPending: false });
  mockUpdate.mockReturnValue({
    mutate: updateMutate,
    isPending: opts.updatePending ?? false,
  });
  mockDelete.mockReturnValue({ mutate: vi.fn(), isPending: false });
  mockDuplicate.mockReturnValue({ mutate: vi.fn(), isPending: false });
  mockActivate.mockReturnValue({ mutate: activateMutate, isPending: false });
  mockApply.mockReturnValue({
    mutate: applyMutate,
    isPending: opts.applyPending ?? false,
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Planner />
    </QueryClientProvider>,
  );
}

describe("Planner page", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the configs dropdown with the active config preselected", () => {
    renderPlanner();
    expect(screen.getByTestId("planner-config-select")).toBeTruthy();
    expect(screen.getByTestId("planner-active-badge")).toBeTruthy();
  });

  it("renders calendar end dates per block (Mon..Sun) anchored on the start date", () => {
    renderPlanner();

    // Sample config: start 2026-05-04, blocks Base 18 + Time on Feet 18 +
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

  it("Apply confirm flow saves the draft, activates this config, then triggers apply, then routes to /plan", () => {
    renderPlanner();

    fireEvent.click(screen.getByTestId("planner-apply"));
    fireEvent.click(screen.getByTestId("planner-confirm-apply"));

    // Update was called with the current draft.
    expect(updateMutate).toHaveBeenCalledTimes(1);
    const [updateArgs, updateHandlers] = updateMutate.mock.calls[0]!;
    expect(updateArgs.id).toBe(1);
    expect(updateArgs.data.name).toBe("Spring 2027");
    expect(updateArgs.data.startDate).toBe("2026-05-04");
    expect(updateArgs.data.marathonDate).toBe("2027-05-02");
    expect(updateArgs.data.blocks).toHaveLength(2);

    // Update success → activate is called next.
    updateHandlers.onSuccess({});
    expect(activateMutate).toHaveBeenCalledTimes(1);
    const [activateArgs, activateHandlers] = activateMutate.mock.calls[0]!;
    expect(activateArgs.id).toBe(1);

    // Activate success → apply is called next.
    activateHandlers.onSuccess({});
    expect(applyMutate).toHaveBeenCalledTimes(1);
    const [, applyHandlers] = applyMutate.mock.calls[0]!;
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

describe("Planner block editor", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("adds a new block when Add Block is clicked", () => {
    renderPlanner();
    const list = screen.getByTestId("planner-blocks-list");
    // Default config has 2 user blocks.
    expect(within(list).getAllByTestId(/^planner-block-\d+$/)).toHaveLength(2);

    fireEvent.click(screen.getByTestId("planner-add-block"));

    expect(within(list).getAllByTestId(/^planner-block-\d+$/)).toHaveLength(3);
    // Defaults for a new block: Base, 4 weeks.
    const newWeeks = screen.getByTestId(
      "planner-block-2-weeks",
    ) as HTMLInputElement;
    expect(newWeeks.value).toBe("4");
  });

  it("removes the targeted block, leaving the others intact", () => {
    // Distinct focus types + weeks so the assertion proves the *clicked*
    // block was removed (not just that the count went down).
    renderPlanner({
      config: {
        startDate: "2026-05-04",
        marathonDate: "2027-05-02",
        blocks: [
          { focusType: "Base", weeks: 7, customName: null, customNotes: null },
          { focusType: "Speed", weeks: 11, customName: null, customNotes: null },
          {
            focusType: "Time on Feet",
            weeks: 18,
            customName: null,
            customNotes: null,
          },
        ],
      },
    });
    const list = screen.getByTestId("planner-blocks-list");
    expect(within(list).getAllByTestId(/^planner-block-\d+$/)).toHaveLength(3);

    // Remove the middle (Speed / 11w) block.
    fireEvent.click(screen.getByTestId("planner-block-1-remove"));

    const remaining = within(list).getAllByTestId(/^planner-block-\d+$/);
    expect(remaining).toHaveLength(2);
    // First survivor must still be Base / 7w; second must be Time on Feet / 18w.
    expect(
      (screen.getByTestId("planner-block-0-weeks") as HTMLInputElement).value,
    ).toBe("7");
    expect(screen.getByTestId("planner-block-0-focus").textContent).toContain(
      "Base",
    );
    expect(
      (screen.getByTestId("planner-block-1-weeks") as HTMLInputElement).value,
    ).toBe("18");
    expect(screen.getByTestId("planner-block-1-focus").textContent).toContain(
      "Time on Feet",
    );
  });

  it("reorders blocks with the Move up button", () => {
    renderPlanner({
      config: {
        startDate: "2026-05-04",
        marathonDate: "2027-05-02",
        blocks: [
          { focusType: "Base", weeks: 18, customName: null, customNotes: null },
          {
            focusType: "Speed",
            weeks: 18,
            customName: null,
            customNotes: null,
          },
        ],
      },
    });

    const block1 = screen.getByTestId("planner-block-1");
    const moveUp = within(block1).getByLabelText("Move up");
    fireEvent.click(moveUp);

    // After the swap, block 0 should be the previously-second one (Speed).
    const firstFocus = screen.getByTestId(
      "planner-block-0-focus",
    ) as HTMLElement;
    expect(firstFocus.textContent).toContain("Speed");
    const secondFocus = screen.getByTestId(
      "planner-block-1-focus",
    ) as HTMLElement;
    expect(secondFocus.textContent).toContain("Base");
  });

  it("Move up is disabled on the first block; Move down is disabled on the last", () => {
    renderPlanner();
    const first = screen.getByTestId("planner-block-0");
    const last = screen.getByTestId("planner-block-1");
    expect(
      (within(first).getByLabelText("Move up") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (within(last).getByLabelText("Move down") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("auto-balance evens out weeks across blocks to match expected user weeks", () => {
    // Three blocks summing to 30, expected user weeks = 36 (52 - 16).
    renderPlanner({
      config: {
        startDate: "2026-05-04",
        marathonDate: "2027-05-02",
        blocks: [
          { focusType: "Base", weeks: 10, customName: null, customNotes: null },
          {
            focusType: "Time on Feet",
            weeks: 10,
            customName: null,
            customNotes: null,
          },
          {
            focusType: "Speed",
            weeks: 10,
            customName: null,
            customNotes: null,
          },
        ],
      },
    });

    fireEvent.click(screen.getByTestId("planner-auto-balance"));

    // 36 / 3 = 12, no remainder, so each block becomes 12 weeks.
    const w0 = screen.getByTestId("planner-block-0-weeks") as HTMLInputElement;
    const w1 = screen.getByTestId("planner-block-1-weeks") as HTMLInputElement;
    const w2 = screen.getByTestId("planner-block-2-weeks") as HTMLInputElement;
    expect(w0.value).toBe("12");
    expect(w1.value).toBe("12");
    expect(w2.value).toBe("12");

    // After balancing, the auto-balance button should disappear (sum matches).
    expect(screen.queryByTestId("planner-auto-balance")).toBeNull();
  });

  it("auto-balance distributes the remainder to leading blocks", () => {
    // Force a remainder by setting a 51-week campaign: start Mon 2026-05-04,
    // race Sun 2027-04-25 = 51 weeks; expectedUserWeeks = 35; with 3 blocks
    // -> 12, 12, 11 (the remainder of 2 lands on the first two blocks).
    renderPlanner({
      config: {
        startDate: "2026-05-04",
        marathonDate: "2027-04-25",
        blocks: [
          { focusType: "Base", weeks: 10, customName: null, customNotes: null },
          {
            focusType: "Time on Feet",
            weeks: 10,
            customName: null,
            customNotes: null,
          },
          {
            focusType: "Speed",
            weeks: 10,
            customName: null,
            customNotes: null,
          },
        ],
      },
    });

    fireEvent.click(screen.getByTestId("planner-auto-balance"));

    const w0 = screen.getByTestId("planner-block-0-weeks") as HTMLInputElement;
    const w1 = screen.getByTestId("planner-block-1-weeks") as HTMLInputElement;
    const w2 = screen.getByTestId("planner-block-2-weeks") as HTMLInputElement;
    expect(w0.value).toBe("12");
    expect(w1.value).toBe("12");
    expect(w2.value).toBe("11");
  });
});

describe("Planner date validation surfacing", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("flags a non-Monday training start date", () => {
    renderPlanner();
    // 2026-05-05 is a Tuesday.
    fireEvent.change(screen.getByTestId("planner-start-date"), {
      target: { value: "2026-05-05" },
    });
    const issues = screen.getByTestId("planner-issues");
    expect(issues.textContent).toContain("Training start date must be a Monday");
    // Inline helper text near the input also surfaces the day name.
    expect(screen.getByText(/Must be a Monday — currently a Tue/)).toBeTruthy();
  });

  it("flags a non-Sunday marathon date", () => {
    renderPlanner();
    // 2027-05-01 is a Saturday.
    fireEvent.change(screen.getByTestId("planner-marathon-date"), {
      target: { value: "2027-05-01" },
    });
    const issues = screen.getByTestId("planner-issues");
    expect(issues.textContent).toContain("Marathon date must be a Sunday");
    expect(screen.getByText(/Must be a Sunday — currently a Sat/)).toBeTruthy();
  });

  it("flags a marathon date less than 16 weeks out", () => {
    renderPlanner();
    // 12 weeks out: start Mon 2026-05-04 -> race Sun 2026-07-26.
    fireEvent.change(screen.getByTestId("planner-marathon-date"), {
      target: { value: "2026-07-26" },
    });
    const issues = screen.getByTestId("planner-issues");
    expect(issues.textContent).toContain("only 12 weeks out");
    expect(issues.textContent).toContain("at least 16");
  });
});

describe("Planner Apply gating and confirm dialog", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("disables Save and Apply when the config has validation errors", () => {
    renderPlanner();

    // Knock the start date off Monday to make the config invalid.
    fireEvent.change(screen.getByTestId("planner-start-date"), {
      target: { value: "2026-05-05" },
    });

    expect(
      (screen.getByTestId("planner-save") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId("planner-apply") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("Save click invokes the PUT mutation with the current draft and does not cascade into Apply", () => {
    renderPlanner();

    fireEvent.click(screen.getByTestId("planner-save"));

    expect(updateMutate).toHaveBeenCalledTimes(1);
    const [putArgs] = updateMutate.mock.calls[0]!;
    expect(putArgs.data.startDate).toBe("2026-05-04");
    expect(putArgs.data.marathonDate).toBe("2027-05-02");
    // Save is the standalone path — it must not trigger plan regeneration.
    expect(applyMutate).not.toHaveBeenCalled();
  });

  it("disables Apply while a save (PUT) is in flight", () => {
    // Apply lives behind `!isValid || isApplying`, where isApplying = PUT
    // pending OR apply pending. Simulate the in-flight save state.
    renderPlanner({ updatePending: true });

    expect(
      (screen.getByTestId("planner-apply") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId("planner-save") as HTMLButtonElement).disabled,
    ).toBe(true);
    // The Apply button label flips to the in-flight copy.
    expect(screen.getByTestId("planner-apply").textContent).toContain(
      "Applying",
    );
  });

  it("enables Apply for a valid default config and opens the confirm dialog when clicked", () => {
    renderPlanner();

    const apply = screen.getByTestId("planner-apply") as HTMLButtonElement;
    expect(apply.disabled).toBe(false);

    // No dialog yet.
    expect(screen.queryByTestId("planner-confirm-apply")).toBeNull();

    fireEvent.click(apply);

    // Dialog opens with the destructive confirm action.
    expect(screen.getByTestId("planner-confirm-apply")).toBeTruthy();
    expect(
      screen.getByText(/Regenerate the entire plan\?/),
    ).toBeTruthy();

    // No mutations fire merely from opening the dialog.
    expect(updateMutate).not.toHaveBeenCalled();
    expect(applyMutate).not.toHaveBeenCalled();
  });
});
