import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

// jsdom doesn't ship ResizeObserver, but recharts' ResponsiveContainer
// (TrendArea + RecompHero sparklines) constructs one on mount.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

const navigateSpy = vi.fn();
vi.mock("wouter", () => ({
  Link: ({ children }: { children: ReactNode }) => <>{children}</>,
  useLocation: () => ["/", navigateSpy] as const,
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetDashboardBootstrap: vi.fn(),
  useListPlannerConfigs: () => ({
    data: { configs: [{ id: 1 }] },
    isError: false,
  }),
}));

// The hub composes several self-fetching tiles (each owns its own useQuery).
// Stub them so the page renders without a QueryClientProvider — exactly the
// pattern the old suite used for DashboardTracking. Their own logic is covered
// by their own tests / the studio kit tests.
vi.mock("@/components/dashboard-fuel-tile", () => ({
  DashboardFuelTile: () => <div data-testid="fuel-tile-stub" />,
}));
vi.mock("@/components/dashboard-water-tile", () => ({
  DashboardWaterTile: () => <div data-testid="water-tile-stub" />,
}));
vi.mock("@/components/dashboard-tracking", () => ({
  DashboardTracking: () => <div data-testid="tracking-stub" />,
}));
vi.mock("@/components/progress-diagnosis", () => ({
  ProgressDiagnosis: () => <div data-testid="diagnosis-stub" />,
}));
vi.mock("@/components/dashboard-nutrition-insights", () => ({
  DashboardNutritionInsights: () => <div data-testid="nutrition-insights-stub" />,
}));
vi.mock("@/components/dashboard-alcohol-box", () => ({
  DashboardAlcoholBox: () => <div data-testid="alcohol-box-stub" />,
}));

vi.mock("recharts", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) =>
      React.cloneElement(children, {
        width: 800,
        height: 300,
      } as Record<string, unknown>),
  };
});

import { useGetDashboardBootstrap } from "@workspace/api-client-react";
import Dashboard from "./dashboard";

const mockBootstrap = vi.mocked(useGetDashboardBootstrap);

const recomp = {
  measurementCount: 3,
  sites: [],
  totalInchesLost: 2.5,
  muscleProxyInchesGained: 0.4,
  strengthScoreCurrent: null,
  strengthScoreGoal: null,
  weightBaseline: 200,
  weightLatest: 190,
  onTrack: true,
};

const baseSummary = {
  hasPlan: true,
  currentWeek: 4,
  currentPhase: "Build",
  weekProgressPct: 50,
  weeklyMilesActual: 0,
  weeklyMilesPlanned: 0,
  weeklyLoadActual: 320,
  weeklyLoadPlanned: 400,
  weeklySessionsCompleted: 3,
  weeklySessionsPlanned: 5,
  weeklyLifestyleMinutes: 0,
  prevFourWeekAvgLifestyleMinutes: null,
  totalMilesAllTime: 0,
  longestRunMi: 0,
  weightStart: 200,
  weightCurrent: 190,
  weightGoal: 180,
  weightLost: 10,
  weightToGoal: 10,
  adherencePct: 72,
  daysToRace: 0,
  activeConfigName: "Recomp Block",
  programs: [],
  recomp,
};

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const fixtures = {
  weightTrend: [
    { date: "2026-06-01", weight: 200 },
    { date: "2026-06-20", weight: 190 },
  ],
  recentActivity: [
    {
      id: 1,
      date: todayStr(),
      equipment: "Tonal",
      sessionType: "Tonal Strength",
      totalMin: 45,
      totalLoad: 120,
      isCustomized: false,
    },
  ],
  today: {
    date: todayStr(),
    hasPlan: true,
    plan: { sessionType: "Tonal Strength" },
    plans: [{ id: 1 }, { id: 2 }],
    loggedWorkouts: [{ id: 1, totalMin: 45, totalLoad: 120 }],
    suggestions: null,
  },
};

function renderDashboard(summaryOverride: Record<string, unknown> | null) {
  mockBootstrap.mockReturnValue({
    data:
      summaryOverride === null
        ? undefined
        : {
            summary: { ...baseSummary, ...summaryOverride },
            weightTrend: fixtures.weightTrend,
            weeklyMileage: [],
            equipmentUsage: [],
            longRunProgression: [],
            recentActivity: fixtures.recentActivity,
            today: fixtures.today,
            overview: { includesRunning: false },
          },
    isLoading: false,
  } as never);
  render(<Dashboard />);
}

afterEach(() => {
  cleanup();
  navigateSpy.mockReset();
});

describe("Dashboard hub (Phase 4)", () => {
  it("shows the loading skeleton while the bootstrap is in flight", () => {
    mockBootstrap.mockReturnValue({
      data: undefined,
      isLoading: true,
    } as never);
    render(<Dashboard />);
    expect(screen.queryByTestId("dashboard-header")).toBeNull();
  });

  it("renders a failure message when the bootstrap resolves without a summary", () => {
    renderDashboard(null);
    expect(screen.getByText("Failed to load dashboard")).toBeTruthy();
  });

  it("renders the empty-plan CTA and the body-recomp hero when hasPlan is false", () => {
    renderDashboard({ hasPlan: false });
    expect(screen.getByTestId("dashboard-empty-plan")).toBeTruthy();
    expect(screen.getByTestId("recomp-hero")).toBeTruthy();
  });

  it("renders the tiled hub for an active plan: header, feature tiles, training tile", () => {
    renderDashboard({});
    expect(screen.getByTestId("dashboard-header-title").textContent).toBe(
      "Recomp Block",
    );
    expect(screen.getByTestId("dashboard-feature-tiles")).toBeTruthy();
    expect(screen.getByTestId("dashboard-tile-today")).toBeTruthy();
    expect(screen.getByTestId("dashboard-training-tile")).toBeTruthy();
    expect(screen.getByTestId("dashboard-ai-frontdoor")).toBeTruthy();
  });

  it("navigates to /today when the Today feature tile is clicked", () => {
    renderDashboard({});
    fireEvent.click(screen.getByTestId("dashboard-tile-today"));
    expect(navigateSpy).toHaveBeenCalledWith("/today");
  });

  it("carries no marathon-era surfaces", () => {
    renderDashboard({});
    expect(
      screen.queryByText(/Days to Race|Mileage Volume|Long Run Build/i),
    ).toBeNull();
  });

  it("reframes the training tile when the scale toggle switches to Weekly", () => {
    renderDashboard({});
    // Daily default → "Today"; switch to Weekly → "Week 4 · Build".
    fireEvent.click(screen.getByText("Weekly"));
    expect(
      screen.getByTestId("dashboard-training-tile").textContent,
    ).toContain("Week 4");
  });
});
