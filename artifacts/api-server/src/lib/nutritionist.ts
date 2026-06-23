// The AI Nutritionist: a deep, body-comp-aware read of how the runner is doing
// on protein, fuelling, and recomposition. Pure + DB-free so the math and the
// prompt assembly are unit-testable; the route gathers the metrics and calls
// Claude. Claude does the reasoning, but it is grounded in a deterministic,
// safety-railed metrics gather (it can never tell the runner to eat below the
// floor or lose faster than the safe rate — those flags are computed here and
// passed in as ground truth).

import type { NutritionistReport } from "@workspace/db";
import { PROTEIN_FLOOR_G_PER_LB } from "./nutrition-safety";

const round1 = (n: number) => Math.round(n * 10) / 10;

// --- Body-composition math -------------------------------------------------

export type BodyComp = { leanMassLb: number | null; fatMassLb: number | null };

// Lean mass = weight * (1 - bf%/100); fat mass = the remainder. Null unless
// BOTH weight and a sane body-fat % are present.
export function computeBodyComp(
  weightLb: number | null,
  bodyFatPct: number | null,
): BodyComp {
  if (weightLb == null || bodyFatPct == null || bodyFatPct <= 0 || bodyFatPct >= 75) {
    return { leanMassLb: null, fatMassLb: null };
  }
  const fat = round1(weightLb * (bodyFatPct / 100));
  return { leanMassLb: round1(weightLb - fat), fatMassLb: fat };
}

// Protein per lb of current bodyweight — the recomp-adequacy yardstick.
export function proteinGPerLb(
  avgProteinG: number | null,
  weightLb: number | null,
): number | null {
  if (avgProteinG == null || weightLb == null || weightLb <= 0) return null;
  return Math.round((avgProteinG / weightLb) * 100) / 100;
}

// --- Analysis input (built by the route, consumed by the prompt) -----------

export type AnalysisInput = {
  weeks: number;
  weeksElapsed: number;
  // Profile
  sex: string | null;
  age: number | null;
  heightIn: number | null;
  activityLevel: string | null;
  bodyGoal: string; // recomp | cut | lean_bulk
  goalWeightLb: number | null;
  weeklyRateLb: number | null; // signed target rate
  goalDirection: "loss" | "gain" | "maintain" | "none";
  onTrack: boolean | null;
  // Body comp
  currentWeightLb: number | null;
  startWeightLb: number | null;
  weightChangeLb: number | null;
  bodyFatPct: number | null;
  startBodyFatPct: number | null;
  leanMassLb: number | null;
  fatMassLb: number | null;
  leanMassChangeLb: number | null;
  fatMassChangeLb: number | null;
  inchesChange: number | null;
  // Nutrition
  daysLogged: number;
  avgCalories: number | null;
  calorieTarget: number | null;
  avgProtein: number | null;
  proteinTarget: number | null;
  proteinHitRate: number | null; // 0..1
  proteinGPerLb: number | null;
  avgCarbs: number | null;
  carbsTarget: number | null;
  avgFat: number | null;
  fatTarget: number | null;
  avgWaterMl: number | null; // average daily water intake (mL) over logged days
  // Today's eating isn't finished until the runner "closes the day". When open,
  // the averages/flags above EXCLUDE today; these carry today's partial numbers
  // so the read can speak to pace without judging a half-eaten day.
  todayOpen: boolean;
  todayCaloriesSoFar: number | null;
  todayProteinSoFar: number | null;
  daysUnderFloor: number;
  // Training
  sessionsDone: number;
  plannedSessions: number;
  avgTrainingLoad: number | null;
  // Safety ground truth (hard rails)
  safeFloorKcal: number;
  safeRateLbPerWk: number;
  proteinFloorGPerLb: number;
  // Deterministic flags surfaced by the diagnosis engine (titles only).
  groundTruthFlags: string[];
};

// --- Structured output tool (Claude returns the report as validated JSON) ---

export const NUTRITIONIST_TOOL_NAME = "emit_nutrition_report";

