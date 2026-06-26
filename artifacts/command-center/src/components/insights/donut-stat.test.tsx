import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DonutStat } from "./donut-stat";
import type { InsightPerDay } from "./types";

// Render coverage for DonutStat — full data (gauge + tally + day strip) and the
// sparse path (empty perDay → no dot strip), asserting the testid is present
// and nothing throws.
afterEach(cleanup);

const PER_DAY: InsightPerDay[] = [
  { date: "2026-06-23", hit: "hit" },
  { date: "2026-06-24", hit: "miss" },
  { date: "2026-06-25", hit: "close" },
];

describe("DonutStat", () => {
  it("renders the donut, default percentage, tally and day strip", () => {
    render(
      <DonutStat
        pct={0.33}
        statText="7 sessions / 2 wk"
        sub="trained hard — now log to match"
        perDay={PER_DAY}
      />,
    );
    expect(screen.getByTestId("donut-stat")).toBeTruthy();
    expect(screen.getByTestId("radial-gauge")).toBeTruthy();
    expect(screen.getByText("33%")).toBeTruthy();
    expect(screen.getByText("on target")).toBeTruthy();
    expect(screen.getByText("7 sessions / 2 wk")).toBeTruthy();
    expect(screen.getByTestId("streak-dots")).toBeTruthy();
  });

  it("renders with an empty perDay and does not throw", () => {
    render(<DonutStat pct={0.5} statText="0 sessions / 2 wk" perDay={[]} />);
    expect(screen.getByTestId("donut-stat")).toBeTruthy();
    expect(screen.getByText("50%")).toBeTruthy();
    // StreakDots renders nothing with no logged days.
    expect(screen.queryByTestId("streak-dots")).toBeNull();
  });
});
