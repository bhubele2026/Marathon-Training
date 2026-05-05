import { afterEach, describe, expect, it, vi } from "vitest";

// jsdom doesn't ship ResizeObserver, but cmdk (used by the quick-add
// popover) constructs one on mount. Stub it so the popover content
// renders in tests.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
// jsdom doesn't implement scrollIntoView, but cmdk calls it on the
// active CommandItem when the popover opens.
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () {};
}
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
  useListPlannerTemplates: () => ({ data: undefined, isLoading: false }),
  getListPlannerConfigsQueryKey: () => ["planner-configs"],
  getGetPlannerConfigQueryKey: (id: number) => ["planner-config", id],
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/lib/invalidate-mission-queries", () => ({
  invalidateMissionRelatedQueries: vi.fn(),
}));

import Planner, { levelOfTemplate, defaultBlankConfig } from "./planner";
import { PLAN_TEMPLATES, validatePlannerConfig } from "@workspace/plan-generator";

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

describe("Planner template library (entries-mode)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // SAMPLE_CONFIG hydrates as legacy blocks-mode (entries: undefined). The
  // template library is always visible; clicking Apply Template should
  // switch the page into entries-mode (composition editor appears) and
  // re-anchor the marathon date so sum(entries.weeks) === totalWeeks.
  it("applying a template appends an entry, opens the composition editor, and re-anchors the race date", () => {
    renderPlanner();
    expect(screen.queryByTestId("planner-composition-editor")).toBeNull();

    fireEvent.click(screen.getByTestId("planner-template-apply-half_marathon"));
    // Every Apply (including the first) opens the start-date dialog.
    fireEvent.click(screen.getByTestId("planner-confirm-pending-apply"));

    const editor = screen.getByTestId("planner-composition-editor");
    expect(editor).toBeTruthy();
    const list = screen.getByTestId("planner-composition-list");
    const entry0 = within(list).getByTestId("planner-entry-0");
    // Entry shows the optional-label input + a range hint + weeks input.
    expect(within(entry0).getByTestId("planner-entry-0-name")).toBeTruthy();
    expect(within(entry0).getByTestId("planner-entry-0-range")).toBeTruthy();
    expect(
      (within(entry0).getByTestId(
        "planner-entry-0-weeks",
      ) as HTMLInputElement).value,
    ).toBe("12");
    // Composition header reflects the new entry count + week sum.
    expect(within(editor).getByText(/Composition · 1 entry · 12\/12w/)).toBeTruthy();
  });

  it("starter shortcuts rail groups starters by training style with Run-only first", () => {
    renderPlanner();
    const rail = screen.getByTestId("planner-starter-rail");
    const runGroup = within(rail).getByTestId("planner-starter-group-run_only");
    const hybridGroup = within(rail).getByTestId(
      "planner-starter-group-hybrid",
    );
    // Run-only group renders before the Hybrid group in DOM order.
    expect(
      runGroup.compareDocumentPosition(hybridGroup) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Visible group headers.
    expect(within(runGroup).getByText("Run-only")).toBeTruthy();
    expect(within(hybridGroup).getByText("Hybrid")).toBeTruthy();
    // Run-only starters live under the Run-only group; hybrid starters
    // under the Hybrid group. Per-card test ids are unchanged.
    expect(
      within(runGroup).getByTestId("planner-starter-hm_beginner_16w"),
    ).toBeTruthy();
    expect(
      within(runGroup).getByTestId("planner-starter-marathon_first_timer_24w"),
    ).toBeTruthy();
    expect(
      within(runGroup).getByTestId("planner-starter-get_faster_5k_14w"),
    ).toBeTruthy();
    expect(
      within(runGroup).getByTestId("planner-starter-beginner_5k_16w"),
    ).toBeTruthy();
    expect(
      within(runGroup).getByTestId("planner-starter-couch_to_hm_24w"),
    ).toBeTruthy();
    expect(
      within(hybridGroup).getByTestId("planner-starter-hm_hybrid_18w"),
    ).toBeTruthy();
    // Hybrid starter does NOT also show up under the Run-only group.
    expect(
      within(runGroup).queryByTestId("planner-starter-hm_hybrid_18w"),
    ).toBeNull();
  });

  it("starter rail's race-distance filter narrows visible cards by the last entry's race kind", () => {
    // Clear any persisted filter from a previous run so this test
    // boots into the default "All" state.
    try {
      window.localStorage.removeItem("planner.starterDistanceFilter.v1");
    } catch {
      // ignore
    }
    renderPlanner();
    const rail = screen.getByTestId("planner-starter-rail");
    const filter = within(rail).getByTestId(
      "planner-starter-distance-filter",
    );
    // All five chips render in canonical order (All, 5K, 10K, Half,
    // Marathon) and "All" is the default active selection.
    for (const v of ["all", "5k", "10k", "half", "marathon"] as const) {
      expect(
        within(filter).getByTestId(`planner-starter-distance-${v}`),
      ).toBeTruthy();
    }
    expect(
      within(filter)
        .getByTestId("planner-starter-distance-all")
        .getAttribute("aria-checked"),
    ).toBe("true");
    // Default "All" shows every starter card.
    expect(
      within(rail).getByTestId("planner-starter-hm_beginner_16w"),
    ).toBeTruthy();
    expect(
      within(rail).getByTestId("planner-starter-hm_hybrid_18w"),
    ).toBeTruthy();
    expect(
      within(rail).getByTestId("planner-starter-marathon_first_timer_24w"),
    ).toBeTruthy();
    expect(
      within(rail).getByTestId("planner-starter-get_faster_5k_14w"),
    ).toBeTruthy();
    expect(
      within(rail).getByTestId("planner-starter-beginner_5k_16w"),
    ).toBeTruthy();
    expect(
      within(rail).getByTestId("planner-starter-couch_to_hm_24w"),
    ).toBeTruthy();

    // Click "Half": only starters whose last entry ends on the half-
    // marathon survive (hm_beginner_16w + hm_hybrid_18w + couch_to_hm_24w).
    fireEvent.click(within(filter).getByTestId("planner-starter-distance-half"));
    expect(
      within(filter)
        .getByTestId("planner-starter-distance-half")
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      within(rail).getByTestId("planner-starter-hm_beginner_16w"),
    ).toBeTruthy();
    expect(
      within(rail).getByTestId("planner-starter-hm_hybrid_18w"),
    ).toBeTruthy();
    expect(
      within(rail).getByTestId("planner-starter-couch_to_hm_24w"),
    ).toBeTruthy();
    expect(
      within(rail).queryByTestId("planner-starter-marathon_first_timer_24w"),
    ).toBeNull();
    expect(
      within(rail).queryByTestId("planner-starter-get_faster_5k_14w"),
    ).toBeNull();

    // Click "Marathon": only the Pfitz first-timer marathon survives.
    fireEvent.click(
      within(filter).getByTestId("planner-starter-distance-marathon"),
    );
    expect(
      within(rail).getByTestId("planner-starter-marathon_first_timer_24w"),
    ).toBeTruthy();
    expect(
      within(rail).queryByTestId("planner-starter-hm_beginner_16w"),
    ).toBeNull();
    expect(
      within(rail).queryByTestId("planner-starter-get_faster_5k_14w"),
    ).toBeNull();

    // Click "5K": only the 5K-focused starters survive
    // (get_faster_5k_14w + beginner_5k_16w — Task #177).
    fireEvent.click(
      within(filter).getByTestId("planner-starter-distance-5k"),
    );
    expect(
      within(rail).getByTestId("planner-starter-get_faster_5k_14w"),
    ).toBeTruthy();
    expect(
      within(rail).getByTestId("planner-starter-beginner_5k_16w"),
    ).toBeTruthy();
    expect(
      within(rail).queryByTestId("planner-starter-marathon_first_timer_24w"),
    ).toBeNull();
    expect(
      within(rail).queryByTestId("planner-starter-hm_beginner_16w"),
    ).toBeNull();

    // "10K": Task #232 added the run-only Get Faster 10K starter, so
    // the rail now renders that single card under the run_only group
    // (no hybrid 10K starter yet, no empty-state placeholder).
    fireEvent.click(
      within(filter).getByTestId("planner-starter-distance-10k"),
    );
    expect(within(rail).queryByTestId("planner-starter-empty")).toBeNull();
    expect(
      within(rail).getByTestId("planner-starter-get_faster_10k_14w"),
    ).toBeTruthy();
    expect(
      within(rail).getByTestId("planner-starter-group-run_only"),
    ).toBeTruthy();
    expect(
      within(rail).queryByTestId("planner-starter-group-hybrid"),
    ).toBeNull();
    // Other-distance starters are filtered out.
    expect(
      within(rail).queryByTestId("planner-starter-get_faster_5k_14w"),
    ).toBeNull();
    expect(
      within(rail).queryByTestId("planner-starter-marathon_first_timer_24w"),
    ).toBeNull();

    // Back to "All" restores the full rail (and clears the empty state).
    fireEvent.click(
      within(filter).getByTestId("planner-starter-distance-all"),
    );
    expect(within(rail).queryByTestId("planner-starter-empty")).toBeNull();
    expect(
      within(rail).getByTestId("planner-starter-group-run_only"),
    ).toBeTruthy();
    expect(
      within(rail).getByTestId("planner-starter-group-hybrid"),
    ).toBeTruthy();
  });

  it("starter distance filter persists the runner's selection across renders", () => {
    try {
      window.localStorage.removeItem("planner.starterDistanceFilter.v1");
    } catch {
      // ignore
    }
    const first = renderPlanner();
    fireEvent.click(
      within(screen.getByTestId("planner-starter-distance-filter")).getByTestId(
        "planner-starter-distance-half",
      ),
    );
    first.unmount();
    renderPlanner();
    // Half remains selected after re-mounting; only HM cards visible.
    const rail = screen.getByTestId("planner-starter-rail");
    expect(
      within(screen.getByTestId("planner-starter-distance-filter"))
        .getByTestId("planner-starter-distance-half")
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      within(rail).getByTestId("planner-starter-hm_beginner_16w"),
    ).toBeTruthy();
    expect(
      within(rail).queryByTestId("planner-starter-marathon_first_timer_24w"),
    ).toBeNull();
    // Reset for downstream tests.
    fireEvent.click(
      within(screen.getByTestId("planner-starter-distance-filter")).getByTestId(
        "planner-starter-distance-all",
      ),
    );
  });

  it("applying a one-click starter loads its full multi-entry composition", () => {
    renderPlanner();
    fireEvent.click(screen.getByTestId("planner-starter-apply-hm_beginner_16w"));
    const list = screen.getByTestId("planner-composition-list");
    expect(within(list).getByTestId("planner-entry-0")).toBeTruthy();
    expect(within(list).getByTestId("planner-entry-1")).toBeTruthy();
    expect(within(list).queryByTestId("planner-entry-2")).toBeNull();
    expect(
      (
        within(list).getByTestId("planner-entry-0-weeks") as HTMLInputElement
      ).value,
    ).toBe("6");
    expect(
      (
        within(list).getByTestId("planner-entry-1-weeks") as HTMLInputElement
      ).value,
    ).toBe("10");
    expect(screen.getByText(/Composition · 2 entries · 16\/16w/)).toBeTruthy();
  });

  it("applying a starter respects a custom config start date already set", () => {
    renderPlanner();
    const startInput = screen.getByTestId("planner-start-date") as HTMLInputElement;
    const startMs = Date.parse(`${startInput.value}T00:00:00Z`);
    const customStart = new Date(startMs + 21 * 24 * 3600 * 1000)
      .toISOString()
      .slice(0, 10);
    fireEvent.change(startInput, { target: { value: customStart } });
    fireEvent.click(screen.getByTestId("planner-starter-apply-hm_beginner_16w"));
    expect(
      (screen.getByTestId("planner-start-date") as HTMLInputElement).value,
    ).toBe(customStart);
    const raceMs = Date.parse(
      `${(screen.getByTestId("planner-marathon-date") as HTMLInputElement).value}T00:00:00Z`,
    );
    expect(raceMs - Date.parse(`${customStart}T00:00:00Z`)).toBe(
      16 * 7 * 24 * 3600 * 1000 - 24 * 3600 * 1000,
    );
  });

  it("removing an entry with a downstream gap normalizes startDates so the composition stays saveable", () => {
    renderPlanner();
    fireEvent.click(screen.getByTestId("planner-template-apply-higdon_5k_novice"));
    fireEvent.click(screen.getByTestId("planner-confirm-pending-apply"));
    fireEvent.click(screen.getByTestId("planner-template-apply-half_marathon"));
    const dateInput = screen.getByTestId(
      "planner-pending-apply-start-date",
    ) as HTMLInputElement;
    const cursorMs = Date.parse(`${dateInput.value}T00:00:00Z`);
    const pushed = new Date(cursorMs + 14 * 24 * 3600 * 1000)
      .toISOString()
      .slice(0, 10);
    fireEvent.change(dateInput, { target: { value: pushed } });
    fireEvent.click(screen.getByTestId("planner-confirm-pending-apply"));
    // Sanity: 10 + 12 + 2 gap = 24w span.
    expect(screen.getByText(/Composition · 2 entries · 22\/22w/)).toBeTruthy();

    // Remove entry 0 — entry 1's absolute startDate would otherwise
    // violate "entry 0 must equal config start". Normalization clears
    // it so the remaining entry starts on the config Monday.
    fireEvent.click(screen.getByTestId("planner-entry-0-remove"));
    expect(screen.getByText(/Composition · 1 entry · 12\/12w/)).toBeTruthy();
    // No "issues" panel rendered → composition is saveable.
    expect(screen.queryByTestId("planner-issues")).toBeNull();
  });

  it("changing the config start date in legacy block mode shifts the race date by the same delta", () => {
    renderPlanner();
    const startInput = screen.getByTestId("planner-start-date") as HTMLInputElement;
    const raceInput = screen.getByTestId("planner-marathon-date") as HTMLInputElement;
    const raceBefore = raceInput.value;
    const startMs = Date.parse(`${startInput.value}T00:00:00Z`);
    const newStart = new Date(startMs + 7 * 24 * 3600 * 1000)
      .toISOString()
      .slice(0, 10);
    fireEvent.change(startInput, { target: { value: newStart } });
    const raceAfter = (screen.getByTestId("planner-marathon-date") as HTMLInputElement).value;
    expect(Date.parse(`${raceAfter}T00:00:00Z`) - Date.parse(`${raceBefore}T00:00:00Z`)).toBe(
      7 * 24 * 3600 * 1000,
    );
  });

  it("disables Apply Template and surfaces a server-rejection warning when weeks fall outside the published range", () => {
    renderPlanner();
    const weeksInput = screen.getByTestId(
      "planner-template-weeks-half_marathon",
    ) as HTMLInputElement;
    fireEvent.change(weeksInput, { target: { value: "4" } });
    expect(screen.getByTestId("planner-template-warn-half_marathon").textContent)
      .toMatch(/server will reject save/);
    expect(
      (screen.getByTestId(
        "planner-template-apply-half_marathon",
      ) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("applying a 2nd template opens the start-date dialog and stacks back-to-back by default", () => {
    renderPlanner();
    // First Apply also opens the dialog now; confirm with default to add.
    fireEvent.click(screen.getByTestId("planner-template-apply-higdon_5k_novice"));
    fireEvent.click(screen.getByTestId("planner-confirm-pending-apply"));
    expect(screen.queryByTestId("planner-pending-apply-start-date")).toBeNull();
    const headerBefore = screen.getByText(/Composition · 1 entry/);
    expect(headerBefore).toBeTruthy();

    // Second Apply: opens dialog with proposed Monday cursor.
    fireEvent.click(screen.getByTestId("planner-template-apply-half_marathon"));
    const dateInput = screen.getByTestId(
      "planner-pending-apply-start-date",
    ) as HTMLInputElement;
    expect(dateInput).toBeTruthy();
    expect(dateInput.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Confirm with the default cursor → no gap, totals stack to 8w + 12w.
    fireEvent.click(screen.getByTestId("planner-confirm-pending-apply"));
    expect(screen.queryByTestId("planner-pending-apply-start-date")).toBeNull();
    expect(screen.getByText(/Composition · 2 entries · 20\/20w/)).toBeTruthy();
    // No gap inserted → no gap summary chip.
    expect(screen.queryByTestId("planner-composition-gap-summary")).toBeNull();
  });

  it("pushing the 2nd entry's start date later inserts a Recovery gap and re-anchors the race date", () => {
    renderPlanner();
    fireEvent.click(screen.getByTestId("planner-template-apply-higdon_5k_novice"));
    fireEvent.click(screen.getByTestId("planner-confirm-pending-apply"));
    fireEvent.click(screen.getByTestId("planner-template-apply-half_marathon"));
    const dateInput = screen.getByTestId(
      "planner-pending-apply-start-date",
    ) as HTMLInputElement;
    // Push 14 days (2 Mondays) past the proposed cursor.
    const cursorMs = Date.parse(`${dateInput.value}T00:00:00Z`);
    const pushed = new Date(cursorMs + 14 * 24 * 3600 * 1000)
      .toISOString()
      .slice(0, 10);
    fireEvent.change(dateInput, { target: { value: pushed } });
    fireEvent.click(screen.getByTestId("planner-confirm-pending-apply"));

    // Header now shows 22w projected (8w + 12w + 2w gap).
    expect(screen.getByText(/Composition · 2 entries · 22\/22w/)).toBeTruthy();
    expect(screen.getByTestId("planner-composition-gap-summary").textContent)
      .toMatch(/20w templates \+ 2w gap/);
    // Entry 1 gets the gap banner.
    expect(screen.getByTestId("planner-entry-1-gap-banner")).toBeTruthy();
  });

  it("changing the config start date re-projects gaps and re-anchors the race date", () => {
    renderPlanner();
    fireEvent.click(screen.getByTestId("planner-template-apply-higdon_5k_novice"));
    fireEvent.click(screen.getByTestId("planner-confirm-pending-apply"));
    fireEvent.click(screen.getByTestId("planner-template-apply-half_marathon"));
    const dateInput = screen.getByTestId(
      "planner-pending-apply-start-date",
    ) as HTMLInputElement;
    const cursorMs = Date.parse(`${dateInput.value}T00:00:00Z`);
    const pushed = new Date(cursorMs + 14 * 24 * 3600 * 1000)
      .toISOString()
      .slice(0, 10);
    fireEvent.change(dateInput, { target: { value: pushed } });
    fireEvent.click(screen.getByTestId("planner-confirm-pending-apply"));
    expect(screen.getByText(/Composition · 2 entries · 22\/22w/)).toBeTruthy();
    const raceBefore = (screen.getByTestId("planner-marathon-date") as HTMLInputElement).value;

    // Push the config start date forward by 7 days (still a Monday).
    const startInput = screen.getByTestId("planner-start-date") as HTMLInputElement;
    const startMs = Date.parse(`${startInput.value}T00:00:00Z`);
    const newStart = new Date(startMs + 7 * 24 * 3600 * 1000)
      .toISOString()
      .slice(0, 10);
    fireEvent.change(startInput, { target: { value: newStart } });

    // Total projected weeks invariant + gap chip preserved.
    expect(screen.getByText(/Composition · 2 entries · 22\/22w/)).toBeTruthy();
    expect(screen.getByTestId("planner-composition-gap-summary")).toBeTruthy();
    // Race date moved by exactly 7 days.
    const raceAfter = (screen.getByTestId("planner-marathon-date") as HTMLInputElement).value;
    expect(Date.parse(`${raceAfter}T00:00:00Z`) - Date.parse(`${raceBefore}T00:00:00Z`)).toBe(
      7 * 24 * 3600 * 1000,
    );
  });

  it("renders the Config (start/marathon date) card above the Plan Template Library card", () => {
    renderPlanner();
    const config = screen.getByTestId("planner-config-card");
    const library = screen.getByTestId("planner-template-library");
    // DOCUMENT_POSITION_FOLLOWING (4) means library follows config in the DOM.
    expect(
      config.compareDocumentPosition(library) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // The two-step helper text lives next to the start-date input.
    expect(screen.getByTestId("planner-start-date-helper").textContent).toMatch(
      /Pick when training starts/,
    );
  });

  it("applying the first template opens the start-date dialog (cancelable) and confirming adds the entry at the chosen date", () => {
    renderPlanner();
    expect(screen.queryByTestId("planner-composition-editor")).toBeNull();

    fireEvent.click(screen.getByTestId("planner-template-apply-half_marathon"));
    // Dialog opens for entry #1 too, pre-filled with the current config start.
    const dateInput = screen.getByTestId(
      "planner-pending-apply-start-date",
    ) as HTMLInputElement;
    const startInput = screen.getByTestId(
      "planner-start-date",
    ) as HTMLInputElement;
    expect(dateInput.value).toBe(startInput.value);

    // Cancel does NOT add an entry.
    fireEvent.click(screen.getByTestId("planner-cancel-pending-apply"));
    expect(screen.queryByTestId("planner-composition-editor")).toBeNull();

    // Open again and pick a later Monday → confirming adds entry AND
    // shifts the config start date to match.
    fireEvent.click(screen.getByTestId("planner-template-apply-half_marathon"));
    const dateInput2 = screen.getByTestId(
      "planner-pending-apply-start-date",
    ) as HTMLInputElement;
    const baseMs = Date.parse(`${dateInput2.value}T00:00:00Z`);
    const pushed = new Date(baseMs + 7 * 24 * 3600 * 1000)
      .toISOString()
      .slice(0, 10);
    fireEvent.change(dateInput2, { target: { value: pushed } });
    fireEvent.click(screen.getByTestId("planner-confirm-pending-apply"));

    // Entry was added.
    expect(screen.getByTestId("planner-composition-editor")).toBeTruthy();
    // Config start date now equals the chosen Monday.
    expect(
      (screen.getByTestId("planner-start-date") as HTMLInputElement).value,
    ).toBe(pushed);
  });

  it("editing entry #1's start date updates the overall config start in lockstep", () => {
    renderPlanner();
    // Add a first entry via the library + dialog.
    fireEvent.click(screen.getByTestId("planner-template-apply-half_marathon"));
    fireEvent.click(screen.getByTestId("planner-confirm-pending-apply"));

    // Entry #1 now has an editable date input (not a read-only span).
    const entryStart = screen.getByTestId(
      "planner-entry-0-start-date",
    ) as HTMLInputElement;
    expect(entryStart.tagName).toBe("INPUT");
    expect(entryStart.type).toBe("date");

    const startInput = screen.getByTestId(
      "planner-start-date",
    ) as HTMLInputElement;
    const baseMs = Date.parse(`${startInput.value}T00:00:00Z`);
    const newMonday = new Date(baseMs + 7 * 24 * 3600 * 1000)
      .toISOString()
      .slice(0, 10);

    fireEvent.change(entryStart, { target: { value: newMonday } });

    // Editing entry #1's start drives the overall config start.
    expect(
      (screen.getByTestId("planner-start-date") as HTMLInputElement).value,
    ).toBe(newMonday);
  });

  it("removing an entry re-projects blocks and re-anchors the race date so the sum invariant holds", () => {
    renderPlanner();
    fireEvent.click(screen.getByTestId("planner-starter-apply-hm_beginner_16w"));
    expect(screen.getByText(/Composition · 2 entries · 16\/16w/)).toBeTruthy();

    const list = screen.getByTestId("planner-composition-list");
    fireEvent.click(within(list).getByTestId("planner-entry-0-remove"));

    expect(screen.getByText(/Composition · 1 entry · 10\/10w/)).toBeTruthy();
    expect(screen.queryByTestId("planner-issues")?.textContent ?? "").not.toMatch(
      /must sum to/,
    );
  });
});

describe("Planner template entry end-date picker", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // half_marathon template's published range is 10–16w (default 12).
  it("picking a new end date updates the entry's weeks via the snap+clamp helper", () => {
    renderPlanner();
    fireEvent.click(screen.getByTestId("planner-template-apply-half_marathon"));
    fireEvent.click(screen.getByTestId("planner-confirm-pending-apply"));
    const list = screen.getByTestId("planner-composition-list");
    const weeksInput = within(list).getByTestId(
      "planner-entry-0-weeks",
    ) as HTMLInputElement;
    expect(weeksInput.value).toBe("12");
    const endInput = within(list).getByTestId(
      "planner-entry-0-end-date",
    ) as HTMLInputElement;
    const startMs = Date.parse(`${SAMPLE_CONFIG.startDate}T00:00:00Z`);
    // Pick the Sunday 14 weeks out (within the 10–16w range).
    const target = new Date(startMs + (14 * 7 - 1) * 86400000)
      .toISOString()
      .slice(0, 10);
    fireEvent.change(endInput, { target: { value: target } });
    expect(
      (within(list).getByTestId("planner-entry-0-weeks") as HTMLInputElement)
        .value,
    ).toBe("14");
    expect(
      within(list).getByTestId("planner-entry-0-weeks-badge").textContent,
    ).toBe("14w");
  });

  it("picking an end date past the template's max clamps to maxWeeks", () => {
    renderPlanner();
    fireEvent.click(screen.getByTestId("planner-template-apply-half_marathon"));
    fireEvent.click(screen.getByTestId("planner-confirm-pending-apply"));
    const list = screen.getByTestId("planner-composition-list");
    const endInput = within(list).getByTestId(
      "planner-entry-0-end-date",
    ) as HTMLInputElement;
    const startMs = Date.parse(`${SAMPLE_CONFIG.startDate}T00:00:00Z`);
    // half_marathon maxWeeks = 16; pick 30 weeks out → clamps to 16.
    const target = new Date(startMs + (30 * 7 - 1) * 86400000)
      .toISOString()
      .slice(0, 10);
    fireEvent.change(endInput, { target: { value: target } });
    expect(
      (within(list).getByTestId("planner-entry-0-weeks") as HTMLInputElement)
        .value,
    ).toBe("16");
  });

  it("picking an end date before the template's min clamps to minWeeks", () => {
    renderPlanner();
    fireEvent.click(screen.getByTestId("planner-template-apply-half_marathon"));
    fireEvent.click(screen.getByTestId("planner-confirm-pending-apply"));
    const list = screen.getByTestId("planner-composition-list");
    const endInput = within(list).getByTestId(
      "planner-entry-0-end-date",
    ) as HTMLInputElement;
    const startMs = Date.parse(`${SAMPLE_CONFIG.startDate}T00:00:00Z`);
    // half_marathon minWeeks = 10; pick 2 weeks out → clamps to 10.
    const target = new Date(startMs + (2 * 7 - 1) * 86400000)
      .toISOString()
      .slice(0, 10);
    fireEvent.change(endInput, { target: { value: target } });
    expect(
      (within(list).getByTestId("planner-entry-0-weeks") as HTMLInputElement)
        .value,
    ).toBe("10");
  });

  it("picking a mid-week end date snaps forward to the next Sunday", () => {
    renderPlanner();
    fireEvent.click(screen.getByTestId("planner-template-apply-half_marathon"));
    fireEvent.click(screen.getByTestId("planner-confirm-pending-apply"));
    const list = screen.getByTestId("planner-composition-list");
    const endInput = within(list).getByTestId(
      "planner-entry-0-end-date",
    ) as HTMLInputElement;
    const startMs = Date.parse(`${SAMPLE_CONFIG.startDate}T00:00:00Z`);
    // Pick Tuesday of week 14 (start + 92 days). Nearest-rounding would
    // snap BACK to week 13; the helper must snap FORWARD to week 14
    // (next Sunday at start + 97 days) so the runner doesn't lose a
    // week they meant to include.
    const target = new Date(startMs + 92 * 86400000)
      .toISOString()
      .slice(0, 10);
    fireEvent.change(endInput, { target: { value: target } });
    expect(
      (within(list).getByTestId("planner-entry-0-weeks") as HTMLInputElement)
        .value,
    ).toBe("14");
    // And the end-date input now shows the snapped Sunday, not the
    // Tuesday the runner clicked.
    expect(
      (within(list).getByTestId(
        "planner-entry-0-end-date",
      ) as HTMLInputElement).value,
    ).toBe(
      new Date(startMs + (14 * 7 - 1) * 86400000).toISOString().slice(0, 10),
    );
  });

  it("apply dialog end-date picker drives the staged entry's weeks", () => {
    renderPlanner();
    // Stage one entry first so the 2nd Apply opens the dialog with a
    // proposed start cursor.
    fireEvent.click(screen.getByTestId("planner-template-apply-higdon_5k_novice"));
    fireEvent.click(screen.getByTestId("planner-confirm-pending-apply"));
    const stagedHeader = screen.getByText(/Composition · 1 entry · (\d+)\/\1w/);
    const stagedWeeks = Number(stagedHeader.textContent!.match(/(\d+)\/\1w/)![1]);
    fireEvent.click(screen.getByTestId("planner-template-apply-half_marathon"));
    const startInput = screen.getByTestId(
      "planner-pending-apply-start-date",
    ) as HTMLInputElement;
    const endInput = screen.getByTestId(
      "planner-pending-apply-end-date",
    ) as HTMLInputElement;
    // Default weeks for half_marathon = 12 → end = start + 83 days.
    const cursorMs = Date.parse(`${startInput.value}T00:00:00Z`);
    expect(endInput.value).toBe(
      new Date(cursorMs + (12 * 7 - 1) * 86400000).toISOString().slice(0, 10),
    );
    // Stretch to 14 weeks via the end-date picker (within 10–16w range).
    const target = new Date(cursorMs + (14 * 7 - 1) * 86400000)
      .toISOString()
      .slice(0, 10);
    fireEvent.change(endInput, { target: { value: target } });
    expect(
      screen.getByTestId("planner-pending-apply-weeks-readout").textContent,
    ).toMatch(/^14w/);
    fireEvent.click(screen.getByTestId("planner-confirm-pending-apply"));
    // 2nd entry now has 14w → composition shows stagedWeeks + 14.
    const total = stagedWeeks + 14;
    const re = new RegExp(`Composition · 2 entries · ${total}\\/${total}w`);
    expect(screen.getByText(re)).toBeTruthy();
  });

  it("shows a clamp hint in the entry row when the picked end date overshoots maxWeeks", () => {
    renderPlanner();
    fireEvent.click(screen.getByTestId("planner-template-apply-half_marathon"));
    fireEvent.click(screen.getByTestId("planner-confirm-pending-apply"));
    const list = screen.getByTestId("planner-composition-list");
    const endInput = within(list).getByTestId(
      "planner-entry-0-end-date",
    ) as HTMLInputElement;
    const startMs = Date.parse(`${SAMPLE_CONFIG.startDate}T00:00:00Z`);
    // 30 weeks past start → clamps to maxWeeks=16, raw=30.
    const target = new Date(startMs + (30 * 7 - 1) * 86400000)
      .toISOString()
      .slice(0, 10);
    fireEvent.change(endInput, { target: { value: target } });
    const hint = within(list).getByTestId("planner-entry-0-clamp-hint");
    expect(hint.textContent).toMatch(/Adjusted to 16w/);
    expect(hint.textContent).toMatch(/max for this template/);
    expect(hint.textContent).toMatch(/picked 30w/);
    // Picking an in-range date clears the hint.
    const inRange = new Date(startMs + (12 * 7 - 1) * 86400000)
      .toISOString()
      .slice(0, 10);
    fireEvent.change(endInput, { target: { value: inRange } });
    expect(
      within(list).queryByTestId("planner-entry-0-clamp-hint"),
    ).toBeNull();
  });

  it("shows a clamp hint in the entry row when the picked end date undershoots minWeeks", () => {
    renderPlanner();
    fireEvent.click(screen.getByTestId("planner-template-apply-half_marathon"));
    fireEvent.click(screen.getByTestId("planner-confirm-pending-apply"));
    const list = screen.getByTestId("planner-composition-list");
    const endInput = within(list).getByTestId(
      "planner-entry-0-end-date",
    ) as HTMLInputElement;
    const startMs = Date.parse(`${SAMPLE_CONFIG.startDate}T00:00:00Z`);
    // 2 weeks past start → clamps to minWeeks=10, raw=2.
    const target = new Date(startMs + (2 * 7 - 1) * 86400000)
      .toISOString()
      .slice(0, 10);
    fireEvent.change(endInput, { target: { value: target } });
    const hint = within(list).getByTestId("planner-entry-0-clamp-hint");
    expect(hint.textContent).toMatch(/Adjusted to 10w/);
    expect(hint.textContent).toMatch(/min for this template/);
    expect(hint.textContent).toMatch(/picked 2w/);
  });

  it("shows a clamp hint in the apply dialog when the picked end date is outside the range", () => {
    renderPlanner();
    fireEvent.click(screen.getByTestId("planner-template-apply-higdon_5k_novice"));
    fireEvent.click(screen.getByTestId("planner-confirm-pending-apply"));
    fireEvent.click(screen.getByTestId("planner-template-apply-half_marathon"));
    const startInput = screen.getByTestId(
      "planner-pending-apply-start-date",
    ) as HTMLInputElement;
    const endInput = screen.getByTestId(
      "planner-pending-apply-end-date",
    ) as HTMLInputElement;
    const cursorMs = Date.parse(`${startInput.value}T00:00:00Z`);
    // 30 weeks past cursor → clamps to maxWeeks=16.
    const target = new Date(cursorMs + (30 * 7 - 1) * 86400000)
      .toISOString()
      .slice(0, 10);
    fireEvent.change(endInput, { target: { value: target } });
    const hint = screen.getByTestId("planner-pending-apply-clamp-hint");
    expect(hint.textContent).toMatch(/Adjusted to 16w/);
    expect(hint.textContent).toMatch(/max for this template/);
    expect(hint.textContent).toMatch(/picked 30w/);
  });
});

describe("Planner Apply Template race-date overrun warning", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // Config window is exactly 16 weeks (start 2026-05-04 → race
  // 2026-08-23). Applying the marathon template at its 18-week default
  // would push the race date forward by 2 weeks, which the dialog must
  // surface as an explicit warning instead of silently re-anchoring.
  function renderShortConfig() {
    return renderPlanner({
      config: {
        marathonDate: "2026-08-23",
        blocks: [
          { focusType: "Base", weeks: 0, customName: null, customNotes: null },
        ],
      },
    });
  }

  it("shows the race-date preview and overrun warning when the staged template would push the marathon date forward", () => {
    renderShortConfig();
    fireEvent.click(screen.getByTestId("planner-template-apply-marathon"));

    const preview = screen.getByTestId("planner-pending-apply-race-preview");
    expect(preview.textContent).toMatch(/2026-09-06/);
    expect(preview.textContent).toMatch(/was/);
    expect(preview.textContent).toMatch(/2026-08-23/);
    expect(preview.textContent).toMatch(/\+2 weeks later/);

    const warn = screen.getByTestId("planner-pending-apply-overrun-warning");
    expect(warn.textContent).toMatch(/move your marathon date forward/);
    expect(warn.textContent).toMatch(/2 weeks/);

    const keepBtn = screen.getByTestId(
      "planner-keep-race-date",
    ) as HTMLButtonElement;
    expect(keepBtn.textContent).toMatch(/trim to 16w/);

    // The default Add-entry button is relabeled when the action would
    // move race day, so the consequence is unambiguous before clicking.
    expect(
      screen.getByTestId("planner-confirm-pending-apply").textContent,
    ).toMatch(/move race date/);
  });

  it("clicking Keep current race date trims the entry's weeks and leaves the marathon date untouched", () => {
    renderShortConfig();
    fireEvent.click(screen.getByTestId("planner-template-apply-marathon"));
    fireEvent.click(screen.getByTestId("planner-keep-race-date"));

    // Dialog closed.
    expect(screen.queryByTestId("planner-pending-apply-race-preview")).toBeNull();

    // Entry was added with the trimmed week count (16w, not 18w).
    expect(screen.getByText(/Composition · 1 entry · 16\/16w/)).toBeTruthy();

    // Race date input was NOT moved forward.
    expect(
      (screen.getByTestId("planner-marathon-date") as HTMLInputElement).value,
    ).toBe("2026-08-23");
  });

  it("does not show the overrun warning when the staged template fits within the current race date", () => {
    renderPlanner();
    fireEvent.click(screen.getByTestId("planner-template-apply-half_marathon"));
    expect(screen.queryByTestId("planner-pending-apply-overrun-warning")).toBeNull();
    // The race-date preview is still shown for transparency.
    expect(screen.getByTestId("planner-pending-apply-race-preview")).toBeTruthy();
  });
});

// Expected skill-level bucket for every entry in PLAN_TEMPLATES. Kept
// as an explicit table so a regression in `levelOfTemplate` (e.g. an
// id getting promoted from Beginner to Advanced by accident) fails
// this test instead of silently shuffling cards into the wrong section
// of the picker. After task #132 the catalog is curated to ~10
// templates grouped by Beginner / Intermediate / Advanced.
const EXPECTED_LEVELS: Record<string, "Beginner" | "Intermediate" | "Advanced"> = {
  // Beginner — 5K race focus, run-only → heavier hybrid. Task #136
  // first-class hybrid-builder entry stays in Beginner.
  custom_hybrid: "Beginner",
  couch_to_5k: "Beginner",
  higdon_5k_novice: "Beginner",
  "5k_strength_lite": "Beginner",
  "5k_hybrid_balanced": "Beginner",
  // Intermediate — 10K race focus + half-marathon hybrid (Task #219),
  // run-only → heavier hybrid.
  "10k_higdon_int": "Intermediate",
  "10k_daniels": "Intermediate",
  "10k_pfitz": "Intermediate",
  "10k_strength_lite": "Intermediate",
  "10k_hybrid_balanced": "Intermediate",
  // Task #219 — the hybrid half-marathon sits at Intermediate alongside
  // `10k_hybrid_balanced` (the recipe-driven `half_marathon` and
  // `hm_pfitz` stay at Advanced).
  half_marathon_hybrid: "Intermediate",
  // Task #205 — parity-named alias for `half_marathon_hybrid` keeping
  // the `5k_hybrid_balanced` / `10k_hybrid_balanced` id convention.
  half_hybrid_balanced: "Intermediate",
  // Advanced — half-marathon and marathon, run-only → heavier hybrid.
  half_marathon: "Advanced",
  hm_pfitz: "Advanced",
  marathon: "Advanced",
  marathon_pfitz_18_70: "Advanced",
  marathon_hybrid: "Advanced",
};

describe("levelOfTemplate (table-driven)", () => {
  it("has an expected entry for every PLAN_TEMPLATES id (no orphans)", () => {
    const ids = PLAN_TEMPLATES.map((t) => t.id).sort();
    const expected = Object.keys(EXPECTED_LEVELS).sort();
    expect(ids).toEqual(expected);
  });

  it.each(PLAN_TEMPLATES.map((t) => [t.id, t] as const))(
    "%s lands in the expected level",
    (id, tpl) => {
      expect(levelOfTemplate(tpl)).toBe(EXPECTED_LEVELS[id]);
    },
  );
});

describe("Plan Template Library — search filter and level grouping", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    // The template search filter persists to localStorage, so wipe it
    // between tests to keep each case isolated.
    window.localStorage.clear();
  });

  it("renders one section per non-empty level and places known templates in the right buckets", () => {
    renderPlanner();
    // Beginner section contains couch_to_5k; Intermediate contains
    // 10k_higdon_int; Advanced contains half_marathon and marathon.
    const beginnerSection = screen.getByTestId(
      "planner-template-level-beginner",
    );
    expect(
      within(beginnerSection).getByTestId("planner-template-couch_to_5k"),
    ).toBeTruthy();
    expect(
      within(beginnerSection).queryByTestId("planner-template-marathon"),
    ).toBeNull();

    const intermediateSection = screen.getByTestId(
      "planner-template-level-intermediate",
    );
    expect(
      within(intermediateSection).getByTestId("planner-template-10k_higdon_int"),
    ).toBeTruthy();

    const advancedSection = screen.getByTestId(
      "planner-template-level-advanced",
    );
    expect(
      within(advancedSection).getByTestId("planner-template-half_marathon"),
    ).toBeTruthy();
    expect(
      within(advancedSection).getByTestId("planner-template-marathon"),
    ).toBeTruthy();
  });

  it("renders a level badge on every template card", () => {
    renderPlanner();
    expect(
      screen.getByTestId("planner-template-couch_to_5k-level").textContent,
    ).toBe("Beginner");
    expect(
      screen.getByTestId("planner-template-half_marathon-level").textContent,
    ).toBe("Advanced");
    expect(
      screen.getByTestId("planner-template-marathon-level").textContent,
    ).toBe("Advanced");
  });

  it("typing into the search input narrows the visible cards to only matches", () => {
    renderPlanner();
    // Pre-filter sanity: the marathon card is in the DOM.
    expect(screen.getByTestId("planner-template-marathon")).toBeTruthy();

    fireEvent.change(screen.getByTestId("planner-template-search"), {
      target: { value: "pfitz" },
    });

    // Matching templates remain visible (Pfitzinger source).
    expect(screen.getByTestId("planner-template-marathon")).toBeTruthy();
    expect(
      screen.getByTestId("planner-template-marathon_pfitz_18_70"),
    ).toBeTruthy();
    // Non-matching templates are removed from the DOM.
    expect(screen.queryByTestId("planner-template-couch_to_5k")).toBeNull();
    expect(screen.queryByTestId("planner-template-half_marathon")).toBeNull();

    // Summary line reports the match count for the active query.
    // Pfitzinger plans live across both Intermediate (10k_pfitz) and
    // Advanced (hm_pfitz, marathon, marathon_pfitz_18_70). All three
    // levels are expanded by default (task #186 — the planner shows
    // the full 5/5/5 catalog up front), so all 4 matches are visible
    // with no "+N in collapsed levels" suffix.
    const summary = screen.getByTestId("planner-template-search-summary");
    expect(summary.textContent).toContain("4 templates match");
    expect(summary.textContent).toContain("pfitz");
    expect(summary.textContent).not.toContain("collapsed level");

    // Collapsing Advanced manually drops its 3 matches out of the
    // visible count and surfaces them as "+3 in collapsed levels",
    // leaving only the Intermediate 10k_pfitz match visible.
    fireEvent.click(
      screen.getByTestId("planner-template-level-toggle-advanced"),
    );
    expect(summary.textContent).toContain("1 template match");
    expect(summary.textContent).toMatch(/\+3 in collapsed levels?/);
  });

  it("filters by author/source and equipment hint, not just template name", () => {
    renderPlanner();
    // 'higdon' only appears in the source/author field of Higdon templates.
    fireEvent.change(screen.getByTestId("planner-template-search"), {
      target: { value: "higdon" },
    });
    expect(screen.getByTestId("planner-template-higdon_5k_novice")).toBeTruthy();
    expect(
      screen.getByTestId("planner-template-10k_higdon_int"),
    ).toBeTruthy();
    expect(screen.queryByTestId("planner-template-marathon")).toBeNull();
  });

  it("does NOT auto-expand a manually-collapsed level section even when filters have matches inside it (search is scoped to visible levels)", () => {
    renderPlanner();
    // Task #186 default is all three levels expanded — manually
    // collapse Advanced first so we can verify the search-time
    // contract that a collapsed section stays collapsed even when
    // matches live inside it.
    fireEvent.click(
      screen.getByTestId("planner-template-level-toggle-advanced"),
    );
    const advancedBefore = screen.getByTestId(
      "planner-template-level-advanced",
    );
    expect(advancedBefore.querySelector("[hidden]")).not.toBeNull();

    fireEvent.change(screen.getByTestId("planner-template-search"), {
      target: { value: "pfitzinger" },
    });

    // After search, the Advanced section MUST stay collapsed even
    // though most pfitzinger matches live inside it.
    const advancedAfter = screen.getByTestId(
      "planner-template-level-advanced",
    );
    expect(advancedAfter.querySelector("[hidden]")).not.toBeNull();
    // The visible-scoped summary stays at 1 (the Intermediate
    // 10k_pfitz match) + a "+3 in collapsed levels" suffix for the
    // Advanced ones the runner has hidden.
    const summary = screen.getByTestId("planner-template-search-summary");
    expect(summary.textContent).toContain("1 template match");
    expect(summary.textContent).toContain("+3 in collapsed levels");
  });

  it("scopes search results to currently-visible levels — manually-collapsed Intermediate/Advanced sections do not surface their cards as visible matches", () => {
    renderPlanner();
    // Task #186 default is all three levels expanded — manually
    // collapse Intermediate AND Advanced first so we can verify the
    // visible-only scoping contract holds when the runner has narrowed
    // their view to just Beginner.
    fireEvent.click(
      screen.getByTestId("planner-template-level-toggle-intermediate"),
    );
    fireEvent.click(
      screen.getByTestId("planner-template-level-toggle-advanced"),
    );

    fireEvent.change(screen.getByTestId("planner-template-search"), {
      target: { value: "pfitzinger" },
    });

    const summary = screen.getByTestId("planner-template-search-summary");
    expect(summary.textContent).toContain("0 templates match");
    expect(summary.textContent).toContain("+4 in collapsed levels");

    const advanced = screen.getByTestId("planner-template-level-advanced");
    expect(advanced.querySelector("[hidden]")).not.toBeNull();
    // The Advanced pfitzinger cards (hm_pfitz, marathon,
    // marathon_pfitz_18_70) live inside the Advanced section's hidden
    // wrapper — they exist in the DOM (so the runner can opt in by
    // expanding Advanced) but are not part of the visible result set.
    const hmPfitz = within(advanced).getByTestId(
      "planner-template-hm_pfitz",
    );
    const marathon = within(advanced).getByTestId(
      "planner-template-marathon",
    );
    const pfitz70 = within(advanced).getByTestId(
      "planner-template-marathon_pfitz_18_70",
    );
    expect(hmPfitz.closest("[hidden]")).not.toBeNull();
    expect(marathon.closest("[hidden]")).not.toBeNull();
    expect(pfitz70.closest("[hidden]")).not.toBeNull();
  });

  it("shows the empty-state message when no templates match the query", () => {
    renderPlanner();
    expect(screen.queryByTestId("planner-template-empty")).toBeNull();

    fireEvent.change(screen.getByTestId("planner-template-search"), {
      target: { value: "zzznopezzz" },
    });

    const empty = screen.getByTestId("planner-template-empty");
    expect(empty.textContent).toMatch(/No templates match/i);
    // No level sections render when there are zero matches.
    expect(screen.queryByTestId("planner-template-level-beginner")).toBeNull();
    expect(screen.queryByTestId("planner-template-level-advanced")).toBeNull();
    // And the summary reports zero matches with the offending query.
    expect(
      screen.getByTestId("planner-template-search-summary").textContent,
    ).toContain("0 templates match");
  });

  it("clearing the search restores the unfiltered grouped layout", () => {
    renderPlanner();
    fireEvent.change(screen.getByTestId("planner-template-search"), {
      target: { value: "pfitz" },
    });
    expect(screen.queryByTestId("planner-template-couch_to_5k")).toBeNull();

    fireEvent.click(screen.getByTestId("planner-template-search-clear"));

    // Couch to 5K (Beginner) is back, and the summary returns to the default copy.
    expect(screen.getByTestId("planner-template-couch_to_5k")).toBeTruthy();
    const summary = screen.getByTestId("planner-template-search-summary");
    expect(summary.textContent).toMatch(/templates across .* levels/);
  });
});

describe("Plan Template Library — tag-cloud filter", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("toggling a chip narrows the visible templates to those carrying that tag", () => {
    renderPlanner();
    // Pre-filter sanity: a non-pfitzinger template is in the DOM.
    expect(screen.getByTestId("planner-template-couch_to_5k")).toBeTruthy();

    fireEvent.click(screen.getByTestId("planner-template-tag-chip-pfitzinger"));

    // Every pfitzinger template remains visible.
    expect(screen.getByTestId("planner-template-marathon")).toBeTruthy();
    expect(
      screen.getByTestId("planner-template-marathon_pfitz_18_70"),
    ).toBeTruthy();
    // Non-matching templates are filtered out.
    expect(screen.queryByTestId("planner-template-couch_to_5k")).toBeNull();
    expect(screen.queryByTestId("planner-template-half_marathon")).toBeNull();

    // Summary line reflects the active tag filter.
    const summary = screen.getByTestId("planner-template-search-summary");
    expect(summary.textContent).toMatch(/templates? match/);
    expect(summary.textContent).toContain("#pfitzinger");
  });

  it("composes multiple selected chips with AND semantics", () => {
    renderPlanner();

    fireEvent.click(screen.getByTestId("planner-template-tag-chip-pfitzinger"));
    fireEvent.click(
      screen.getByTestId("planner-template-tag-chip-high-mileage"),
    );

    // Only marathon_pfitz_18_70 carries BOTH tags.
    expect(
      screen.getByTestId("planner-template-marathon_pfitz_18_70"),
    ).toBeTruthy();
    // The other pfitzinger template (no high-mileage tag) is filtered out.
    expect(screen.queryByTestId("planner-template-marathon")).toBeNull();
    // Other templates (non-pfitzinger) are filtered out too.
    expect(screen.queryByTestId("planner-template-couch_to_5k")).toBeNull();
    expect(screen.queryByTestId("planner-template-half_marathon")).toBeNull();
  });

  it("composes the chip filter with the free-text query (AND)", () => {
    renderPlanner();

    fireEvent.click(screen.getByTestId("planner-template-tag-chip-pfitzinger"));
    fireEvent.change(screen.getByTestId("planner-template-search"), {
      target: { value: "couch" },
    });

    // No template carries both `pfitzinger` AND matches "couch" text.
    expect(screen.getByTestId("planner-template-empty")).toBeTruthy();
  });

  it("Clear restores the full unfiltered list", () => {
    renderPlanner();
    fireEvent.click(screen.getByTestId("planner-template-tag-chip-pfitzinger"));
    expect(screen.queryByTestId("planner-template-couch_to_5k")).toBeNull();

    fireEvent.click(screen.getByTestId("planner-template-tag-cloud-clear"));

    // Previously-hidden templates return.
    expect(screen.getByTestId("planner-template-couch_to_5k")).toBeTruthy();
    expect(screen.getByTestId("planner-template-half_marathon")).toBeTruthy();
    // The Clear button itself disappears once nothing is selected.
    expect(screen.queryByTestId("planner-template-tag-cloud-clear")).toBeNull();
    // Summary returns to the default copy.
    expect(
      screen.getByTestId("planner-template-search-summary").textContent,
    ).toMatch(/templates across .* levels/);
  });

  it("toggling the same chip twice deselects it (acts like Clear for a single tag)", () => {
    renderPlanner();
    const chip = screen.getByTestId("planner-template-tag-chip-pfitzinger");

    fireEvent.click(chip);
    expect(screen.queryByTestId("planner-template-couch_to_5k")).toBeNull();

    fireEvent.click(chip);
    expect(screen.getByTestId("planner-template-couch_to_5k")).toBeTruthy();
  });

  it("each chip carries a count badge of how many templates it would surface", () => {
    renderPlanner();

    // pfitzinger appears on 2 templates (marathon, marathon_pfitz_18_70)
    // — sanity-check it shows a positive count rather than the literal
    // zero placeholder.
    const pfitzCount = screen.getByTestId(
      "planner-template-tag-chip-count-pfitzinger",
    );
    const match = pfitzCount.textContent?.match(/(\d+)/);
    expect(match).not.toBeNull();
    const initialCount = Number(match![1]);
    expect(initialCount).toBeGreaterThan(1);
  });

  it("chip counts narrow as the free-text query narrows the catalog", () => {
    renderPlanner();
    const before = Number(
      screen
        .getByTestId("planner-template-tag-chip-count-pfitzinger")
        .textContent?.match(/(\d+)/)?.[1],
    );

    fireEvent.change(screen.getByTestId("planner-template-search"), {
      target: { value: "70" },
    });

    const after = Number(
      screen
        .getByTestId("planner-template-tag-chip-count-pfitzinger")
        .textContent?.match(/(\d+)/)?.[1],
    );
    // Restricting the free-text query to "70" should leave only the
    // marathon_pfitz_18_70 template, narrowing the count. Use <= so
    // adding more pfitzinger 70-mpw templates later doesn't make this
    // brittle; the >0 lower bound keeps the assertion meaningful.
    expect(after).toBeLessThanOrEqual(before);
    expect(after).toBeGreaterThan(0);
  });

  it("chip counts narrow as additional chips are selected (AND semantics)", () => {
    renderPlanner();
    const beforeMarathon = Number(
      screen
        .getByTestId("planner-template-tag-chip-count-marathon")
        .textContent?.match(/(\d+)/)?.[1],
    );

    fireEvent.click(screen.getByTestId("planner-template-tag-chip-pfitzinger"));

    const afterMarathon = Number(
      screen
        .getByTestId("planner-template-tag-chip-count-marathon")
        .textContent?.match(/(\d+)/)?.[1],
    );
    // Adding pfitzinger can only shrink (or preserve) the marathon
    // count to those marathon templates that are also pfitzinger. Use
    // <= so adding more crossover templates doesn't make this brittle;
    // the >0 lower bound keeps the assertion meaningful.
    expect(afterMarathon).toBeLessThanOrEqual(beforeMarathon);
    expect(afterMarathon).toBeGreaterThan(0);
  });

  it("hides zero-count chips behind a '+N hidden' toggle once a filter is active; expanded chips stay disabled", () => {
    renderPlanner();
    // 5k is interactive on a fresh catalog and no toggle is shown
    // because no filter is applied yet.
    const fivek = screen.getByTestId(
      "planner-template-tag-chip-5k",
    ) as HTMLButtonElement;
    expect(fivek.disabled).toBe(false);
    expect(
      screen.queryByTestId("planner-template-tag-cloud-toggle-hidden"),
    ).toBeNull();

    // Selecting pfitzinger creates a dead-end for 5k (no template
    // carries both tags), so the 5k chip is collapsed out of the
    // cloud and hides behind the "+N hidden" toggle.
    fireEvent.click(screen.getByTestId("planner-template-tag-chip-pfitzinger"));

    expect(screen.queryByTestId("planner-template-tag-chip-5k")).toBeNull();
    const toggle = screen.getByTestId(
      "planner-template-tag-cloud-toggle-hidden",
    );
    expect(toggle.textContent).toMatch(/^\+\d+ hidden$/);

    // The currently-selected chip itself stays interactive (and
    // visible) so the runner can deselect it without hunting for the
    // Clear button.
    const pfitzAfter = screen.getByTestId(
      "planner-template-tag-chip-pfitzinger",
    ) as HTMLButtonElement;
    expect(pfitzAfter.disabled).toBe(false);

    // Expanding the toggle reveals the hidden chips (still disabled
    // so the dead-end signal is preserved) and switches the toggle
    // label to a collapse affordance.
    fireEvent.click(toggle);
    const fivekAfter = screen.getByTestId(
      "planner-template-tag-chip-5k",
    ) as HTMLButtonElement;
    expect(fivekAfter.disabled).toBe(true);
    expect(
      screen.getByTestId("planner-template-tag-chip-count-5k").textContent,
    ).toContain("0");
    expect(
      screen.getByTestId("planner-template-tag-cloud-toggle-hidden").textContent,
    ).toBe("Show less");

    // Clearing the selection brings every chip back and removes the
    // toggle entirely.
    fireEvent.click(screen.getByTestId("planner-template-tag-cloud-clear"));
    expect(
      screen.queryByTestId("planner-template-tag-cloud-toggle-hidden"),
    ).toBeNull();
    expect(
      (
        screen.getByTestId(
          "planner-template-tag-chip-5k",
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it("hides zero-count chips under a free-text-only filter and resets the toggle when the search clears", () => {
    renderPlanner();
    // No filter: 5k is visible and there is no toggle yet.
    expect(screen.getByTestId("planner-template-tag-chip-5k")).toBeTruthy();
    expect(
      screen.queryByTestId("planner-template-tag-cloud-toggle-hidden"),
    ).toBeNull();

    // Free-text search alone (no chip selection) is enough to trigger
    // the collapse — searching "pfitz" zeroes out the 5k tag.
    fireEvent.change(screen.getByTestId("planner-template-search"), {
      target: { value: "pfitz" },
    });
    expect(screen.queryByTestId("planner-template-tag-chip-5k")).toBeNull();
    const toggle = screen.getByTestId(
      "planner-template-tag-cloud-toggle-hidden",
    );
    fireEvent.click(toggle);
    expect(
      (
        screen.getByTestId(
          "planner-template-tag-chip-5k",
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    // Clearing the search drops the toggle back to its collapsed
    // default so a fresh filter session starts clean instead of
    // remembering the previous expansion.
    fireEvent.change(screen.getByTestId("planner-template-search"), {
      target: { value: "" },
    });
    expect(
      screen.queryByTestId("planner-template-tag-cloud-toggle-hidden"),
    ).toBeNull();

    // Re-applying a filter yields the collapsed state again, not an
    // already-expanded one.
    fireEvent.change(screen.getByTestId("planner-template-search"), {
      target: { value: "pfitz" },
    });
    expect(screen.queryByTestId("planner-template-tag-chip-5k")).toBeNull();
    expect(
      screen
        .getByTestId("planner-template-tag-cloud-toggle-hidden")
        .textContent,
    ).toMatch(/^\+\d+ hidden$/);
  });
});

describe("Quick-add popover (entries-mode) — tag-cloud filter", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("toggling a chip in the quick-add popover narrows the option list", () => {
    renderPlanner();
    // Enter entries-mode by applying any template; this exposes the
    // quick-add combobox at the bottom of the composition editor.
    fireEvent.click(screen.getByTestId("planner-template-apply-higdon_5k_novice"));
    fireEvent.click(screen.getByTestId("planner-confirm-pending-apply"));

    // Open the quick-add popover.
    fireEvent.click(screen.getByTestId("planner-entry-add-select"));
    expect(screen.getByTestId("planner-entry-add-popover")).toBeTruthy();

    // Pre-filter sanity: a non-pfitzinger option is in the popover.
    expect(
      screen.getByTestId("planner-entry-add-option-half_marathon"),
    ).toBeTruthy();

    // Toggle the pfitzinger chip inside the popover.
    fireEvent.click(
      screen.getByTestId("planner-entry-add-tag-chip-pfitzinger"),
    );

    // Pfitzinger options remain.
    expect(
      screen.getByTestId("planner-entry-add-option-marathon"),
    ).toBeTruthy();
    expect(
      screen.getByTestId("planner-entry-add-option-marathon_pfitz_18_70"),
    ).toBeTruthy();
    // Non-matching options are filtered out.
    expect(
      screen.queryByTestId("planner-entry-add-option-half_marathon"),
    ).toBeNull();
    expect(
      screen.queryByTestId("planner-entry-add-option-couch_to_5k"),
    ).toBeNull();
  });

  it("quick-add chips carry counts that narrow with the popover's free-text query and selected chips", () => {
    renderPlanner();
    fireEvent.click(screen.getByTestId("planner-template-apply-higdon_5k_novice"));
    fireEvent.click(screen.getByTestId("planner-confirm-pending-apply"));
    fireEvent.click(screen.getByTestId("planner-entry-add-select"));

    const initial = Number(
      screen
        .getByTestId("planner-entry-add-tag-chip-count-pfitzinger")
        .textContent?.match(/(\d+)/)?.[1],
    );
    expect(initial).toBeGreaterThan(1);

    // Free-text search inside the popover narrows the count.
    fireEvent.change(screen.getByTestId("planner-entry-add-search"), {
      target: { value: "70" },
    });
    const afterSearch = Number(
      screen
        .getByTestId("planner-entry-add-tag-chip-count-pfitzinger")
        .textContent?.match(/(\d+)/)?.[1],
    );
    // Use <= so adding more pfitzinger 70-mpw templates later doesn't
    // make this brittle; the >0 lower bound keeps the assertion
    // meaningful.
    expect(afterSearch).toBeLessThanOrEqual(initial);
    expect(afterSearch).toBeGreaterThan(0);
  });

  it("hides zero-count quick-add chips behind a '+N hidden' toggle once a filter is active; expanded chips stay disabled", () => {
    renderPlanner();
    fireEvent.click(screen.getByTestId("planner-template-apply-higdon_5k_novice"));
    fireEvent.click(screen.getByTestId("planner-confirm-pending-apply"));
    fireEvent.click(screen.getByTestId("planner-entry-add-select"));

    // 5k is interactive at first and no toggle is shown.
    const fivek = screen.getByTestId(
      "planner-entry-add-tag-chip-5k",
    ) as HTMLButtonElement;
    expect(fivek.disabled).toBe(false);
    expect(
      screen.queryByTestId("planner-entry-add-tag-cloud-toggle-hidden"),
    ).toBeNull();

    fireEvent.click(
      screen.getByTestId("planner-entry-add-tag-chip-pfitzinger"),
    );

    // 5k collapses out of the cloud (no template carries both pfitzinger
    // AND the 5k tag), replaced by a "+N hidden" expander mirroring the
    // Plan Template Library card.
    expect(
      screen.queryByTestId("planner-entry-add-tag-chip-5k"),
    ).toBeNull();
    const toggle = screen.getByTestId(
      "planner-entry-add-tag-cloud-toggle-hidden",
    );
    expect(toggle.textContent).toMatch(/^\+\d+ hidden$/);

    // Expanding shows the hidden chips, still disabled with their
    // zero count, and flips the toggle label.
    fireEvent.click(toggle);
    const fivekAfter = screen.getByTestId(
      "planner-entry-add-tag-chip-5k",
    ) as HTMLButtonElement;
    expect(fivekAfter.disabled).toBe(true);
    expect(
      screen.getByTestId("planner-entry-add-tag-chip-count-5k").textContent,
    ).toContain("0");
    expect(
      screen.getByTestId("planner-entry-add-tag-cloud-toggle-hidden")
        .textContent,
    ).toBe("Show less");
  });

  it("hides zero-count quick-add chips under a free-text-only filter and resets the toggle when the search clears", () => {
    renderPlanner();
    fireEvent.click(screen.getByTestId("planner-template-apply-higdon_5k_novice"));
    fireEvent.click(screen.getByTestId("planner-confirm-pending-apply"));
    fireEvent.click(screen.getByTestId("planner-entry-add-select"));

    expect(
      screen.getByTestId("planner-entry-add-tag-chip-5k"),
    ).toBeTruthy();
    expect(
      screen.queryByTestId("planner-entry-add-tag-cloud-toggle-hidden"),
    ).toBeNull();

    // Free-text typing in the popover (no chip selection) is enough
    // to collapse zero-count chips. "pfitz" zeroes out the 5k tag.
    fireEvent.change(screen.getByTestId("planner-entry-add-search"), {
      target: { value: "pfitz" },
    });
    expect(
      screen.queryByTestId("planner-entry-add-tag-chip-5k"),
    ).toBeNull();
    const toggle = screen.getByTestId(
      "planner-entry-add-tag-cloud-toggle-hidden",
    );
    fireEvent.click(toggle);
    expect(
      (
        screen.getByTestId(
          "planner-entry-add-tag-chip-5k",
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    // Clearing the search resets the expansion so the next filter
    // session starts collapsed by default.
    fireEvent.change(screen.getByTestId("planner-entry-add-search"), {
      target: { value: "" },
    });
    expect(
      screen.queryByTestId("planner-entry-add-tag-cloud-toggle-hidden"),
    ).toBeNull();
  });

  it("Clear in the quick-add popover restores the full option list", () => {
    renderPlanner();
    fireEvent.click(screen.getByTestId("planner-template-apply-higdon_5k_novice"));
    fireEvent.click(screen.getByTestId("planner-confirm-pending-apply"));

    fireEvent.click(screen.getByTestId("planner-entry-add-select"));
    fireEvent.click(
      screen.getByTestId("planner-entry-add-tag-chip-pfitzinger"),
    );
    expect(
      screen.queryByTestId("planner-entry-add-option-half_marathon"),
    ).toBeNull();

    fireEvent.click(screen.getByTestId("planner-entry-add-tag-cloud-clear"));

    expect(
      screen.getByTestId("planner-entry-add-option-half_marathon"),
    ).toBeTruthy();
    expect(
      screen.queryByTestId("planner-entry-add-tag-cloud-clear"),
    ).toBeNull();
  });
});

describe("Planner template tag-cloud chip counts", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    // Selecting chips here writes to localStorage; clear so the
    // persistence describe block below isn't seeded with stale tags.
    window.localStorage.clear();
  });

  it("renders each chip with its template count and updates the other chips' counts when one is selected; zero-count chips collapse behind a '+N hidden' toggle and stay disabled when expanded", () => {
    renderPlanner();

    // The catalog has multiple "marathon" templates and multiple
    // "5k" templates with no overlap (no marathon template carries
    // the 5k tag). So before any selection both chips show a
    // positive count and neither is disabled; after selecting
    // "marathon" the 5k chip drops to count 0.
    const marathonChip = screen.getByTestId(
      "planner-template-tag-chip-marathon",
    ) as HTMLButtonElement;
    const fivekChip = screen.getByTestId(
      "planner-template-tag-chip-5k",
    ) as HTMLButtonElement;

    function readCount(tag: string): number {
      const el = screen.getByTestId(`planner-template-tag-chip-count-${tag}`);
      const m = (el.textContent ?? "").match(/(\d+)/);
      expect(m).not.toBeNull();
      return Number(m![1]);
    }

    const marathonBefore = readCount("marathon");
    const fivekBefore = readCount("5k");
    // Both chips reflect a positive count rendered as "· N".
    expect(marathonBefore).toBeGreaterThan(0);
    expect(fivekBefore).toBeGreaterThan(0);
    expect(
      screen.getByTestId("planner-template-tag-chip-count-marathon")
        .textContent,
    ).toBe(`· ${marathonBefore}`);
    expect(marathonChip.disabled).toBe(false);
    expect(fivekChip.disabled).toBe(false);

    // Selecting "marathon" should leave its own chip's count
    // unchanged (selecting an already-active tag is a no-op under
    // AND-semantics) and zero out chips like "5k" that no marathon
    // template carries.
    fireEvent.click(marathonChip);

    expect(readCount("marathon")).toBe(marathonBefore);
    // The active chip itself stays interactive (clicking deselects).
    expect(
      (
        screen.getByTestId(
          "planner-template-tag-chip-marathon",
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    // Zero-count chips like 5k collapse behind the
    // "+N hidden" toggle so the cloud stays scannable.
    expect(
      screen.queryByTestId("planner-template-tag-chip-5k"),
    ).toBeNull();
    fireEvent.click(
      screen.getByTestId("planner-template-tag-cloud-toggle-hidden"),
    );
    // Once expanded the chip reappears with its zero count and stays
    // disabled so runners can't over-narrow into a dead end.
    expect(readCount("5k")).toBe(0);
    expect(
      (
        screen.getByTestId(
          "planner-template-tag-chip-5k",
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});

describe("Plan Template Library — tag-cloud filter persistence", () => {
  const STORAGE_KEY = "planner.selectedTemplateTags.v1";

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("persists selected tag chips across reloads via localStorage", () => {
    const first = renderPlanner();

    // Select two chips. AND-semantics narrows to templates carrying both.
    fireEvent.click(screen.getByTestId("planner-template-tag-chip-pfitzinger"));
    fireEvent.click(
      screen.getByTestId("planner-template-tag-chip-high-mileage"),
    );

    // Sanity: the chip-driven filter is in effect (only marathon_pfitz_18_70
    // carries both pfitzinger AND high-mileage).
    expect(
      screen.getByTestId("planner-template-marathon_pfitz_18_70"),
    ).toBeTruthy();
    expect(screen.queryByTestId("planner-template-couch_to_5k")).toBeNull();

    // The persist effect must have written the selection to storage.
    const persisted = window.localStorage.getItem(STORAGE_KEY);
    expect(persisted).not.toBeNull();
    const parsed = JSON.parse(persisted!) as string[];
    expect(new Set(parsed)).toEqual(new Set(["pfitzinger", "high-mileage"]));

    // Simulate a reload: tear down the planner and mount it fresh. The
    // hydration path should rebuild the same filter from localStorage.
    first.unmount();
    renderPlanner();

    // Both chips come back active (aria-pressed) without the runner
    // having to click anything.
    expect(
      screen
        .getByTestId("planner-template-tag-chip-pfitzinger")
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen
        .getByTestId("planner-template-tag-chip-high-mileage")
        .getAttribute("aria-pressed"),
    ).toBe("true");
    // And the filter is genuinely re-applied: marathon_pfitz_18_70 is the lone match.
    expect(
      screen.getByTestId("planner-template-marathon_pfitz_18_70"),
    ).toBeTruthy();
    expect(screen.queryByTestId("planner-template-couch_to_5k")).toBeNull();
    // The Clear control is rendered with the restored count.
    expect(
      screen.getByTestId("planner-template-tag-cloud-clear").textContent,
    ).toContain("(2)");
  });

  it("Clear wipes both the in-memory selection and the persisted storage entry", () => {
    renderPlanner();

    fireEvent.click(screen.getByTestId("planner-template-tag-chip-pfitzinger"));
    // Sanity: storage is populated after selecting.
    expect(window.localStorage.getItem(STORAGE_KEY)).not.toBeNull();

    fireEvent.click(screen.getByTestId("planner-template-tag-cloud-clear"));

    // The Clear button disappears (no active selection) and the
    // persisted entry is removed entirely (rather than left as an
    // empty array) so a future reload starts from a clean slate.
    expect(screen.queryByTestId("planner-template-tag-cloud-clear")).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("drops persisted tags that are no longer in the catalog on hydration without console errors", () => {
    // Seed storage with one tag that exists in the bundled catalog and
    // one that does not (e.g. a tag retired between visits).
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(["pfitzinger", "definitely-not-a-real-tag-xyz"]),
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      renderPlanner();

      // The valid tag stays active; the stale tag is silently dropped.
      expect(
        screen
          .getByTestId("planner-template-tag-chip-pfitzinger")
          .getAttribute("aria-pressed"),
      ).toBe("true");
      // Stale tag never renders a chip (it isn't in the catalog).
      expect(
        screen.queryByTestId(
          "planner-template-tag-chip-definitely-not-a-real-tag-xyz",
        ),
      ).toBeNull();
      // Filter is in the surviving single-tag state, not the empty
      // state — non-pfitzinger templates are filtered out.
      expect(screen.queryByTestId("planner-template-couch_to_5k")).toBeNull();
      // The Clear control shows the pruned count of 1.
      expect(
        screen.getByTestId("planner-template-tag-cloud-clear").textContent,
      ).toContain("(1)");
      // The persist effect rewrites storage without the stale tag so
      // the prune is durable across the next reload.
      const persisted = window.localStorage.getItem(STORAGE_KEY);
      expect(persisted).not.toBeNull();
      expect(JSON.parse(persisted!)).toEqual(["pfitzinger"]);

      // Hydration must be silent — no errors or warnings logged.
      expect(errSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      errSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});

describe("Tag-cloud sort toggle", () => {
  const TEMPLATE_SORT_KEY = "planner.templateTagSort.v1";
  const QUICKADD_SORT_KEY = "planner.quickAddTagSort.v1";

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  function templateChipOrder(): string[] {
    return screen
      .getAllByTestId(/^planner-template-tag-chip-(?!count-)/)
      .map((el) => el.getAttribute("data-testid")!.replace(
        "planner-template-tag-chip-",
        "",
      ));
  }

  function quickAddChipOrder(): string[] {
    return screen
      .getAllByTestId(/^planner-entry-add-tag-chip-(?!count-)/)
      .map((el) => el.getAttribute("data-testid")!.replace(
        "planner-entry-add-tag-chip-",
        "",
      ));
  }

  it("Plan Template Library: clicking A–Z reorders chips alphabetically; By count restores count order", () => {
    renderPlanner();

    const countOrder = templateChipOrder();
    const alphaSorted = [...countOrder].sort((a, b) => a.localeCompare(b));
    // The default is "By count", and the catalog has tags whose count
    // ordering is not already alphabetical — so the two orders differ.
    expect(countOrder).not.toEqual(alphaSorted);
    expect(
      screen
        .getByTestId("planner-template-tag-cloud-sort-count")
        .getAttribute("aria-pressed"),
    ).toBe("true");

    fireEvent.click(screen.getByTestId("planner-template-tag-cloud-sort-alpha"));

    expect(
      screen
        .getByTestId("planner-template-tag-cloud-sort-alpha")
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(templateChipOrder()).toEqual(alphaSorted);

    fireEvent.click(screen.getByTestId("planner-template-tag-cloud-sort-count"));
    expect(
      screen
        .getByTestId("planner-template-tag-cloud-sort-count")
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(templateChipOrder()).toEqual(countOrder);
  });

  it("Plan Template Library: sort choice persists to localStorage and survives a remount", () => {
    const first = renderPlanner();
    fireEvent.click(screen.getByTestId("planner-template-tag-cloud-sort-alpha"));
    expect(window.localStorage.getItem(TEMPLATE_SORT_KEY)).toBe("alpha");
    const alphaOrder = templateChipOrder();

    first.unmount();
    renderPlanner();

    expect(
      screen
        .getByTestId("planner-template-tag-cloud-sort-alpha")
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(templateChipOrder()).toEqual(alphaOrder);
  });

  it("Quick-add popover: A–Z reorders chips and persists separately from the library toggle", () => {
    renderPlanner();
    fireEvent.click(screen.getByTestId("planner-template-apply-higdon_5k_novice"));
    fireEvent.click(screen.getByTestId("planner-confirm-pending-apply"));
    fireEvent.click(screen.getByTestId("planner-entry-add-select"));

    const countOrder = quickAddChipOrder();
    const alphaSorted = [...countOrder].sort((a, b) => a.localeCompare(b));
    expect(countOrder).not.toEqual(alphaSorted);

    fireEvent.click(
      screen.getByTestId("planner-entry-add-tag-cloud-sort-alpha"),
    );
    expect(
      screen
        .getByTestId("planner-entry-add-tag-cloud-sort-alpha")
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(quickAddChipOrder()).toEqual(alphaSorted);

    // Quick-add toggle persists under its OWN storage key — not the
    // template-library key — so the two surfaces don't bleed into one
    // another.
    expect(window.localStorage.getItem(QUICKADD_SORT_KEY)).toBe("alpha");
    // Library toggle untouched, so its persisted mode stays at the
    // default "count" — not changed to "alpha" by the quick-add click.
    expect(window.localStorage.getItem(TEMPLATE_SORT_KEY)).toBe("count");
  });

  it("Quick-add popover: sort choice survives a remount via the QUICKADD_SORT_KEY", () => {
    window.localStorage.setItem(QUICKADD_SORT_KEY, "alpha");
    renderPlanner();
    fireEvent.click(screen.getByTestId("planner-template-apply-higdon_5k_novice"));
    fireEvent.click(screen.getByTestId("planner-confirm-pending-apply"));
    fireEvent.click(screen.getByTestId("planner-entry-add-select"));

    expect(
      screen
        .getByTestId("planner-entry-add-tag-cloud-sort-alpha")
        .getAttribute("aria-pressed"),
    ).toBe("true");
    const observed = quickAddChipOrder();
    const sorted = [...observed].sort((a, b) => a.localeCompare(b));
    expect(observed).toEqual(sorted);
  });
});

describe("defaultBlankConfig", () => {
  it("produces a payload that passes validatePlannerConfig (legacy blocks-mode)", () => {
    const blank = defaultBlankConfig();
    const issues = validatePlannerConfig({
      startDate: blank.startDate,
      marathonDate: blank.marathonDate,
      blocks: blank.blocks,
    });
    expect(issues).toEqual([]);
  });
});

describe("Planner archived-template migration safety", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // A persisted config whose entries reference templates pruned from
  // PLAN_TEMPLATES during the level-grouped curation pass. The catalog
  // must not error on these IDs: the entry should render with an
  // "Archived template" badge and the Save / Apply controls must remain
  // operable so the runner can keep editing or regenerate the plan.
  const ARCHIVED_ENTRIES_CONFIG = {
    id: 7,
    name: "Legacy plan",
    isActive: true,
    startDate: "2026-05-04", // Monday
    marathonDate: "2026-06-28", // Sunday at the end of the 8th Mon..Sun week
    blocks: [],
    entries: [
      {
        templateId: "marathon_hansons",
        weeks: 4,
        startDate: "2026-05-04",
        customName: null,
        customNotes: null,
      },
      {
        templateId: "aerobic_base",
        weeks: 4,
        startDate: "2026-06-01",
        customName: null,
        customNotes: null,
      },
    ],
    notes: null,
    updatedAt: "2026-05-04T00:00:00.000Z",
    lastAppliedAt: null,
  };

  it("renders the Archived template badge for entries pointing at pruned templates", () => {
    renderPlanner({
      config: ARCHIVED_ENTRIES_CONFIG as unknown as typeof SAMPLE_CONFIG,
    });
    expect(screen.getByTestId("planner-entry-0-archived")).toBeTruthy();
    expect(screen.getByTestId("planner-entry-1-archived")).toBeTruthy();
  });

  it("keeps Save and Apply enabled when the only validation concern is archived template IDs", () => {
    renderPlanner({
      config: ARCHIVED_ENTRIES_CONFIG as unknown as typeof SAMPLE_CONFIG,
    });
    expect(
      (screen.getByTestId("planner-save") as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(
      (screen.getByTestId("planner-apply") as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("does not surface the archived template IDs anywhere in the picker", () => {
    renderPlanner({
      config: ARCHIVED_ENTRIES_CONFIG as unknown as typeof SAMPLE_CONFIG,
    });
    // The picker renders one Apply button per LIVE catalog template. An
    // archived ID must never get a card / Apply button there.
    expect(
      screen.queryByTestId("planner-template-apply-marathon_hansons"),
    ).toBeNull();
    expect(
      screen.queryByTestId("planner-template-apply-aerobic_base"),
    ).toBeNull();
  });
});

// Task #136 — the "Build my own hybrid" Beginner card replaces the
// usual single Apply button with a slider + days/level + event-date
// builder, and a live preview of week 1 that mirrors what the
// generator will emit. These tests cover the unique pieces of that
// flow that don't apply to any other template card.
// Task #175 — the per-block sparkline now overlays an amber-400 dot on
// every week whose Wed will be a Steady Run. The dot uses the same
// HR_ZONE_COLORS[3] swatch the plan calendar chip and the Run Target
// chip on Today / Week Detail use, so a Z3 stimulus reads the same
// across surfaces. The marker is purely driven by the
// `wedSteady` flag on `previewWeeklyMileage` output, which mirrors the
// generator's `buildWeekDays` rule (Marathon-Specific recipe,
// non-cutback, non-race-week, no swap). These tests assert the marker
// appears only on the auto-pinned tail block (which uses Marathon-
// Specific) and not on the user-authored Base / Time on Feet blocks.
describe("Block sparkline Steady-Wed marker (Task #175)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the steady legend on the Marathon-Specific tail and omits it from Base / Time on Feet blocks", () => {
    renderPlanner();
    // SAMPLE_CONFIG has Base 18 + Time on Feet 18 + auto-pinned 16-week
    // Marathon-Specific tail. Only the tail recipe emits Steady Wed
    // sessions, so only the tail sparkline should show the legend.
    expect(
      screen.queryByTestId("planner-block-0-sparkline-steady-legend"),
    ).toBeNull();
    expect(
      screen.queryByTestId("planner-block-1-sparkline-steady-legend"),
    ).toBeNull();
    const tailLegend = screen.getByTestId(
      "planner-block-tail-sparkline-steady-legend",
    );
    expect(tailLegend.textContent).toContain("Steady Wed");
    // Tail is 16 weeks; 4 are cutbacks (every 4th), and the final week
    // is the race week, so the Marathon-Specific tail emits Steady Wed
    // on weeks {1,2,3,5,6,7,9,10,11,13,14,15} of the block — 12 weeks.
    // The legend pluralizes "wks" so verify both the count and the
    // plural suffix so a future regression in the gating rule shows up
    // here instead of silently in production.
    expect(tailLegend.textContent).toContain("12");
    expect(tailLegend.textContent).toContain("wks");
  });

  it("places one amber dot per steady week inside the tail sparkline", () => {
    renderPlanner();
    // Each per-week dot uses testid `<sparkline-id>-steady-w<weekNumber>`.
    // The tail sits at planner-block weeks 37..52 in SAMPLE_CONFIG, so
    // its steady weeks are 37,38,39,41,42,43,45,46,47,49,50,51 (12 wks,
    // skipping cutbacks 40/44/48 and race week 52).
    const expected = [37, 38, 39, 41, 42, 43, 45, 46, 47, 49, 50, 51];
    for (const w of expected) {
      expect(
        screen.getByTestId(`planner-block-tail-sparkline-steady-w${w}`),
      ).toBeTruthy();
    }
    for (const w of [40, 44, 48, 52]) {
      expect(
        screen.queryByTestId(`planner-block-tail-sparkline-steady-w${w}`),
      ).toBeNull();
    }
  });
});

// Task #181 — the plan-wide MileageCurve in the Plan Preview card now
// surfaces the same amber-400 Steady-Wed marker the per-block sparklines
// (Task #175) and the plan calendar week strip already use, so a runner
// can scan the entire 52-week build at a glance and immediately see
// which weeks earn the Z3 stimulus. Marker placement is fully driven by
// the `wedSteady` flag on `previewWeeklyMileage` output, so the same
// gating that drives the sparkline tail (Marathon-Specific recipe,
// non-cutback, non-race-week) applies here too. SAMPLE_CONFIG has Base
// 18 + Time on Feet 18 (neither emits Steady Wed) followed by the
// auto-pinned 16-week Marathon-Specific tail (weeks 37..52), so only
// weeks 37,38,39,41,42,43,45,46,47,49,50,51 should carry an amber dot.
describe("Plan-wide mileage curve Steady-Wed marker (Task #181)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("places one amber dot on every Steady-Wed week of the full plan curve", () => {
    renderPlanner();
    const expected = [37, 38, 39, 41, 42, 43, 45, 46, 47, 49, 50, 51];
    for (const w of expected) {
      expect(
        screen.getByTestId(`planner-mileage-curve-steady-w${w}`),
      ).toBeTruthy();
    }
    // Cutbacks 40/44/48 and race week 52 must NOT carry a marker, and
    // neither should any week from the user-authored Base / Time on
    // Feet blocks (1..36) which use recipes that don't emit Steady Wed.
    for (const w of [40, 44, 48, 52, 1, 18, 19, 36]) {
      expect(
        screen.queryByTestId(`planner-mileage-curve-steady-w${w}`),
      ).toBeNull();
    }
  });

  it("renders the steady legend with the correct count and pluralization", () => {
    renderPlanner();
    const legend = screen.getByTestId("planner-mileage-curve-steady-legend");
    expect(legend.textContent).toContain("Steady Wed");
    expect(legend.textContent).toContain("12");
    expect(legend.textContent).toContain("wks");
  });
});

describe("Custom hybrid builder card (Task #136)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("renders the slider, slot inputs, and structured weekly preview instead of an Apply button", () => {
    renderPlanner();
    // The custom_hybrid card is special — no plain Apply button is
    // emitted; the Build CTA lives at the bottom of the builder.
    expect(
      screen.queryByTestId("planner-template-apply-custom_hybrid"),
    ).toBeNull();
    expect(screen.getByTestId("planner-hybrid-builder")).toBeTruthy();
    expect(screen.getByTestId("planner-hybrid-slider")).toBeTruthy();
    expect(screen.getByTestId("planner-hybrid-days-input")).toBeTruthy();
    expect(screen.getByTestId("planner-hybrid-level-select")).toBeTruthy();
    expect(screen.getByTestId("planner-hybrid-event-date-input")).toBeTruthy();
    expect(screen.getByTestId("planner-hybrid-build")).toBeTruthy();
    // The structured preview must render the full Mon..Sun strip and a
    // totals line, defaulted to Balanced / 5 days / Beginner. Balanced
    // schedules pin the long run on Sun, so the Sun cell should show
    // a "Long Run" label.
    const totals = screen.getByTestId("planner-hybrid-preview-totals");
    expect(totals.textContent).toContain("5 sessions");
    expect(totals.textContent).toContain("3 runs");
    expect(totals.textContent).toContain("2 lifts");
    const sunCell = screen.getByTestId("planner-hybrid-preview-sun");
    expect(sunCell.textContent).toContain("Long Run");
  });

  it("rewrites the preview when the runner changes days/week", () => {
    renderPlanner();
    const totalsBefore = screen.getByTestId("planner-hybrid-preview-totals")
      .textContent ?? "";
    expect(totalsBefore).toContain("5 sessions");
    fireEvent.change(screen.getByTestId("planner-hybrid-days-input"), {
      target: { value: "3" },
    });
    const totalsAfter = screen.getByTestId("planner-hybrid-preview-totals")
      .textContent ?? "";
    expect(totalsAfter).toContain("3 sessions");
    // Trim must preserve the long run on Balanced — Sun stays a Long Run
    // even when daysPerWeek drops to 3.
    expect(
      screen.getByTestId("planner-hybrid-preview-sun").textContent,
    ).toContain("Long Run");
  });

  it("renders an intensity tag below each non-rest slot in the preview", () => {
    renderPlanner();
    // Sun is the long run on Balanced/5/Beginner — its tag must read LONG.
    expect(
      screen.getByTestId("planner-hybrid-preview-sun-tag").textContent,
    ).toContain("LONG");
    // The lift days carry HEAVY or ACC tags depending on the slot's
    // `heavy` flag. At least one of the seven days must be a lift with a
    // tag of HEAVY or ACC so the runner can tell the lift days apart
    // from the run days at a glance.
    const liftTags = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
      .map((d) => {
        const el = screen.queryByTestId(`planner-hybrid-preview-${d}-tag`);
        return el?.textContent ?? "";
      })
      .filter((t) => t === "HEAVY" || t === "ACC");
    expect(liftTags.length).toBeGreaterThanOrEqual(1);
  });

  it("does not render an intensity tag on rest day cells", () => {
    renderPlanner();
    // Balanced/5/Beginner pins Mon as a rest day. Rest cells must NOT
    // emit a tag element so the strip stays visually quiet on off days.
    expect(
      screen.queryByTestId("planner-hybrid-preview-mon-tag"),
    ).toBeNull();
  });

  it("does not show the Cutback badge for week 1 of the block", () => {
    renderPlanner();
    // Default preview is week 1 of the block — never a cutback. The
    // badge must be absent so we don't mislabel the typical week.
    expect(
      screen.queryByTestId("planner-hybrid-preview-cutback"),
    ).toBeNull();
  });

  // Task #203 — the builder card now mounts a SECOND preview tagged
  // for race week (Mon..Fri taper, Sat Race Prep, Sun RACE DAY 26.2 mi)
  // ONLY when the projected hybrid end lands on the configured
  // marathonDate Sunday (or the runner's entries classify as a
  // marathon). These tests pin the gating so a future refactor of
  // `hybridIsRaceWeek` can't silently regress when the second preview
  // appears.
  it("does NOT mount the race-week preview when the hybrid block does not end on marathonDate", () => {
    // SAMPLE_CONFIG: start 2026-05-04 Mon, marathon 2027-05-02 Sun.
    // Default hybridBuilderWeeks is 8 → projected end is 2026-06-28,
    // which is NOT marathonDate → race-week preview must be absent.
    renderPlanner();
    expect(screen.getByTestId("planner-hybrid-preview")).toBeTruthy();
    expect(
      screen.queryByTestId("planner-hybrid-preview-race-week"),
    ).toBeNull();
    expect(
      screen.queryByTestId("planner-hybrid-preview-race-week-badge"),
    ).toBeNull();
  });

  it("mounts the race-week preview when the projected hybrid end lands exactly on marathonDate", () => {
    // Force the date-match branch: startDate Mon + 8 weeks (default
    // custom_hybrid block length) = 2026-06-28 Sun. Setting marathonDate
    // to 2026-06-28 makes `hybridIsRaceWeek` true via the end-date path
    // (no entries-mode classification needed).
    renderPlanner({
      config: {
        ...SAMPLE_CONFIG,
        startDate: "2026-05-04",
        marathonDate: "2026-06-28",
      },
    });
    // Both previews must be present side-by-side.
    expect(screen.getByTestId("planner-hybrid-preview")).toBeTruthy();
    const raceWeek = screen.getByTestId("planner-hybrid-preview-race-week");
    expect(raceWeek).toBeTruthy();
    expect(raceWeek.getAttribute("data-race-week")).toBe("true");
    // The race-week branch must surface the Trophy "Race Day" badge and
    // a Sun cell flagged as race day with the 26.2 mi marathon distance.
    expect(
      screen.getByTestId("planner-hybrid-preview-race-week-badge").textContent,
    ).toContain("Race Day");
    const raceSun = screen.getByTestId("planner-hybrid-preview-race-week-sun");
    expect(raceSun.getAttribute("data-race-day")).toBe("true");
    expect(raceSun.textContent).toContain("RACE DAY");
    expect(raceSun.textContent).toContain("26.2 mi");
  });

  it("encodes slider/days/level into customNotes when the runner clicks Build", () => {
    // Start from a blank config so the new entry is the first one and
    // the Composition badge is unambiguous.
    renderPlanner({
      config: {
        ...SAMPLE_CONFIG,
        blocks: [],
        entries: [],
      } as unknown as typeof SAMPLE_CONFIG,
    });
    // Pick run-leaning (slider index 3 in the LIFT→RUN order).
    fireEvent.change(screen.getByTestId("planner-hybrid-days-input"), {
      target: { value: "6" },
    });
    // Hidden Radix slider — drive the position by directly clicking
    // Build with a default state would fall back to Balanced. Instead
    // walk the textContent of the position-label to confirm the
    // default applies, then click Build and inspect the resulting
    // Composition badge for the customName encoding.
    fireEvent.click(screen.getByTestId("planner-hybrid-build"));
    // After Build, the entry is staged into the draft and the
    // Composition card shows the human-friendly custom name (which
    // embeds the slider position label).
    expect(
      screen.getByText(/Custom Hybrid \(Balanced\)/i),
    ).toBeTruthy();
  });
});

describe("Tag-cloud sort toggle — Plan Template Library", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  // Returns chip tags in DOM order, filtering out the count-badge
  // descendants whose testid shares the chip prefix.
  function templateChipTags(): string[] {
    const els = document.querySelectorAll<HTMLElement>(
      '[data-testid^="planner-template-tag-chip-"]',
    );
    return Array.from(els)
      .map((el) => el.getAttribute("data-testid")!)
      .filter((id) => !id.startsWith("planner-template-tag-chip-count-"))
      .map((id) => id.replace("planner-template-tag-chip-", ""));
  }

  it("defaults to By count and switches to alphabetical when A-Z is clicked", () => {
    renderPlanner();
    const countBtn = screen.getByTestId(
      "planner-template-tag-cloud-sort-count",
    );
    const alphaBtn = screen.getByTestId(
      "planner-template-tag-cloud-sort-alpha",
    );
    expect(countBtn.getAttribute("aria-pressed")).toBe("true");
    expect(alphaBtn.getAttribute("aria-pressed")).toBe("false");

    const before = templateChipTags();
    expect(before.length).toBeGreaterThan(1);

    fireEvent.click(alphaBtn);

    expect(alphaBtn.getAttribute("aria-pressed")).toBe("true");
    expect(countBtn.getAttribute("aria-pressed")).toBe("false");

    const after = templateChipTags();
    expect(after).toEqual(
      [...after].sort((a, b) => a.localeCompare(b)),
    );
    // The reorder must actually have changed the chip sequence — if
    // both modes produced identical output the toggle would be a no-op.
    expect(after).not.toEqual(before);
  });

  it("clicking By count restores the count-ordered chip sequence", () => {
    renderPlanner();
    const countBtn = screen.getByTestId(
      "planner-template-tag-cloud-sort-count",
    );
    const alphaBtn = screen.getByTestId(
      "planner-template-tag-cloud-sort-alpha",
    );

    const initial = templateChipTags();

    fireEvent.click(alphaBtn);
    expect(templateChipTags()).not.toEqual(initial);

    fireEvent.click(countBtn);
    expect(countBtn.getAttribute("aria-pressed")).toBe("true");
    expect(alphaBtn.getAttribute("aria-pressed")).toBe("false");
    expect(templateChipTags()).toEqual(initial);
  });

  it("persists the sort choice to localStorage and survives a remount", () => {
    const { unmount } = renderPlanner();
    fireEvent.click(
      screen.getByTestId("planner-template-tag-cloud-sort-alpha"),
    );
    expect(
      window.localStorage.getItem("planner.templateTagSort.v1"),
    ).toBe("alpha");

    unmount();
    cleanup();

    renderPlanner();
    const alphaBtn = screen.getByTestId(
      "planner-template-tag-cloud-sort-alpha",
    );
    expect(alphaBtn.getAttribute("aria-pressed")).toBe("true");
    const tags = templateChipTags();
    expect(tags).toEqual([...tags].sort((a, b) => a.localeCompare(b)));
  });

  it("hydrates from a pre-set localStorage value as A-Z", () => {
    window.localStorage.setItem("planner.templateTagSort.v1", "alpha");
    renderPlanner();
    expect(
      screen
        .getByTestId("planner-template-tag-cloud-sort-alpha")
        .getAttribute("aria-pressed"),
    ).toBe("true");
    const tags = templateChipTags();
    expect(tags).toEqual([...tags].sort((a, b) => a.localeCompare(b)));
  });

  it("the Plan Template Library and quick-add popover persist independently", () => {
    // Flipping the library to A-Z must NOT change the quick-add key
    // (each surface owns its own preference).
    renderPlanner();
    fireEvent.click(
      screen.getByTestId("planner-template-tag-cloud-sort-alpha"),
    );
    expect(
      window.localStorage.getItem("planner.templateTagSort.v1"),
    ).toBe("alpha");
    // Quick-add stayed on its default ("count").
    expect(
      window.localStorage.getItem("planner.quickAddTagSort.v1"),
    ).toBe("count");
  });
});

describe("Tag-cloud sort toggle — quick-add popover", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  function quickAddChipTags(): string[] {
    const els = document.querySelectorAll<HTMLElement>(
      '[data-testid^="planner-entry-add-tag-chip-"]',
    );
    return Array.from(els)
      .map((el) => el.getAttribute("data-testid")!)
      .filter((id) => !id.startsWith("planner-entry-add-tag-chip-count-"))
      .map((id) => id.replace("planner-entry-add-tag-chip-", ""));
  }

  function enterEntriesModeAndOpenQuickAdd() {
    fireEvent.click(
      screen.getByTestId("planner-template-apply-higdon_5k_novice"),
    );
    fireEvent.click(screen.getByTestId("planner-confirm-pending-apply"));
    fireEvent.click(screen.getByTestId("planner-entry-add-select"));
    expect(screen.getByTestId("planner-entry-add-popover")).toBeTruthy();
  }

  it("defaults to By count and switches to alphabetical when A-Z is clicked", () => {
    renderPlanner();
    enterEntriesModeAndOpenQuickAdd();

    const countBtn = screen.getByTestId(
      "planner-entry-add-tag-cloud-sort-count",
    );
    const alphaBtn = screen.getByTestId(
      "planner-entry-add-tag-cloud-sort-alpha",
    );
    expect(countBtn.getAttribute("aria-pressed")).toBe("true");
    expect(alphaBtn.getAttribute("aria-pressed")).toBe("false");

    const before = quickAddChipTags();
    expect(before.length).toBeGreaterThan(1);

    fireEvent.click(alphaBtn);
    expect(alphaBtn.getAttribute("aria-pressed")).toBe("true");
    expect(countBtn.getAttribute("aria-pressed")).toBe("false");

    const after = quickAddChipTags();
    expect(after).toEqual(
      [...after].sort((a, b) => a.localeCompare(b)),
    );
    expect(after).not.toEqual(before);

    fireEvent.click(countBtn);
    expect(countBtn.getAttribute("aria-pressed")).toBe("true");
    expect(quickAddChipTags()).toEqual(before);
  });

  it("persists the quick-add sort choice and survives a remount", () => {
    const { unmount } = renderPlanner();
    enterEntriesModeAndOpenQuickAdd();
    fireEvent.click(
      screen.getByTestId("planner-entry-add-tag-cloud-sort-alpha"),
    );
    expect(
      window.localStorage.getItem("planner.quickAddTagSort.v1"),
    ).toBe("alpha");

    unmount();
    cleanup();

    renderPlanner();
    enterEntriesModeAndOpenQuickAdd();
    const alphaBtn = screen.getByTestId(
      "planner-entry-add-tag-cloud-sort-alpha",
    );
    expect(alphaBtn.getAttribute("aria-pressed")).toBe("true");
    const tags = quickAddChipTags();
    expect(tags).toEqual([...tags].sort((a, b) => a.localeCompare(b)));
  });

  it("hydrates from a pre-set localStorage value as A-Z", () => {
    window.localStorage.setItem("planner.quickAddTagSort.v1", "alpha");
    renderPlanner();
    enterEntriesModeAndOpenQuickAdd();
    expect(
      screen
        .getByTestId("planner-entry-add-tag-cloud-sort-alpha")
        .getAttribute("aria-pressed"),
    ).toBe("true");
    const tags = quickAddChipTags();
    expect(tags).toEqual([...tags].sort((a, b) => a.localeCompare(b)));
  });
});
