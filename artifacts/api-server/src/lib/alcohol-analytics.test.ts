import { describe, it, expect } from "vitest";
import { computeAlcoholStats, DRY_DAYS_TARGET } from "./alcohol-analytics";

// All dates are fixed strings and `today` is an input, so the engine is fully
// deterministic — no clock. We use a far-future test year to stay clear of real
// data windows.

describe("computeAlcoholStats — inactive / seed", () => {
  it("is inactive with no entries and claims no dry days", () => {
    const s = computeAlcoholStats({ today: "2099-07-01", entries: [] });
    expect(s.active).toBe(false);
    expect(s.seedState).toBe(true);
    expect(s.dryDaysThisWeek).toBe(0);
    expect(s.dryDaysTarget).toBe(DRY_DAYS_TARGET);
    expect(s.impact).toEqual([]);
    expect(s.dailyStrip).toHaveLength(7);
  });

  it("is in seed state under ~2 weeks of tracking (no impact precision)", () => {
    const s = computeAlcoholStats({
      today: "2099-07-08",
      entries: [{ date: "2099-07-02", standardDrinks: 2 }], // 7 days tracked
    });
    expect(s.active).toBe(true);
    expect(s.seedState).toBe(true);
    expect(s.impact).toEqual([]);
  });
});

describe("computeAlcoholStats — dry days, strip, streaks", () => {
  // Tracking starts 2099-06-01 (a drink), so all of June is tracked. today has
  // no entry → "pending" (not counted dry). 31 days tracked → not seed.
  const entries = [
    { date: "2099-06-01", standardDrinks: 2 }, // drinking (tracking start)
    { date: "2099-06-15", standardDrinks: 3 }, // drinking
    { date: "2099-06-28", standardDrinks: 1 }, // drinking
  ];
  const s = computeAlcoholStats({ today: "2099-07-01", entries });

  it("infers past zero-drink days as dry and is past seed", () => {
    expect(s.active).toBe(true);
    expect(s.seedState).toBe(false);
    expect(s.daysTracked).toBe(31);
  });

  it("builds a 7-day strip ending today, marking logged vs inferred", () => {
    expect(s.dailyStrip).toHaveLength(7);
    const last = s.dailyStrip[s.dailyStrip.length - 1]!;
    expect(last.date).toBe("2099-07-01");
    // today, no entry → pending: not dry, not logged
    expect(last.isDry).toBe(false);
    expect(last.logged).toBe(false);
    // the drinking day 06-28 is in the strip (06-25..07-01)
    const d28 = s.dailyStrip.find((d) => d.date === "2099-06-28")!;
    expect(d28.drinks).toBe(1);
    expect(d28.isDry).toBe(false);
    expect(d28.logged).toBe(true);
    // a past day with no entry → inferred dry, not logged
    const d26 = s.dailyStrip.find((d) => d.date === "2099-06-26")!;
    expect(d26.isDry).toBe(true);
    expect(d26.logged).toBe(false);
  });

  it("counts the current dry streak back from yesterday (today pending)", () => {
    // 06-29, 06-30 dry; 06-28 was a drink → streak of 2.
    expect(s.currentDryStreak).toBe(2);
  });

  it("finds the longest dry run between drinking days", () => {
    // 06-02..06-14 = 13 dry days.
    expect(s.longestDryStreak).toBe(13);
  });

  it("counts an explicit mark-dry on today toward the streak", () => {
    const marked = computeAlcoholStats({
      today: "2099-07-01",
      entries: [...entries, { date: "2099-07-01", standardDrinks: 0 }],
    });
    const last = marked.dailyStrip[marked.dailyStrip.length - 1]!;
    expect(last.isDry).toBe(true);
    expect(last.logged).toBe(true);
    // 06-29, 06-30, 07-01 → streak 3.
    expect(marked.currentDryStreak).toBe(3);
  });
});

describe("computeAlcoholStats — budget and week-over-week", () => {
  it("derives the drinking budget from the dry-days target", () => {
    const s = computeAlcoholStats({ today: "2099-07-01", entries: [], dryDaysTarget: 5 });
    expect(s.dryDaysTarget).toBe(5);
    expect(s.drinkingBudget).toBe(2);
  });

  it("trends completed weeks and an on-target streak", () => {
    // Mostly-dry weeks (occasional single drinking day) over ~5 weeks.
    const entries = [
      { date: "2099-06-03", standardDrinks: 2 },
      { date: "2099-06-10", standardDrinks: 1 },
      { date: "2099-06-17", standardDrinks: 2 },
      { date: "2099-06-24", standardDrinks: 1 },
      { date: "2099-06-01", standardDrinks: 1 }, // tracking start
    ];
    const s = computeAlcoholStats({ today: "2099-07-01", entries });
    expect(s.weeksTracked).toBeGreaterThan(0);
    // One drinking day/week → 6 dry days/week → every completed week hits the
    // target of 4, so the on-target streak equals the tracked-week count.
    expect(s.weeksOnTarget).toBe(s.weeksTracked);
    expect(s.weeksOnTargetStreak).toBe(s.weeksTracked);
    expect(s.avgDryPerWeek).not.toBeNull();
    expect(s.avgDryPerWeek!).toBeGreaterThanOrEqual(5);
  });
});

describe("computeAlcoholStats — impact comparison (honest)", () => {
  it("reads next-day training load lower after drinking days", () => {
    const entries = [
      { date: "2099-06-10", standardDrinks: 2 }, // drinking start
      { date: "2099-06-17", standardDrinks: 2 }, // drinking
    ];
    const trainingLoadByDate = {
      "2099-06-11": 10, // morning after 06-10 (drinking)
      "2099-06-18": 20, // morning after 06-17 (drinking)
      "2099-06-13": 50, // morning after 06-12 (dry)
      "2099-06-14": 60, // morning after 06-13 (dry)
    };
    const s = computeAlcoholStats({ today: "2099-07-01", entries, trainingLoadByDate });
    expect(s.seedState).toBe(false);
    const load = s.impact.find((i) => i.key === "trainingLoad")!;
    expect(load).toBeTruthy();
    expect(load.drinkingAvg).toBe(15); // (10+20)/2
    expect(load.dryAvg).toBe(55); // (50+60)/2
    expect(load.deltaPct).toBe(-73); // (15-55)/55
    expect(load.betterWhenDry).toBe(true);
    expect(load.note).toMatch(/lower after a drinking day/);
  });
});
