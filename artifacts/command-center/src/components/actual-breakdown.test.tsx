// Component tests for the per-bucket *actual* breakdown tile rendered on
// /today and /plan/:week for logged workouts. The component has three
// distinct rendering paths that each lock down a real UX guarantee:
//
//   1. With per-bucket actuals + planned context, render TOTAL plus only
//      the buckets that have a positive value on either side, annotating
//      each tile with "/ planned" so the user can see the gap inline.
//   2. With per-bucket actuals but no planned context (e.g. rest-day
//      free-form logging), render the same tiles without the planned
//      annotation.
//   3. With no per-bucket actuals at all, fall back to a single Duration
//      tile sourced from the legacy `durationMin` field — so old logs
//      and quick-logged Lifestyle activities still render something
//      instead of disappearing.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ActualBreakdown } from "./actual-breakdown";

afterEach(() => {
  cleanup();
});

describe("ActualBreakdown", () => {
  it("renders TOTAL · LIFT · CARDIO · RUN with planned annotations when actuals + plan are present", () => {
    render(
      <ActualBreakdown
        totalMin={100}
        strengthMin={40}
        cardioMin={28}
        runMin={32}
        plannedTotalMin={106}
        plannedStrengthMin={45}
        plannedCardioMin={25}
        plannedRunMin={36}
        testIdPrefix="t"
      />,
    );
    // textContent includes the inline planned annotation, so we use
    // toContain instead of toBe for value cells when planned is set.
    expect(screen.getByTestId("t-actual-breakdown-total").textContent).toContain("100 min");
    expect(screen.getByTestId("t-actual-breakdown-lift").textContent).toContain("40 min");
    expect(screen.getByTestId("t-actual-breakdown-cardio").textContent).toContain("28 min");
    expect(screen.getByTestId("t-actual-breakdown-run").textContent).toContain("32 min");
    expect(screen.getByTestId("t-actual-breakdown-total-planned").textContent).toBe("/ 106");
    expect(screen.getByTestId("t-actual-breakdown-lift-planned").textContent).toBe("/ 45");
    expect(screen.getByTestId("t-actual-breakdown-cardio-planned").textContent).toBe("/ 25");
    expect(screen.getByTestId("t-actual-breakdown-run-planned").textContent).toBe("/ 36");
  });

  it("still surfaces the LIFT tile (with '0 min' actual) when the user did 0 of a prescribed bucket — keeps the gap visible", () => {
    render(
      <ActualBreakdown
        totalMin={28}
        strengthMin={0}
        cardioMin={0}
        runMin={28}
        plannedTotalMin={73}
        plannedStrengthMin={45}
        plannedCardioMin={0}
        plannedRunMin={28}
        testIdPrefix="t"
      />,
    );
    expect(screen.getByTestId("t-actual-breakdown-lift").textContent).toContain("0 min");
    expect(screen.getByTestId("t-actual-breakdown-lift-planned").textContent).toBe("/ 45");
    // Cardio is 0 on both sides — the tile is suppressed entirely so the
    // breakdown row stays focused on what the user actually missed.
    expect(screen.queryByTestId("t-actual-breakdown-cardio")).toBeNull();
  });

  it("renders TOTAL · LIFT · CARDIO · RUN without planned annotations when no plan context is provided", () => {
    render(
      <ActualBreakdown
        totalMin={70}
        strengthMin={45}
        cardioMin={25}
        runMin={0}
        testIdPrefix="t"
      />,
    );
    expect(screen.getByTestId("t-actual-breakdown-total").textContent).toBe("70 min");
    expect(screen.getByTestId("t-actual-breakdown-lift").textContent).toBe("45 min");
    expect(screen.getByTestId("t-actual-breakdown-cardio").textContent).toBe("25 min");
    expect(screen.queryByTestId("t-actual-breakdown-run")).toBeNull();
    expect(screen.queryByTestId("t-actual-breakdown-total-planned")).toBeNull();
  });

  it("falls back to a single Duration tile when no per-bucket actuals are present (legacy row)", () => {
    render(
      <ActualBreakdown
        totalMin={null}
        strengthMin={null}
        cardioMin={null}
        runMin={null}
        durationMin={45}
        testIdPrefix="t"
      />,
    );
    expect(screen.getByTestId("t-actual-breakdown-total").textContent).toBe("45 min");
    expect(screen.queryByTestId("t-actual-breakdown-lift")).toBeNull();
    expect(screen.queryByTestId("t-actual-breakdown-cardio")).toBeNull();
    expect(screen.queryByTestId("t-actual-breakdown-run")).toBeNull();
  });

  it("renders nothing when the workout has neither a breakdown nor a legacy duration", () => {
    const { container } = render(
      <ActualBreakdown
        totalMin={null}
        strengthMin={null}
        cardioMin={null}
        runMin={null}
        durationMin={null}
        testIdPrefix="t"
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the prominent variant with the same suppression rules + planned annotations", () => {
    render(
      <ActualBreakdown
        totalMin={49}
        strengthMin={25}
        cardioMin={0}
        runMin={24}
        plannedTotalMin={49}
        plannedStrengthMin={25}
        plannedCardioMin={0}
        plannedRunMin={24}
        variant="prominent"
        testIdPrefix="p"
      />,
    );
    expect(screen.getByTestId("p-actual-breakdown-total").textContent).toBe("49 min");
    expect(screen.getByTestId("p-actual-breakdown-lift").textContent).toBe("25 min");
    expect(screen.queryByTestId("p-actual-breakdown-cardio")).toBeNull();
    expect(screen.getByTestId("p-actual-breakdown-run").textContent).toBe("24 min");
    // Prominent variant puts the planned annotation in its own <p>, so
    // an exact-match assertion is safe here.
    expect(screen.getByTestId("p-actual-breakdown-total-planned").textContent).toBe(
      "/ 49 planned",
    );
    expect(screen.getByTestId("p-actual-breakdown-run-planned").textContent).toBe(
      "/ 24 planned",
    );
  });
});
