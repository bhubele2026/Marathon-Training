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
  actualWeeklyRateLb: number | null; // signed ACTUAL rate (weight change / weeks elapsed)
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
  calorieHitRate: number | null; // 0..1 — share of logged days within ~±10% of the calorie target
  proteinGPerLb: number | null;
  avgCarbs: number | null;
  carbsTarget: number | null;
  avgFat: number | null;
  fatTarget: number | null;
  avgWaterMl: number | null; // average daily water intake (mL) over logged days
  avgSodiumMg: number | null; // average daily sodium (mg) over logged days
  sodiumLimitMg: number | null; // the runner's daily sodium ceiling (default 2300)
  // Today's eating isn't finished until the runner "closes the day". When open,
  // the averages/flags above EXCLUDE today; these carry today's partial numbers
  // so the read can COACH PACE (calories/protein/water vs target) without judging
  // a half-eaten day, and update as more food logs.
  todayOpen: boolean;
  todayCaloriesSoFar: number | null;
  todayProteinSoFar: number | null;
  todayCarbsSoFar: number | null;
  todayFatSoFar: number | null;
  todayWaterMl: number | null;
  todaySodiumMg: number | null;
  // Phase 9 — local-clock context so pace coaching on an OPEN day is grounded
  // in the time of day ("it's 7pm, ~60% of the day done"), not judged early.
  // Optional/back-compatible: undefined → no time context (the report still
  // works, just without the "by now" pacing line).
  todayLocalHour?: number | null;
  todayFractionElapsed?: number | null;
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
  required: ["headline", "today", "protein", "bodyComp", "deficit", "hydration", "sodium", "keyMoves", "confidence", "dataGaps", "narrative"],
  properties: {
    headline: {
      type: "string",
      description: "One plain-language sentence: the single most important thing about how they're doing right now. If today is OPEN, make it a pace headline (where today stands), not a verdict.",
    },
    today: {
      type: "string",
      description:
        "If today is OPEN (still eating), 1-2 sentences of PACE coaching: where today stands vs target (calories X of Y, protein X of Y, water), whether they're on pace, and what to prioritise for the REST of the day (e.g. 'protein's ahead, ~1,000 kcal and 50g protein to go — get a solid dinner in'). Never warn it's too low — the day isn't done. If today is closed or there's no today data, return an empty string.",
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
        "One sentence on hydration: how their water intake (given below, with bodyweight + training) is helping or holding back the goal — satiety/appetite control on a deficit, recovery + performance, and the extra fluid a high-protein intake needs. If water isn't logged, say so and give a simple target (~½ oz per lb bodyweight as a rough daily aim, more on training days). If only today's (open-day) water is available, speak to that.",
    },
    sodium: {
      type: "string",
      description:
        "One sentence on sodium, tuned to THIS runner: they're heavy (high bodyweight), training hard, and building muscle on a deficit — so they need ADEQUATE sodium (electrolytes support training performance, blood volume, muscle pumps, and offset sweat loss), not a near-zero intake, BUT they also track sodium against a ceiling (given below, default ~2300 mg) for blood-pressure safety. Read their intake vs that balance: too low can flatten training + cause cramps; chronically very high (>~3500-4000 mg without heavy sweat) is worth reining in. Give a concrete steer. If sodium isn't logged, say so and give the balanced target range.",
    },
    keyMoves: {
      type: "array",
      items: { type: "string" },
      minItems: 1,
      maxItems: 4,
      description: "2-4 concrete next moves, most important first. Each a short imperative line that NAMES THE NUMBER — 'Get protein to 224 g/day (you're at 198)', 'Bring intake up to the 1,500 kcal floor' — not 'eat more protein' or 'be consistent'.",
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
      description: "2-4 sentences IN THE COACH PERSONA — the line shown on the Today screen. Lead with the real cause + safe fix, anchored to an actual number from the brief (the g/lb, the lb/wk, the kcal-to-go); the substance matters more than the joke. Warm (no sarcasm) for any health flag.",
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
    `high-protein intake raises fluid needs. Sodium is an electrolyte, not just a villain: a ` +
    `hard-training, muscle-building athlete needs ADEQUATE sodium for performance, blood volume ` +
    `and sweat replacement — too little flattens training and causes cramps — while chronically ` +
    `very high intake warrants reining in for blood pressure.\n\n` +
    `## Today may still be in progress\n` +
    `If the data says today is OPEN, the runner is STILL EATING — coach today by PACE (where they ` +
    `stand vs target, what to prioritise for the rest of the day) in the 'today' field, and do NOT ` +
    `say "not enough data" or warn that today is low. Save verdicts for closed/past days. When ` +
    `there's little closed history yet, that's fine — lead with today's pace and keep confidence low.\n\n` +
    `## Hard rules (non-negotiable)\n` +
    `- Use ONLY the numbers given. If a metric is missing (e.g. body-fat % unlogged), say ` +
    `so plainly, lower your confidence, and reason from what you have. Never fabricate.\n` +
    `- The safe floor and safe rate passed in are GROUND TRUTH. Never suggest eating below ` +
    `the floor or losing faster than the safe rate. If they're already under-fuelling or ` +
    `losing too fast, DROP all sarcasm, be genuinely warm, and steer UP.\n` +
    `- We have DAILY macro totals only, not per-meal data — give protein timing advice as a ` +
    `principle, never as if you can see their meals.\n` +
    `## Be SPECIFIC — name the number, every time\n` +
    `Every verdict, every key move, the narrative — anchor it to the REAL figure in the ` +
    `brief. Say "you're at 0.78 g/lb, the floor's 0.8 — you're one chicken breast short," not ` +
    `"eat more protein." Say "down 0.4 lb/wk, target's 1.0 — you're dawdling," not "you're ` +
    `behind." On an OPEN day, coach the gap as a move: "bury the other 122 g of protein before ` +
    `bed," "1,000 kcal left — that's dinner and a snack," not "log more." Vague, number-free ` +
    `advice ("eat better", "stay consistent", "log more") is a FAIL — the runner can already see ` +
    `their dashboard; your job is to tell them the one number that matters and what to do about it.\n` +
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
  // Goal trajectory: the ACTUAL weekly rate vs the target rate is the single
  // clearest "is this working?" signal — surface it explicitly (it was computed
  // but never shown) so the coach can call the gap by its number.
  {
    const actual = d.actualWeeklyRateLb;
    const target = d.weeklyRateLb;
    const onTrackTxt =
      d.onTrack == null ? "no weekly goal set" : d.onTrack ? "ON TRACK" : "OFF TRACK";
    lines.push(
      `Trajectory: actual ${fmt(actual, " lb/wk")} vs target ${fmt(target, " lb/wk")} ` +
        `over ${d.weeksElapsed} weeks → ${onTrackTxt}. ` +
        `(Recomp scale move is slow on purpose — weigh this against body-fat % + tape, not just the scale.)`,
    );
  }
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
      `Hit the calorie target (±10%) on ${d.calorieHitRate != null ? Math.round(d.calorieHitRate * 100) : "—"}% of logged days. ` +
      `Logged ${d.daysLogged} days; ${d.daysUnderFloor} day(s) under the safe floor of ${d.safeFloorKcal} kcal.`,
  );
  lines.push(
    `Water: avg ${d.avgWaterMl != null ? `${Math.round(d.avgWaterMl / 29.5735)} oz (${d.avgWaterMl} mL)` : "not logged"}/day` +
      `${d.currentWeightLb != null ? ` at ${d.currentWeightLb} lb bodyweight` : ""}.`,
  );
  lines.push(
    `Sodium: avg ${d.avgSodiumMg != null ? `${d.avgSodiumMg} mg` : "not logged"}/day, ` +
      `ceiling ${d.sodiumLimitMg != null ? `${d.sodiumLimitMg} mg` : "~2300 mg (default)"}.`,
  );
  if (d.todayOpen) {
    // Phase 9 — ground the pace read in the LOCAL clock. People eat across a
    // ~7am–10pm window, so translate the hour into an "expected by now" calorie
    // fraction (not a flat 1/24 per hour) the coach can pace against. Only added
    // when the client has reported a timezone (else hour is null → omitted).
    let clockLine = "";
    if (d.todayLocalHour != null) {
      const hour = d.todayLocalHour;
      const pctDay =
        d.todayFractionElapsed != null
          ? Math.round(d.todayFractionElapsed * 100)
          : null;
      const eatFrac = Math.max(0, Math.min(1, (hour - 7) / 15));
      const expectedCal =
        d.calorieTarget != null ? Math.round(d.calorieTarget * eatFrac) : null;
      clockLine =
        ` It is about ${hour}:00 local${pctDay != null ? ` (${pctDay}% of the day elapsed)` : ""}.` +
        (expectedCal != null
          ? ` By this hour a typical eating day would have ~${expectedCal} of ${d.calorieTarget} kcal in;` +
            ` compare intake-so-far to THAT pace, not the full-day target — being "behind" the full day at midday is normal, not a miss.`
          : "");
    }
    // Protein PACE: the gap that matters most on an open day. Give the coach the
    // g-to-go and a rough per-remaining-meal figure (eating window ~7am–10pm) so
    // it can say "bury the other 122 g across ~2 meals" instead of "log more".
    let proteinPace = "";
    if (d.proteinTarget != null) {
      const toGo = Math.max(0, d.proteinTarget - (d.todayProteinSoFar ?? 0));
      const hour = d.todayLocalHour ?? 12;
      const mealsLeft = hour < 11 ? 3 : hour < 15 ? 2 : hour < 20 ? 1 : 1;
      proteinPace =
        toGo <= 0
          ? ` Protein target already hit for today — nice.`
          : ` Protein still to bury today: ${toGo} g (~${Math.round(toGo / mealsLeft)} g across the ~${mealsLeft} meal(s) likely left) — make this the priority.`;
    }
    lines.push(
      `\nTODAY (in progress, not closed) — coach this by PACE in the 'today' field, no warnings: ` +
        `calories ${d.todayCaloriesSoFar ?? 0} of ${d.calorieTarget ?? "—"}, ` +
        `protein ${d.todayProteinSoFar ?? 0} of ${d.proteinTarget ?? "—"} g, ` +
        `carbs ${d.todayCarbsSoFar ?? 0} of ${d.carbsTarget ?? "—"} g, ` +
        `fat ${d.todayFatSoFar ?? 0} of ${d.fatTarget ?? "—"} g, ` +
        `water ${d.todayWaterMl != null ? `${Math.round(d.todayWaterMl / 29.5735)} oz` : "—"}, ` +
        `sodium ${d.todaySodiumMg != null ? `${d.todaySodiumMg} mg` : "—"}.` +
        clockLine +
        proteinPace +
        ` Use these (not the averages) for the hydration + sodium reads while the day is open.`,
    );
  }
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
  // Prefer today's water while the day is open, else the logged-day average.
  const waterSrcMl = d.todayOpen ? d.todayWaterMl : d.avgWaterMl;
  const waterOz = waterSrcMl != null ? Math.round(waterSrcMl / 29.5735) : null;
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

  // Pace coaching for an open day (and a pace headline when there's no closed
  // history yet) so the read is useful mid-day instead of "not enough data".
  const calToGo =
    d.calorieTarget != null && d.todayCaloriesSoFar != null
      ? Math.max(0, d.calorieTarget - d.todayCaloriesSoFar)
      : null;
  const proToGo =
    d.proteinTarget != null && d.todayProteinSoFar != null
      ? Math.max(0, d.proteinTarget - d.todayProteinSoFar)
      : null;
  const todayLine = d.todayOpen
    ? `Today so far: ${d.todayCaloriesSoFar ?? 0}${d.calorieTarget != null ? ` of ${d.calorieTarget}` : ""} kcal, ` +
      `protein ${d.todayProteinSoFar ?? 0}${d.proteinTarget != null ? ` of ${d.proteinTarget}` : ""} g` +
      `${calToGo != null ? ` — about ${calToGo} kcal${proToGo != null ? ` and ${proToGo} g protein` : ""} to go` : ""}. ` +
      `Still eating, so this is pace, not a verdict — get protein in first.`
    : "";

  // Sodium: enough for a hard-training lifter, not chronically over the ceiling.
  const sodiumNow = d.todayOpen ? d.todaySodiumMg : d.avgSodiumMg;
  const sodiumLimit = d.sodiumLimitMg ?? 2300;
  const sodiumDetail =
    sodiumNow == null
      ? `Sodium isn't logged. Training hard at your size you want ADEQUATE sodium — roughly ${Math.round(sodiumLimit * 0.65)}–${sodiumLimit} mg most days (electrolytes fuel performance + replace sweat), more around big sweaty sessions; just don't sit chronically high for blood pressure.`
      : sodiumNow > sodiumLimit + 800
        ? `Sodium ~${sodiumNow} mg is well over your ${sodiumLimit} mg ceiling — fine around hard, sweaty training, but pull it back on easy/rest days for blood pressure.`
        : sodiumNow < 1500
          ? `Sodium ~${sodiumNow} mg is low — too little can flatten training and bring on cramps. A little salt / electrolytes around sessions helps performance and pumps.`
          : `Sodium ~${sodiumNow} mg sits in a sensible range under your ${sodiumLimit} mg ceiling — enough to fuel training without going overboard.`;

  const headline =
    deficitStatus === "under_floor"
      ? "You're under-fuelling — that stalls everything."
      : proteinStatus === "too_little"
        ? "Protein's below the recomp floor."
        : d.todayOpen && d.daysLogged === 0
          ? "Day's in progress — here's your pace."
          : "Here's your current nutrition read.";

  return {
    weeks: d.weeks,
    weeksElapsed: d.weeksElapsed,
    headline,
    today: todayLine,
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
      trend: `Over ${d.weeksElapsed} weeks: weight ${d.weightChangeLb != null ? `${d.weightChangeLb} lb` : "—"}` +
        `${d.actualWeeklyRateLb != null ? ` (${d.actualWeeklyRateLb} lb/wk${d.weeklyRateLb != null ? ` vs ${d.weeklyRateLb} target` : ""})` : ""}, ${leanTxt}.`,
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
    sodium: sodiumDetail,
    keyMoves,
    confidence,
    dataGaps,
    narrative: `${headline} ${proteinDetail}`,
  };
}

export { PROTEIN_FLOOR_G_PER_LB };
