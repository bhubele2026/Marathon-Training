import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

// recharts' ResponsiveContainer needs ResizeObserver, which jsdom lacks.
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(cleanup);

import { AlcoholTile, DryDaysTile } from "@/components/insights/alcohol-tiles";
import type { NutritionInsight, AlcoholStats, AlcoholDay } from "@/components/insights/types";

function strip7(): AlcoholDay[] {
  // A Mon-anchored week so weekday classification is deterministic in tests.
  return [
    { date: "2099-06-29", drinks: 0, isDry: true, logged: true }, // Mon (target)
    { date: "2099-06-30", drinks: 0, isDry: true, logged: true }, // Tue
    { date: "2099-07-01", drinks: 1, isDry: false, logged: true }, // Wed
    { date: "2099-07-02", drinks: 0, isDry: true, logged: false }, // Thu
    { date: "2099-07-03", drinks: 2, isDry: false, logged: true }, // Fri (free)
    { date: "2099-07-04", drinks: 0, isDry: true, logged: false }, // Sat
    { date: "2099-07-05", drinks: 0, isDry: false, logged: false }, // Sun (today, pending)
  ];
}

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
    dailyStrip: strip7(),
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

function insight(id: "alcohol" | "dryDays", a: AlcoholStats): NutritionInsight {
  return {
    id,
    label: id === "alcohol" ? "Alcohol" : "Dry days",
    group: "alcohol",
    unit: id === "alcohol" ? "drinks" : "days",
    actual: id === "alcohol" ? a.weekDrinks : a.dryDaysThisWeek,
    target: id === "alcohol" ? null : a.dryDaysTarget,
    direction: id === "alcohol" ? "lower_better" : "higher_better",
    status: id === "dryDays" ? "ahead" : "appropriate",
    alcohol: a,
    caption: "caption here",
    detail: "the longer why",
  };
}

describe("DryDaysTile", () => {
  it("leads with the streak + dry/target and the week-structure visual", () => {
    render(<DryDaysTile insight={insight("dryDays", stats())} />);
    expect(screen.getByText(/day dry streak/)).toBeTruthy();
    expect(screen.getByText("5")).toBeTruthy(); // dry days this week
    expect(screen.getByText("/4")).toBeTruthy();
    expect(screen.getByTestId("dry-week-structure")).toBeTruthy();
  });

  it("shows the multi-week trend once enough weeks exist", () => {
    render(<DryDaysTile insight={insight("dryDays", stats())} />);
    expect(screen.getByText(/2 of last 3 · avg 4\.3 dry\/wk/)).toBeTruthy();
  });

  it("marks a complete week, never red/shame", () => {
    render(<DryDaysTile insight={insight("dryDays", stats({ dryDaysThisWeek: 4, dryDaysTarget: 4 }))} />);
    expect(screen.getByText("week complete")).toBeTruthy();
  });

  it("shows an inviting zero state with the full scaffold (no lonely circle)", () => {
    render(
      <DryDaysTile
        insight={insight("dryDays", stats({ seedState: true, dryDaysThisWeek: 0, weeksTracked: 0 }))}
      />,
    );
    expect(screen.getByTestId("dry-week-structure")).toBeTruthy();
    expect(screen.getByText(/Four dry slots this week/)).toBeTruthy();
    expect(screen.getByText("early read")).toBeTruthy();
  });

  it("opens the why drawer with each week's dry count", () => {
    render(<DryDaysTile insight={insight("dryDays", stats())} />);
    fireEvent.click(screen.getByText(/Why \+ week by week/));
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
  it("shows the week's drinks and a real bar strip (not a floating number)", () => {
    render(<AlcoholTile insight={insight("alcohol", stats())} />);
    expect(screen.getByText("3")).toBeTruthy(); // week drinks
    expect(screen.getByTestId("alcohol-bar-strip")).toBeTruthy();
    expect(screen.getByText(/2 of 3 free days used/)).toBeTruthy();
  });

  it("reads NEUTRAL on plan, soft amber over — never red", () => {
    render(<AlcoholTile insight={insight("alcohol", stats({ drinkingDaysThisWeek: 2, drinkingBudget: 3 }))} />);
    expect(screen.getByText("on plan")).toBeTruthy();
    cleanup();
    render(<AlcoholTile insight={insight("alcohol", stats({ drinkingDaysThisWeek: 5, drinkingBudget: 3 }))} />);
    expect(screen.getByText("over plan")).toBeTruthy();
  });

  it("shows an early-read chip in seed state", () => {
    render(<AlcoholTile insight={insight("alcohol", stats({ seedState: true }))} />);
    expect(screen.getByText("early read")).toBeTruthy();
  });

  it("keeps the why + impact drawer", () => {
    render(<AlcoholTile insight={insight("alcohol", stats())} />);
    fireEvent.click(screen.getByText(/Why \+ impact/));
    expect(screen.getByText(/lower after a drinking day/)).toBeTruthy();
  });
});
