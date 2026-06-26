import { describe, it, expect } from "vitest";
import { buildWeek } from "@/components/insights/week-structure";
import type { AlcoholDay } from "@/components/insights/types";

const day = (date: string, drinks: number, isDry: boolean, logged = true): AlcoholDay => ({
  date,
  drinks,
  isDry,
  logged,
});

describe("buildWeek", () => {
  it("returns a bare Mon–Sun scaffold with Mon–Thu as targets when empty", () => {
    const week = buildWeek([]);
    expect(week).toHaveLength(7);
    expect(week.map((c) => c.label)).toEqual(["M", "T", "W", "T", "F", "S", "S"]);
    expect(week.map((c) => c.isTarget)).toEqual([true, true, true, true, false, false, false]);
    expect(week.every((c) => c.state === "upcoming")).toBe(true);
  });

  it("anchors the strip's last day as today, with past/upcoming around it", () => {
    // Weekday-agnostic: assert by date, not by grid index.
    const today = "2099-07-01";
    const week = buildWeek([day("2099-06-30", 2, false), day(today, 0, true)]);
    const todayCell = week.find((c) => c.date === today)!;
    expect(todayCell.state).toBe("today");
    expect(todayCell.isDry).toBe(true);
    // Exactly one "today"; every dated cell after it is upcoming, before it past.
    expect(week.filter((c) => c.state === "today")).toHaveLength(1);
    for (const c of week) {
      if (!c.date) continue;
      if (c.date > today) expect(c.state).toBe("upcoming");
      if (c.date < today) expect(c.state).toBe("past");
    }
    // The drinking day, if it falls in this Mon–Sun window, carries its value.
    const drinkCell = week.find((c) => c.date === "2099-06-30");
    if (drinkCell) expect(drinkCell.drinks).toBe(2);
  });
});
