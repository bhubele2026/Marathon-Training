import { describe, expect, it } from "vitest";
import { phaseColor } from "./phase-colors";

describe("phaseColor", () => {
  it("maps each canonical phase to its theme-driven CSS variable", () => {
    // Phase colors are now CSS custom properties so the active visual
    // theme (task #188) can re-skin them at runtime without forcing
    // every consumer to re-render. Defaults are seeded to the Arctic
    // Performance palette in `index.css`.
    expect(phaseColor("Foundation Build")).toBe("var(--phase-foundation)");
    expect(phaseColor("Aerobic Build")).toBe("var(--phase-aerobic)");
    expect(phaseColor("Tempo / Threshold")).toBe("var(--phase-tempo)");
    expect(phaseColor("Race-Specific")).toBe("var(--phase-race-specific)");
    expect(phaseColor("Taper & Race")).toBe("var(--phase-taper)");
  });

  it("returns a stable color for unknown phase names across calls", () => {
    const first = phaseColor("Mystery Phase");
    const second = phaseColor("Mystery Phase");
    const third = phaseColor("Mystery Phase");

    expect(first).toBe(second);
    expect(second).toBe(third);
    // Unknown phases hash into the same theme-driven palette, so the
    // result is always one of the `var(--phase-*)` references.
    expect(first).toMatch(/^var\(--phase-/);
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
