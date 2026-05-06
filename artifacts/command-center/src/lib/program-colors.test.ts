import { describe, expect, it } from "vitest";
import { programColor, PROGRAM_PALETTE_SIZE } from "./program-colors";

describe("programColor", () => {
  it("returns the same color for the same sourceEntryIndex across calls", () => {
    expect(programColor(0)).toBe(programColor(0));
    expect(programColor(2)).toBe(programColor(2));
  });

  it("assigns distinct colors to distinct entry indices within the palette", () => {
    const c0 = programColor(0);
    const c1 = programColor(1);
    const c2 = programColor(2);
    expect(c0).not.toBe(c1);
    expect(c1).not.toBe(c2);
    expect(c0).not.toBe(c2);
  });

  it("wraps once the palette is exhausted", () => {
    expect(programColor(PROGRAM_PALETTE_SIZE)).toBe(programColor(0));
    expect(programColor(PROGRAM_PALETTE_SIZE + 1)).toBe(programColor(1));
  });

  it("falls back to the first palette entry for negative or non-finite indices", () => {
    expect(programColor(-1)).toBe(programColor(0));
    expect(programColor(Number.NaN)).toBe(programColor(0));
  });
});
