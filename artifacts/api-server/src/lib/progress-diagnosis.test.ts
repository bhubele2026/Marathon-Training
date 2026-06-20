import { describe, it, expect } from "vitest";
import { diagnose, type DiagnosisInput } from "./progress-diagnosis";

// A neutral, on-track baseline; tests override only what they exercise.
function base(over: Partial<DiagnosisInput> = {}): DiagnosisInput {
  return {
    weeks: 12,
    weeksElapsed: 6,
    goalDirection: "loss",
    weightChangeLb: -6, // ~1 lb/wk
    goalRateLbPerWk: -1,
    onTrack: true,
    varianceLb: -0.2,
    avgCalories: 2400,
    calorieTarget: 2400,
    avgProtein: 220,
    proteinTarget: 220,
    proteinHitRate: 0.9,
    sessionsDone: 18,
    plannedSessions: 20,
    inchesChange: -1.5,
    safeFloorKcal: 1500,
    safeRateLbPerWk: 2,
    ...over,
  };
}

describe("diagnose — health flags win", () => {
  it("flags under-eating below the floor as supportive and top-ranked", () => {
    const d = diagnose(base({ avgCalories: 1300 }));
    expect(d.findings[0]!.id).toBe("under-floor");
    expect(d.findings[0]!.tone).toBe("supportive");
    // Never recommends going lower.
    expect(d.findings[0]!.fix.toLowerCase()).toMatch(/at least|bring|up/);
  });

  it("flags losing faster than safe as supportive (raise calories), not a roast", () => {
    const d = diagnose(
      base({ weightChangeLb: -20, weeksElapsed: 5, avgCalories: 1800 }), // ~4 lb/wk
    );
    expect(d.findings[0]!.id).toBe("too-fast");
    expect(d.findings[0]!.tone).toBe("supportive");
    expect(d.findings[0]!.fix.toLowerCase()).toMatch(/raise|maintenance|toward/);
  });
});

describe("diagnose — recomp is a win, not a stall", () => {
  it("calls a flat scale with inches down a win (positive)", () => {
    const d = diagnose(
      base({ weightChangeLb: -0.4, weeksElapsed: 6, inchesChange: -2 }),
    );
    expect(d.findings[0]!.id).toBe("recomp-working");
    expect(d.findings[0]!.tone).toBe("positive");
  });
});

describe("diagnose — adherence problems get the sass", () => {
  it("flat scale + over target → sassy over-eating finding", () => {
    const d = diagnose(
      base({
        weightChangeLb: -0.3,
        weeksElapsed: 6,
        avgCalories: 2800,
        inchesChange: 0,
      }),
    );
    const f = d.findings.find((x) => x.id === "flat-over-target");
    expect(f).toBeTruthy();
    expect(f!.tone).toBe("sassy");
  });

  it("low protein is flagged sassily", () => {
    const d = diagnose(base({ proteinHitRate: 0.3, avgProtein: 150 }));
    expect(d.findings.some((f) => f.id === "low-protein" && f.tone === "sassy")).toBe(true);
  });

  it("missed sessions are flagged", () => {
    const d = diagnose(base({ sessionsDone: 8, plannedSessions: 20 }));
    expect(d.findings.some((f) => f.id === "missed-sessions")).toBe(true);
  });
});

describe("diagnose — plateau + defaults", () => {
  it("flags a genuine plateau when adherent but flat", () => {
    const d = diagnose(
      base({
        weightChangeLb: -0.2,
        weeksElapsed: 5,
        avgCalories: 2400,
        inchesChange: 0,
      }),
    );
    expect(d.findings.some((f) => f.id === "plateau")).toBe(true);
  });

  it("says on-track when everything lines up", () => {
    const d = diagnose(base());
    expect(d.findings[0]!.id).toBe("on-track");
    expect(d.findings[0]!.tone).toBe("positive");
  });

  it("says insufficient data when there's nothing to judge", () => {
    const d = diagnose(
      base({
        weightChangeLb: null,
        onTrack: null,
        avgCalories: null,
        proteinHitRate: null,
        sessionsDone: 0,
        plannedSessions: 0,
        inchesChange: null,
        goalDirection: "loss",
      }),
    );
    expect(d.findings[0]!.id).toBe("insufficient");
  });
});
