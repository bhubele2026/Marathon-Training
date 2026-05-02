// Tests for the field-level update logic in the strength_min / cardio_min /
// run_min backfill. The double-count guard is the most important case here:
// for a "run-led" row whose legacy cardio_min was actually run minutes
// (e.g. cardio_min=24 for a Wed treadmill day), the backfill must MOVE
// cardio_min into run_min, not write inferred run_min while leaving the
// same minutes still sitting in cardio_min — that would inflate totalMin.

import { describe, it, expect } from "vitest";
import { computeBackfillUpdates } from "./backfill-plan-day-minutes";

describe("computeBackfillUpdates", () => {
  it("rest day: zeros every NULL minute column without touching populated ones", () => {
    expect(
      computeBackfillUpdates({
        current: { strengthMin: null, cardioMin: null, runMin: null },
        inferred: { strengthMin: 0, cardioMin: 0, runMin: 0 },
        classification: "rest",
      }),
    ).toEqual({ strengthMin: 0, cardioMin: 0, runMin: 0 });

    expect(
      computeBackfillUpdates({
        current: { strengthMin: 0, cardioMin: 0, runMin: 0 },
        inferred: { strengthMin: 0, cardioMin: 0, runMin: 0 },
        classification: "rest",
      }),
    ).toEqual({});
  });

  it("run-led legacy: moves cardio_min → run_min when run_min is NULL and cardio_min is positive", () => {
    // Wed in the seeded plan, pre-task #74 state: equipment=Tread,
    // sessionType="Run + Accessory", cardio_min=24 (the run minutes
    // misfiled as cardio), run_min=NULL, strength_min=NULL. Inference
    // from distance × pace says run≈22, cardio=0, lift=25.
    expect(
      computeBackfillUpdates({
        current: { strengthMin: null, cardioMin: 24, runMin: null },
        inferred: { strengthMin: 25, cardioMin: 0, runMin: 22 },
        classification: "run-led",
      }),
    ).toEqual({ strengthMin: 25, cardioMin: 0, runMin: 24 });
    // CRITICAL: run_min is the EXISTING cardio_min value (24), not the
    // freshly inferred 22. cardio_min is reset to the inferred 0 so we
    // don't double-count.
  });

  it("run-led with no legacy cardio: uses distance × pace inference for run_min", () => {
    expect(
      computeBackfillUpdates({
        current: { strengthMin: null, cardioMin: null, runMin: null },
        inferred: { strengthMin: 0, cardioMin: 0, runMin: 30 },
        classification: "run-led",
      }),
    ).toEqual({ strengthMin: 0, cardioMin: 0, runMin: 30 });
  });

  it("run-led already migrated: leaves all three columns alone (idempotent)", () => {
    expect(
      computeBackfillUpdates({
        current: { strengthMin: 25, cardioMin: 0, runMin: 24 },
        inferred: { strengthMin: 25, cardioMin: 0, runMin: 22 },
        classification: "run-led",
      }),
    ).toEqual({});
  });

  it("strength-cardio: never touches cardio_min, only fills NULL run_min with 0", () => {
    expect(
      computeBackfillUpdates({
        current: { strengthMin: null, cardioMin: 25, runMin: null },
        inferred: { strengthMin: 45, cardioMin: 25, runMin: 0 },
        classification: "strength-cardio",
      }),
    ).toEqual({ strengthMin: 45, runMin: 0 });
    // cardio_min stays at 25 (genuine cross-train), strength_min filled.
  });

  it("ambiguous: only fills NULL columns when inference is confident", () => {
    expect(
      computeBackfillUpdates({
        current: { strengthMin: null, cardioMin: null, runMin: null },
        inferred: { strengthMin: null, cardioMin: null, runMin: null },
        classification: "ambiguous",
      }),
    ).toEqual({});

    expect(
      computeBackfillUpdates({
        current: { strengthMin: null, cardioMin: null, runMin: null },
        inferred: { strengthMin: 30, cardioMin: null, runMin: null },
        classification: "ambiguous",
      }),
    ).toEqual({ strengthMin: 30 });
  });

  it("seed mirrors: applies the same classification-aware rules to the seed snapshot", () => {
    // Edited row whose seed snapshot was a legacy run-led day.
    expect(
      computeBackfillUpdates({
        current: { strengthMin: 30, cardioMin: 0, runMin: 22 },
        inferred: { strengthMin: 30, cardioMin: 0, runMin: 22 },
        classification: "run-led",
        seed: { strengthMin: null, cardioMin: 24, runMin: null },
        inferredSeed: { strengthMin: 25, cardioMin: 0, runMin: 22 },
        seedClassification: "run-led",
      }),
    ).toEqual({
      seedStrengthMin: 25,
      seedCardioMin: 0,
      seedRunMin: 24,
    });
  });
});
