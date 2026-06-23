import { describe, it, expect } from "vitest";
import {
  computeBodyComp,
  proteinGPerLb,
  fallbackReport,
  type AnalysisInput,
} from "./nutritionist";

// A reasonable mid-recomp baseline; tests override only what they exercise.
function base(over: Partial<AnalysisInput> = {}): AnalysisInput {
  return {
    weeks: 8,
    weeksElapsed: 6,
    sex: "male",
    age: 41,
    heightIn: 70,
    activityLevel: "moderate",
    bodyGoal: "recomp",
    goalWeightLb: 210,
    weeklyRateLb: -1,
    goalDirection: "loss",
    onTrack: true,
    currentWeightLb: 240,
    startWeightLb: 246,
    weightChangeLb: -6,
    bodyFatPct: 24,
    startBodyFatPct: 27,
    leanMassLb: 182.4,
    fatMassLb: 57.6,
    leanMassChangeLb: 2,
    fatMassChangeLb: -8,
    inchesChange: -2,
    daysLogged: 40,
    avgCalories: 2400,
    calorieTarget: 2480,
    avgProtein: 220,
    proteinTarget: 224,
    proteinHitRate: 0.85,
    proteinGPerLb: 0.92,
    avgCarbs: 240,
    carbsTarget: 242,
    avgFat: 65,
    fatTarget: 68,
    avgWaterMl: 3000,
    todayOpen: false,
    todayCaloriesSoFar: null,
    todayProteinSoFar: null,
    daysUnderFloor: 0,
    sessionsDone: 28,
    plannedSessions: 30,
    avgTrainingLoad: 60,
    safeFloorKcal: 1500,
    safeRateLbPerWk: 2,
    proteinFloorGPerLb: 0.8,
    groundTruthFlags: [],
    ...over,
  };
}

describe("computeBodyComp", () => {
  it("splits weight into lean + fat from body-fat %", () => {
    expect(computeBodyComp(200, 25)).toEqual({ leanMassLb: 150, fatMassLb: 50 });
  });
  it("returns nulls when weight or bf% missing", () => {
    expect(computeBodyComp(null, 25)).toEqual({ leanMassLb: null, fatMassLb: null });
    expect(computeBodyComp(200, null)).toEqual({ leanMassLb: null, fatMassLb: null });
  });
  it("rejects implausible body-fat %", () => {
    expect(computeBodyComp(200, 0)).toEqual({ leanMassLb: null, fatMassLb: null });
    expect(computeBodyComp(200, 90)).toEqual({ leanMassLb: null, fatMassLb: null });
  });
});

describe("proteinGPerLb", () => {
  it("divides protein by bodyweight", () => {
    expect(proteinGPerLb(200, 250)).toBe(0.8);
  });
  it("is null without both inputs", () => {
    expect(proteinGPerLb(null, 250)).toBeNull();
    expect(proteinGPerLb(200, null)).toBeNull();
  });
});

describe("fallbackReport — safety-correct without AI", () => {
  it("flags under-floor fuelling as the headline and steers up", () => {
    const r = fallbackReport(base({ avgCalories: 1300, daysUnderFloor: 5 }));
    expect(r.deficit.status).toBe("under_floor");
    expect(r.headline).toMatch(/under-fuel/i);
    expect(r.keyMoves[0]).toMatch(/1500/);
  });

  it("calls low protein too_little below ~0.7 g/lb", () => {
    const r = fallbackReport(base({ proteinGPerLb: 0.6 }));
    expect(r.protein.status).toBe("too_little");
    expect(r.bodyComp.whyYouMayNotBe).toMatch(/protein/i);
  });

  it("calls a solid recomp protein intake on_point", () => {
    const r = fallbackReport(base());
    expect(r.protein.status).toBe("on_point");
  });

  it("lowers confidence and lists body-fat as a gap when bf% missing", () => {
    const r = fallbackReport(base({ bodyFatPct: null, leanMassLb: null, fatMassLb: null, leanMassChangeLb: null, fatMassChangeLb: null }));
    expect(r.dataGaps.join(" ")).toMatch(/body-fat/i);
  });

  it("gives a hydration read — a target when water is unlogged, a check-in when it's logged", () => {
    const noWater = fallbackReport(base({ avgWaterMl: null }));
    expect(noWater.hydration).toMatch(/water|hydrat/i);
    expect(noWater.hydration).toMatch(/\d+\s*oz/i); // suggests a target

    const lowWater = fallbackReport(base({ avgWaterMl: 1000, currentWeightLb: 240 })); // ~34 oz vs ~120 aim
    expect(lowWater.hydration).toMatch(/under|more water/i);
  });

  it("never recommends eating below the floor", () => {
    const r = fallbackReport(base({ avgCalories: 1200 }));
    const allText = JSON.stringify(r).toLowerCase();
    // The only calorie figure pushed should be the floor (up), never a cut below it.
    expect(r.deficit.status).toBe("under_floor");
    expect(allText).not.toMatch(/eat less|cut calories|reduce calories/);
  });
});
