import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

afterEach(cleanup);

// Self-fetching tile — mock its query hook and stub the log-button (which owns
// its own mutation hooks) so the box renders without a QueryClientProvider.
const useGetAlcoholSummary = vi.fn();
vi.mock("@workspace/api-client-react", () => ({
  useGetAlcoholSummary: () => useGetAlcoholSummary(),
}));
vi.mock("@/components/alcohol-log-button", () => ({
  AlcoholLogButton: () => <button>+ drink</button>,
}));

import { DashboardAlcoholBox } from "./dashboard-alcohol-box";
import type { AlcoholSummary } from "@workspace/api-client-react";

function summary(over: Partial<AlcoholSummary> = {}): AlcoholSummary {
  return {
    active: true,
    seedState: false,
    daysTracked: 30,
    dryDaysTarget: 4,
    weekDrinks: 3,
    drinkingDaysThisWeek: 2,
    drinkingBudget: 3,
    dryDaysThisWeek: 5,
    currentDryStreak: 3,
    longestDryStreak: 9,
    dailyStrip: [],
    weeklyTrend: [],
    avgDryPerWeek: 4.3,
    weeksOnTarget: 2,
    weeksTracked: 3,
    weeksOnTargetStreak: 1,
    impact: [],
    ...over,
  } as AlcoholSummary;
}

describe("DashboardAlcoholBox", () => {
  it("leads with dry days vs target + streak + weekly drinks when active", () => {
    useGetAlcoholSummary.mockReturnValue({ data: summary(), isLoading: false });
    render(<DashboardAlcoholBox />);
    expect(screen.getByText("Alcohol")).toBeTruthy();
    expect(screen.getByText("5")).toBeTruthy();
    expect(screen.getByText("/4 dry")).toBeTruthy();
    expect(screen.getByText(/3-day streak/)).toBeTruthy();
    expect(screen.getByText(/2\/3 wk on target/)).toBeTruthy();
    expect(screen.getByText(/3 drinks this week/)).toBeTruthy();
  });

  it("celebrates a hit week, never shame", () => {
    useGetAlcoholSummary.mockReturnValue({
      data: summary({ dryDaysThisWeek: 4, dryDaysTarget: 4 }),
      isLoading: false,
    });
    render(<DashboardAlcoholBox />);
    expect(screen.getByText(/goal hit this week/i)).toBeTruthy();
  });

  it("invites logging when there's no data yet", () => {
    useGetAlcoholSummary.mockReturnValue({ data: summary({ active: false }), isLoading: false });
    render(<DashboardAlcoholBox />);
    expect(screen.getByText(/No drinks logged yet/)).toBeTruthy();
  });
});
