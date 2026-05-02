// Asserts the per-day strength_min / cardio_min / run_min values that the
// canonical generator emits for the seeded 52-week plan. This is the
// upstream source of truth for the new TOTAL · LIFT · CARDIO · RUN
// breakdown — if the generator regresses (drops a bucket, double-counts,
// misclassifies a Tonal day as a run-led day), the UI tile is wrong on
// every page that renders it. Locked in here so a future generator tweak
// can't silently break the contract.

import { describe, expect, it } from "vitest";
import { generatePlan, type DailyRow } from "@workspace/plan-generator";

const PLAN = generatePlan();

function dayOf(week: number, day: string): DailyRow {
  const row = PLAN.daily.find((d) => d.week === week && d.day === day);
  if (!row) throw new Error(`No row for week ${week} ${day}`);
  return row;
}

describe("generator: per-day minute breakdown", () => {
  it("MON is a clean rest day with all three minute buckets at 0", () => {
    const mon = dayOf(1, "Mon");
    expect(mon.is_rest).toBe(true);
    expect(mon.strength_min).toBe(0);
    expect(mon.cardio_min).toBe(0);
    expect(mon.run_min).toBe(0);
  });

  it("TUE / THU / SAT are 'Strength + Cardio' days with non-zero lift + non-zero cross-train and zero run", () => {
    for (const day of ["Tue", "Thu", "Sat"] as const) {
      const row = dayOf(1, day);
      expect(row.session_type).toMatch(/Strength \+ Cardio/);
      expect(row.strength_min).toBeGreaterThan(0);
      expect(row.cardio_min).toBeGreaterThan(0);
      expect(row.run_min).toBe(0);
    }
  });

  it("WED is a 'Run + Accessory' day with non-zero lift + zero cross-train + non-zero run", () => {
    const wed = dayOf(1, "Wed");
    expect(wed.session_type).toBe("Run + Accessory");
    expect(wed.strength_min).toBeGreaterThan(0);
    expect(wed.cardio_min).toBe(0);
    expect(wed.run_min).toBeGreaterThan(0);
    expect(wed.distance_mi).toBeGreaterThan(0);
  });

  it("FRI in the foundation phase keeps lift accessory minutes; FRI from week 7 onward drops lift and is run-only", () => {
    const friFoundation = dayOf(3, "Fri");
    expect(friFoundation.session_type).toMatch(/Aerobic Base \+ Accessory/);
    expect(friFoundation.strength_min).toBeGreaterThan(0);
    expect(friFoundation.cardio_min).toBe(0);
    expect(friFoundation.run_min).toBeGreaterThan(0);

    const friBuild = dayOf(12, "Fri");
    expect(friBuild.strength_min).toBe(0);
    expect(friBuild.cardio_min).toBe(0);
    expect(friBuild.run_min).toBeGreaterThan(0);
  });

  it("SUN long-run weeks zero lift and cardio; run minutes derive from distance × pace", () => {
    const sun = dayOf(2, "Sun");
    expect(sun.session_type).toBe("Long Run");
    expect(sun.strength_min).toBe(0);
    expect(sun.cardio_min).toBe(0);
    expect(sun.run_min).toBeGreaterThan(0);
    expect(sun.distance_mi).toBeGreaterThan(0);
  });

  it("SUN race week is a run-only Race day with no lift / cardio bucket", () => {
    const raceSun = dayOf(52, "Sun");
    expect(raceSun.session_type).toBe("Race");
    expect(raceSun.strength_min).toBe(0);
    expect(raceSun.cardio_min).toBe(0);
    expect(raceSun.run_min).toBeGreaterThan(120);
  });

  it("never emits NULLs for any of the three minute buckets across all 52 weeks", () => {
    for (const row of PLAN.daily) {
      expect(row.strength_min, `${row.date} ${row.day} strength_min`).not.toBeNull();
      expect(row.cardio_min, `${row.date} ${row.day} cardio_min`).not.toBeNull();
      expect(row.run_min, `${row.date} ${row.day} run_min`).not.toBeNull();
    }
  });

  it("emits the canonical equipment_list chip rail for every day", () => {
    // Mon = rest (single chip)
    expect(dayOf(1, "Mon").equipment_list).toEqual(["Off / Rest"]);

    // Tue = Tonal + Peloton Bike
    expect(dayOf(1, "Tue").equipment_list).toEqual(["Tonal", "Peloton Bike"]);

    // Wed = Tonal accessory + Peloton Tread. Task #77 contract: scalar
    // `equipment` always equals `equipment_list[0]` (the primary machine).
    expect(dayOf(1, "Wed").equipment_list).toEqual(["Tonal", "Peloton Tread"]);
    expect(dayOf(1, "Wed").equipment).toBe("Tonal");

    // Thu = Tonal + Peloton Row
    expect(dayOf(1, "Thu").equipment_list).toEqual(["Tonal", "Peloton Row"]);

    // Foundation Fri (W1-6) pairs Tonal accessory with the Tread run.
    expect(dayOf(3, "Fri").equipment_list).toEqual(["Tonal", "Peloton Tread"]);

    // Build-phase Fri (W7+) drops the Tonal accessory.
    expect(dayOf(12, "Fri").equipment_list).toEqual(["Peloton Tread"]);

    // Sat alternates Bike (odd) / Row (even) as the cardio chip after Tonal.
    expect(dayOf(1, "Sat").equipment_list).toEqual(["Tonal", "Peloton Bike"]);
    expect(dayOf(2, "Sat").equipment_list).toEqual(["Tonal", "Peloton Row"]);

    // Sun long-run weeks emit the single long-run equipment chip.
    expect(dayOf(2, "Sun").equipment_list).toEqual(["Outdoor"]);
    expect(dayOf(3, "Sun").equipment_list).toEqual(["Peloton Tread"]);

    // Race week Sunday is Outdoor only.
    expect(dayOf(52, "Sun").equipment_list).toEqual(["Outdoor"]);
  });

  it("keeps the scalar `equipment` aligned with `equipment_list[0]` for every generated day (task #77 contract)", () => {
    // The scalar `equipment` is the back-compat handle for any code path
    // that still reads a single value (dashboard, suggestions pairKey,
    // /equipment). Per the task #77 contract it must always equal the
    // primary chip — i.e. `equipment_list[0]` — so the legacy view and
    // the new chip rail never disagree about which machine leads the day.
    for (const row of PLAN.daily) {
      expect(
        row.equipment_list[0],
        `${row.date} ${row.day} primary chip`,
      ).toBe(row.equipment);
    }
  });

  it("weekly planned_cardio sums NON-running cross-train minutes only (run minutes already live in planned_miles)", () => {
    for (const wk of PLAN.weekly) {
      const dailyCardioSum = PLAN.daily
        .filter((d) => d.week === wk.week)
        .reduce((s, d) => s + (d.cardio_min || 0), 0);
      expect(wk.planned_cardio, `week ${wk.week} planned_cardio`).toBe(
        dailyCardioSum,
      );
    }
  });
});
