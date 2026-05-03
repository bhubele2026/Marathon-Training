import { describe, it, expect } from "vitest";
import { sortWorkoutsByTimeOfDay, defaultTimeOfDayForNow } from "./time-of-day";

type TestWorkout = {
  id: number;
  timeOfDay: "AM" | "PM" | "Other" | string | null;
  createdAt: string;
};

const w = (
  id: number,
  timeOfDay: TestWorkout["timeOfDay"],
  createdAt: string,
): TestWorkout => ({ id, timeOfDay, createdAt });

describe("sortWorkoutsByTimeOfDay", () => {
  it("places AM before PM regardless of createdAt", () => {
    const list = [
      w(1, "PM", "2025-01-01T07:00:00Z"),
      w(2, "AM", "2025-01-01T20:00:00Z"),
    ];
    const sorted = sortWorkoutsByTimeOfDay(list);
    expect(sorted.map((x) => x.id)).toEqual([2, 1]);
  });

  it("orders AM, PM, Other, then untagged", () => {
    const list = [
      w(1, null, "2025-01-01T06:00:00Z"),
      w(2, "Other", "2025-01-01T07:00:00Z"),
      w(3, "PM", "2025-01-01T08:00:00Z"),
      w(4, "AM", "2025-01-01T09:00:00Z"),
    ];
    sortWorkoutsByTimeOfDay(list);
    expect(list.map((x) => x.id)).toEqual([4, 3, 2, 1]);
  });

  it("breaks ties within the same slot by createdAt ascending", () => {
    const list = [
      w(1, "AM", "2025-01-01T09:00:00Z"),
      w(2, "AM", "2025-01-01T07:00:00Z"),
      w(3, "AM", "2025-01-01T08:00:00Z"),
    ];
    sortWorkoutsByTimeOfDay(list);
    expect(list.map((x) => x.id)).toEqual([2, 3, 1]);
  });

  it("handles missing timeOfDay (null and undefined) by ranking them last", () => {
    const list = [
      w(1, undefined as unknown as null, "2025-01-01T06:00:00Z"),
      w(2, null, "2025-01-01T05:00:00Z"),
      w(3, "PM", "2025-01-01T22:00:00Z"),
    ];
    sortWorkoutsByTimeOfDay(list);
    expect(list[0]!.id).toBe(3);
    expect(new Set([list[1]!.id, list[2]!.id])).toEqual(new Set([1, 2]));
  });

  it("treats unknown timeOfDay strings as untagged (rank 3)", () => {
    const list = [
      w(1, "Evening", "2025-01-01T06:00:00Z"),
      w(2, "AM", "2025-01-01T22:00:00Z"),
    ];
    sortWorkoutsByTimeOfDay(list);
    expect(list.map((x) => x.id)).toEqual([2, 1]);
  });

  it("returns the same array reference (in-place sort)", () => {
    const list = [w(1, "PM", "2025-01-01T07:00:00Z"), w(2, "AM", "2025-01-01T08:00:00Z")];
    const result = sortWorkoutsByTimeOfDay(list);
    expect(result).toBe(list);
  });

  it("is stable for fully-tied rows", () => {
    const list = [
      w(1, "AM", "2025-01-01T09:00:00Z"),
      w(2, "AM", "2025-01-01T09:00:00Z"),
      w(3, "AM", "2025-01-01T09:00:00Z"),
    ];
    sortWorkoutsByTimeOfDay(list);
    expect(list.map((x) => x.id)).toEqual([1, 2, 3]);
  });
});

describe("defaultTimeOfDayForNow", () => {
  it("returns AM before noon", () => {
    expect(defaultTimeOfDayForNow(new Date("2025-01-01T08:00:00"))).toBe("AM");
    expect(defaultTimeOfDayForNow(new Date("2025-01-01T11:59:00"))).toBe("AM");
  });

  it("returns PM at and after noon", () => {
    expect(defaultTimeOfDayForNow(new Date("2025-01-01T12:00:00"))).toBe("PM");
    expect(defaultTimeOfDayForNow(new Date("2025-01-01T18:30:00"))).toBe("PM");
  });
});
