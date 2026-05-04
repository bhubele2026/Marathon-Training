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
  useGetDashboardSummary: vi.fn(),
  useGetWeightTrend: vi.fn(),
  useGetWeeklyMileage: vi.fn(),
  useGetEquipmentUsage: vi.fn(),
  useGetLongRunProgression: vi.fn(),
  useGetRecentActivity: vi.fn(),
  useGetTodayPlan: vi.fn(),
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
}));

vi.mock("@/components/quick-log-activity", () => ({
  QuickLogActivity: () => null,
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

import {
  useGetDashboardSummary,
  useGetWeightTrend,
  useGetWeeklyMileage,
  useGetEquipmentUsage,
  useGetLongRunProgression,
  useGetRecentActivity,
  useGetTodayPlan,
} from "@workspace/api-client-react";
import Dashboard from "./dashboard";

const mockSummary = vi.mocked(useGetDashboardSummary);
const mockWeight = vi.mocked(useGetWeightTrend);
const mockMileage = vi.mocked(useGetWeeklyMileage);
const mockEquipment = vi.mocked(useGetEquipmentUsage);
const mockLongRun = vi.mocked(useGetLongRunProgression);
const mockActivity = vi.mocked(useGetRecentActivity);
const mockToday = vi.mocked(useGetTodayPlan);

const SUMMARY = {
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
  prevWeeklyLifestyleMinutes: 0,
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
};

function setupHooks(mileage: ReadonlyArray<Record<string, unknown>>) {
  mockSummary.mockReturnValue({
    data: SUMMARY,
    isLoading: false,
  } as unknown as ReturnType<typeof useGetDashboardSummary>);
  mockWeight.mockReturnValue({
    data: [],
    isLoading: false,
  } as unknown as ReturnType<typeof useGetWeightTrend>);
  mockMileage.mockReturnValue({
    data: mileage,
    isLoading: false,
  } as unknown as ReturnType<typeof useGetWeeklyMileage>);
  mockEquipment.mockReturnValue({
    data: [],
    isLoading: false,
  } as unknown as ReturnType<typeof useGetEquipmentUsage>);
  mockLongRun.mockReturnValue({
    data: [],
    isLoading: false,
  } as unknown as ReturnType<typeof useGetLongRunProgression>);
  mockActivity.mockReturnValue({
    data: [],
    isLoading: false,
  } as unknown as ReturnType<typeof useGetRecentActivity>);
  mockToday.mockReturnValue({
    data: { hasPlan: false, date: "2026-05-04", loggedWorkouts: [] },
    isLoading: false,
  } as unknown as ReturnType<typeof useGetTodayPlan>);
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
