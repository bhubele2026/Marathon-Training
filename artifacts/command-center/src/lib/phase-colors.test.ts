import { describe, expect, it } from "vitest";
import { phaseColor } from "./phase-colors";

describe("phaseColor", () => {
  it("maps each canonical phase to its expected palette color", () => {
    // Arctic Performance phase palette (task #186): slate-blue, teal,
    // mint, soft plum, warm amber for Foundation Build, Aerobic Build,
    // Tempo/Threshold, Race-Specific, Taper & Race respectively.
    expect(phaseColor("Foundation Build")).toBe("hsl(215 50% 52%)");
    expect(phaseColor("Aerobic Build")).toBe("hsl(178 65% 42%)");
    expect(phaseColor("Tempo / Threshold")).toBe("hsl(160 55% 48%)");
    expect(phaseColor("Race-Specific")).toBe("hsl(260 40% 58%)");
    expect(phaseColor("Taper & Race")).toBe("hsl(30 65% 55%)");
  });

  it("returns a stable color for unknown phase names across calls", () => {
    const first = phaseColor("Mystery Phase");
    const second = phaseColor("Mystery Phase");
    const third = phaseColor("Mystery Phase");

    expect(first).toBe(second);
    expect(second).toBe(third);
    expect(first).toMatch(/^hsl\(/);
  });

  it("returns neutral gray for blank, null, and undefined phase labels", () => {
    const gray = "hsl(220 9% 46%)";
    expect(phaseColor("")).toBe(gray);
    expect(phaseColor("   ")).toBe(gray);
    expect(phaseColor(null as any)).toBe(gray);
    expect(phaseColor(undefined as any)).toBe(gray);
  });

  it("does not confuse blank phases with Foundation Build", () => {
    const foundationColor = phaseColor("Foundation Build");
    expect(phaseColor("")).not.toBe(foundationColor);
    expect(phaseColor(null as any)).not.toBe(foundationColor);
  });
});
