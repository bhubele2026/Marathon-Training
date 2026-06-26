import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RecompTrajectory } from "./recomp-trajectory";
import type { BodyTrajectoryPoint } from "./types";

// Render coverage for RecompTrajectory — renders without crashing for full
// data (with the body-fat band), toggles metrics via the SegmentedControl, and
// shows the EmptyState when the chosen metric is sparse.
// recharts' ResponsiveContainer needs ResizeObserver, which jsdom lacks.
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(cleanup);

const TRAJECTORY: BodyTrajectoryPoint[] = [
  { date: "2026-06-01", weightLb: 280, bodyFatPct: 32, leanLb: 190, fatLb: 90 },
  { date: "2026-06-08", weightLb: 277, bodyFatPct: 31, leanLb: 191, fatLb: 86 },
  { date: "2026-06-15", weightLb: 275, bodyFatPct: 30, leanLb: 192, fatLb: 83 },
];

describe("RecompTrajectory", () => {
  it("renders body-fat by default with the expected band", () => {
    render(<RecompTrajectory trajectory={TRAJECTORY} expectedBand={{ lo: 25, hi: 28 }} />);
    expect(screen.getByTestId("recomp-trajectory")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Body-fat" }).getAttribute("aria-checked")).toBe(
      "true",
    );
  });

  it("toggles to another metric without throwing", () => {
    render(<RecompTrajectory trajectory={TRAJECTORY} />);
    fireEvent.click(screen.getByRole("radio", { name: "Weight" }));
    expect(screen.getByRole("radio", { name: "Weight" }).getAttribute("aria-checked")).toBe(
      "true",
    );
  });

  it("shows the EmptyState when the trajectory is sparse", () => {
    render(
      <RecompTrajectory
        trajectory={[
          { date: "2026-06-01", weightLb: 280, bodyFatPct: 32, leanLb: 190, fatLb: 90 },
        ]}
      />,
    );
    expect(screen.getByText(/Log weight \+ body-fat % to see your recomp trend/)).toBeTruthy();
  });

  it("shows the EmptyState when no trajectory is provided", () => {
    render(<RecompTrajectory />);
    expect(screen.getByText(/recomp trend/)).toBeTruthy();
  });
});
