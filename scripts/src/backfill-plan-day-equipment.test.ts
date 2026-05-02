// Unit tests for the equipment_list backfill (task #77). Per the task
// contract the parser builds `[scalar equipment, ...secondary machines in
// order of appearance in the description]`, deduped, so legacy rows
// preserve their existing scalar at index 0. The wrapper around the
// parser only writes equipment_list when it's NULL, and only writes
// seed_equipment_list when the row carries an "edited" marker.

import { describe, expect, it } from "vitest";
import {
  computeEquipmentBackfillUpdates,
  parseEquipmentList,
} from "./backfill-plan-day-equipment";

describe("parseEquipmentList", () => {
  it("emits scalar Tonal first then the cardio machine for a Tue heavy + bike day", () => {
    expect(
      parseEquipmentList({
        description:
          "Heavy upper-body Tonal (45 min, push/pull at 80-85% effort), then 25 min easy Peloton Bike spin",
        equipment: "Tonal",
      }),
    ).toEqual(["Tonal", "Peloton Bike"]);
  });

  it("preserves a legacy scalar Peloton Tread at index 0 then appends Tonal in order of appearance for a Wed run-with-accessory day", () => {
    // Legacy DB rows inserted before task #77 have `equipment = "Peloton
    // Tread"` on Wed (the run was treated as the headline activity). The
    // backfill must keep that scalar at index 0 so any code reading the
    // scalar stays consistent with `equipmentList[0]`. Tonal is mentioned
    // later in the description, so it appears second in the rail.
    expect(
      parseEquipmentList({
        description:
          "Easy aerobic Tread run (3 mi, fully conversational pace), then 25 min Tonal core + accessory work",
        equipment: "Peloton Tread",
      }),
    ).toEqual(["Peloton Tread", "Tonal"]);
  });

  it("returns a single Peloton Tread chip for a tempo Fri with no Tonal accessory", () => {
    expect(
      parseEquipmentList({
        description:
          "Tread tempo (4 mi: 5 min easy, 16 min steady tempo, 5 min cool-down) — no lift today, recover for the long run",
        equipment: "Peloton Tread",
      }),
    ).toEqual(["Peloton Tread"]);
  });

  it("returns a single Outdoor chip for race day", () => {
    expect(
      parseEquipmentList({
        description:
          "RACE DAY — Half Marathon (13.1 mi). Execute race plan, fuel every 4 mi, finish strong.",
        equipment: "Outdoor",
      }),
    ).toEqual(["Outdoor"]);
  });

  it("falls back to [equipment] when no known secondary machine name appears in the description", () => {
    expect(
      parseEquipmentList({
        description: "Full rest day. Optional 20 min walk, foam roll, mobility, hydrate.",
        equipment: "Off / Rest",
      }),
    ).toEqual(["Off / Rest"]);
  });

  it("dedupes the scalar so it never repeats when the description also names it", () => {
    expect(
      parseEquipmentList({
        description: "Heavy Tonal then easy Peloton Bike spin",
        equipment: "Tonal",
      }),
    ).toEqual(["Tonal", "Peloton Bike"]);
  });

  // Regression coverage: the bare word "race" is not enough to add an
  // Outdoor chip. Treadmill workouts and the Saturday race-eve session
  // mention "race" in phrases like "race-pace", "Race-eve",
  // "race tomorrow" while still being indoor sessions, and adding a
  // bogus OUTDOOR chip there would mislead the runner about which gear
  // to grab.
  it("does NOT add Outdoor for a Tread race-pace workout", () => {
    expect(
      parseEquipmentList({
        description:
          "Tread race-pace (5 mi: warm-up, 3 x 1 mi at goal half-marathon pace w/ 2 min recovery, cool-down) — no lift today, recover for the long run",
        equipment: "Peloton Tread",
      }),
    ).toEqual(["Peloton Tread"]);
  });

  it("does NOT add Outdoor for a race-eve Tonal + Peloton Bike session", () => {
    expect(
      parseEquipmentList({
        description:
          "Race-eve: light Tonal mobility (15 min) + 15 min easy Peloton Bike spin. Stay loose, hydrate, fuel well.",
        equipment: "Tonal",
      }),
    ).toEqual(["Tonal", "Peloton Bike"]);
  });

  it("does NOT add Outdoor for a race-week Fri shakeout that mentions 'race tomorrow'", () => {
    expect(
      parseEquipmentList({
        description:
          "Easy Tread shakeout (3 mi) with 3 x 30s strides — no lift today, race tomorrow",
        equipment: "Peloton Tread",
      }),
    ).toEqual(["Peloton Tread"]);
  });

  it("DOES add Outdoor for the literal RACE DAY banner", () => {
    expect(
      parseEquipmentList({
        description:
          "RACE DAY — Half Marathon (13.1 mi). Execute race plan, fuel every 4 mi, finish strong.",
        equipment: "Outdoor",
      }),
    ).toEqual(["Outdoor"]);
  });

  it("DOES add Outdoor when the prose explicitly says 'outside'", () => {
    expect(
      parseEquipmentList({
        description: "Long aerobic run outside (10 mi): conversational pace.",
        equipment: "Peloton Tread",
      }),
    ).toEqual(["Peloton Tread", "Outdoor"]);
  });
});

describe("computeEquipmentBackfillUpdates", () => {
  const baseRow = {
    equipment: "Tonal",
    description: "Heavy Tonal then Peloton Bike",
    equipmentList: null,
    seedSessionType: null,
    seedEquipment: null,
    seedDescription: null,
    seedEquipmentList: null,
  };

  it("populates equipment_list when NULL", () => {
    expect(computeEquipmentBackfillUpdates(baseRow)).toEqual({
      equipmentList: ["Tonal", "Peloton Bike"],
    });
  });

  it("skips equipment_list when already populated", () => {
    expect(
      computeEquipmentBackfillUpdates({
        ...baseRow,
        equipmentList: ["Tonal", "Peloton Bike"],
      }),
    ).toEqual({});
  });

  it("populates seed_equipment_list only when an edited marker exists and the seed mirror is null", () => {
    expect(
      computeEquipmentBackfillUpdates({
        ...baseRow,
        equipmentList: ["Tonal", "Peloton Bike"],
        seedSessionType: "Strength + Cardio",
        seedEquipment: "Tonal",
        seedDescription: "Heavy Tonal then Peloton Row",
        seedEquipmentList: null,
      }),
    ).toEqual({ seedEquipmentList: ["Tonal", "Peloton Row"] });
  });

  it("leaves seed_equipment_list alone when the row has never been edited", () => {
    expect(
      computeEquipmentBackfillUpdates({
        ...baseRow,
        equipmentList: ["Tonal", "Peloton Bike"],
        seedSessionType: null,
        seedEquipmentList: null,
      }),
    ).toEqual({});
  });
});
