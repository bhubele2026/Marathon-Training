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
import type { PlanDayRow, WorkoutRow } from "@workspace/db";
import { computeTotalMin, toPlanDay, toWorkout } from "./transforms";

function makeWorkoutRow(overrides: Partial<WorkoutRow> = {}): WorkoutRow {
  return {
    id: 1,
    planDayId: null,
    date: "2026-05-05",
    equipment: "Outdoor",
    equipmentList: ["Outdoor"],
    sessionType: "Long Run",
    durationMin: 60,
    strengthMin: null,
    cardioMin: null,
    runMin: 60,
    distanceMi: 6,
    pace: "10:00",
    avgHr: 145,
    rpe: 6,
    strengthLoad: null,
    totalLoad: 60,
    notes: null,
    timeOfDay: null,
    modality: "Cardio",
    sourceKey: null,
    seedSessionType: null,
    seedEquipment: null,
    seedEquipmentList: null,
    seedDurationMin: null,
    seedStrengthMin: null,
    seedCardioMin: null,
    seedRunMin: null,
    seedDistanceMi: null,
    seedPace: null,
    seedAvgHr: null,
    seedRpe: null,
    seedStrengthLoad: null,
    seedTotalLoad: null,
    seedNotes: null,
    seedTimeOfDay: null,
    seedModality: null,
    createdAt: new Date("2026-05-05T12:00:00Z"),
    ...overrides,
  };
}

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
    plannedLoad: null,
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
    sourceEntryIndex: 0,
    sourceEntryLabel: null,
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
    expect(out.customizedDiff).toEqual([]);
  });

  it("emits a customizedDiff entry per changed field with stringified before/after values", () => {
    const row = makeRow({
      sessionType: "Run + Accessory",
      strengthMin: 30,
      distanceMi: 4,
      pace: "9:30",
      isRest: false,
      seedSessionType: "Strength + Cardio",
      seedEquipment: "Tonal",
      seedDescription: "Heavy upper-body Tonal",
      seedDistanceMi: null,
      seedStrengthMin: 45,
      seedCardioMin: 0,
      seedRunMin: 0,
      seedPace: null,
      seedStrengthLoad: 60,
      seedTotalLoad: 85,
      seedIsRest: false,
    });
    const out = toPlanDay(row);
    expect(out.customizedDiff.length).toBe(out.customizedFields.length);
    const byField = new Map(out.customizedDiff.map((d) => [d.field, d]));
    expect(byField.get("sessionType")).toEqual({
      field: "sessionType",
      before: "Strength + Cardio",
      after: "Run + Accessory",
    });
    expect(byField.get("strengthMin")).toEqual({
      field: "strengthMin",
      before: "45",
      after: "30",
    });
    expect(byField.get("distanceMi")).toEqual({
      field: "distanceMi",
      before: null,
      after: "4",
    });
    expect(byField.get("pace")).toEqual({
      field: "pace",
      before: null,
      after: "9:30",
    });
  });

  // Regression for the equipment-rail null asymmetry fixed in task #77:
  // before the fix, a row whose live `equipmentList` had been backfilled to
  // `[scalar]` while the seed snapshot still held NULL (or vice versa) would
  // be falsely flagged as customized on the chip rail, even though both
  // sides round-trip through the same `?? [scalar]` fallback in toPlanDay
  // and therefore render identically. Lock that invariant in place against
  // future refactors of the diff helper by exercising all four NULL/non-NULL
  // permutations against a single-element list of the matching scalar.
  it("does NOT flag equipmentList as customized when one side is NULL and the other is [scalar]", () => {
    const seedSnapshot = {
      seedSessionType: "Strength + Cardio" as const,
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
    };

    const liveNullSeedList = toPlanDay(
      makeRow({
        equipmentList: null,
        ...seedSnapshot,
        seedEquipmentList: ["Tonal"],
      }),
    );
    const liveListSeedNull = toPlanDay(
      makeRow({
        equipmentList: ["Tonal"],
        ...seedSnapshot,
        seedEquipmentList: null,
      }),
    );
    const bothNull = toPlanDay(
      makeRow({
        equipmentList: null,
        ...seedSnapshot,
        seedEquipmentList: null,
      }),
    );
    const bothEqual = toPlanDay(
      makeRow({
        equipmentList: ["Tonal"],
        ...seedSnapshot,
        seedEquipmentList: ["Tonal"],
      }),
    );

    expect(liveNullSeedList.customizedFields).not.toContain("equipmentList");
    expect(liveListSeedNull.customizedFields).not.toContain("equipmentList");
    expect(bothNull.customizedFields).not.toContain("equipmentList");
    expect(bothEqual.customizedFields).not.toContain("equipmentList");
  });
});

// Task #270: same diff treatment for logged workouts so the Training Log
// can render an "Edited" badge when a runner adjusts a previously-logged
// session.
describe("toWorkout customized diff", () => {
  it("returns isCustomized=false and empty diff arrays when the row has never been edited", () => {
    const out = toWorkout(makeWorkoutRow({ seedSessionType: null }));
    expect(out.isCustomized).toBe(false);
    expect(out.customizedFields).toEqual([]);
    expect(out.customizedDiff).toEqual([]);
  });

  it("flags every changed mutable field once the seed snapshot is populated", () => {
    const out = toWorkout(
      makeWorkoutRow({
        sessionType: "Tempo",
        equipment: "Peloton Tread",
        equipmentList: ["Peloton Tread"],
        durationMin: 50,
        runMin: 50,
        distanceMi: 5,
        pace: "9:30",
        avgHr: 162,
        rpe: 8,
        notes: "felt strong",
        modality: "Cardio",
        // Original snapshot from the first edit — values match the
        // makeWorkoutRow defaults at the time of creation.
        seedSessionType: "Long Run",
        seedEquipment: "Outdoor",
        seedEquipmentList: ["Outdoor"],
        seedDurationMin: 60,
        seedStrengthMin: null,
        seedCardioMin: null,
        seedRunMin: 60,
        seedDistanceMi: 6,
        seedPace: "10:00",
        seedAvgHr: 145,
        seedRpe: 6,
        seedStrengthLoad: null,
        seedTotalLoad: 60,
        seedNotes: null,
        seedTimeOfDay: null,
        seedModality: "Cardio",
      }),
    );
    expect(out.isCustomized).toBe(true);
    // Modality didn't change; everything else listed should be flagged.
    expect(out.customizedFields).toEqual(
      expect.arrayContaining([
        "sessionType",
        "equipment",
        "equipmentList",
        "durationMin",
        "runMin",
        "distanceMi",
        "pace",
        "avgHr",
        "rpe",
        "notes",
      ]),
    );
    expect(out.customizedFields).not.toContain("modality");
    expect(out.customizedDiff.length).toBe(out.customizedFields.length);
    const byField = new Map(out.customizedDiff.map((d) => [d.field, d]));
    expect(byField.get("distanceMi")).toEqual({
      field: "distanceMi",
      before: "6",
      after: "5",
    });
    expect(byField.get("pace")).toEqual({
      field: "pace",
      before: "10:00",
      after: "9:30",
    });
    expect(byField.get("notes")).toEqual({
      field: "notes",
      before: null,
      after: "felt strong",
    });
  });
});
