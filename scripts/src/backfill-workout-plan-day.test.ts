import { describe, expect, it } from "vitest";
import { pickBestPlanDayId } from "./backfill-workout-plan-day";

const candidate = (
  id: number,
  sessionType: string,
  equipment: string,
  sourceEntryIndex = 0,
) => ({ id, sessionType, equipment, sourceEntryIndex });

describe("pickBestPlanDayId", () => {
  it("returns null when no plan_days exist on the date", () => {
    expect(
      pickBestPlanDayId({ sessionType: "Strength", equipment: "Tonal" }, []),
    ).toBeNull();
  });

  it("returns the only candidate when one plan_day exists on the date", () => {
    expect(
      pickBestPlanDayId({ sessionType: "Strength", equipment: "Tonal" }, [
        candidate(7, "Easy Run", "Peloton Tread"),
      ]),
    ).toBe(7);
  });

  it("prefers the candidate matching both session_type and equipment", () => {
    expect(
      pickBestPlanDayId({ sessionType: "Strength", equipment: "Tonal" }, [
        candidate(1, "Easy Run", "Peloton Tread", 0),
        candidate(2, "Strength", "Tonal", 1),
      ]),
    ).toBe(2);
  });

  it("prefers session_type match (+2) over equipment-only match (+1)", () => {
    expect(
      pickBestPlanDayId({ sessionType: "Strength", equipment: "Tonal" }, [
        candidate(1, "Easy Run", "Tonal", 0),
        candidate(2, "Strength", "Peloton Bike", 1),
      ]),
    ).toBe(2);
  });

  it("falls back to equipment match when no session_type matches", () => {
    expect(
      pickBestPlanDayId({ sessionType: "Strength", equipment: "Tonal" }, [
        candidate(1, "Easy Run", "Peloton Tread", 0),
        candidate(2, "Long Run", "Tonal", 1),
      ]),
    ).toBe(2);
  });

  it("breaks score ties by lowest source_entry_index (date-only fallback parity)", () => {
    expect(
      pickBestPlanDayId({ sessionType: "Strength", equipment: "Tonal" }, [
        candidate(10, "Long Run", "Outdoor", 1),
        candidate(11, "Easy Run", "Peloton Tread", 0),
      ]),
    ).toBe(11);
  });

  it("breaks ties between two equally-scoring matches by lowest source_entry_index", () => {
    expect(
      pickBestPlanDayId({ sessionType: "Strength", equipment: "Tonal" }, [
        candidate(20, "Strength", "Tonal", 2),
        candidate(21, "Strength", "Tonal", 0),
        candidate(22, "Strength", "Tonal", 1),
      ]),
    ).toBe(21);
  });

  it("picks the better-scoring higher-index candidate over a worse-scoring lower-index one", () => {
    // Lift-priority program at index 0 has Easy Run that day; the
    // running program at index 1 has the Strength + Tonal session that
    // actually matches the logged workout. The backfill must NOT just
    // default to index 0.
    expect(
      pickBestPlanDayId({ sessionType: "Strength", equipment: "Tonal" }, [
        candidate(30, "Easy Run", "Peloton Tread", 0),
        candidate(31, "Strength", "Tonal", 1),
      ]),
    ).toBe(31);
  });
});
