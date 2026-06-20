import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

// jsdom doesn't ship ResizeObserver, but recharts' ResponsiveContainer
// constructs one on mount. Stub it so the chart can lay out.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

vi.mock("wouter", () => ({
  Link: ({ children }: { children: ReactNode }) => <>{children}</>,
  useLocation: () => ["/", vi.fn()] as const,
}));

vi.mock("@workspace/api-client-react", () => ({
  // Task #383: dashboard consolidated its 8 per-tile reads into a
  // single `useGetDashboardBootstrap` call so the cold first paint
  // pays one HTTP round-trip instead of eight. Tests now mock the
  // bootstrap hook with the same union shape the server emits.
  useGetDashboardBootstrap: vi.fn(),
  // Task #308: dashboard auto-redirects to /planner on first visit when
  // hasPlan=false AND no saved drafts exist. Stub with a non-empty
  // configs list so existing scenarios never trigger the redirect.
  useListPlannerConfigs: () => ({
    data: { configs: [{ id: 1 }] },
    isError: false,
  }),
  // RunTargetLine reads the active mode + HR settings off the user
  // preferences hook (Task #147 wires it into the Recent Logs widget).
  useGetUserPreferences: () => ({
    data: {
      runTargetingMode: "effort",
      maxHr: 200,
      restingHr: null,
    },
  }),
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

vi.mock("@/components/race-week-banner", () => ({
  RaceWeekBanner: () => null,
  ChecklistNudge: () => null,
}));

vi.mock("@/components/quick-log-activity", () => ({
  QuickLogActivity: () => null,
}));

// The tracking hub runs its own /api/dashboard/tracking useQuery; stub it so the
// Dashboard tests keep rendering without a QueryClientProvider (its own logic is
// covered in dashboard-tracking lib tests).
vi.mock("@/components/dashboard-tracking", () => ({
  DashboardTracking: () => <div data-testid="dashboard-tracking-stub" />,
}));

vi.mock("@/components/progress-diagnosis", () => ({
  ProgressDiagnosis: () => <div data-testid="progress-diagnosis-stub" />,
}));

// Recharts' ResponsiveContainer renders a 0×0 box in jsdom which causes
// every child <BarChart> to bail out. Clone the chart child with explicit
// width/height so the ReferenceDot markers actually render.
vi.mock("recharts", async () => {
  const React =
    await vi.importActual<typeof import("react")>("react");
  const actual =
    await vi.importActual<typeof import("recharts")>("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) =>
      React.cloneElement(
        children,
        { width: 800, height: 400 } as Record<string, unknown>,
      ),
  };
});

import { useGetDashboardBootstrap } from "@workspace/api-client-react";
import Dashboard, { MileageTooltipContent } from "./dashboard";

const mockBootstrap = vi.mocked(useGetDashboardBootstrap);

// Task #383. Per-tile state lives on a single record so the existing
// per-test override helpers (`mockToday.mockReturnValue({...})`,
// `mockActivity.mockReturnValue({...})`) can keep their shape while
// the consolidated bootstrap hook is the only call the dashboard
// actually makes. `applyBootstrap()` reassembles the union payload
// from whatever was last set.
interface BootstrapState {
  summary: unknown;
  weightTrend: unknown;
  weeklyMileage: unknown;
  equipmentUsage: unknown;
  longRunProgression: unknown;
  recentActivity: unknown;
  today: unknown;
  overview: unknown;
  isLoading: boolean;
}
const bootstrapState: BootstrapState = {
  summary: undefined,
  weightTrend: undefined,
  weeklyMileage: undefined,
  equipmentUsage: undefined,
  longRunProgression: undefined,
  recentActivity: undefined,
  today: undefined,
  // R2: default the plan overview to a running plan so the existing
  // mileage-chart / Total-Volume / empty-state-mileage assertions keep
  // passing. The recomp-gating tests below set includesRunning=false.
  overview: { nextScheduledRace: null, includesRunning: true },
  isLoading: false,
};
function applyBootstrap() {
  mockBootstrap.mockReturnValue({
    data: {
      summary: bootstrapState.summary,
      weightTrend: bootstrapState.weightTrend,
      weeklyMileage: bootstrapState.weeklyMileage,
      equipmentUsage: bootstrapState.equipmentUsage,
      longRunProgression: bootstrapState.longRunProgression,
      recentActivity: bootstrapState.recentActivity,
      today: bootstrapState.today,
      overview: bootstrapState.overview,
    },
    isLoading: bootstrapState.isLoading,
  } as unknown as ReturnType<typeof useGetDashboardBootstrap>);
}

// Per-tile shims that preserve the old mock API used by per-test
// overrides further down. Each one updates `bootstrapState` and
// re-applies the consolidated mock.
type Setter = { mockReturnValue: (r: { data: unknown; isLoading?: boolean }) => void };
const mockSummary: Setter = {
  mockReturnValue: (r) => {
    bootstrapState.summary = r.data;
    if (typeof r.isLoading === "boolean") bootstrapState.isLoading = r.isLoading;
    applyBootstrap();
  },
};
const mockWeight: Setter = {
  mockReturnValue: (r) => {
    bootstrapState.weightTrend = r.data;
    applyBootstrap();
  },
};
const mockMileage: Setter = {
  mockReturnValue: (r) => {
    bootstrapState.weeklyMileage = r.data;
    applyBootstrap();
  },
};
const mockEquipment: Setter = {
  mockReturnValue: (r) => {
    bootstrapState.equipmentUsage = r.data;
    applyBootstrap();
  },
};
const mockLongRun: Setter = {
  mockReturnValue: (r) => {
    bootstrapState.longRunProgression = r.data;
    applyBootstrap();
  },
};
const mockActivity: Setter = {
  mockReturnValue: (r) => {
    bootstrapState.recentActivity = r.data;
    applyBootstrap();
  },
};
const mockToday: Setter = {
  mockReturnValue: (r) => {
    bootstrapState.today = r.data;
    applyBootstrap();
  },
};

// `raceKind` is widened explicitly so per-test overrides can pin it to
// any of the four canonical race kinds (or null) without the inferred
// type narrowing it to just `null`.
const SUMMARY: {
  currentWeek: number;
  currentPhase: string;
  totalWeeks: number;
  weeksRemaining: number;
  raceDate: string;
  startDate: string;
  weeklyMilesActual: number;
  weeklyMilesPlanned: number;
  weeklyLoadActual: number;
  weeklyLoadPlanned: number;
  weeklySessionsCompleted: number;
  weeklySessionsPlanned: number;
  weeklyLifestyleMinutes: number;
  prevFourWeekAvgLifestyleMinutes: number | null;
  totalMilesAllTime: number;
  longestRunMi: number;
  weightStart: number;
  weightCurrent: number;
  weightGoal: number;
  weightLost: number;
  weightToGoal: number;
  adherencePct: number;
  daysToRace: number;
  programs: Array<unknown>;
  raceKind: "marathon" | "half" | "10k" | "5k" | null;
  activeConfigName: string;
  hasPlan: boolean;
  recomp: Record<string, unknown>;
} = {
  hasPlan: true,
  // Phase 4. Body-recomp summary now rides the dashboard summary and the
  // hero leads with inches lost. Default to a populated recomp so the
  // hero renders; per-test overrides can pin measurementCount: 0 to
  // exercise the empty state.
  recomp: {
    measurementCount: 3,
    sites: [
      { key: "belly", label: "Belly", muscleProxy: false, baseline: 42, latest: 38, delta: 4, series: [{ date: "2026-01-01", value: 42 }, { date: "2026-03-01", value: 38 }] },
      { key: "chest", label: "Chest", muscleProxy: false, baseline: 44, latest: 43, delta: 1, series: [{ date: "2026-01-01", value: 44 }, { date: "2026-03-01", value: 43 }] },
      { key: "arms", label: "Arms", muscleProxy: true, baseline: 28, latest: 29, delta: -1, series: [{ date: "2026-01-01", value: 28 }, { date: "2026-03-01", value: 29 }] },
      { key: "legs", label: "Legs", muscleProxy: true, baseline: 48, latest: 49, delta: -1, series: [{ date: "2026-01-01", value: 48 }, { date: "2026-03-01", value: 49 }] },
    ],
    totalInchesLost: 5,
    muscleProxyInchesGained: 2,
    strengthScoreCurrent: 300,
    strengthScoreGoal: 500,
    weightBaseline: 280,
    weightLatest: 250,
    onTrack: true,
  },
  currentWeek: 34,
  currentPhase: "Marathon-Specific",
  totalWeeks: 52,
  weeksRemaining: 18,
  raceDate: "2027-05-02",
  startDate: "2026-05-04",
  weeklyMilesActual: 0,
  weeklyMilesPlanned: 30,
  weeklyLoadActual: 0,
  weeklyLoadPlanned: 100,
  weeklySessionsCompleted: 0,
  weeklySessionsPlanned: 5,
  weeklyLifestyleMinutes: 0,
  prevFourWeekAvgLifestyleMinutes: null,
  totalMilesAllTime: 0,
  longestRunMi: 0,
  weightStart: 280,
  weightCurrent: 250,
  weightGoal: 210,
  weightLost: 30,
  weightToGoal: 40,
  adherencePct: 90,
  daysToRace: 120,
  programs: [],
  raceKind: "marathon",
  activeConfigName: "Race Campaign",
};

function setupHooks(
  mileage: ReadonlyArray<Record<string, unknown>>,
  summaryOverrides: Partial<typeof SUMMARY> = {},
) {
  mockSummary.mockReturnValue({
    data: { ...SUMMARY, ...summaryOverrides },
    isLoading: false,
  });
  mockWeight.mockReturnValue({
    data: [],
    isLoading: false,
  });
  mockMileage.mockReturnValue({
    data: mileage,
    isLoading: false,
  });
  mockEquipment.mockReturnValue({
    data: [],
    isLoading: false,
  });
  mockLongRun.mockReturnValue({
    data: [],
    isLoading: false,
  });
  mockActivity.mockReturnValue({
    data: [],
    isLoading: false,
  });
  mockToday.mockReturnValue({
    data: { hasPlan: false, date: "2026-05-04", loggedWorkouts: [] },
    isLoading: false,
  });
}

describe("Dashboard mileage chart — Steady Wed marker (Task #183)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the amber Steady marker on every week whose wedSteady is true and shows the legend", () => {
    setupHooks([
      {
        week: 33,
        startDate: "2026-12-21",
        phase: "Marathon-Specific",
        plannedMiles: 28,
        actualMiles: 0,
        plannedCardioMin: 60,
        actualCardioMin: 0,
        dominantCardioEquipment: null,
        programs: [],
        wedSteady: true,
      },
      {
        week: 34,
        startDate: "2026-12-28",
        phase: "Marathon-Specific",
        plannedMiles: 22,
        actualMiles: 0,
        plannedCardioMin: 60,
        actualCardioMin: 0,
        dominantCardioEquipment: null,
        programs: [],
        wedSteady: false,
      },
      {
        week: 35,
        startDate: "2027-01-04",
        phase: "Marathon-Specific",
        plannedMiles: 30,
        actualMiles: 0,
        plannedCardioMin: 60,
        actualCardioMin: 0,
        dominantCardioEquipment: null,
        programs: [],
        wedSteady: true,
      },
    ]);
    render(<Dashboard />);

    const legend = screen.getByTestId("mileage-chart-steady-legend");
    expect(legend.textContent).toMatch(/Steady Wed/);
    expect(legend.textContent).toMatch(/2\s+wks/);

    expect(screen.getByTestId("mileage-chart-steady-w33")).toBeTruthy();
    expect(screen.getByTestId("mileage-chart-steady-w35")).toBeTruthy();
    expect(screen.queryByTestId("mileage-chart-steady-w34")).toBeNull();
  });

  it("hides the Steady legend and renders no markers when no week is steady", () => {
    setupHooks([
      {
        week: 1,
        startDate: "2026-05-04",
        phase: "Foundation Build",
        plannedMiles: 12,
        actualMiles: 0,
        plannedCardioMin: 0,
        actualCardioMin: 0,
        dominantCardioEquipment: null,
        programs: [],
        wedSteady: false,
      },
      {
        week: 2,
        startDate: "2026-05-11",
        phase: "Foundation Build",
        plannedMiles: 14,
        actualMiles: 0,
        plannedCardioMin: 0,
        actualCardioMin: 0,
        dominantCardioEquipment: null,
        programs: [],
        wedSteady: null,
      },
    ]);
    render(<Dashboard />);

    expect(screen.queryByTestId("mileage-chart-steady-legend")).toBeNull();
    expect(screen.queryByTestId("mileage-chart-steady-w1")).toBeNull();
    expect(screen.queryByTestId("mileage-chart-steady-w2")).toBeNull();
  });

  it("shows a 'Steady Wed (Z3)' tooltip callout on a steady week and omits it on a non-steady week (Task #187)", () => {
    const steadyRow = {
      week: 33,
      phase: "Marathon-Specific",
      plannedMiles: 28,
      plannedCardioMin: 60,
      dominantCardioEquipment: null,
      programs: [],
      wedSteady: true,
    };
    const nonSteadyRow = {
      week: 34,
      phase: "Marathon-Specific",
      plannedMiles: 22,
      plannedCardioMin: 60,
      dominantCardioEquipment: null,
      programs: [],
      wedSteady: false,
    };

    const { rerender } = render(
      <MileageTooltipContent
        active
        label={steadyRow.week}
        payload={[
          {
            name: "Planned",
            value: steadyRow.plannedMiles,
            color: "#888",
            payload: steadyRow,
          },
        ] as never}
      />,
    );

    const callout = screen.getByTestId("mileage-tooltip-steady");
    expect(callout.textContent).toMatch(/Steady Wed \(Z3\)/);
    expect(callout.querySelector(".bg-amber-400")).toBeTruthy();

    rerender(
      <MileageTooltipContent
        active
        label={nonSteadyRow.week}
        payload={[
          {
            name: "Planned",
            value: nonSteadyRow.plannedMiles,
            color: "#888",
            payload: nonSteadyRow,
          },
        ] as never}
      />,
    );

    expect(screen.queryByTestId("mileage-tooltip-steady")).toBeNull();
  });

  it("renders a singular 'wk' label when only one week is steady", () => {
    setupHooks([
      {
        week: 40,
        startDate: "2027-02-08",
        phase: "Marathon-Specific",
        plannedMiles: 35,
        actualMiles: 0,
        plannedCardioMin: 60,
        actualCardioMin: 0,
        dominantCardioEquipment: null,
        programs: [],
        wedSteady: true,
      },
    ]);
    render(<Dashboard />);

    const legend = screen.getByTestId("mileage-chart-steady-legend");
    expect(legend.textContent).toMatch(/1\s+wk\b/);
    expect(legend.textContent).not.toMatch(/wks/);
    expect(screen.getByTestId("mileage-chart-steady-w40")).toBeTruthy();
  });
});

describe("Dashboard — per-program color coding (task #160)", () => {
  // Task #160 assigns each program a stable color (keyed by
  // sourceEntryIndex) and reuses it across the Week Snapshot per-
  // program rows, the Mileage Volume stacked planned bar, and the
  // Arsenal Usage per-program lines, plus a small legend.
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the program legend and color-keyed snapshot rows when 2+ programs are stacked", () => {
    const programs = [
      {
        sourceEntryIndex: 0,
        label: "Tonal Lift",
        endDate: "2027-02-01",
        weeklyMilesPlanned: 0,
        weeklyMilesActual: 0,
        weeklyLoadPlanned: 50,
        weeklyLoadActual: 0,
        weeklySessionsPlanned: 3,
        weeklySessionsCompleted: 0,
        adherencePlanned: 3,
        adherenceCompleted: 0,
        adherencePct: 0,
      },
      {
        sourceEntryIndex: 1,
        label: "5K Improver",
        endDate: "2026-09-13",
        weeklyMilesPlanned: 12,
        weeklyMilesActual: 0,
        weeklyLoadPlanned: 50,
        weeklyLoadActual: 0,
        weeklySessionsPlanned: 2,
        weeklySessionsCompleted: 0,
        adherencePlanned: 2,
        adherenceCompleted: 0,
        adherencePct: 0,
      },
    ];
    setupHooks([], { programs });
    render(<Dashboard />);

    const legend = screen.getByTestId("dashboard-program-legend");
    expect(legend.textContent).toContain("Tonal Lift");
    expect(legend.textContent).toContain("5K Improver");

    const row0 = screen.getByTestId("snapshot-program-0") as HTMLElement;
    const row1 = screen.getByTestId("snapshot-program-1") as HTMLElement;
    const c0 = row0.style.borderLeftColor;
    const c1 = row1.style.borderLeftColor;
    expect(c0).not.toBe("");
    expect(c1).not.toBe("");
    expect(c0).not.toBe(c1);
  });

  it("hides the program legend when only one program is active", () => {
    setupHooks([], {
      programs: [
        {
          sourceEntryIndex: 0,
          label: "Marathon Plan",
          endDate: "2027-05-02",
          weeklyMilesPlanned: 30,
          weeklyMilesActual: 0,
          weeklyLoadPlanned: 100,
          weeklyLoadActual: 0,
          weeklySessionsPlanned: 5,
          weeklySessionsCompleted: 0,
        },
      ],
    });
    render(<Dashboard />);
    expect(screen.queryByTestId("dashboard-program-legend")).toBeNull();
    expect(screen.queryByTestId("snapshot-programs-breakdown")).toBeNull();
  });
});