const REPORT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "protein", "bodyComp", "deficit", "hydration", "keyMoves", "confidence", "dataGaps", "narrative"],
  properties: {
    headline: {
      type: "string",
      description: "One plain-language sentence: the single most important thing about how they're doing right now.",
    },
    protein: {
      type: "object",
      additionalProperties: false,
      required: ["status", "detail", "distributionTip"],
      properties: {
        status: {
          type: "string",
          enum: ["too_little", "on_point", "too_much"],
          description: "Verdict vs recomp need. ~0.8-1.0 g/lb is the floor; ~1.0 g/lb is the sweet spot on a recomp/cut. Below ~0.7 g/lb = too_little. Sustained above ~1.3 g/lb with macros suffering = too_much.",
        },
        detail: {
          type: "string",
          description: "2-3 sentences: is protein enough to hold/build muscle, what the trend shows, and what under/over is doing to muscle + recovery. Reference the real g/lb and hit rate numbers.",
        },
        distributionTip: {
          type: "string",
          description: "One sentence of timing/distribution guidance. We only have DAILY totals (no per-meal data) — frame it as a principle (e.g. spread across 3-4 meals at ~0.4 g/lb each, anchor one serving near training) and DO NOT claim to see their meal timing.",
        },
      },
    },
    bodyComp: {
      type: "object",
      additionalProperties: false,
      required: ["trend", "whatYouShouldSee", "whyYouMayNotBe"],
      properties: {
        trend: {
          type: "string",
          description: "Plain read of the trajectory using the numbers given (weight, body-fat %, lean/fat mass, tape inches). If body-fat % is unlogged, say so and reason from weight + inches + lifts.",
        },
        whatYouShouldSee: {
          type: "string",
          description: "Given their goal (recomp/cut/lean_bulk) and inputs, what the trajectory SHOULD look like over this window — concrete and realistic (e.g. fat mass down ~X lb, lean mass flat or up, scale slow).",
        },
        whyYouMayNotBe: {
          type: "string",
          description: "The diagnosis: if the trajectory isn't matching, the most likely WHY, tied to their actual inputs (low protein, over/under calories, missed sessions, too-aggressive deficit, not enough data). Honest and specific. If they ARE on track, say what's working.",
        },
      },
    },
    deficit: {
      type: "object",
      additionalProperties: false,
      required: ["status", "detail"],
      properties: {
        status: {
          type: "string",
          enum: ["under_floor", "aggressive", "appropriate", "surplus", "unknown"],
          description: "Fuelling read vs the safe floor + target. under_floor = avg below the safe floor (a health flag). NEVER endorse eating below the floor or losing faster than the safe rate.",
        },
        detail: {
          type: "string",
          description: "1-2 sentences on fuelling adequacy. If under the floor or losing too fast, DROP all sarcasm, be warm, and steer UP toward the floor.",
        },
      },
    },
    hydration: {
      type: "string",
      description:
        "One sentence on hydration: how their water intake (given below, with bodyweight + training) is helping or holding back the goal — satiety/appetite control on a deficit, recovery + performance, and the extra fluid a high-protein intake needs. If water isn't logged, say so and give a simple target (~½ oz per lb bodyweight as a rough daily aim, more on training days).",
    },
    keyMoves: {
      type: "array",
      items: { type: "string" },
      minItems: 1,
      maxItems: 4,
      description: "2-4 concrete next moves, most important first. Each a short imperative line.",
    },
    confidence: {
      type: "string",
      enum: ["low", "medium", "high"],
      description: "How much to trust this read given how much was actually logged (few weigh-ins / few logged days / no body-fat % → low).",
    },
    dataGaps: {
      type: "array",
      items: { type: "string" },
      maxItems: 4,
      description: "Inputs that would sharpen the diagnosis (e.g. 'Log body-fat % so I can separate fat loss from muscle', 'Log meals more days'). Empty if data is rich.",
    },
    narrative: {
      type: "string",
      description: "2-4 sentences IN THE COACH PERSONA — the line shown on the Today screen. Lead with the real cause + safe fix; the substance matters more than the joke. Warm (no sarcasm) for any health flag.",
    },
  },
} as const;

export const NUTRITIONIST_TOOL = {
  name: NUTRITIONIST_TOOL_NAME,
  description:
    "Emit the complete nutrition + body-composition report as structured data. " +
    "Call this exactly once, after you have reasoned through the runner's protein " +
    "adequacy, fuelling, and recomposition trajectory. Ground every claim in the " +
    "numbers provided; never invent data you weren't given.",
  input_schema: REPORT_SCHEMA,
} as const;

// --- Prompt assembly -------------------------------------------------------

