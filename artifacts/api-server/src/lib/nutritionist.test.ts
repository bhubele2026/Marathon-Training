import { describe, it, expect } from "vitest";
import {
  computeBodyComp,
  proteinGPerLb,
  fallbackReport,
  buildNutritionistUser,
  buildNutritionistSystem,
  type AnalysisInput,
} from "./nutritionist";
import type { AlcoholStats } from "@workspace/db";

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
    actualWeeklyRateLb: -1,
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
    calorieHitRate: 0.8,
    proteinGPerLb: 0.92,
    avgCarbs: 240,
    carbsTarget: 242,
    avgFat: 65,
    fatTarget: 68,
    avgWaterMl: 3000,
    avgSodiumMg: 2800,
    sodiumLimitMg: 2300,
    todayOpen: false,
    todayCaloriesSoFar: null,
    todayProteinSoFar: null,
    todayCarbsSoFar: null,
    todayFatSoFar: null,
    todayWaterMl: null,
    todaySodiumMg: null,
    daysUnderFloor: 0,
    sessionsDone: 28,
    plannedSessions: 30,
    avgTrainingLoad: 60,
    safeFloorKcal: 1500,
    safeRateLbPerWk: 2,
    proteinFloorGPerLb: 0.8,
    groundTruthFlags: [],
    dailyLog: [],
    bodyLog: [],
    ...over,
  };
}

// Pull one structured insight out of the report by id.
function insight(r: ReturnType<typeof fallbackReport>, id: string) {
  const found = r.insights.find((i) => i.id === id);
  if (!found) throw new Error(`no insight ${id}`);
  return found;
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
  it("emits the six structured insights, engine-owned numbers intact", () => {
    const r = fallbackReport(base());
    expect(r.insights.map((i) => i.id).sort()).toEqual(
      ["bodycomp", "carbs", "fat", "fuelling", "hydration", "protein", "sodium"].sort(),
    );
    // The engine owns the numbers: protein insight carries the real avg/target.
    expect(insight(r, "protein").actual).toBe(220);
    expect(insight(r, "protein").target).toBe(224);
    // Every insight gets a one-line caption (engine fallback copy).
    for (const i of r.insights) expect(i.caption.length).toBeGreaterThan(0);
  });

  it("flags under-floor fuelling as the headline and steers up", () => {
    const r = fallbackReport(base({ avgCalories: 1300, daysUnderFloor: 5 }));
    expect(insight(r, "fuelling").status).toBe("under");
    expect(r.headline).toMatch(/under-fuel/i);
    expect(r.keyMoves[0]).toMatch(/1500/);
  });

  it("calls low protein 'under' below ~0.7 g/lb and blames it in the body-comp why", () => {
    const r = fallbackReport(base({ proteinGPerLb: 0.6 }));
    expect(insight(r, "protein").status).toBe("under");
    expect(insight(r, "bodycomp").detail).toMatch(/protein/i);
  });

  it("calls a solid recomp protein intake on_track", () => {
    const r = fallbackReport(base());
    expect(insight(r, "protein").status).toBe("on_track");
  });

  it("lowers confidence and lists body-fat as a gap when bf% missing", () => {
    const r = fallbackReport(base({ bodyFatPct: null, leanMassLb: null, fatMassLb: null, leanMassChangeLb: null, fatMassChangeLb: null }));
    expect(r.dataGaps.join(" ")).toMatch(/body-fat/i);
  });

  it("gives a hydration read — a target when water is unlogged, a check-in when it's logged", () => {
    const noWater = insight(fallbackReport(base({ avgWaterMl: null })), "hydration");
    expect(noWater.detail).toMatch(/water|hydrat/i);
    expect(noWater.detail).toMatch(/\d+\s*oz/i); // suggests a target
    expect(noWater.status).toBe("early");

    const lowWater = insight(
      fallbackReport(base({ avgWaterMl: 1000, currentWeightLb: 240 })), // ~34 oz vs ~120 aim
      "hydration",
    );
    expect(lowWater.detail).toMatch(/under|more water/i);
    expect(lowWater.status).toBe("under");
  });

  it("coaches an open day by pace instead of 'not enough data'", () => {
    const r = fallbackReport(
      base({
        daysLogged: 0,
        avgCalories: null,
        avgProtein: null,
        proteinGPerLb: null,
        avgWaterMl: null,
        avgSodiumMg: null,
        todayOpen: true,
        todayCaloriesSoFar: 1430,
        todayProteinSoFar: 172,
        todayWaterMl: 710,
        calorieTarget: 2480,
        proteinTarget: 224,
      }),
    );
    expect(r.today).toMatch(/1430|to go|pace/i);
    expect(r.headline).toMatch(/pace|progress/i);
    // Uses today's water (open day), not "not logged".
    expect(insight(r, "hydration").detail).not.toMatch(/isn't logged/i);
  });

  it("gives sodium advice tuned to a hard-training lifter", () => {
    const low = insight(fallbackReport(base({ avgSodiumMg: 900 })), "sodium");
    expect(low.detail).toMatch(/low|cramp|flatten/i);
    expect(low.status).toBe("under");
    const high = insight(fallbackReport(base({ avgSodiumMg: 4200, sodiumLimitMg: 2300 })), "sodium");
    expect(high.detail).toMatch(/over|rein|pull it back/i);
    expect(high.status).toBe("over");
    const none = insight(fallbackReport(base({ avgSodiumMg: null, todaySodiumMg: null })), "sodium");
    expect(none.detail).toMatch(/adequate|electrolyte|mg/i);
  });

  it("never recommends eating below the floor", () => {
    const r = fallbackReport(base({ avgCalories: 1200 }));
    const allText = JSON.stringify(r).toLowerCase();
    // The only calorie figure pushed should be the floor (up), never a cut below it.
    expect(insight(r, "fuelling").status).toBe("under");
    expect(allText).not.toMatch(/eat less|cut calories|reduce calories/);
  });
});