describe("Dashboard header — title from active planner config name (task #244)", () => {
  // Task #244 stops hardcoding the dashboard title from raceKind and
  // reads it from `summary.activeConfigName` — the runner's own
  // planner config name. The countdown subtitle is still gated on
  // raceKind so non-race plans don't presuppose a race day, but the
  // title is always shown so the runner sees what they named their
  // plan.
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("uses the active planner config's name verbatim as the title", () => {
    setupHooks([], {
      raceKind: "5k",
      daysToRace: 21,
      activeConfigName: "Spring 5K Build",
    });
    render(<Dashboard />);
    const title = screen.getByTestId("dashboard-header-title");
    expect(title.textContent).toBe("Spring 5K Build");
    expect(title.getAttribute("data-race-kind")).toBe("5k");
    const subtitle = screen.getByTestId("dashboard-header-subtitle");
    expect(subtitle.textContent).toContain("21 Days to Race Day");
  });

  it("renders the title even on tonal-first / non-race plans (raceKind null)", () => {
    // No race signal → the countdown subtitle is omitted, but the
    // title still surfaces the runner's planner config name so the
    // dashboard reads "Tonal Upper 8wk" (not a hardcoded "Race
    // Campaign") on lift-primary blocks.
    setupHooks([], {
      raceKind: null,
      activeConfigName: "Tonal Upper 8wk",
    });
    render(<Dashboard />);
    const title = screen.getByTestId("dashboard-header-title");
    expect(title.textContent).toBe("Tonal Upper 8wk");
    expect(title.getAttribute("data-race-kind")).toBe("");
    expect(screen.queryByTestId("dashboard-header-subtitle")).toBeNull();
  });

  it("falls back to 'Workout Plan' when the active config name is empty", () => {
    setupHooks([], { raceKind: null, activeConfigName: "" });
    render(<Dashboard />);
    expect(screen.getByTestId("dashboard-header-title").textContent).toBe(
      "Workout Plan",
    );
  });
});

