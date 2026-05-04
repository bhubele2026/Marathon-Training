// Render tests for the hybrid-week-preview component. Pin the
// race-week branch (Task #203) so the planner's hybrid builder card
// keeps showing the trailing Saturday Race Prep slot and the Sunday
// 26.2 mi RACE DAY cell with the same amber Trophy treatment that
// Week Detail uses for the marathon Sunday (Task #199). Also locks
// in the typical-week default so the existing builder behavior
// doesn't regress.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { HybridWeekPreview } from "./hybrid-week-preview";

afterEach(() => {
  cleanup();
});

describe("HybridWeekPreview — typical week (default)", () => {
  it("renders the typical-week strip with Mon..Sun cells, header label, totals, and no race-week badge / cell", () => {
    render(
      <HybridWeekPreview
        position="balanced"
        daysPerWeek={5}
        level="beginner"
        blockWeeks={8}
      />,
    );
    // The typical-week container uses the v1 testid (no -race-week
    // suffix) so existing tests that target it keep working.
    const root = screen.getByTestId("planner-hybrid-preview");
    expect(root).toBeTruthy();
    expect(root.getAttribute("data-race-week")).toBeNull();
    // All seven day cells render in Mon..Sun order.
    for (const day of ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]) {
      expect(
        screen.getByTestId(`planner-hybrid-preview-${day}`),
      ).toBeTruthy();
    }
    // Sunday has no race-day amber hook on the typical-week branch.
    const sun = screen.getByTestId("planner-hybrid-preview-sun");
    expect(sun.getAttribute("data-race-day")).toBeNull();
    // No race-week badge on the typical-week header.
    expect(
      screen.queryByTestId("planner-hybrid-preview-race-week-badge"),
    ).toBeNull();
    // No race-week container either.
    expect(
      screen.queryByTestId("planner-hybrid-preview-race-week"),
    ).toBeNull();
    // Totals line is the typical-week one.
    expect(
      screen.getByTestId("planner-hybrid-preview-totals"),
    ).toBeTruthy();
  });
});

describe("HybridWeekPreview — race week (Task #203)", () => {
  it("renders the race-week container with a RACE DAY badge in the header", () => {
    render(
      <HybridWeekPreview
        position="balanced"
        daysPerWeek={5}
        level="advanced"
        blockWeeks={18}
        isRaceWeek
      />,
    );
    // Distinct race-week container so the planner can mount both the
    // typical and race-week previews side-by-side without testid clash.
    const root = screen.getByTestId("planner-hybrid-preview-race-week");
    expect(root).toBeTruthy();
    expect(root.getAttribute("data-race-week")).toBe("true");
    // Trophy + RACE DAY pill in the header — same visual language as
    // the Week Detail race-day badge (Task #199).
    const badge = screen.getByTestId(
      "planner-hybrid-preview-race-week-badge",
    );
    expect(badge.textContent).toContain("Race Day");
    // Header label flips from "Typical week" to "Race week".
    expect(root.textContent).toContain("Race week");
    expect(root.textContent).not.toContain("Typical week");
  });

  it("force-overrides the trailing Saturday to Race Prep and Sunday to a 26.2 mi RACE DAY cell with the amber race-day hook", () => {
    render(
      <HybridWeekPreview
        position="balanced"
        daysPerWeek={5}
        level="advanced"
        blockWeeks={18}
        isRaceWeek
      />,
    );
    // Race-week branch namespaces day testids under `-race-week-` so
    // it can mount alongside the typical-week preview without selector
    // collisions on `planner-hybrid-preview-sun`.
    // Saturday: Race Prep label + PREP tag (mirrors buildHybridWeekDays).
    const sat = screen.getByTestId("planner-hybrid-preview-race-week-sat");
    expect(within(sat).getByText("Race Prep")).toBeTruthy();
    expect(
      screen.getByTestId("planner-hybrid-preview-race-week-sat-tag")
        .textContent,
    ).toBe("PREP");
    // Sunday: RACE DAY 26.2 mi label + RACE tag + amber race-day hook.
    const sun = screen.getByTestId("planner-hybrid-preview-race-week-sun");
    expect(sun.getAttribute("data-race-day")).toBe("true");
    expect(sun.textContent).toContain("RACE DAY");
    expect(sun.textContent).toContain("26.2 mi");
    expect(
      screen.getByTestId("planner-hybrid-preview-race-week-sun-tag")
        .textContent,
    ).toBe("RACE");
  });

  it("includes the 26.2 mi race-day distance in the race-week totals line", () => {
    render(
      <HybridWeekPreview
        position="balanced"
        daysPerWeek={5}
        level="advanced"
        blockWeeks={18}
        isRaceWeek
      />,
    );
    const totals = screen.getByTestId(
      "planner-hybrid-preview-race-week-totals",
    );
    // Race-week totals must include the 26.2 mi marathon on top of any
    // tapered weekday runs — the runner is looking at the campaign-final
    // week, so the headline mileage must be at LEAST the race itself.
    // Parse the trailing "X.Y mi" out of the totals line and check it
    // covers at least 26.2 (the marathon distance).
    const match = totals.textContent?.match(/(\d+(?:\.\d+)?)\s*mi/);
    expect(match).not.toBeNull();
    const totalMi = parseFloat(match![1]!);
    expect(totalMi).toBeGreaterThanOrEqual(26.2);
    // And totals must count the race day as one of the runs (so the
    // typical typical-week breakdown — 2 lifts + 3 runs in the
    // balanced/5-day default — increments to 3 runs minimum).
    expect(totals.textContent).toMatch(/\d+ runs?/);
  });

  it("does NOT show the Cutback badge on the race week even if it lands on a 4th-week cadence", () => {
    // blockWeeks=8 → race week defaults to week 8 (8 % 4 === 0). The
    // race-week branch must suppress the Cutback badge regardless,
    // since the trailing Sat/Sun overrides own that week's shape.
    render(
      <HybridWeekPreview
        position="balanced"
        daysPerWeek={5}
        level="beginner"
        blockWeeks={8}
        isRaceWeek
      />,
    );
    // Cutback testid is namespaced under the race-week prefix; both
    // the legacy typical-week id and the race-week id must be absent.
    expect(
      screen.queryByTestId("planner-hybrid-preview-race-week-cutback"),
    ).toBeNull();
    expect(
      screen.queryByTestId("planner-hybrid-preview-cutback"),
    ).toBeNull();
  });
});