describe("buildNutritionistUser — enriched briefing (Phase 10)", () => {
  it("surfaces goal trajectory: actual vs target weekly rate + on/off-track", () => {
    const onText = buildNutritionistUser(base({ actualWeeklyRateLb: -1, weeklyRateLb: -1, onTrack: true }));
    expect(onText).toMatch(/Trajectory:/);
    expect(onText).toMatch(/actual -1 lb\/wk vs target -1 lb\/wk/);
    expect(onText).toMatch(/ON TRACK/);

    const offText = buildNutritionistUser(base({ actualWeeklyRateLb: -0.3, weeklyRateLb: -1, onTrack: false }));
    expect(offText).toMatch(/actual -0\.3 lb\/wk vs target -1 lb\/wk/);
    expect(offText).toMatch(/OFF TRACK/);
  });

  it("reports calorie adherence as a hit-rate percentage", () => {
    expect(buildNutritionistUser(base({ calorieHitRate: 0.8 }))).toMatch(/calorie target \(±10%\) on 80% of logged days/);
  });

  it("coaches protein PACE on an open day with g-to-go and per-meal split", () => {
    const txt = buildNutritionistUser(
      base({
        todayOpen: true,
        todayProteinSoFar: 102,
        proteinTarget: 224,
        todayLocalHour: 18, // evening → ~1 meal left
      }),
    );
    expect(txt).toMatch(/Protein still to bury today: 122 g/);
    expect(txt).toMatch(/priority/);
  });

  it("acknowledges when today's protein target is already met", () => {
    const txt = buildNutritionistUser(
      base({ todayOpen: true, todayProteinSoFar: 230, proteinTarget: 224 }),
    );
    expect(txt).toMatch(/already hit for today/);
  });
});