// Task #139: end-to-end coverage that the slim Today's Mission card on
// the Dashboard actually renders the one headline number picked by
// `getPrimaryMetric` / `getPrimaryMetricCompare`. The unit tests on
// the helpers cover the selection rule itself; these tests pin the
// rendered DOM so a refactor of the slim-card layout (or a swap of
// PrimaryMetricDisplay's testIds) is caught here. The Dashboard surface
// gets a planned-only, a logged-only, and a planned-vs-actual compare
// case so all three card states stay covered alongside the matching
// Today / Week Detail suites.
describe("Dashboard — primary metric rendering on Today's Mission card (task #139)", () => {
  // Common Today payload pieces. We override `today` per-test via
  // mockToday so we can flip planned/logged shape without rewriting
  // every other dashboard hook return.
  function setTodayPayload(payload: Record<string, unknown>) {
    setupHooks([]);
    mockToday.mockReturnValue({
      data: payload,
      isLoading: false,
    });
  }

  const planBase = {
    id: 1,
    week: 1,
    phase: "Foundation Build",
    date: "2026-05-05",
    day: "Tue",
    sessionType: "Tonal Lift",
    description: "Heavy upper-body Tonal",
    equipment: "Tonal",
    equipmentList: ["Tonal"],
    isRest: false,
    isCustomized: false,
    customizedFields: [],
    strengthLoad: 60,
    strengthMin: 45,
    cardioMin: 0,
    runMin: 0,
    distanceMi: null,
    pace: null,
    totalMin: 45,
    totalLoad: 60,
    sourceEntryIndex: 0,
  };

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------
  // Today's Mission planned card (PrimaryMetric, single-value variant)
  // testIdPrefix: `dashboard-today-plan`
  // -----------------------------------------------------------------
  it("renders distance as the headline metric on a long-run Today's Mission card", () => {
    setTodayPayload({
      hasPlan: true,
      date: "2026-05-05",
      plan: {
        ...planBase,
        sessionType: "Long Run",
        strengthMin: 0,
        runMin: 60,
        distanceMi: 8,
        totalMin: 60,
      },
      loggedWorkouts: [],
    });
    render(<Dashboard />);

    expect(
      screen.getByTestId("dashboard-today-plan-primary-metric-value")
        .textContent,
    ).toBe("8.00 mi");
  });

  it("renders lift minutes as the headline metric on a Tonal-only Today's Mission card", () => {
    setTodayPayload({
      hasPlan: true,
      date: "2026-05-05",
      plan: planBase,
      loggedWorkouts: [],
    });
    render(<Dashboard />);

    expect(
      screen.getByTestId("dashboard-today-plan-primary-metric-value")
        .textContent,
    ).toBe("45 min");
    expect(
      screen.getByTestId("dashboard-today-plan-primary-metric").textContent,
    ).toContain("Lift");
  });

  // -----------------------------------------------------------------
  // Logged session row on the Dashboard (compare variant)
  // testIdPrefix: `session-dashboard-${session.id}`
  // -----------------------------------------------------------------
  it("renders an actual / planned compare on a logged session row matching a run plan day", () => {
    setTodayPayload({
      hasPlan: true,
      date: "2026-05-05",
      plan: {
        ...planBase,
        sessionType: "Long Run",
        strengthMin: 0,
        runMin: 60,
        distanceMi: 6,
        totalMin: 60,
      },
      loggedWorkouts: [
        {
          id: 555,
          date: "2026-05-05",
          sessionType: "Long Run",
          equipment: "Outdoor",
          durationMin: 58,
          strengthMin: 0,
          cardioMin: 0,
          runMin: 58,
          distanceMi: 5.2,
          pace: "10:05",
          avgHr: null,
          rpe: 7,
          strengthLoad: 0,
          totalLoad: 60,
          notes: null,
          timeOfDay: null,
          modality: null,
          planDayId: 1,
          totalMin: 58,
        },
      ],
    });
    render(<Dashboard />);

    expect(
      screen.getByTestId("session-dashboard-555-primary-metric-actual")
        .textContent,
    ).toBe("5.20 mi");
    expect(
      screen.getByTestId("session-dashboard-555-primary-metric-planned")
        .textContent,
    ).toContain("6.00 mi");
  });

  it("renders the actual headline with no planned counterpart when the logged session has no comparable plan numbers (logged-only compare)", () => {
    // Rest plan day + a quick-logged Lifestyle row → planned side has
    // nothing positive to display, so getPrimaryMetricCompare picks
    // the kind off the actual and omits the planned slot.
    setTodayPayload({
      hasPlan: true,
      date: "2026-05-04",
      plan: {
        ...planBase,
        date: "2026-05-04",
        day: "Mon",
        sessionType: "Rest",
        equipment: "None",
        equipmentList: ["None"],
        isRest: true,
        strengthLoad: 0,
        strengthMin: 0,
        cardioMin: 0,
        runMin: 0,
        distanceMi: null,
        totalMin: 0,
        totalLoad: 0,
      },
      loggedWorkouts: [
        {
          id: 888,
          date: "2026-05-04",
          sessionType: "Lifestyle",
          equipment: "Lifestyle",
          durationMin: 30,
          strengthMin: 0,
          cardioMin: 0,
          runMin: 0,
          distanceMi: null,
          pace: null,
          avgHr: null,
          rpe: null,
          strengthLoad: 0,
          totalLoad: 0,
          notes: null,
          timeOfDay: null,
          modality: null,
          planDayId: null,
        },
      ],
    });
    render(<Dashboard />);

    expect(
      screen.getByTestId("session-dashboard-888-primary-metric-actual")
        .textContent,
    ).toBe("30 min");
    expect(
      screen.queryByTestId("session-dashboard-888-primary-metric-planned"),
    ).toBeNull();
  });
});

