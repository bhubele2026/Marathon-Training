import { describe, it, expect } from "vitest";
import { navyBodyFatPct } from "./body-fat";

describe("navyBodyFatPct", () => {
  it("estimates male body fat from neck + waist + height", () => {
    // 70 in tall, 16 in neck, 38 in waist → ~23% (standard Navy result).
    const pct = navyBodyFatPct({ sex: "male", heightIn: 70, neckIn: 16, waistIn: 38 });
    expect(pct).not.toBeNull();
    expect(pct!).toBeGreaterThan(18);
    expect(pct!).toBeLessThan(28);
  });

  it("defaults to the male formula when sex is unknown", () => {
    const a = navyBodyFatPct({ sex: null, heightIn: 70, neckIn: 16, waistIn: 38 });
    const b = navyBodyFatPct({ sex: "male", heightIn: 70, neckIn: 16, waistIn: 38 });
    expect(a).toBe(b);
  });

  it("uses the women's formula and requires a hip measurement", () => {
    expect(
      navyBodyFatPct({ sex: "female", heightIn: 65, neckIn: 13, waistIn: 30 }),
    ).toBeNull(); // no hip → can't compute
    const withHip = navyBodyFatPct({
      sex: "female",
      heightIn: 65,
      neckIn: 13,
      waistIn: 30,
      hipIn: 40,
    });
    expect(withHip).not.toBeNull();
    expect(withHip!).toBeGreaterThan(20);
  });

  it("returns null when a measurement is missing", () => {
    expect(navyBodyFatPct({ sex: "male", heightIn: null, neckIn: 16, waistIn: 38 })).toBeNull();
    expect(navyBodyFatPct({ sex: "male", heightIn: 70, neckIn: null, waistIn: 38 })).toBeNull();
    expect(navyBodyFatPct({ sex: "male", heightIn: 70, neckIn: 16, waistIn: null })).toBeNull();
  });

  it("returns null when waist doesn't exceed neck (invalid log)", () => {
    expect(navyBodyFatPct({ sex: "male", heightIn: 70, neckIn: 40, waistIn: 38 })).toBeNull();
  });
});
