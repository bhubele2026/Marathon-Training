// Focused unit tests for the plan-day transform layer added in task #74:
//   * `computeTotalMin` returns null when ALL three buckets are null
//     (ambiguous legacy row the backfill couldn't classify) so the UI
//     hides the breakdown rather than rendering a misleading "0 min".
//     Otherwise sums and treats individual-bucket nulls as 0.
//   * `toPlanDay` exposes the full breakdown (strengthMin / cardioMin /
//     runMin / totalMin) on the API contract so the UI tile is stable.
//   * `isCustomized` / `customizedFields` correctly flag the new
//     strengthMin and runMin columns so the "Edited" badge surfaces minute
//     edits the same way it does for distance / load edits.

import { describe, it, expect } from "vitest";
import type { PlanDayRow } from "@workspace/db";
import { computeTotalMin, toPlanDay } from "./transforms";

function makeRow(overrides: Partial<PlanDayRow> = {}): PlanDayRow {
  return {
    id: 1,
    week: 1,
    phase: "Foundation Build",
    date: "2026-05-05",
    day: "Tue",
    strengthLoad: 60,
    equipment: "Tonal",
    equipmentList: ["Tonal", "Peloton Bike"],
    description: "Heavy upper-body Tonal",
    strengthMin: 45,
    cardioMin: 25,
    runMin: 0,
    distanceMi: null,
    pace: null,
    sessionType: "Strength + Cardio",
    isRest: false,
    totalLoad: 85,
    seedSessionType: null,
    seedEquipment: null,
    seedEquipmentList: null,
    seedDescription: null,
    seedDistanceMi: null,
    seedStrengthMin: null,
    seedCardioMin: null,
    seedRunMin: null,
    seedPace: null,
    seedStrengthLoad: null,
    seedTotalLoad: null,
    seedIsRest: null,
    ...overrides,
  };
}

describe("computeTotalMin", () => {
  it("sums all three minute buckets", () => {
    expect(
      computeTotalMin({ strengthMin: 45, cardioMin: 25, runMin: 0 }),
    ).toBe(70);
    expect(
      computeTotalMin({ strengthMin: 25, cardioMin: 0, runMin: 36 }),
    ).toBe(61);
    expect(
      computeTotalMin({ strengthMin: 0, cardioMin: 0, runMin: 157 }),
    ).toBe(157);
  });

  it("treats individual-bucket nulls as zero when at least one bucket is known", () => {
    expect(
      computeTotalMin({ strengthMin: null, cardioMin: 25, runMin: null }),
    ).toBe(25);
    expect(
      computeTotalMin({ strengthMin: 0, cardioMin: null, runMin: null }),
    ).toBe(0);
  });

  it("returns null when ALL three buckets are null so the UI can distinguish 'unknown' from a clean 0", () => {
    expect(
      computeTotalMin({ strengthMin: null, cardioMin: null, runMin: null }),
    ).toBeNull();
  });
});

describe("toPlanDay", () => {
  it("exposes all three minute buckets and the server-computed totalMin", () => {
    const row = makeRow({ strengthMin: 25, cardioMin: 0, runMin: 36 });
    const out = toPlanDay(row);
    expect(out.strengthMin).toBe(25);
    expect(out.cardioMin).toBe(0);
    expect(out.runMin).toBe(36);
    expect(out.totalMin).toBe(61);
  });

  it("flags strengthMin as customized when it diverges from the seed snapshot", () => {
    const row = makeRow({
      strengthMin: 30,
      seedSessionType: "Strength + Cardio",
      seedEquipment: "Tonal",
      seedDescription: "Heavy upper-body Tonal",
      seedDistanceMi: null,
      seedStrengthMin: 45,
      seedCardioMin: 25,
      seedRunMin: 0,
      seedPace: null,
      seedStrengthLoad: 60,
      seedTotalLoad: 85,
      seedIsRest: false,
    });
    const out = toPlanDay(row);
    expect(out.isCustomized).toBe(true);
    expect(out.customizedFields).toContain("strengthMin");
    expect(out.customizedFields).not.toContain("cardioMin");
    expect(out.customizedFields).not.toContain("runMin");
  });

  it("flags runMin and cardioMin as customized when they diverge from the seed snapshot", () => {
    const row = makeRow({
      sessionType: "Run + Accessory",
      equipment: "Peloton Tread",
      description: "easy 3 mi",
      strengthMin: 25,
      cardioMin: 10,
      runMin: 40,
      distanceMi: 3,
      strengthLoad: 25,
      totalLoad: 65,
      seedSessionType: "Run + Accessory",
      seedEquipment: "Peloton Tread",
      seedDescription: "easy 3 mi",
      seedDistanceMi: 3,
      seedStrengthMin: 25,
      seedCardioMin: 0,
      seedRunMin: 36,
      seedPace: "13:30",
      seedStrengthLoad: 25,
      seedTotalLoad: 61,
      seedIsRest: false,
    });
    const out = toPlanDay(row);
    expect(out.isCustomized).toBe(true);
    expect(out.customizedFields).toContain("cardioMin");
    expect(out.customizedFields).toContain("runMin");
    expect(out.customizedFields).not.toContain("strengthMin");
  });

  it("returns isCustomized=false and an empty customizedFields when the seed snapshot has never been recorded", () => {
    const out = toPlanDay(makeRow({ seedSessionType: null }));
    expect(out.isCustomized).toBe(false);
    expect(out.customizedFields).toEqual([]);
  });
});
