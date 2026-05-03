import { describe, expect, it } from "vitest";
import { phaseColor } from "./phase-colors";

describe("phaseColor", () => {
  it("maps each canonical phase to its expected palette color", () => {
    expect(phaseColor("Foundation Build")).toBe("hsl(24 95% 53%)");
    expect(phaseColor("Aerobic Build")).toBe("hsl(199 89% 48%)");
    expect(phaseColor("Tempo / Threshold")).toBe("hsl(142 71% 45%)");
    expect(phaseColor("Race-Specific")).toBe("hsl(271 76% 53%)");
    expect(phaseColor("Taper & Race")).toBe("hsl(346 87% 55%)");
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