export function buildNutritionistSystem(persona: string): string {
  return (
    `${persona}\n\n## Your role right now\n` +
    `You are also a sharp, evidence-based sports nutritionist and body-recomposition ` +
    `coach. The runner wants to understand how they're ACTUALLY doing: is their protein ` +
    `right, what should their body composition be doing for their goal, and if it isn't, ` +
    `WHY — traced to their real inputs.\n\n` +
    `Reason like a nutritionist who knows the literature: protein ~0.8-1.0 g/lb of ` +
    `bodyweight to spare/build muscle in a deficit (the recomp floor), a moderate deficit ` +
    `(~0.5-1% bodyweight/wk) to lose fat while training hard, lean mass is preserved by ` +
    `protein + resistance training, the scale lies during recomp (judge by body-fat %, ` +
    `tape, and lifts), metabolic adaptation is real after a long cut, and hydration ` +
    `matters — water blunts appetite on a deficit, supports recovery + performance, and a ` +
    `high-protein intake raises fluid needs.\n\n` +
    `## Hard rules (non-negotiable)\n` +
    `- Use ONLY the numbers given. If a metric is missing (e.g. body-fat % unlogged), say ` +
    `so plainly, lower your confidence, and reason from what you have. Never fabricate.\n` +
    `- The safe floor and safe rate passed in are GROUND TRUTH. Never suggest eating below ` +
    `the floor or losing faster than the safe rate. If they're already under-fuelling or ` +
    `losing too fast, DROP all sarcasm, be genuinely warm, and steer UP.\n` +
    `- We have DAILY macro totals only, not per-meal data — give protein timing advice as a ` +
    `principle, never as if you can see their meals.\n` +
    `- Output ONLY via the ${NUTRITIONIST_TOOL_NAME} tool. No prose outside it.`
  );
}

const fmt = (n: number | null, unit = "") => (n == null ? "—" : `${n}${unit}`);
const txt = (s: string | null) => (s == null || s === "" ? "—" : s);

export function buildNutritionistUser(d: AnalysisInput): string {
  const lines: string[] = [];
  lines.push(`Window: last ${d.weeks} weeks (${d.weeksElapsed} weeks of data).`);
  lines.push(
    `Profile: sex ${txt(d.sex)}, age ${fmt(d.age)}, height ${fmt(d.heightIn, " in")}, ` +
      `activity ${txt(d.activityLevel)}, goal "${d.bodyGoal}", ` +
      `goal weight ${fmt(d.goalWeightLb, " lb")}, target rate ${fmt(d.weeklyRateLb, " lb/wk")} (${d.goalDirection}).`,
  );
  lines.push(
    `Body comp now: weight ${fmt(d.currentWeightLb, " lb")} (from ${fmt(d.startWeightLb, " lb")}, ` +
      `change ${fmt(d.weightChangeLb, " lb")}), body-fat ${fmt(d.bodyFatPct, "%")} ` +
      `(from ${fmt(d.startBodyFatPct, "%")}), lean mass ${fmt(d.leanMassLb, " lb")} ` +
      `(change ${fmt(d.leanMassChangeLb, " lb")}), fat mass ${fmt(d.fatMassLb, " lb")} ` +
      `(change ${fmt(d.fatMassChangeLb, " lb")}), tape total change ${fmt(d.inchesChange, " in")}.`,
  );
  lines.push(
    `Protein: avg ${fmt(d.avgProtein, " g")}/day vs target ${fmt(d.proteinTarget, " g")}, ` +
      `that's ${fmt(d.proteinGPerLb, " g/lb")} of bodyweight, hit target on ` +
      `${d.proteinHitRate != null ? Math.round(d.proteinHitRate * 100) : "—"}% of logged days. ` +
      `Recomp protein floor ~${d.proteinFloorGPerLb} g/lb.`,
  );
  lines.push(
    `Energy: avg ${fmt(d.avgCalories, " kcal")}/day vs target ${fmt(d.calorieTarget, " kcal")}, ` +
      `carbs ${fmt(d.avgCarbs, " g")} (target ${fmt(d.carbsTarget, " g")}), ` +
      `fat ${fmt(d.avgFat, " g")} (target ${fmt(d.fatTarget, " g")}). ` +
      `Logged ${d.daysLogged} days; ${d.daysUnderFloor} day(s) under the safe floor of ${d.safeFloorKcal} kcal.`,
  );
  lines.push(
    `Water: avg ${d.avgWaterMl != null ? `${Math.round(d.avgWaterMl / 29.5735)} oz (${d.avgWaterMl} mL)` : "not logged"}/day` +
      `${d.currentWeightLb != null ? ` at ${d.currentWeightLb} lb bodyweight` : ""}.`,
  );
  lines.push(
    `Training: ${d.sessionsDone} of ${d.plannedSessions} planned sessions done, ` +
      `avg training load ${fmt(d.avgTrainingLoad)}.`,
  );
  if (d.todayOpen) {
    lines.push(
      `IMPORTANT — today is still OPEN (the runner hasn't closed the day, they're ` +
        `still eating). Today's partial intake (${d.todayCaloriesSoFar ?? "—"} kcal, ` +
        `${d.todayProteinSoFar ?? "—"} g protein so far) is EXCLUDED from the averages above ` +
        `and must NOT be judged as a finished day. Do not warn that today is low. You may ` +
        `note pace toward target encouragingly; save the verdict for closed days.`,
    );
  }
  lines.push(`Safety ground truth: floor ${d.safeFloorKcal} kcal/day, safe loss rate ${d.safeRateLbPerWk} lb/wk.`);
  if (d.groundTruthFlags.length > 0) {
    lines.push(`Deterministic flags already detected: ${d.groundTruthFlags.join("; ")}.`);
  }
  lines.push(
    `\nWrite the report. Be specific and honest, lead with what matters most, and tie the ` +
      `body-comp "why" to the actual inputs above.`,
  );
  return lines.join("\n");
}

