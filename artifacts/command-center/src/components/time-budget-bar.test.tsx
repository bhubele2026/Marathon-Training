// Tests for TimeBudgetBar — locks in the Task #336 daily time-budget
// contract visualization (Mon hidden, Tue–Fri capped at 60, Sat/Sun
// open-ended ≥ 60), the over-budget destructive-tone overlay, and the
// at-cap primary tone.

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

  it("renders a 60-min cap label on a Tue–Fri weekday", () => {
    // 2026-05-05 is a Tuesday.
    render(
      <TimeBudgetBar date="2026-05-05" plannedMin={55} testIdPrefix="t" />,
    );
    expect(screen.getByTestId("t-time-budget")).not.toBeNull();
    expect(screen.getByTestId("t-time-budget-label").textContent).toBe(
      "55 / 60 min budget",
    );
  });

  it("flips the label to OVER BUDGET when the actual exceeds 60 on a weekday", () => {
    // 2026-05-08 is a Friday.
    render(
      <TimeBudgetBar
        date="2026-05-08"
        plannedMin={58}
        actualMin={72}
        testIdPrefix="t"
      />,
    );
    expect(screen.getByTestId("t-time-budget-label").textContent).toBe(
      "72 / 60 min · over budget",
    );
    expect(screen.getByTestId("t-time-budget-overflow")).not.toBeNull();
  });

  it("renders the 60+ open-ended label on Sat/Sun and never marks over-budget", () => {
    // 2026-05-10 is a Sunday.
    render(
      <TimeBudgetBar
        date="2026-05-10"
        plannedMin={90}
        actualMin={110}
        testIdPrefix="t"
      />,
    );
    expect(screen.getByTestId("t-time-budget-label").textContent).toBe(
      "90 / 60+ min",
    );
    expect(screen.queryByTestId("t-time-budget-overflow")).toBeNull();
  });

  it("does not render the actual overlay or overflow when no actual is logged", () => {
    render(
      <TimeBudgetBar date="2026-05-05" plannedMin={50} testIdPrefix="t" />,
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
