import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { TrendVsGoal } from "./trend-vs-goal";
import type { InsightSeriesPoint } from "./types";

// Render coverage for TrendVsGoal — renders without crashing for full data
// (both goal shapes) and shows the EmptyState for a sparse series.
// recharts' ResponsiveContainer needs ResizeObserver, which jsdom lacks.
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(cleanup);

const SERIES: InsightSeriesPoint[] = [
  { date: "2026-06-01", value: 120 },
  { date: "2026-06-02", value: 135 },
  { date: "2026-06-03", value: 128 },
  { date: "2026-06-04", value: 142 },
];

describe("TrendVsGoal", () => {
  it("renders with a number goal (dashed line) and full series", () => {
    render(<TrendVsGoal series={SERIES} goal={150} unit="g" />);
    expect(screen.getByTestId("trend-vs-goal")).toBeTruthy();
  });

  it("renders with a {lo,hi} band goal and a tone", () => {
    render(
      <TrendVsGoal series={SERIES} goal={{ lo: 130, hi: 160 }} tone="warning" unit="g" />,
    );
    expect(screen.getByTestId("trend-vs-goal")).toBeTruthy();
  });

  it("shows the EmptyState for a sparse series", () => {
    render(<TrendVsGoal series={[{ date: "2026-06-01", value: 120 }]} goal={150} />);
    expect(screen.getByText(/Not enough logged days yet/)).toBeTruthy();
  });

  it("shows the EmptyState when no series is provided", () => {
    render(<TrendVsGoal />);
    expect(screen.getByText(/Not enough logged days yet/)).toBeTruthy();
  });
});