// --- Deterministic fallback (AI unavailable) -------------------------------

// A useful, safety-correct report built from the numbers alone, so the feature
// degrades gracefully when ANTHROPIC_API_KEY is missing or the call fails.
export function fallbackReport(d: AnalysisInput): NutritionistReport {
  const gPerLb = d.proteinGPerLb;
  let proteinStatus: NutritionistReport["protein"]["status"] = "on_point";
  if (gPerLb != null && gPerLb < 0.7) proteinStatus = "too_little";
  else if (gPerLb != null && gPerLb > 1.3) proteinStatus = "too_much";

  const proteinDetail =
    gPerLb == null
      ? "Not enough logged protein to judge adequacy yet."
      : proteinStatus === "too_little"
        ? `You're averaging ${gPerLb} g/lb — under the ~${d.proteinFloorGPerLb} g/lb recomp floor. In a deficit that's where muscle starts leaking away.`
        : proteinStatus === "too_much"
          ? `You're averaging ${gPerLb} g/lb — plenty for muscle; more isn't buying extra, and it may be crowding out the carbs that fuel training.`
          : `You're averaging ${gPerLb} g/lb — right in the recomp pocket for holding and building muscle.`;

  let deficitStatus: NutritionistReport["deficit"]["status"] = "unknown";
  if (d.avgCalories != null) {
    if (d.avgCalories < d.safeFloorKcal) deficitStatus = "under_floor";
    else if (d.calorieTarget != null && d.avgCalories > d.calorieTarget + 100) deficitStatus = "surplus";
    else if (d.calorieTarget != null && d.avgCalories < d.calorieTarget - 100) deficitStatus = "appropriate";
    else deficitStatus = "appropriate";
  }
  const deficitDetail =
    deficitStatus === "under_floor"
      ? `Average intake (${d.avgCalories} kcal) is under your safe floor of ${d.safeFloorKcal} kcal. That's too little to recover or hold muscle — bring it up, protein first.`
      : deficitStatus === "surplus"
        ? `Intake is running over target, which will slow fat loss.`
        : deficitStatus === "unknown"
          ? `Not enough logged days to read your fuelling.`
          : `Fuelling is in a reasonable place versus your target.`;

  // Hydration: rough daily aim of ~0.5 oz per lb bodyweight (a common, safe
  // rule of thumb), nudged up by training. Compared against logged water.
  const targetOz =
    d.currentWeightLb != null ? Math.round(d.currentWeightLb * 0.5) : null;
  const waterOz = d.avgWaterMl != null ? Math.round(d.avgWaterMl / 29.5735) : null;
  const hydrationDetail =
    waterOz == null
      ? `Water isn't logged yet${targetOz != null ? ` — aim for roughly ${targetOz} oz a day (about ½ oz per lb), more on training days` : ""}. Staying hydrated blunts appetite on a deficit and helps recovery.`
      : targetOz != null && waterOz < targetOz * 0.8
        ? `You're averaging ~${waterOz} oz/day, under the ~${targetOz} oz aim for your size. More water curbs hunger on a deficit and supports recovery + protein metabolism.`
        : `You're averaging ~${waterOz} oz/day — solid. That helps appetite control on a deficit and recovery; keep it up, more on hard training days.`;

  const leanTxt =
    d.leanMassChangeLb != null
      ? `lean mass ${d.leanMassChangeLb >= 0 ? "up" : "down"} ${Math.abs(d.leanMassChangeLb)} lb, fat mass ${
          d.fatMassChangeLb != null && d.fatMassChangeLb <= 0 ? "down" : "up"
        } ${d.fatMassChangeLb != null ? Math.abs(d.fatMassChangeLb) : "—"} lb`
      : d.bodyFatPct == null
        ? "body-fat % isn't logged, so I'm reading the scale and tape only"
        : "not enough body-fat readings to trend lean vs fat";

  const keyMoves: string[] = [];
  if (deficitStatus === "under_floor") keyMoves.push(`Eat at least ${d.safeFloorKcal} kcal — protein first.`);
  if (proteinStatus === "too_little") keyMoves.push(`Get protein to ~${Math.round((d.currentWeightLb ?? 0) * d.proteinFloorGPerLb) || d.proteinTarget || 0} g/day, every day.`);
  if (d.plannedSessions > 0 && d.sessionsDone / d.plannedSessions < 0.7) keyMoves.push("Get session consistency above ~80%.");
  if (d.bodyFatPct == null) keyMoves.push("Log body-fat % so fat loss and muscle can be tracked apart.");
  if (keyMoves.length === 0) keyMoves.push("Keep doing what's working — protein high, sessions in, weigh in weekly.");

  const dataGaps: string[] = [];
  if (d.bodyFatPct == null) dataGaps.push("Log body-fat % (smart scale / DEXA / calipers).");
  if (d.daysLogged < d.weeks * 5) dataGaps.push("Log meals on more days for a sharper read.");
  if (d.currentWeightLb == null) dataGaps.push("Log bodyweight regularly.");

  const confidence: NutritionistReport["confidence"] =
    d.daysLogged >= d.weeks * 5 && d.bodyFatPct != null && d.weeksElapsed >= 2
      ? "high"
      : d.daysLogged >= d.weeks * 3
        ? "medium"
        : "low";

  const headline =
    deficitStatus === "under_floor"
      ? "You're under-fuelling — that stalls everything."
      : proteinStatus === "too_little"
        ? "Protein's below the recomp floor."
        : "Here's your current nutrition read.";

  return {
    weeks: d.weeks,
    weeksElapsed: d.weeksElapsed,
    headline,
    protein: {
      status: proteinStatus,
      avgProteinG: d.avgProtein,
      targetProteinG: d.proteinTarget,
      gPerLb,
      hitRate: d.proteinHitRate,
      detail: proteinDetail,
      distributionTip:
        "Spread protein across 3-4 meals (~0.4 g/lb each) and anchor one serving near your session — daily totals only here, so this is a principle, not a read of your timing.",
    },
    bodyComp: {
      currentWeightLb: d.currentWeightLb,
      bodyFatPct: d.bodyFatPct,
      leanMassLb: d.leanMassLb,
      fatMassLb: d.fatMassLb,
      leanMassChangeLb: d.leanMassChangeLb,
      fatMassChangeLb: d.fatMassChangeLb,
      weightChangeLb: d.weightChangeLb,
      inchesChange: d.inchesChange,
      trend: `Over ${d.weeksElapsed} weeks: weight ${d.weightChangeLb != null ? `${d.weightChangeLb} lb` : "—"}, ${leanTxt}.`,
      whatYouShouldSee:
        d.bodyGoal === "recomp"
          ? "On a recomp the scale should move slowly while the tape and body-fat % drift down and lean mass holds — judge it by those, not the scale."
          : d.bodyGoal === "cut"
            ? "On a cut you should see steady fat loss near your safe rate with lean mass largely preserved by protein + lifting."
            : "On a lean bulk you should see slow weight gain with most of it lean, fat creeping only slightly.",
      whyYouMayNotBe:
        proteinStatus === "too_little"
          ? "Protein under the floor is the most likely culprit — without it a deficit eats muscle and the recomp stalls."
          : deficitStatus === "surplus"
            ? "Intake is over target, so the deficit needed for fat loss isn't there."
            : d.plannedSessions > 0 && d.sessionsDone / d.plannedSessions < 0.7
              ? "Missed sessions mean the muscle-building stimulus is thin — the plan can't work the days it isn't run."
              : "Inputs look reasonable; if results are flat it may be early, or a genuine plateau worth a short diet break.",
    },
    deficit: {
      status: deficitStatus,
      avgCalories: d.avgCalories,
      calorieTarget: d.calorieTarget,
      safeFloorKcal: d.safeFloorKcal,
      detail: deficitDetail,
    },
    hydration: hydrationDetail,
    keyMoves,
    confidence,
    dataGaps,
    narrative: `${headline} ${proteinDetail}`,
  };
}

export { PROTEIN_FLOOR_G_PER_LB };
