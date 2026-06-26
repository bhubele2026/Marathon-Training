import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

afterEach(cleanup);
import { InsightTile, StatusPill } from "@/components/insights/insight-tile";
import { RadialGauge } from "@/components/insights/radial-gauge";
import { StreakDots } from "@/components/insights/streak-dots";
import { statusGaugeColor } from "@/components/insights/types";
import type { InsightPerDay } from "@/components/insights/types";

const perDay: InsightPerDay[] = [
  { date: "2026-06-23", hit: "hit" },
  { date: "2026-06-24", hit: "miss" },
  { date: "2026-06-25", hit: "close" },
];

describe("StatusPill", () => {
  it("renders a label", () => {
    render(<StatusPill tone="success" label="on track" glyph="✓" />);
    expect(screen.getByText("on track")).toBeTruthy();
  });
});

describe("RadialGauge", () => {
  it("renders the center value + sub", () => {
    const { getByTestId, getByText } = render(
      <RadialGauge pct={0.88} color={statusGaugeColor("under")} centerMain="197" centerSub="/224 g" />,
    );
    expect(getByTestId("radial-gauge")).toBeTruthy();
    expect(getByText("197")).toBeTruthy();
    expect(getByText("/224 g")).toBeTruthy();
  });
  it("clamps out-of-range pct without throwing", () => {
    const { getByTestId } = render(
      <RadialGauge pct={1.7} color="hsl(var(--chart-1))" centerMain="33%" />,
    );
    expect(getByTestId("radial-gauge")).toBeTruthy();
  });
});

describe("StreakDots", () => {
  it("renders a dot per day + a tally", () => {
    const { container } = render(<StreakDots perDay={perDay} daysHit={1} daysLogged={3} tally />);
    expect(container.querySelectorAll("[title]").length).toBe(3);
    expect(screen.getByText(/1\/3 on target/)).toBeTruthy();
  });
  it("renders nothing with no data and no tally", () => {
    const { container } = render(<StreakDots perDay={[]} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("InsightTile", () => {
  it("shows name, derived pill, caption, and a toggling Why drawer", () => {
    render(
      <InsightTile
        name="Protein"
        status="under"
        caption="A chicken breast short, every day."
        drawer={<div>the 8-week chart and reasoning</div>}
        whyLabel="Why + 8-wk chart"
      >
        <div data-testid="viz-slot" />
      </InsightTile>,
    );
    expect(screen.getByText("Protein")).toBeTruthy();
    expect(screen.getByText("under")).toBeTruthy(); // derived pill label
    expect(screen.getByTestId("viz-slot")).toBeTruthy();
    expect(screen.queryByText(/8-week chart and reasoning/)).toBeNull();
    fireEvent.click(screen.getByTestId("tile-why"));
    expect(screen.getByText(/8-week chart and reasoning/)).toBeTruthy();
  });

  it("accepts a pill override (e.g. sodium high / consistency info)", () => {
    render(
      <InsightTile
        name="Sodium"
        status="over"
        pill={{ tone: "warning", label: "high", glyph: "▴" }}
        caption="Past the band."
      >
        <div />
      </InsightTile>,
    );
    expect(screen.getByText("high")).toBeTruthy();
  });
});
