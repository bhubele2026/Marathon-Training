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

import Planner, { categorizeTemplate, defaultBlankConfig } from "./planner";
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
    ).toBe("4");
    expect(
      (
        within(list).getByTestId("planner-entry-1-weeks") as HTMLInputElement
      ).value,
    ).toBe("12");
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
    fireEvent.click(screen.getByTestId("planner-template-apply-aerobic_base"));
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
    fireEvent.click(screen.getByTestId("planner-template-apply-aerobic_base"));
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
    fireEvent.click(screen.getByTestId("planner-template-apply-aerobic_base"));
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
    fireEvent.click(screen.getByTestId("planner-template-apply-aerobic_base"));
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

    expect(screen.getByText(/Composition · 1 entry · 12\/12w/)).toBeTruthy();
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

  it("picking a mid-week end date snaps to the nearest whole-week boundary", () => {
    renderPlanner();
    fireEvent.click(screen.getByTestId("planner-template-apply-half_marathon"));
    fireEvent.click(screen.getByTestId("planner-confirm-pending-apply"));
    const list = screen.getByTestId("planner-composition-list");
    const endInput = within(list).getByTestId(
      "planner-entry-0-end-date",
    ) as HTMLInputElement;
    const startMs = Date.parse(`${SAMPLE_CONFIG.startDate}T00:00:00Z`);
    // 14 weeks would be start + 97 days (days+1=98, 98/7=14). Pick
    // start + 95 days (Fri of week 14) → days+1=96, round(96/7)=14.
    const target = new Date(startMs + 95 * 86400000)
      .toISOString()
      .slice(0, 10);
    fireEvent.change(endInput, { target: { value: target } });
    expect(
      (within(list).getByTestId("planner-entry-0-weeks") as HTMLInputElement)
        .value,
    ).toBe("14");
  });

  it("apply dialog end-date picker drives the staged entry's weeks", () => {
    renderPlanner();
    // Stage one entry first so the 2nd Apply opens the dialog with a
    // proposed start cursor.
    fireEvent.click(screen.getByTestId("planner-template-apply-aerobic_base"));
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

// Expected category bucket for every entry in PLAN_TEMPLATES. Kept as
// an explicit table so a regression in `categorizeTemplate` (e.g. the
// run/bike/row priority order, hyrox detection, mat-only conditioning)
// fails this test instead of silently shuffling cards into the wrong
// section of the picker.
const EXPECTED_CATEGORIES: Record<string, string> = {
  couch_to_5k: "Run",
  "5k_improver": "Run",
  "10k_builder": "Run",
  half_marathon: "Run",
  marathon: "Run",
  ultramarathon_50k: "Run",
  aerobic_base: "Run",
  speed_block: "Run",
  hybrid_strength: "Hybrid",
  cardio_weight_loss: "Run",
  recovery: "Conditioning",
  maintenance: "Conditioning",
  tonal_strength_upper: "Strength",
  tonal_strength_lower: "Strength",
  push_pull_legs: "Strength",
  tonal_conditioning: "Strength",
  couch_to_5k_alt: "Run",
  higdon_5k_novice: "Run",
  higdon_5k_intermediate: "Run",
  higdon_5k_advanced: "Run",
  higdon_10k_advanced: "Run",
  hm_higdon_novice2: "Run",
  hm_pfitz: "Run",
  hm_hansons: "Run",
  marathon_pfitz_12_55: "Run",
  marathon_pfitz_18_70: "Run",
  marathon_hansons: "Run",
  marathon_8020: "Run",
  marathon_higdon_novice: "Run",
  marathon_higdon_advanced: "Run",
  ultra_50_mile: "Run",
  ultra_100k: "Run",
  norwegian_singles: "Run",
  pelo_bike_you_can_ride: "Bike",
  pelo_bike_pz_beginner: "Bike",
  pelo_bike_pz_intermediate: "Bike",
  pelo_bike_pz_advanced: "Bike",
  pelo_bike_strength_for_cyclists: "Hybrid",
  pelo_row_dpz: "Row",
  c2_row_30day: "Row",
  c2_row_5k: "Row",
  c2_row_2k: "Row",
  tonal_full_body_5x: "Strength",
  starting_strength: "Strength",
  stronglifts_5x5: "Strength",
  wendler_531_bbb: "Strength",
  phul: "Strength",
  ppl_6day: "Strength",
  simple_and_sinister: "Strength",
  nick_bare_1_0: "Hybrid",
  pelo_x_hyrox: "Hybrid",
  maf_180: "Run",
  bike_bootcamp_builder: "Bike",
  ywa_30day: "Conditioning",
  run_custom: "Custom",
  bike_custom: "Custom",
  row_custom: "Custom",
  strength_custom: "Custom",
  hybrid_custom: "Custom",
  // race_countdown's equipment hint is "Runner-defined", which the
  // categorizer routes to Custom (runner-defined templates are always
  // Custom scaffolds). Pinned here so classification is locked down.
  race_countdown: "Custom",
};

describe("categorizeTemplate (table-driven)", () => {
  it("has an expected entry for every PLAN_TEMPLATES id (no orphans)", () => {
    const ids = PLAN_TEMPLATES.map((t) => t.id).sort();
    const expected = Object.keys(EXPECTED_CATEGORIES).sort();
    expect(ids).toEqual(expected);
  });

  it.each(PLAN_TEMPLATES.map((t) => [t.id, t] as const))(
    "%s lands in the expected category",
    (id, tpl) => {
      expect(categorizeTemplate(tpl)).toBe(EXPECTED_CATEGORIES[id]);
    },
  );

  it("any *_custom id is bucketed as Custom regardless of metadata", () => {
    expect(
      categorizeTemplate({
        id: "anything_custom",
        name: "Anything Custom",
        source: "test",
        goalDistance: "26.2 mi",
        metadata: {
          intensityDistribution: "",
          peakLongRun: "",
          peakWeeklyVolume: "",
          taperLength: "",
          cutbackCadence: "",
          mandatoryRestDays: 1,
          equipmentMixHint: "Run-only",
        },
        tags: [],
      }),
    ).toBe("Custom");
  });
});

describe("Plan Template Library — search filter and category grouping", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    // The template search filter persists to localStorage, so wipe it
    // between tests to keep each case isolated.
    window.localStorage.clear();
  });

  it("renders one section per non-empty category and places known templates in the right buckets", () => {
    renderPlanner();
    // The Run section must contain marathon and the Bike section must
    // contain a peloton bike template.
    const runSection = screen.getByTestId("planner-template-category-run");
    expect(within(runSection).getByTestId("planner-template-marathon")).toBeTruthy();
    expect(
      within(runSection).queryByTestId("planner-template-pelo_bike_pz_beginner"),
    ).toBeNull();

    const bikeSection = screen.getByTestId("planner-template-category-bike");
    expect(
      within(bikeSection).getByTestId("planner-template-pelo_bike_pz_beginner"),
    ).toBeTruthy();

    const strengthSection = screen.getByTestId(
      "planner-template-category-strength",
    );
    expect(
      within(strengthSection).getByTestId("planner-template-tonal_full_body_5x"),
    ).toBeTruthy();

    const hybridSection = screen.getByTestId("planner-template-category-hybrid");
    expect(
      within(hybridSection).getByTestId("planner-template-pelo_x_hyrox"),
    ).toBeTruthy();
  });

  it("typing into the search input narrows the visible cards to only matches", () => {
    renderPlanner();
    // Pre-filter sanity: the marathon card is in the DOM.
    expect(screen.getByTestId("planner-template-marathon")).toBeTruthy();

    fireEvent.change(screen.getByTestId("planner-template-search"), {
      target: { value: "hansons" },
    });

    // Matching templates remain visible.
    expect(screen.getByTestId("planner-template-hm_hansons")).toBeTruthy();
    expect(screen.getByTestId("planner-template-marathon_hansons")).toBeTruthy();
    // Non-matching templates are removed from the DOM.
    expect(screen.queryByTestId("planner-template-marathon")).toBeNull();
    expect(screen.queryByTestId("planner-template-pelo_bike_pz_beginner")).toBeNull();
    expect(screen.queryByTestId("planner-template-tonal_full_body_5x")).toBeNull();

    // Summary line reports the match count for the active query.
    const summary = screen.getByTestId("planner-template-search-summary");
    expect(summary.textContent).toContain("2 templates match");
    expect(summary.textContent).toContain("hansons");
  });

  it("filters by author/source and equipment hint, not just template name", () => {
    renderPlanner();
    // 'pfitz' only appears in the source/author field of Pfitz templates.
    fireEvent.change(screen.getByTestId("planner-template-search"), {
      target: { value: "pfitz" },
    });
    expect(screen.getByTestId("planner-template-hm_pfitz")).toBeTruthy();
    expect(screen.getByTestId("planner-template-marathon_pfitz_12_55")).toBeTruthy();
    expect(screen.queryByTestId("planner-template-marathon_hansons")).toBeNull();
  });

  it("auto-expands a category section that has matches even if it was collapsed by default", () => {
    renderPlanner();
    // Bike is collapsed by default (only Run starts expanded). With no
    // search, the bike card is hidden from the layout via `hidden`.
    const bikeBefore = screen.getByTestId("planner-template-category-bike");
    expect(bikeBefore.querySelector("[hidden]")).not.toBeNull();

    fireEvent.change(screen.getByTestId("planner-template-search"), {
      target: { value: "peloton bike" },
    });

    // After search, the matching bike cards should be visible (the
    // wrapping grid is not hidden).
    const bikeAfter = screen.getByTestId("planner-template-category-bike");
    const hiddenChildren = bikeAfter.querySelectorAll("[hidden]");
    expect(hiddenChildren.length).toBe(0);
    expect(
      within(bikeAfter).getByTestId("planner-template-pelo_bike_pz_beginner"),
    ).toBeTruthy();
  });

  it("shows the empty-state message when no templates match the query", () => {
    renderPlanner();
    expect(screen.queryByTestId("planner-template-empty")).toBeNull();

    fireEvent.change(screen.getByTestId("planner-template-search"), {
      target: { value: "zzznopezzz" },
    });

    const empty = screen.getByTestId("planner-template-empty");
    expect(empty.textContent).toMatch(/No templates match/i);
    // No category sections render when there are zero matches.
    expect(screen.queryByTestId("planner-template-category-run")).toBeNull();
    expect(screen.queryByTestId("planner-template-category-bike")).toBeNull();
    // And the summary reports zero matches with the offending query.
    expect(
      screen.getByTestId("planner-template-search-summary").textContent,
    ).toContain("0 templates match");
  });

  it("clearing the search restores the unfiltered grouped layout", () => {
    renderPlanner();
    fireEvent.change(screen.getByTestId("planner-template-search"), {
      target: { value: "hansons" },
    });
    expect(screen.queryByTestId("planner-template-marathon")).toBeNull();

    fireEvent.click(screen.getByTestId("planner-template-search-clear"));

    // Marathon (Run) is back, and the summary returns to the default copy.
    expect(screen.getByTestId("planner-template-marathon")).toBeTruthy();
    const summary = screen.getByTestId("planner-template-search-summary");
    expect(summary.textContent).toMatch(/templates across .* categories/);
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
    expect(screen.getByTestId("planner-template-marathon_hansons")).toBeTruthy();

    fireEvent.click(screen.getByTestId("planner-template-tag-chip-pfitzinger"));

    // Every pfitzinger template remains visible.
    expect(screen.getByTestId("planner-template-hm_pfitz")).toBeTruthy();
    expect(screen.getByTestId("planner-template-marathon_pfitz_12_55")).toBeTruthy();
    expect(screen.getByTestId("planner-template-marathon_pfitz_18_70")).toBeTruthy();
    // Non-matching templates are filtered out.
    expect(screen.queryByTestId("planner-template-marathon_hansons")).toBeNull();
    expect(screen.queryByTestId("planner-template-pelo_bike_pz_beginner")).toBeNull();

    // Summary line reflects the active tag filter.
    const summary = screen.getByTestId("planner-template-search-summary");
    expect(summary.textContent).toMatch(/templates? match/);
    expect(summary.textContent).toContain("#pfitzinger");
  });

  it("composes multiple selected chips with AND semantics", () => {
    renderPlanner();

    fireEvent.click(screen.getByTestId("planner-template-tag-chip-pfitzinger"));
    fireEvent.click(
      screen.getByTestId("planner-template-tag-chip-half-marathon"),
    );

    // Only hm_pfitz carries BOTH tags.
    expect(screen.getByTestId("planner-template-hm_pfitz")).toBeTruthy();
    // Other pfitzinger templates (marathon distance) are filtered out.
    expect(screen.queryByTestId("planner-template-marathon_pfitz_12_55")).toBeNull();
    expect(screen.queryByTestId("planner-template-marathon_pfitz_18_70")).toBeNull();
    // Other half-marathon templates (non-pfitzinger) are filtered out too.
    expect(screen.queryByTestId("planner-template-hm_hansons")).toBeNull();
    expect(screen.queryByTestId("planner-template-half_marathon")).toBeNull();
  });

  it("composes the chip filter with the free-text query (AND)", () => {
    renderPlanner();

    fireEvent.click(screen.getByTestId("planner-template-tag-chip-pfitzinger"));
    fireEvent.change(screen.getByTestId("planner-template-search"), {
      target: { value: "hansons" },
    });

    // No template carries both `pfitzinger` AND matches "hansons" text.
    expect(screen.getByTestId("planner-template-empty")).toBeTruthy();
  });

  it("Clear restores the full unfiltered list", () => {
    renderPlanner();
    fireEvent.click(screen.getByTestId("planner-template-tag-chip-pfitzinger"));
    expect(screen.queryByTestId("planner-template-marathon_hansons")).toBeNull();

    fireEvent.click(screen.getByTestId("planner-template-tag-cloud-clear"));

    // Previously-hidden templates return.
    expect(screen.getByTestId("planner-template-marathon_hansons")).toBeTruthy();
    expect(screen.getByTestId("planner-template-pelo_bike_pz_beginner")).toBeTruthy();
    // The Clear button itself disappears once nothing is selected.
    expect(screen.queryByTestId("planner-template-tag-cloud-clear")).toBeNull();
    // Summary returns to the default copy.
    expect(
      screen.getByTestId("planner-template-search-summary").textContent,
    ).toMatch(/templates across .* categories/);
  });

  it("toggling the same chip twice deselects it (acts like Clear for a single tag)", () => {
    renderPlanner();
    const chip = screen.getByTestId("planner-template-tag-chip-pfitzinger");

    fireEvent.click(chip);
    expect(screen.queryByTestId("planner-template-marathon_hansons")).toBeNull();

    fireEvent.click(chip);
    expect(screen.getByTestId("planner-template-marathon_hansons")).toBeTruthy();
  });

  it("each chip carries a count badge of how many templates it would surface", () => {
    renderPlanner();

    // pfitzinger appears on 4 templates (hm_pfitz, marathon_pfitz_12_55,
    // marathon_pfitz_18_70, hm_pfitz advanced) — sanity-check it shows
    // a positive count rather than the literal zero placeholder.
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
      target: { value: "half" },
    });

    const after = Number(
      screen
        .getByTestId("planner-template-tag-chip-count-pfitzinger")
        .textContent?.match(/(\d+)/)?.[1],
    );
    // Restricting the free-text query to "half" can only shrink (or
    // preserve) the count of pfitzinger templates surfaced. Use <= so
    // adding a half-marathon pfitzinger template later doesn't make
    // this brittle; the >0 lower bound keeps the assertion meaningful.
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
    // hansons is interactive on a fresh catalog and no toggle is
    // shown because no filter is applied yet.
    const hansons = screen.getByTestId(
      "planner-template-tag-chip-hansons",
    ) as HTMLButtonElement;
    expect(hansons.disabled).toBe(false);
    expect(
      screen.queryByTestId("planner-template-tag-cloud-toggle-hidden"),
    ).toBeNull();

    // Selecting pfitzinger creates a dead-end for hansons (no template
    // carries both tags), so the hansons chip is collapsed out of the
    // cloud and hides behind the "+N hidden" toggle.
    fireEvent.click(screen.getByTestId("planner-template-tag-chip-pfitzinger"));

    expect(
      screen.queryByTestId("planner-template-tag-chip-hansons"),
    ).toBeNull();
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
    const hansonsAfter = screen.getByTestId(
      "planner-template-tag-chip-hansons",
    ) as HTMLButtonElement;
    expect(hansonsAfter.disabled).toBe(true);
    expect(
      screen.getByTestId("planner-template-tag-chip-count-hansons").textContent,
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
          "planner-template-tag-chip-hansons",
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it("hides zero-count chips under a free-text-only filter and resets the toggle when the search clears", () => {
    renderPlanner();
    // No filter: lift-only is visible and there is no toggle yet.
    expect(
      screen.getByTestId("planner-template-tag-chip-lift-only"),
    ).toBeTruthy();
    expect(
      screen.queryByTestId("planner-template-tag-cloud-toggle-hidden"),
    ).toBeNull();

    // Free-text search alone (no chip selection) is enough to trigger
    // the collapse — searching "marathon" zeroes out lift-only.
    fireEvent.change(screen.getByTestId("planner-template-search"), {
      target: { value: "marathon" },
    });
    expect(
      screen.queryByTestId("planner-template-tag-chip-lift-only"),
    ).toBeNull();
    const toggle = screen.getByTestId(
      "planner-template-tag-cloud-toggle-hidden",
    );
    fireEvent.click(toggle);
    expect(
      (
        screen.getByTestId(
          "planner-template-tag-chip-lift-only",
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
      target: { value: "marathon" },
    });
    expect(
      screen.queryByTestId("planner-template-tag-chip-lift-only"),
    ).toBeNull();
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
    fireEvent.click(screen.getByTestId("planner-template-apply-aerobic_base"));
    fireEvent.click(screen.getByTestId("planner-confirm-pending-apply"));

    // Open the quick-add popover.
    fireEvent.click(screen.getByTestId("planner-entry-add-select"));
    expect(screen.getByTestId("planner-entry-add-popover")).toBeTruthy();

    // Pre-filter sanity: a non-pfitzinger option is in the popover.
    expect(
      screen.getByTestId("planner-entry-add-option-marathon_hansons"),
    ).toBeTruthy();

    // Toggle the pfitzinger chip inside the popover.
    fireEvent.click(
      screen.getByTestId("planner-entry-add-tag-chip-pfitzinger"),
    );

    // Pfitzinger options remain.
    expect(
      screen.getByTestId("planner-entry-add-option-hm_pfitz"),
    ).toBeTruthy();
    expect(
      screen.getByTestId("planner-entry-add-option-marathon_pfitz_18_70"),
    ).toBeTruthy();
    // Non-matching options are filtered out.
    expect(
      screen.queryByTestId("planner-entry-add-option-marathon_hansons"),
    ).toBeNull();
    expect(
      screen.queryByTestId("planner-entry-add-option-pelo_bike_pz_beginner"),
    ).toBeNull();
  });

  it("quick-add chips carry counts that narrow with the popover's free-text query and selected chips", () => {
    renderPlanner();
    fireEvent.click(screen.getByTestId("planner-template-apply-aerobic_base"));
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
      target: { value: "half" },
    });
    const afterSearch = Number(
      screen
        .getByTestId("planner-entry-add-tag-chip-count-pfitzinger")
        .textContent?.match(/(\d+)/)?.[1],
    );
    // Use <= so adding more pfitzinger half-marathon templates later
    // doesn't make this brittle; the >0 lower bound keeps the
    // assertion meaningful.
    expect(afterSearch).toBeLessThanOrEqual(initial);
    expect(afterSearch).toBeGreaterThan(0);
  });

  it("hides zero-count quick-add chips behind a '+N hidden' toggle once a filter is active; expanded chips stay disabled", () => {
    renderPlanner();
    fireEvent.click(screen.getByTestId("planner-template-apply-aerobic_base"));
    fireEvent.click(screen.getByTestId("planner-confirm-pending-apply"));
    fireEvent.click(screen.getByTestId("planner-entry-add-select"));

    // hansons is interactive at first and no toggle is shown.
    const hansons = screen.getByTestId(
      "planner-entry-add-tag-chip-hansons",
    ) as HTMLButtonElement;
    expect(hansons.disabled).toBe(false);
    expect(
      screen.queryByTestId("planner-entry-add-tag-cloud-toggle-hidden"),
    ).toBeNull();

    fireEvent.click(
      screen.getByTestId("planner-entry-add-tag-chip-pfitzinger"),
    );

    // hansons collapses out of the cloud, replaced by a "+N hidden"
    // expander mirroring the Plan Template Library card.
    expect(
      screen.queryByTestId("planner-entry-add-tag-chip-hansons"),
    ).toBeNull();
    const toggle = screen.getByTestId(
      "planner-entry-add-tag-cloud-toggle-hidden",
    );
    expect(toggle.textContent).toMatch(/^\+\d+ hidden$/);

    // Expanding shows the hidden chips, still disabled with their
    // zero count, and flips the toggle label.
    fireEvent.click(toggle);
    const hansonsAfter = screen.getByTestId(
      "planner-entry-add-tag-chip-hansons",
    ) as HTMLButtonElement;
    expect(hansonsAfter.disabled).toBe(true);
    expect(
      screen.getByTestId("planner-entry-add-tag-chip-count-hansons")
        .textContent,
    ).toContain("0");
    expect(
      screen.getByTestId("planner-entry-add-tag-cloud-toggle-hidden")
        .textContent,
    ).toBe("Show less");
  });

  it("hides zero-count quick-add chips under a free-text-only filter and resets the toggle when the search clears", () => {
    renderPlanner();
    fireEvent.click(screen.getByTestId("planner-template-apply-aerobic_base"));
    fireEvent.click(screen.getByTestId("planner-confirm-pending-apply"));
    fireEvent.click(screen.getByTestId("planner-entry-add-select"));

    expect(
      screen.getByTestId("planner-entry-add-tag-chip-lift-only"),
    ).toBeTruthy();
    expect(
      screen.queryByTestId("planner-entry-add-tag-cloud-toggle-hidden"),
    ).toBeNull();

    // Free-text typing in the popover (no chip selection) is enough
    // to collapse zero-count chips.
    fireEvent.change(screen.getByTestId("planner-entry-add-search"), {
      target: { value: "marathon" },
    });
    expect(
      screen.queryByTestId("planner-entry-add-tag-chip-lift-only"),
    ).toBeNull();
    const toggle = screen.getByTestId(
      "planner-entry-add-tag-cloud-toggle-hidden",
    );
    fireEvent.click(toggle);
    expect(
      (
        screen.getByTestId(
          "planner-entry-add-tag-chip-lift-only",
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
    fireEvent.click(screen.getByTestId("planner-template-apply-aerobic_base"));
    fireEvent.click(screen.getByTestId("planner-confirm-pending-apply"));

    fireEvent.click(screen.getByTestId("planner-entry-add-select"));
    fireEvent.click(
      screen.getByTestId("planner-entry-add-tag-chip-pfitzinger"),
    );
    expect(
      screen.queryByTestId("planner-entry-add-option-marathon_hansons"),
    ).toBeNull();

    fireEvent.click(screen.getByTestId("planner-entry-add-tag-cloud-clear"));

    expect(
      screen.getByTestId("planner-entry-add-option-marathon_hansons"),
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
    // "lift-only" templates with no overlap (no marathon template
    // is lift-only). So before any selection both chips show a
    // positive count and neither is disabled; after selecting
    // "marathon" the lift-only chip drops to count 0.
    const marathonChip = screen.getByTestId(
      "planner-template-tag-chip-marathon",
    ) as HTMLButtonElement;
    const liftOnlyChip = screen.getByTestId(
      "planner-template-tag-chip-lift-only",
    ) as HTMLButtonElement;

    function readCount(tag: string): number {
      const el = screen.getByTestId(`planner-template-tag-chip-count-${tag}`);
      const m = (el.textContent ?? "").match(/(\d+)/);
      expect(m).not.toBeNull();
      return Number(m![1]);
    }

    const marathonBefore = readCount("marathon");
    const liftOnlyBefore = readCount("lift-only");
    // Both chips reflect a positive count rendered as "· N".
    expect(marathonBefore).toBeGreaterThan(0);
    expect(liftOnlyBefore).toBeGreaterThan(0);
    expect(
      screen.getByTestId("planner-template-tag-chip-count-marathon")
        .textContent,
    ).toBe(`· ${marathonBefore}`);
    expect(marathonChip.disabled).toBe(false);
    expect(liftOnlyChip.disabled).toBe(false);

    // Selecting "marathon" should leave its own chip's count
    // unchanged (selecting an already-active tag is a no-op under
    // AND-semantics) and zero out chips like "lift-only" that no
    // marathon template carries.
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
    // Zero-count chips like lift-only collapse behind the
    // "+N hidden" toggle so the cloud stays scannable.
    expect(
      screen.queryByTestId("planner-template-tag-chip-lift-only"),
    ).toBeNull();
    fireEvent.click(
      screen.getByTestId("planner-template-tag-cloud-toggle-hidden"),
    );
    // Once expanded the chip reappears with its zero count and stays
    // disabled so runners can't over-narrow into a dead end.
    expect(readCount("lift-only")).toBe(0);
    expect(
      (
        screen.getByTestId(
          "planner-template-tag-chip-lift-only",
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
      screen.getByTestId("planner-template-tag-chip-half-marathon"),
    );

    // Sanity: the chip-driven filter is in effect (only hm_pfitz matches both).
    expect(screen.getByTestId("planner-template-hm_pfitz")).toBeTruthy();
    expect(screen.queryByTestId("planner-template-marathon_hansons")).toBeNull();

    // The persist effect must have written the selection to storage.
    const persisted = window.localStorage.getItem(STORAGE_KEY);
    expect(persisted).not.toBeNull();
    const parsed = JSON.parse(persisted!) as string[];
    expect(new Set(parsed)).toEqual(new Set(["pfitzinger", "half-marathon"]));

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
        .getByTestId("planner-template-tag-chip-half-marathon")
        .getAttribute("aria-pressed"),
    ).toBe("true");
    // And the filter is genuinely re-applied: hm_pfitz is the lone match.
    expect(screen.getByTestId("planner-template-hm_pfitz")).toBeTruthy();
    expect(screen.queryByTestId("planner-template-marathon_hansons")).toBeNull();
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
      expect(screen.queryByTestId("planner-template-marathon_hansons")).toBeNull();
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
