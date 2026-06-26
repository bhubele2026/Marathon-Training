import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

afterEach(cleanup);
import { AlcoholTile, DryDaysTile } from "@/components/insights/alcohol-tiles";
import type { NutritionInsight, AlcoholStats } from "@/components/insights/types";

function stats(over: Partial<AlcoholStats> = {}): AlcoholStats {
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
    dailyStrip: [
      { date: "2099-06-25", drinks: 0, isDry: true, logged: false },
      { date: "2099-06-26", drinks: 2, isDry: false, logged: true },
      { date: "2099-06-27", drinks: 0, isDry: true, logged: false },
      { date: "2099-06-28", drinks: 1, isDry: false, logged: true },
      { date: "2099-06-29", drinks: 0, isDry: true, logged: false },
      { date: "2099-06-30", drinks: 0, isDry: true, logged: false },
      { date: "2099-07-01", drinks: 0, isDry: false, logged: false },
    ],
    weeklyTrend: [
      { weekStart: "2099-06-08", dryDays: 5, drinkingDays: 2, drinks: 4, hitTarget: true, inProgress: false },
      { weekStart: "2099-06-15", dryDays: 3, drinkingDays: 4, drinks: 7, hitTarget: false, inProgress: false },
      { weekStart: "2099-06-22", dryDays: 5, drinkingDays: 2, drinks: 3, hitTarget: true, inProgress: false },
      { weekStart: "2099-06-29", dryDays: 5, drinkingDays: 1, drinks: 3, hitTarget: true, inProgress: true },
    ],
    avgDryPerWeek: 4.3,
    weeksOnTarget: 2,
    weeksTracked: 3,
    weeksOnTargetStreak: 1,
    impact: [
      {
        key: "trainingLoad",
        label: "Next-day training load",
        drinkingAvg: 15,
        dryAvg: 55,
        deltaPct: -73,
        betterWhenDry: true,
        note: "Next-day load averages 73% lower after a drinking day.",
      },
    ],
    ...over,
  };
}

function insight(id: "alcohol" | "dryDays", a: AlcoholStats, over: Partial<NutritionInsight> = {}): NutritionInsight {
  return {
    id,
    label: id === "alcohol" ? "Alcohol" : "Dry days",
    group: "alcohol",
    unit: id === "alcohol" ? "drinks" : "days",
    actual: id === "alcohol" ? a.weekDrinks : a.dryDaysThisWeek,
    target: id === "alcohol" ? null : a.dryDaysTarget,
    direction: id === "alcohol" ? "lower_better" : "higher_better",
    status: "appropriate",
    alcohol: a,
    caption: "caption here",
    detail: "the longer why",
    ...over,
  };
}

describe("DryDaysTile", () => {
  it("shows dry days vs target and the week-over-week trend", () => {
    render(<DryDaysTile insight={insight("dryDays", stats(), { status: "ahead" })} />);
    expect(screen.getByText("5")).toBeTruthy(); // dry days this week
    expect(screen.getByText("/4 dry")).toBeTruthy();
    expect(screen.getByTestId("dry-week-dots")).toBeTruthy();
    expect(screen.getByText(/2 of 3 wk/)).toBeTruthy();
    expect(screen.getByText(/3-day dry streak/)).toBeTruthy();
  });

  it("opens the why drawer with each week's dry count", () => {
    render(<DryDaysTile insight={insight("dryDays", stats(), { status: "ahead" })} />);
    fireEvent.click(screen.getByText(/Why \+ week-by-week/));
    expect(screen.getByText(/the longer why/)).toBeTruthy();
  });

  it("renders nothing without the alcohol payload", () => {
    const { container } = render(
      <DryDaysTile insight={{ ...insight("dryDays", stats()), alcohol: undefined }} />,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe("AlcoholTile", () => {
  it("shows the week's drinks, the 7-day strip, and the impact line", () => {
    render(<AlcoholTile insight={insight("alcohol", stats())} />);
    expect(screen.getByText("3")).toBeTruthy(); // week drinks
    expect(screen.getByTestId("alcohol-bar-strip")).toBeTruthy();
    expect(screen.getAllByText(/lower after a drinking day/).length).toBeGreaterThan(0);
  });

  it("reads NEUTRAL within budget (in budget pill), not a red flag", () => {
    render(<AlcoholTile insight={insight("alcohol", stats({ drinkingDaysThisWeek: 2, drinkingBudget: 3 }))} />);
    expect(screen.getByText("in budget")).toBeTruthy();
  });

  it("nudges softly (amber) when over budget", () => {
    render(<AlcoholTile insight={insight("alcohol", stats({ drinkingDaysThisWeek: 5, drinkingBudget: 3 }))} />);
    expect(screen.getByText("over budget")).toBeTruthy();
  });

  it("shows an early-read pill in seed state", () => {
    render(<AlcoholTile insight={insight("alcohol", stats({ seedState: true, impact: [] }))} />);
    expect(screen.getByText("early read")).toBeTruthy();
  });
});
