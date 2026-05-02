import { describe, expect, it } from "vitest";
import { computeWorkoutEquipmentBackfillUpdates } from "./backfill-workout-equipment";

describe("computeWorkoutEquipmentBackfillUpdates", () => {
  it("populates equipment_list from the scalar when NULL", () => {
    expect(
      computeWorkoutEquipmentBackfillUpdates({
        equipment: "Tonal",
        equipmentList: null,
      }),
    ).toEqual({ equipmentList: ["Tonal"] });
  });

  it("repairs an empty equipment_list array", () => {
    expect(
      computeWorkoutEquipmentBackfillUpdates({
        equipment: "Peloton Tread",
        equipmentList: [],
      }),
    ).toEqual({ equipmentList: ["Peloton Tread"] });
  });

  it("skips rows already populated with a single chip", () => {
    expect(
      computeWorkoutEquipmentBackfillUpdates({
        equipment: "Tonal",
        equipmentList: ["Tonal"],
      }),
    ).toEqual({});
  });

  it("preserves a multi-machine rail (does not collapse it back to the scalar)", () => {
    expect(
      computeWorkoutEquipmentBackfillUpdates({
        equipment: "Tonal",
        equipmentList: ["Tonal", "Peloton Bike"],
      }),
    ).toEqual({});
  });

  it("handles a None / Skipped row by lifting the scalar", () => {
    expect(
      computeWorkoutEquipmentBackfillUpdates({
        equipment: "None",
        equipmentList: null,
      }),
    ).toEqual({ equipmentList: ["None"] });
  });
});
