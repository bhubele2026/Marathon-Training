import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { RecompHero } from "./recomp-hero";
import type { BodyStat, BodyTrajectoryPoint } from "./types";

// Render coverage for RecompHero — full data (sparkline + expected band + mini
// stats) and the sparse paths (no trajectory / null body-fat → placeholder),
// asserting the testid is present and nothing throws.
afterEach(cleanup);

const TRAJECTORY: BodyTrajectoryPoint[] = [
  { date: "2026-06-01", weightLb: 286, bodyFatPct: 40, leanLb: 172, fatLb: 114 },
  { date: "2026-06-08", weightLb: 283, bodyFatPct: 39, leanLb: 173, fatLb: 110 },
  { date: "2026-06-15", weightLb: 280, bodyFatPct: 38.1, leanLb: 173, fatLb: 107 },
];

const STATS: BodyStat[] = [
  { key: "weight", label: "Weight", unit: "lb", value: 280, change: 0, goodDirection: "down" },
  { key: "lean", label: "Lean", unit: "lb", value: 173, change: 1, goodDirection: "up" },
  { key: "fat", label: "Fat", unit: "lb", value: 107, change: -3, goodDirection: "down" },
];

describe("RecompHero", () => {
  it("renders the hero content with a sparkline, band and mini stats", () => {
    const { container } = render(
      <RecompHero
        bodyFatPct={38.1}
        bodyFatSub="flat vs last week — judge by this, not the scale"
        trajectory={TRAJECTORY}
        expectedBand={{ lo: 33, hi: 39 }}
        bodyStats={STATS}
      />,
    );
    expect(screen.getByTestId("recomp-hero")).toBeTruthy();
    expect(screen.getByText("Body fat")).toBeTruthy();
    expect(screen.getByText("38.1")).toBeTruthy();
    expect(screen.getByText("Weight")).toBeTruthy();
    // Sparkline drew an azure series line.
    expect(container.querySelector("polyline")).toBeTruthy();
  });

  it("renders the placeholder with no trajectory and does not throw", () => {
    render(<RecompHero bodyFatPct={38.1} />);
    expect(screen.getByTestId("recomp-hero")).toBeTruthy();
    expect(screen.getByText(/Log weight \+ body-fat %/)).toBeTruthy();
  });

  it("renders an em-dash and placeholder when body-fat is null", () => {
    const { container } = render(<RecompHero bodyFatPct={null} />);
    expect(screen.getByTestId("recomp-hero")).toBeTruthy();
    expect(screen.getByText("—")).toBeTruthy();
    // No sparkline series without points.
    expect(container.querySelector("polyline")).toBeNull();
  });
});
