// Component tests for the TOTAL · LIFT · CARDIO · RUN breakdown tile.
// Locks in the empty-bucket-suppression behavior (no "—" placeholders),
// the null-total hide behavior (so ambiguous legacy rows from the API
// render nothing rather than a misleading "0 min"), and the optional
// run-mileage detail line on the RUN tile.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PlannedBreakdown } from "./planned-breakdown";

afterEach(() => {
  cleanup();
});

describe("PlannedBreakdown", () => {
  it("renders TOTAL · LIFT · CARDIO when run minutes are 0 (Strength + Cardio day)", () => {
    render(
      <PlannedBreakdown
        totalMin={70}
        strengthMin={45}
        cardioMin={25}
        runMin={0}
        testIdPrefix="t"
      />,
    );
    expect(screen.getByTestId("t-breakdown-total").textContent).toBe("70 min");
    expect(screen.getByTestId("t-breakdown-lift").textContent).toBe("45 min");
    expect(screen.getByTestId("t-breakdown-cardio").textContent).toBe("25 min");
    expect(screen.queryByTestId("t-breakdown-run")).toBeNull();
  });

  it("renders TOTAL · LIFT · RUN when cardio minutes are 0 (Run + Accessory day) and shows mileage in the RUN tile", () => {
    render(
      <PlannedBreakdown
        totalMin={49}
        strengthMin={25}
        cardioMin={0}
        runMin={24}
        runDistanceMi={1.5}
        testIdPrefix="t"
      />,
    );
    expect(screen.getByTestId("t-breakdown-total").textContent).toBe("49 min");
    expect(screen.getByTestId("t-breakdown-lift").textContent).toBe("25 min");
    expect(screen.queryByTestId("t-breakdown-cardio")).toBeNull();
    // Compact variant nests the detail span inside the value span, so
    // the run cell's textContent is "24 min · 1.50 mi". The detail line
    // is still asserted by its own data-testid.
    expect(screen.getByTestId("t-breakdown-run").textContent).toContain(
      "24 min",
    );
    expect(screen.getByTestId("t-breakdown-run-detail").textContent).toBe(
      "· 1.50 mi",
    );
  });

  it("renders only TOTAL · RUN on a long-run-only day (Sun)", () => {
    render(
      <PlannedBreakdown
        totalMin={32}
        strengthMin={0}
        cardioMin={0}
        runMin={32}
        runDistanceMi={2}
        testIdPrefix="t"
      />,
    );
    expect(screen.getByTestId("t-breakdown-total").textContent).toBe("32 min");
    expect(screen.queryByTestId("t-breakdown-lift")).toBeNull();
    expect(screen.queryByTestId("t-breakdown-cardio")).toBeNull();
    expect(screen.getByTestId("t-breakdown-run").textContent).toContain(
      "32 min",
    );
    expect(screen.getByTestId("t-breakdown-run-detail").textContent).toBe(
      "· 2.00 mi",
    );
  });

  it("renders nothing (whole component hidden) when totalMin is 0", () => {
    const { container } = render(
      <PlannedBreakdown
        totalMin={0}
        strengthMin={0}
        cardioMin={0}
        runMin={0}
        testIdPrefix="t"
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when totalMin is null (ambiguous legacy row from the API)", () => {
    const { container } = render(
      <PlannedBreakdown
        totalMin={null}
        strengthMin={null}
        cardioMin={null}
        runMin={null}
        testIdPrefix="t"
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("does NOT render a mileage detail line when runDistanceMi is null/undefined", () => {
    render(
      <PlannedBreakdown
        totalMin={32}
        strengthMin={0}
        cardioMin={0}
        runMin={32}
        runDistanceMi={null}
        testIdPrefix="t"
      />,
    );
    expect(screen.getByTestId("t-breakdown-run").textContent).toBe("32 min");
    expect(screen.queryByTestId("t-breakdown-run-detail")).toBeNull();
  });

  it("renders the prominent variant the same way (TOTAL + only non-zero buckets, with run mileage detail)", () => {
    render(
      <PlannedBreakdown
        totalMin={49}
        strengthMin={25}
        cardioMin={0}
        runMin={24}
        runDistanceMi={1.5}
        variant="prominent"
        testIdPrefix="p"
      />,
    );
    // Prominent variant separates the detail into its own <p>, so the
    // value cell holds just "24 min".
    expect(screen.getByTestId("p-breakdown-total").textContent).toBe("49 min");
    expect(screen.getByTestId("p-breakdown-lift").textContent).toBe("25 min");
    expect(screen.queryByTestId("p-breakdown-cardio")).toBeNull();
    expect(screen.getByTestId("p-breakdown-run").textContent).toBe("24 min");
    expect(screen.getByTestId("p-breakdown-run-detail").textContent).toBe(
      "1.50 mi",
    );
  });
});