describe("buildNutritionistSystem — sharpened persona", () => {
  it("mandates naming the real number and forbids vague advice", () => {
    const sys = buildNutritionistSystem("PERSONA");
    expect(sys).toMatch(/name the number/i);
    expect(sys).toMatch(/g\/lb/);
    // keeps the non-negotiable safety rails intact
    expect(sys).toMatch(/safe floor/i);
    expect(sys).toMatch(/DROP all sarcasm/);
  });

  it("teaches alcohol as a first-class, woven-in, win-not-shame input", () => {
    const sys = buildNutritionistSystem("PERSONA");
    expect(sys).toMatch(/muscle protein synthesis/i);
    expect(sys).toMatch(/dry days are wins/i);
    expect(sys).toMatch(/never shame/i);
    expect(sys).toMatch(/ALONGSIDE/);
  });
});

// --- Alcohol insights (reduction tool; win-not-shame guardrails) ------------

function alc(over: Partial<AlcoholStats> = {}): AlcoholStats {
  return {
    active: true,
    seedState: false,
    daysTracked: 30,
    dryDaysTarget: 4,
    weekDrinks: 3,
    drinkingDaysThisWeek: 2,
    drinkingBudget: 3,
    dryDaysThisWeek: 5,
    currentDryStreak: 2,
    longestDryStreak: 9,
    dailyStrip: [],
    weeklyTrend: [],
    avgDryPerWeek: 5,
    weeksOnTarget: 3,
    weeksTracked: 4,
    weeksOnTargetStreak: 2,
    impact: [],
    ...over,
  };
}

describe("computeInsights — alcohol tiles", () => {
  it("omits both alcohol tiles when there's no alcohol data", () => {
    const r = fallbackReport(base());
    expect(r.insights.find((i) => i.id === "alcohol")).toBeUndefined();
    expect(r.insights.find((i) => i.id === "dryDays")).toBeUndefined();
  });

  it("emits both tiles, each carrying the shared read, when active", () => {
    const r = fallbackReport(base({ alcohol: alc() }));
    const dry = insight(r, "dryDays");
    const drink = insight(r, "alcohol");
    expect(dry.alcohol?.dryDaysTarget).toBe(4);
    expect(drink.alcohol).toBeTruthy();
    expect(dry.group).toBe("alcohol");
  });

  it("dry-days tile is a green win when the weekly target is met", () => {
    const r = fallbackReport(base({ alcohol: alc({ dryDaysThisWeek: 5, dryDaysTarget: 4 }) }));
    expect(insight(r, "dryDays").status).toBe("ahead");
  });

  it("dry-days tile nudges with amber (never red) when short of target", () => {
    const r = fallbackReport(base({ alcohol: alc({ dryDaysThisWeek: 2, dryDaysTarget: 4 }) }));
    const dry = insight(r, "dryDays");
    expect(dry.status).toBe("attention");
    expect(["under", "over"]).not.toContain(dry.status);
  });

  it("alcohol tile reads NEUTRAL within budget and amber over — never red", () => {
    const within = insight(
      fallbackReport(base({ alcohol: alc({ drinkingDaysThisWeek: 2, drinkingBudget: 3 }) })),
      "alcohol",
    );
    expect(within.status).toBe("appropriate");
    const over = insight(
      fallbackReport(base({ alcohol: alc({ drinkingDaysThisWeek: 5, drinkingBudget: 3 }) })),
      "alcohol",
    );
    expect(over.status).toBe("attention");
    for (const ins of [within, over]) expect(["under", "over"]).not.toContain(ins.status);
  });

  it("shows an early-read seed state under ~2 weeks", () => {
    const r = fallbackReport(base({ alcohol: alc({ seedState: true }) }));
    expect(insight(r, "dryDays").status).toBe("early");
    expect(insight(r, "alcohol").status).toBe("early");
  });
});

describe("buildNutritionistUser — alcohol briefing", () => {
  it("includes the dry-days goal and weaves the cost in", () => {
    const txt = buildNutritionistUser(base({ alcohol: alc() }));
    expect(txt).toMatch(/Alcohol \(reduction tool/);
    expect(txt).toMatch(/dry days\/week/);
    expect(txt).toMatch(/NEUTRAL/);
  });

  it("says nothing about alcohol when there's no data", () => {
    expect(buildNutritionistUser(base())).not.toMatch(/Alcohol \(reduction tool/);
  });
});
