import { describe, expect, it } from "vitest";
import {
  getPrimaryMetric,
  getPrimaryMetricCompare,
} from "./primary-metric";

describe("getPrimaryMetric", () => {
  it("picks distance for run sessions with mileage", () => {
    const m = getPrimaryMetric({
      distanceMi: 6,
      runMin: 54,
      totalMin: 54,
    });
    expect(m).toEqual({
      kind: "distance",
      label: "Distance",
      value: 6,
      formatted: "6.00 mi",
    });
  });

  it("picks lift minutes for strength-only sessions", () => {
    const m = getPrimaryMetric({ strengthMin: 45, totalMin: 45 });
    expect(m?.kind).toBe("lift");
    expect(m?.formatted).toBe("45 min");
  });

  it("picks cardio minutes for bike/row machine sessions", () => {
    const m = getPrimaryMetric({ cardioMin: 30, totalMin: 30 });
    expect(m?.kind).toBe("cardio");
    expect(m?.formatted).toBe("30 min");
  });

  it("picks total minutes for mixed strength + cardio sessions (no run distance)", () => {
    const m = getPrimaryMetric({
      strengthMin: 35,
      cardioMin: 25,
      totalMin: 60,
    });
    expect(m?.kind).toBe("total");
    expect(m?.formatted).toBe("60 min");
  });

  it("falls back to durationMin when no per-bucket data is available", () => {
    const m = getPrimaryMetric({ durationMin: 22 });
    expect(m?.kind).toBe("total");
    expect(m?.formatted).toBe("22 min");
  });

  it("returns null when nothing is populated (rest day / empty)", () => {
    expect(getPrimaryMetric({})).toBeNull();
    expect(
      getPrimaryMetric({ totalMin: 0, strengthMin: 0, cardioMin: 0, runMin: 0 }),
    ).toBeNull();
    expect(getPrimaryMetric(null)).toBeNull();
  });
});

describe("getPrimaryMetricCompare", () => {
  it("uses the planned kind so actual lines up apples-to-apples", () => {
    const c = getPrimaryMetricCompare(
      // Actual run with no recorded distance, just a total.
      { totalMin: 50, runMin: 50 },
      // Planned was a 6 mile run.
      { distanceMi: 6, runMin: 54 },
    );
    expect(c?.actual.kind).toBe("distance");
    expect(c?.actual.formatted).toBe("0.00 mi");
    expect(c?.planned?.formatted).toBe("6.00 mi");
  });

  it("falls back to TOTAL when plan bucket and logged bucket are different families", () => {
    // Plan logged the day as cardio (40 min) but the runner actually ran —
    // don't show a misleading "Cardio 0 / 40"; compare totals instead.
    const run = getPrimaryMetricCompare(
      { runMin: 30, distanceMi: 1.77, totalMin: 30 },
      { cardioMin: 40, totalMin: 40 },
    );
    expect(run?.actual.kind).toBe("total");
    expect(run?.actual.value).toBe(30);
    expect(run?.planned?.value).toBe(40);

    // Same for a Tonal lift logged against a cardio-bucketed plan day.
    const lift = getPrimaryMetricCompare(
      { strengthMin: 10.6, totalMin: 10.6 },
      { cardioMin: 40, totalMin: 40 },
    );
    expect(lift?.actual.kind).toBe("total");
    expect(lift?.planned?.value).toBe(40);
  });

  it("returns just actual when there is no plan", () => {
    const c = getPrimaryMetricCompare({ strengthMin: 40, totalMin: 40 }, null);
    expect(c?.actual.kind).toBe("lift");
    expect(c?.planned).toBeUndefined();
  });

  it("falls back to actual kind when plan is empty", () => {
    const c = getPrimaryMetricCompare(
      { strengthMin: 40, totalMin: 40 },
      { totalMin: 0 },
    );
    expect(c?.actual.kind).toBe("lift");
    expect(c?.planned).toBeUndefined();
  });

  it("returns null when neither side has anything to show", () => {
    expect(getPrimaryMetricCompare({}, null)).toBeNull();
  });
});
