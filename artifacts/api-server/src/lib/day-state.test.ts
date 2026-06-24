import { describe, it, expect } from "vitest";
import { localToday, dayState } from "./day-state";

describe("localToday (Phase 9 local-day boundary)", () => {
  it("uses the runner's local calendar date, not UTC, for an evening log", () => {
    // 02:30 UTC on the 24th is still 21:30 on the 23rd in America/Chicago (CDT,
    // UTC-5). The old UTC math would call this the 24th and show an empty day.
    const now = new Date("2026-06-24T02:30:00Z");
    expect(localToday("America/Chicago", now)).toBe("2026-06-23");
    expect(now.toISOString().slice(0, 10)).toBe("2026-06-24"); // the old (wrong) value
  });

  it("falls back to UTC when no timezone is set", () => {
    const now = new Date("2026-06-24T02:30:00Z");
    expect(localToday(null, now)).toBe("2026-06-24");
    expect(localToday("", now)).toBe("2026-06-24");
  });

  it("falls back to UTC for an invalid timezone string", () => {
    const now = new Date("2026-06-24T02:30:00Z");
    expect(localToday("Not/AZone", now)).toBe("2026-06-24");
  });
});

describe("dayState (Phase 9 open/closed + pace context)", () => {
  it("midday partial log reads as TODAY and OPEN — never a failure verdict", () => {
    // 17:00 UTC = 12:00 noon in America/Chicago.
    const now = new Date("2026-06-24T17:00:00Z");
    const s = dayState("America/Chicago", {}, now);
    expect(s.localDate).toBe("2026-06-24");
    expect(s.localHour).toBe(12);
    expect(s.isToday).toBe(true);
    expect(s.isClosed).toBe(false); // open → coach by pace, not a verdict
    expect(s.fractionOfDayElapsed).toBeCloseTo(0.5, 2);
  });

  it("a past calendar date is closed (verdict allowed)", () => {
    const now = new Date("2026-06-24T17:00:00Z");
    const s = dayState("America/Chicago", { date: "2026-06-22" }, now);
    expect(s.isToday).toBe(false);
    expect(s.isClosed).toBe(true);
  });

  it("an explicitly closed day is closed even when it is today", () => {
    const now = new Date("2026-06-24T17:00:00Z");
    const s = dayState(
      "America/Chicago",
      { date: "2026-06-24", closedAt: new Date("2026-06-24T16:00:00Z") },
      now,
    );
    expect(s.isToday).toBe(true);
    expect(s.isClosed).toBe(true);
  });

  it("late-evening local time reports a high fraction of the day elapsed", () => {
    // 02:30 UTC = 21:30 CDT on the prior local day.
    const now = new Date("2026-06-24T02:30:00Z");
    const s = dayState("America/Chicago", {}, now);
    expect(s.localDate).toBe("2026-06-23");
    expect(s.localHour).toBe(21);
    expect(s.fractionOfDayElapsed).toBeGreaterThan(0.85);
    expect(s.isClosed).toBe(false); // still the current local day → open
  });
});
