// Tests for TimeBudgetBar — locks in the fixed-cadence daily time-budget
// contract visualization (Mon hidden; Tue-Thu SHORT capped at 50;
// Fri-Sun LONG open-ended ≥ 60), the over-budget destructive-tone overlay
// on short days, and the at-cap primary tone.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { TimeBudgetBar } from "./time-budget-bar";

afterEach(() => {
  cleanup();
});

describe("TimeBudgetBar", () => {
  it("hides on Mon", () => {
    // 2026-05-04 is a Monday.
    const { container } = render(
      <TimeBudgetBar date="2026-05-04" plannedMin={0} testIdPrefix="t" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders a 50-min cap label on a Tue-Thu short day", () => {
    // 2026-05-05 is a Tuesday.
    render(
      <TimeBudgetBar date="2026-05-05" plannedMin={45} testIdPrefix="t" />,
    );
    expect(screen.getByTestId("t-time-budget")).not.toBeNull();
    expect(screen.getByTestId("t-time-budget-label").textContent).toBe(
      "45 / 50 min budget",
    );
  });

  it("treats Friday as a LONG day (60+ open-ended, not a short cap)", () => {
    // 2026-05-08 is a Friday.
    render(
      <TimeBudgetBar date="2026-05-08" plannedMin={75} testIdPrefix="t" />,
    );
    expect(screen.getByTestId("t-time-budget-label").textContent).toBe(
      "75 / 60+ min",
    );
  });

  it("treats Saturday as a LONG day (60+ open-ended)", () => {
    // 2026-05-09 is a Saturday.
    render(
      <TimeBudgetBar date="2026-05-09" plannedMin={70} testIdPrefix="t" />,
    );
    expect(screen.getByTestId("t-time-budget-label").textContent).toBe(
      "70 / 60+ min",
    );
  });

  it("flips the label to OVER BUDGET when the actual exceeds 50 on a short day", () => {
    // 2026-05-06 is a Wednesday (short day).
    render(
      <TimeBudgetBar
        date="2026-05-06"
        plannedMin={45}
        actualMin={62}
        testIdPrefix="t"
      />,
    );
    expect(screen.getByTestId("t-time-budget-label").textContent).toBe(
      "62 / 50 min · over budget",
    );
    expect(screen.getByTestId("t-time-budget-overflow")).not.toBeNull();
  });

  it("renders the 60+ open-ended label on Sun and never marks over-budget", () => {
    // 2026-05-10 is a Sunday.
    render(
      <TimeBudgetBar
        date="2026-05-10"
        plannedMin={120}
        actualMin={135}
        testIdPrefix="t"
      />,
    );
    expect(screen.getByTestId("t-time-budget-label").textContent).toBe(
      "120 / 60+ min",
    );
    expect(screen.queryByTestId("t-time-budget-overflow")).toBeNull();
  });

  it("does not render the actual overlay or overflow when no actual is logged", () => {
    render(
      <TimeBudgetBar date="2026-05-05" plannedMin={45} testIdPrefix="t" />,
    );
    expect(screen.queryByTestId("t-time-budget-actual")).toBeNull();
    expect(screen.queryByTestId("t-time-budget-overflow")).toBeNull();
  });

  it("renders nothing when both planned and actual are zero", () => {
    const { container } = render(
      <TimeBudgetBar
        date="2026-05-05"
        plannedMin={0}
        actualMin={0}
        testIdPrefix="t"
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});