// Task #147: the Recent Logs widget on the dashboard renders a compact
// RunTargetLine next to each row whose joined plan day is run-shaped,
// so a runner glancing at the dashboard sees the prescribed target
// alongside the actuals without bouncing to /log. Rest / strength /
// cardio rows and off-plan quick-logged rows have no
// `prescribedRunTarget` snapshot and render the legacy actuals-only
// row unchanged.
describe("Dashboard — prescribed run target on Recent Logs (task #147)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  function makeRecent(over: Record<string, unknown> = {}) {
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

  function setupActivity(
    rows: ReadonlyArray<ReturnType<typeof makeRecent>>,
    summaryOverrides: Partial<typeof SUMMARY> = {},
  ) {
    setupHooks([], summaryOverrides);
    mockActivity.mockReturnValue({
      data: rows,
      isLoading: false,
    });
  }

  it("renders a compact RunTargetLine on a run-shaped row that carries a prescribed target snapshot", () => {
    setupActivity([
      makeRecent({
        id: 700,
        prescribedRunTarget: {
          sessionType: "Long Run",
          week: 4,
          runMin: 60,
          distanceMi: 6,
          pace: "10:00",
        },
      }),
    ]);
    render(<Dashboard />);

    const target = screen.getByTestId("recent-activity-700-run-target");
    expect(target.getAttribute("data-run-targeting-mode")).toBe("effort");
    expect(target.textContent).toContain("Effort");
  });

  // Task #307: empty-plan dashboard mode must surface the "Open Phase
  // Planner" CTA AND continue rendering Body Mass + Recent Logs so the
  // runner can still see baseline data and quick-log activities even
  // before applying a plan.
  it("renders the empty-plan CTA and preserves Body Mass + Recent Logs when hasPlan is false", () => {
    setupActivity([
      makeRecent({
        id: 901,
        date: "2026-05-03",
        sessionType: "Outdoor Walk",
        equipment: "Outdoor",
        equipmentList: ["Outdoor"],
        runMin: 30,
        distanceMi: 1.5,
        pace: null,
        prescribedRunTarget: null,
      }),
    ], { hasPlan: false });
    render(<Dashboard />);

    expect(screen.getByTestId("dashboard-empty-plan")).toBeTruthy();
    expect(screen.getByTestId("dashboard-empty-plan-cta")).toBeTruthy();
    expect(screen.getByTestId("dashboard-empty-stats")).toBeTruthy();
    // Phase 4. The body-recomp hero leads even on the empty-plan
    // dashboard; weight is demoted into its secondary line.
    expect(screen.getByTestId("recomp-hero")).toBeTruthy();
    expect(screen.getByTestId("recomp-hero-inches-lost").textContent).toContain(
      "5.0",
    );
    // Recent Logs preserved with the logged workout visible.
    expect(screen.getByTestId("dashboard-empty-recent-activity")).toBeTruthy();
    expect(screen.getByText("Outdoor Walk")).toBeTruthy();
  });

  it("does NOT render a RunTargetLine on a non-run row (rest / strength / cardio or off-plan with no snapshot)", () => {
    setupActivity([
      makeRecent({
        id: 701,
        sessionType: "Tonal Lift",
        equipment: "Tonal",
        equipmentList: ["Tonal"],
        runMin: null,
        distanceMi: null,
        pace: null,
        prescribedRunTarget: null,
      }),
    ]);
    render(<Dashboard />);

    expect(screen.queryByTestId("recent-activity-701-run-target")).toBeNull();
  });
});

// Behavior rehaul R2: on the default recomp plan (includesRunning false)
// the dashboard hides the run-only Total Volume tile, Mileage chart, Long
// Run Build chart and the Week Snapshot mileage row, and swaps in a
// strength-relevant "Sessions done" tile. Default (no race) shows zero
// miles / pace surfaces.
describe("Dashboard — recomp gating (R2)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    // Restore the running default so other suites are unaffected.
    bootstrapState.overview = { nextScheduledRace: null, includesRunning: true };
  });

  it("hides mileage surfaces and swaps in a Sessions tile when includesRunning is false", () => {
    bootstrapState.overview = { nextScheduledRace: null, includesRunning: false };
    setupHooks([
      {
        week: 34,
        startDate: "2026-12-28",
        phase: "Strength Block",
        plannedMiles: 0,
        actualMiles: 0,
        plannedCardioMin: 60,
        actualCardioMin: 0,
        dominantCardioEquipment: null,
        programs: [],
        wedSteady: false,
      },
    ], {
      raceKind: null,
      weeklySessionsCompleted: 3,
      weeklySessionsPlanned: 5,
    });
    render(<Dashboard />);

    // Strength-relevant tile replaces Total Volume.
    expect(screen.getByTestId("dashboard-tile-sessions-done").textContent).toContain(
      "3 / 5",
    );
    expect(screen.queryByText("Total Volume")).toBeNull();
    expect(screen.queryByText("Max Long Run")).toBeNull();
    // Run-only charts and the snapshot mileage row are gone.
    expect(screen.queryByText("Mileage Volume")).toBeNull();
    expect(screen.queryByText("Long Run Build")).toBeNull();
    expect(screen.queryByText("Mileage")).toBeNull();
  });

  it("keeps the mileage surfaces when includesRunning is true", () => {
    bootstrapState.overview = { nextScheduledRace: null, includesRunning: true };
    setupHooks([
      {
        week: 34,
        startDate: "2026-12-28",
        phase: "Marathon-Specific",
        plannedMiles: 28,
        actualMiles: 0,
        plannedCardioMin: 0,
        actualCardioMin: 0,
        dominantCardioEquipment: null,
        programs: [],
        wedSteady: false,
      },
    ]);
    render(<Dashboard />);

    expect(screen.getByText("Total Volume")).toBeTruthy();
    expect(screen.getByText("Mileage Volume")).toBeTruthy();
    expect(screen.getByText("Long Run Build")).toBeTruthy();
  });
});
