// The AI Nutritionist: a deep, body-comp-aware read of how the runner is doing
// on protein, fuelling, and recomposition. Pure + DB-free so the math and the
// prompt assembly are unit-testable; the route gathers the metrics and calls
// Claude. Claude does the reasoning, but it is grounded in a deterministic,
// safety-railed metrics gather (it can never tell the runner to eat below the
// floor or lose faster than the safe rate — those flags are computed here and
// passed in as ground truth).

import type {
  NutritionistReport,
  NutritionInsight,
  InsightStatus,
  InsightPerDay,
  InsightSeriesPoint,
  BodyTrajectoryPoint,
  BodyStat,
  AlcoholStats,
} from "@workspace/db";
import { PROTEIN_FLOOR_G_PER_LB } from "./nutrition-safety";

const round1 = (n: number) => Math.round(n * 10) / 10;
const oz = (ml: number) => Math.round(ml / 29.5735);

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
  // Per-day FINAL logged days (oldest → newest, recent window) for the insight
  // trend sparklines + adherence dots. The engine derives each metric's series,
  // perDay hit/close/miss, and days-on-target from this — no new analytics, just
  // the daily values the averages were already built from.
  dailyLog: DailyLogPoint[];
  // Body-composition readings over the window (oldest → newest) for the recomp
  // trajectory chart. lean/fat are derived per reading from its own weight+bf%.
  bodyLog: BodyTrajectoryPoint[];
  // Alcohol read (reduction tool): dry days vs the weekly target, the week-over-
  // week trend, and what drinking is costing training/eating. Undefined when the
  // feature has no data — the coach simply doesn't mention it then.
  alcohol?: AlcoholStats;
};

// One final logged day's macro values (null where that metric wasn't logged).
export type DailyLogPoint = {
  date: string;
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  waterOz: number | null;
  sodiumMg: number | null;
};

// --- Structured output tool (Claude returns the report as validated JSON) ---

export const NUTRITIONIST_TOOL_NAME = "emit_nutrition_report";

// Per-insight COPY only — the AI's whole job per insight is a one-liner and an
// optional longer "why". Every NUMBER that drives a chart is computed server-side
// and must NOT be supplied here.
const INSIGHT_COPY = {
  type: "object",
  additionalProperties: false,
  required: ["caption"],
  properties: {
    caption: {
      type: "string",
      description:
        "ONE short, punchy line in the coach voice that NAMES THE NUMBER (e.g. 'You're at 0.78 g/lb — one chicken breast short of the floor.'). No hedging, no preamble. Warm (no sarcasm) for any health flag.",
    },
    detail: {
      type: "string",
      description:
        "2-3 sentences of the longer reasoning shown behind a 'why' expander: what the trend means, what under/over is doing, and the principle-based fix. Reference the real figures. For body-comp: what the trajectory SHOULD look like for the goal and, if it isn't, the most likely WHY tied to their inputs.",
    },
  },
} as const;

const REPORT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "today", "insights", "keyMoves", "confidence", "dataGaps", "narrative"],
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
    insights: {
      type: "object",
      additionalProperties: false,
      description:
        "Per-insight COPY (caption + optional detail) for each read in the brief. Provide each that's relevant. The actual/target/floor/ceiling/series/status are all computed server-side — you supply ONLY the words, never numbers as data.",
      properties: {
        protein: INSIGHT_COPY,
        carbs: INSIGHT_COPY,
        fat: INSIGHT_COPY,
        fuelling: INSIGHT_COPY,
        hydration: INSIGHT_COPY,
        sodium: INSIGHT_COPY,
        bodycomp: INSIGHT_COPY,
        // Alcohol tiles (only when there's alcohol data). 'alcohol' = what this
        // week's drinking is costing training/eating (within budget → neutral,
        // over → soft nudge, NEVER red/shame). 'dryDays' = the win, dry days vs
        // target + the week-over-week trend (frame dry days as the score going
        // up; small samples are an early read).
        alcohol: INSIGHT_COPY,
        dryDays: INSIGHT_COPY,
      },
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
    `## Alcohol — weigh it WITH everything else, never as a separate box\n` +
    `If the brief includes an alcohol read, it is a first-class input you reason about ` +
    `ALONGSIDE protein, calories, training and recomposition — not a bolt-on. Know the ` +
    `physiology and let it COMPOUND with the rest: alcohol suppresses muscle protein ` +
    `synthesis and blunts recovery, degrades sleep (so next-day training quality and ` +
    `appetite control suffer), adds empty calories straight against a recomp deficit, and ` +
    `dehydrates — and every one of those hits HARDER when protein is already low, the ` +
    `deficit is real, or training volume is high. So tie it together: "under protein AND ` +
    `four drinking nights is a double hit on the recomp," "the 3 next-day load dips line up ` +
    `with your drinking days." When you talk diet/training, factor alcohol in; when you talk ` +
    `alcohol, use the bodyweight, protein pace, calorie target and session load to make the ` +
    `read specific.\n` +
    `REQUIRED when the brief carries an alcohol IMPACT read (next-day training load on drinking ` +
    `vs dry days) or alcohol history beyond this week: include ONE concrete line on what the ` +
    `drinking is doing to the TRAINING across the whole window — name the next-day load gap and ` +
    `say whether the pattern is holding, easing, or worsening over the weeks, not just this week. ` +
    `Read the EARLY weeks too, not only the latest; if the window is long but data is thin in the ` +
    `early weeks, say so and treat it as a trend forming.\n` +
    `TONE for alcohol (non-negotiable — this is a habit being WORKED DOWN, not a failure to ` +
    `mock): dry days are WINS — frame them as the score going up. Drinking WITHIN the weekly ` +
    `budget is NEUTRAL, not a red flag; over budget is a SOFT nudge, never shame, never ` +
    `"failed". Be honest about real effects but don't catastrophize, and when there are fewer ` +
    `than ~2 weeks of data say it's an early read. Wry but genuinely supportive here.\n\n` +
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
    `## What you produce (visual-first)\n` +
    `The app DRAWS every number (actual vs target, the floor/ceiling band, the trend, days-on-target) ` +
    `from server-computed values — you do NOT supply any numbers as data. For each insight you give ` +
    `only words: a one-line 'caption' (the punchy read, naming the number) and an optional 'detail' ` +
    `(2-3 sentences of the deeper why, shown behind a "why"). Keep captions to a single line — the ` +
    `chart carries the figures, your line carries the meaning. Cover protein, carbs, fuelling ` +
    `(calories), hydration, sodium, and bodycomp (the recomposition read).\n` +
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
  if (d.alcohol?.active) {
    const a = d.alcohol;
    const impactTxt =
      a.impact.length > 0
        ? ` Impact so far — ${a.impact.map((i) => i.note).join(" ")}`
        : a.seedState
          ? ` Under ~2 weeks of tracking, so treat impact as an EARLY read, not proof.`
          : "";
    lines.push(
      `\nAlcohol (reduction tool — dry days are the WIN; weave this in WITH protein/calories/` +
        `training, don't quarantine it): goal ${a.dryDaysTarget} dry days/week. This week ` +
        `${a.dryDaysThisWeek} dry so far, ${a.drinkingDaysThisWeek} drinking day(s) (budget ` +
        `${a.drinkingBudget}), ${a.weekDrinks} standard drinks. Current dry streak ` +
        `${a.currentDryStreak} day(s) (longest ${a.longestDryStreak}). Week-over-week: ` +
        `${a.weeksOnTarget}/${a.weeksTracked} completed weeks hit target, avg ` +
        `${fmt(a.avgDryPerWeek)} dry/wk, ${a.weeksOnTargetStreak}-week on-target streak.` +
        impactTxt +
        ` Within budget reads NEUTRAL, over budget a SOFT nudge — never shame.`,
    );
  }
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
  const insights = computeInsights(d);
  const find = (id: NutritionInsight["id"]) => insights.find((i) => i.id === id)!;
  const proteinStatus = find("protein").status;
  const deficitStatus = find("fuelling").status;

  const keyMoves: string[] = [];
  if (deficitStatus === "under") keyMoves.push(`Eat at least ${d.safeFloorKcal} kcal — protein first.`);
  if (proteinStatus === "under")
    keyMoves.push(
      `Get protein to ~${Math.round((d.currentWeightLb ?? 0) * d.proteinFloorGPerLb) || d.proteinTarget || 0} g/day, every day.`,
    );
  if (d.plannedSessions > 0 && d.sessionsDone / d.plannedSessions < 0.7)
    keyMoves.push("Get session consistency above ~80%.");
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

  const headline =
    deficitStatus === "under"
      ? "You're under-fuelling — that stalls everything."
      : proteinStatus === "under"
        ? "Protein's below the recomp floor."
        : d.todayOpen && d.daysLogged === 0
          ? "Day's in progress — here's your pace."
          : "Here's your current nutrition read.";

  return {
    weeks: d.weeks,
    weeksElapsed: d.weeksElapsed,
    headline,
    insights,
    today: todayLine,
    keyMoves,
    confidence,
    dataGaps,
    narrative: `${headline} ${find("protein").detail ?? ""}`.trim(),
    sessionsDone: d.sessionsDone,
    plannedSessions: d.plannedSessions,
  };
}

// --- Insight assembly: the ENGINE owns every number + status + a deterministic
// caption/detail. The AI overlay (in the route) replaces only caption/detail.
// Pure + DB-free so it's unit-testable and identical between the AI and fallback
// paths — the charts read these numbers, so they are always correct. -----------

function statusColorIsHealthFlag(s: InsightStatus): boolean {
  return s === "under" || s === "over";
}

export function computeInsights(d: AnalysisInput): NutritionInsight[] {
  const log = d.dailyLog;
  const series = (pick: (p: DailyLogPoint) => number | null): InsightSeriesPoint[] =>
    log
      .map((p) => ({ date: p.date, value: pick(p) }))
      .filter((q): q is InsightSeriesPoint => q.value != null);
  const perDay = (
    pick: (p: DailyLogPoint) => number | null,
    classify: (v: number) => "hit" | "close" | "miss",
  ): InsightPerDay[] =>
    log.map((p) => {
      const v = pick(p);
      return { date: p.date, hit: v == null ? ("none" as const) : classify(v) };
    });
  const hits = (pd: InsightPerDay[]) => pd.filter((x) => x.hit === "hit").length;
  const logged = (pd: InsightPerDay[]) => pd.filter((x) => x.hit !== "none").length;

  const out: NutritionInsight[] = [];

  // ---------- PROTEIN (higher is better; hard recomp floor) ----------
  {
    const gPerLb = d.proteinGPerLb;
    const floorG = d.currentWeightLb != null ? Math.round(d.currentWeightLb * d.proteinFloorGPerLb) : null;
    const target = d.proteinTarget;
    let status: InsightStatus;
    if (d.avgProtein == null) status = "early";
    else if (gPerLb != null && gPerLb < 0.7) status = "under";
    else if (floorG != null && d.avgProtein < floorG) status = "under";
    else if (target != null && d.avgProtein >= target * 1.05) status = "ahead";
    else if (target != null && d.avgProtein >= target * 0.95) status = "on_track";
    else status = "attention";
    const pd = perDay(
      (p) => p.proteinG,
      (v) => (target == null ? "hit" : v >= target * 0.95 ? "hit" : v >= target * 0.8 ? "close" : "miss"),
    );
    const caption =
      gPerLb == null
        ? "Log a few more days so I can read your protein."
        : status === "under"
          ? `${gPerLb} g/lb — under the ${d.proteinFloorGPerLb} floor. Bump it.`
          : status === "ahead"
            ? `${gPerLb} g/lb — covered, maybe to spare.`
            : `${gPerLb} g/lb — right in the recomp pocket.`;
    const detail =
      gPerLb == null
        ? "Not enough logged protein to judge adequacy yet — log meals on more days."
        : status === "under"
          ? `Averaging ${gPerLb} g/lb, under the ~${d.proteinFloorGPerLb} g/lb recomp floor. In a deficit that's where muscle starts leaking away — anchor a protein serving at each meal. Spread it across 3-4 meals (~0.4 g/lb each), one near training.`
          : status === "ahead"
            ? `Averaging ${gPerLb} g/lb — plenty for muscle; more isn't buying extra and may be crowding out the carbs that fuel training. Daily totals only, so treat distribution as a principle, not a read of your timing.`
            : `Averaging ${gPerLb} g/lb — right in the recomp pocket for holding and building muscle. Keep spreading it across 3-4 meals, one near your session.`;
    out.push({
      id: "protein",
      label: "Protein",
      group: "macros",
      unit: "g",
      actual: d.avgProtein,
      target,
      floor: floorG,
      direction: "higher_better",
      series: series((p) => p.proteinG),
      goal: target,
      daysLogged: logged(pd),
      daysHit: hits(pd),
      perDay: pd,
      status,
      subMetric:
        gPerLb != null
          ? `${gPerLb} g/lb · floor ${d.proteinFloorGPerLb}`
          : floorG != null
            ? `floor ${floorG} g`
            : null,
      caption,
      detail,
    });
  }

  // ---------- FUELLING / calories (band: floor..target) ----------
  {
    const target = d.calorieTarget;
    const floor = d.safeFloorKcal;
    let status: InsightStatus;
    if (d.avgCalories == null) status = "early";
    else if (d.avgCalories < floor) status = "under";
    else if (target != null && d.avgCalories > target + 100) status = "over";
    else status = "appropriate";
    const pd = perDay(
      (p) => p.calories,
      (v) =>
        v < floor
          ? "miss"
          : target == null
            ? "hit"
            : Math.abs(v - target) <= target * 0.1
              ? "hit"
              : Math.abs(v - target) <= target * 0.2
                ? "close"
                : "miss",
    );
    const caption =
      d.avgCalories == null
        ? "Not enough logged days to read your fuelling."
        : status === "under"
          ? `~${Math.round(d.avgCalories)} kcal — under your ${floor} floor. Eat up.`
          : status === "over"
            ? `~${Math.round(d.avgCalories)} kcal — over target, fat loss will drag.`
            : `~${Math.round(d.avgCalories)} kcal — fuelling sits in a sensible place.`;
    const detail =
      d.avgCalories == null
        ? "Log meals on more days so I can read your fuelling against the floor and target."
        : status === "under"
          ? `Average intake (${Math.round(d.avgCalories)} kcal) is under your safe floor of ${floor} kcal. That's too little to recover or hold muscle — bring it up, protein first.`
          : status === "over"
            ? `Intake is running over your ${target} kcal target, which blunts the deficit fat loss needs. Trim from fats/refined carbs, keep protein where it is.`
            : `Fuelling is in a reasonable place versus your ${target ?? "—"} kcal target and above the ${floor} kcal floor.`;
    out.push({
      id: "fuelling",
      label: "Fuelling",
      group: "fuelling",
      unit: "kcal",
      actual: d.avgCalories,
      target,
      floor,
      ceiling: target,
      direction: "band",
      series: series((p) => p.calories),
      goal: target != null ? { lo: floor, hi: target } : floor,
      daysLogged: logged(pd),
      daysHit: hits(pd),
      perDay: pd,
      status,
      subMetric: null,
      caption,
      detail,
    });
  }

  // ---------- CARBS (higher is better — they fuel training) ----------
  {
    const target = d.carbsTarget;
    let status: InsightStatus;
    if (d.avgCarbs == null) status = "early";
    else if (target == null) status = "on_track";
    else if (d.avgCarbs > target * 1.3) status = "over";
    else if (d.avgCarbs >= target * 0.9) status = "on_track";
    else if (d.avgCarbs >= target * 0.6) status = "attention";
    else status = "under";
    const pd = perDay(
      (p) => p.carbsG,
      (v) => (target == null ? "hit" : v >= target * 0.9 ? "hit" : v >= target * 0.6 ? "close" : "miss"),
    );
    const caption =
      d.avgCarbs == null
        ? "Carbs aren't logged enough to read yet."
        : status === "under"
          ? `${Math.round(d.avgCarbs)} g carbs vs ${target} — low fuel for hard sessions.`
          : status === "over"
            ? `${Math.round(d.avgCarbs)} g carbs — over target; trim if calories run high.`
            : `${Math.round(d.avgCarbs)} g carbs — enough to fuel the work.`;
    const detail =
      d.avgCarbs == null
        ? "Log carbs on more days so I can read whether training is fuelled."
        : status === "under"
          ? `Averaging ${Math.round(d.avgCarbs)} g vs a ${target} g target — carbs are the lever that fuels hard sessions and spares protein. Put more around training when energy matters most.`
          : status === "over"
            ? `Averaging ${Math.round(d.avgCarbs)} g, over the ${target} g target — fine if calories hold, but the first place to trim if fuelling is running surplus.`
            : `Averaging ${Math.round(d.avgCarbs)} g against a ${target} g target — enough to fuel training and protect performance on a deficit.`;
    out.push({
      id: "carbs",
      label: "Carbs",
      group: "macros",
      unit: "g",
      actual: d.avgCarbs,
      target,
      direction: "higher_better",
      series: series((p) => p.carbsG),
      goal: target,
      daysLogged: logged(pd),
      daysHit: hits(pd),
      perDay: pd,
      status,
      subMetric:
        target != null && d.avgCarbs != null && d.avgCarbs < target
          ? `−${Math.round(target - d.avgCarbs)} g to target`
          : null,
      caption,
      detail,
    });
  }

  // ---------- FAT (target band — hit it, don't overshoot) ----------
  {
    const target = d.fatTarget;
    let status: InsightStatus;
    if (d.avgFat == null) status = "early";
    else if (target == null) status = "on_track";
    else if (d.avgFat > target * 1.25) status = "over";
    else if (d.avgFat >= target * 0.85) status = "on_track";
    else if (d.avgFat >= target * 0.6) status = "attention";
    else status = "under";
    const pd = perDay(
      (p) => p.fatG,
      (v) => (target == null ? "hit" : v >= target * 0.85 && v <= target * 1.25 ? "hit" : v >= target * 0.6 ? "close" : "miss"),
    );
    const caption =
      d.avgFat == null
        ? "Fat isn't logged enough to read yet."
        : status === "over"
          ? `${Math.round(d.avgFat)} g fat — a touch over; trim if calories run high.`
          : status === "under"
            ? `${Math.round(d.avgFat)} g fat vs ${target} — a little low for hormones.`
            : `${Math.round(d.avgFat)} g fat — right where it should be.`;
    const detail =
      d.avgFat == null
        ? "Log fat on more days so I can confirm hormone-supporting intake."
        : status === "over"
          ? `Averaging ${Math.round(d.avgFat)} g, over the ${target} g target — fine if calories hold; fat's the easiest lever to trim when fuelling runs surplus.`
          : status === "under"
            ? `Averaging ${Math.round(d.avgFat)} g vs ${target} g — enough fat matters for hormones and satiety; don't drive it too low on a long cut.`
            : `Averaging ${Math.round(d.avgFat)} g against a ${target} g target — sorted. Leave it alone and spend your attention on carbs.`;
    out.push({
      id: "fat",
      label: "Fat",
      group: "macros",
      unit: "g",
      actual: d.avgFat,
      target,
      direction: "band",
      series: series((p) => p.fatG),
      goal: target,
      daysLogged: logged(pd),
      daysHit: hits(pd),
      perDay: pd,
      status,
      subMetric: target != null && d.avgFat != null ? `${Math.round((d.avgFat / target) * 100)}% of target` : null,
      caption,
      detail,
    });
  }

  // ---------- HYDRATION (higher is better; ~½ oz per lb aim) ----------
  {
    const targetOz = d.currentWeightLb != null ? Math.round(d.currentWeightLb * 0.5) : null;
    // Match prior behaviour: prefer today's water on an open day, else the avg.
    const srcMl = d.todayOpen ? d.todayWaterMl : d.avgWaterMl;
    const actualOz = srcMl != null ? oz(srcMl) : null;
    let status: InsightStatus;
    if (actualOz == null) status = "early";
    else if (targetOz == null) status = "on_track";
    else if (actualOz >= targetOz * 1.1) status = "ahead";
    else if (actualOz >= targetOz * 0.95) status = "on_track";
    else if (actualOz >= targetOz * 0.7) status = "attention";
    else status = "under";
    const pd = perDay(
      (p) => p.waterOz,
      (v) => (targetOz == null ? "hit" : v >= targetOz * 0.95 ? "hit" : v >= targetOz * 0.7 ? "close" : "miss"),
    );
    const caption =
      actualOz == null
        ? `Water's not logged${targetOz != null ? ` — aim ~${targetOz} oz/day` : ""}.`
        : status === "under"
          ? `~${actualOz} oz/day — under the ~${targetOz} oz aim. Drink up.`
          : `~${actualOz} oz/day — hydration's handled.`;
    const detail =
      actualOz == null
        ? `Water isn't logged yet${targetOz != null ? ` — aim for roughly ${targetOz} oz a day (about ½ oz per lb), more on training days` : ""}. Staying hydrated blunts appetite on a deficit and helps recovery.`
        : targetOz != null && actualOz < targetOz * 0.8
          ? `Averaging ~${actualOz} oz/day, under the ~${targetOz} oz aim for your size. More water curbs hunger on a deficit and supports recovery + protein metabolism.`
          : `Averaging ~${actualOz} oz/day — solid. That helps appetite control on a deficit and recovery; keep it up, more on hard training days.`;
    out.push({
      id: "hydration",
      label: "Hydration",
      group: "hydration",
      unit: "oz",
      actual: actualOz,
      target: targetOz,
      direction: "higher_better",
      series: series((p) => p.waterOz),
      goal: targetOz,
      daysLogged: logged(pd),
      daysHit: hits(pd),
      perDay: pd,
      status,
      subMetric:
        targetOz != null && actualOz != null && actualOz < targetOz
          ? `+${targetOz - actualOz} oz to go`
          : targetOz != null
            ? `½ oz per lb · ${targetOz} oz aim`
            : null,
      caption,
      detail,
    });
  }

  // ---------- SODIUM (band: adequacy floor..ceiling) ----------
  {
    const ceiling = d.sodiumLimitMg ?? 2300;
    const floor = Math.round(ceiling * 0.65);
    const src = d.todayOpen ? d.todaySodiumMg : d.avgSodiumMg;
    let status: InsightStatus;
    if (src == null) status = "early";
    else if (src > ceiling + 800) status = "over";
    else if (src < 1500) status = "under";
    else status = "appropriate";
    const pd = perDay(
      (p) => p.sodiumMg,
      (v) => (v >= floor && v <= ceiling ? "hit" : v >= 1500 && v <= ceiling + 800 ? "close" : "miss"),
    );
    const caption =
      src == null
        ? `Sodium's not logged — aim ~${floor}–${ceiling} mg.`
        : status === "over"
          ? `~${src} mg — over your ${ceiling} ceiling. Ease off rest days.`
          : status === "under"
            ? `~${src} mg — low; a little salt helps training.`
            : `~${src} mg — sensible, under your ${ceiling} ceiling.`;
    const detail =
      src == null
        ? `Sodium isn't logged. Training hard at your size you want ADEQUATE sodium — roughly ${floor}–${ceiling} mg most days (electrolytes fuel performance + replace sweat), more around big sweaty sessions; just don't sit chronically high for blood pressure.`
        : status === "over"
          ? `Sodium ~${src} mg is well over your ${ceiling} mg ceiling — fine around hard, sweaty training, but pull it back on easy/rest days for blood pressure.`
          : status === "under"
            ? `Sodium ~${src} mg is low — too little can flatten training and bring on cramps. A little salt / electrolytes around sessions helps performance and pumps.`
            : `Sodium ~${src} mg sits in a sensible range under your ${ceiling} mg ceiling — enough to fuel training without going overboard.`;
    out.push({
      id: "sodium",
      label: "Sodium",
      group: "sodium",
      unit: "mg",
      actual: src,
      target: ceiling,
      floor,
      ceiling,
      direction: "band",
      series: series((p) => p.sodiumMg),
      goal: { lo: floor, hi: ceiling },
      daysLogged: logged(pd),
      daysHit: hits(pd),
      perDay: pd,
      status,
      subMetric: `aim ${(floor / 1000).toFixed(1)}–${(ceiling / 1000).toFixed(1)}k mg`,
      caption,
      detail,
    });
  }

  // ---------- BODY COMPOSITION (the recomp trajectory) ----------
  {
    const bfChange =
      d.bodyFatPct != null && d.startBodyFatPct != null ? round1(d.bodyFatPct - d.startBodyFatPct) : null;
    const weightGood: BodyStat["goodDirection"] =
      d.goalDirection === "loss" ? "down" : d.goalDirection === "gain" ? "up" : "either";
    const bodyStats: BodyStat[] = [
      { key: "weight", label: "Weight", unit: "lb", value: d.currentWeightLb, change: d.weightChangeLb, goodDirection: weightGood },
      { key: "bodyfat", label: "Body-fat", unit: "%", value: d.bodyFatPct, change: bfChange, goodDirection: "down" },
      { key: "lean", label: "Lean", unit: "lb", value: d.leanMassLb, change: d.leanMassChangeLb, goodDirection: "up" },
      { key: "fat", label: "Fat", unit: "lb", value: d.fatMassLb, change: d.fatMassChangeLb, goodDirection: "down" },
    ];
    // Expected recomp band: where body-fat % SHOULD sit now given the goal.
    let expectedBand: { lo: number; hi: number } | null = null;
    if (d.startBodyFatPct != null && d.weeksElapsed > 0) {
      const w = d.weeksElapsed;
      if (d.bodyGoal === "cut")
        expectedBand = { lo: round1(d.startBodyFatPct - 0.5 * w), hi: round1(d.startBodyFatPct - 0.2 * w) };
      else if (d.bodyGoal === "recomp")
        expectedBand = { lo: round1(d.startBodyFatPct - 0.4 * w), hi: round1(d.startBodyFatPct - 0.15 * w) };
      else expectedBand = { lo: round1(d.startBodyFatPct - 0.1 * w), hi: round1(d.startBodyFatPct + 0.2 * w) };
    }
    let status: InsightStatus;
    if (d.bodyFatPct == null && d.weightChangeLb == null) status = "early";
    else if (d.onTrack === true) status = "on_track";
    else if (d.onTrack === false) status = "attention";
    else if (bfChange != null) status = bfChange <= 0 ? "on_track" : "attention";
    else status = d.weeksElapsed < 2 ? "early" : "attention";

    const leanTxt =
      d.leanMassChangeLb != null
        ? `lean mass ${d.leanMassChangeLb >= 0 ? "up" : "down"} ${Math.abs(d.leanMassChangeLb)} lb, fat mass ${
            d.fatMassChangeLb != null && d.fatMassChangeLb <= 0 ? "down" : "up"
          } ${d.fatMassChangeLb != null ? Math.abs(d.fatMassChangeLb) : "—"} lb`
        : d.bodyFatPct == null
          ? "body-fat % isn't logged, so I'm reading the scale and tape only"
          : "not enough body-fat readings to trend lean vs fat";
    const shouldSee =
      d.bodyGoal === "recomp"
        ? "On a recomp the scale moves slowly while body-fat % and the tape drift down and lean mass holds — judge it by those, not the scale."
        : d.bodyGoal === "cut"
          ? "On a cut you should see steady fat loss near your safe rate with lean mass largely preserved by protein + lifting."
          : "On a lean bulk you should see slow weight gain, most of it lean, with fat creeping only slightly.";
    const whyNot =
      d.proteinGPerLb != null && d.proteinGPerLb < 0.7
        ? "Protein under the floor is the most likely culprit — without it a deficit eats muscle and the recomp stalls."
        : d.avgCalories != null && d.calorieTarget != null && d.avgCalories > d.calorieTarget + 100
          ? "Intake is over target, so the deficit needed for fat loss isn't there."
          : d.plannedSessions > 0 && d.sessionsDone / d.plannedSessions < 0.7
            ? "Missed sessions mean the muscle-building stimulus is thin — the plan can't work the days it isn't run."
            : "Inputs look reasonable; if results are flat it may be early, or a genuine plateau worth a short diet break.";
    const caption =
      status === "early"
        ? "Log weight + body-fat % so I can trend your recomp."
        : `Over ${d.weeksElapsed} wk: weight ${d.weightChangeLb != null ? `${d.weightChangeLb} lb` : "—"}${
            d.actualWeeklyRateLb != null ? ` (${d.actualWeeklyRateLb} lb/wk)` : ""
          }, ${leanTxt}.`;
    const detail = `${shouldSee} ${whyNot}`;
    out.push({
      id: "bodycomp",
      label: "Body composition",
      group: "body",
      unit: "%",
      actual: d.bodyFatPct,
      target: null,
      direction: "lower_better",
      bodyTrajectory: d.bodyLog,
      bodyStats,
      expectedBand,
      series:
        d.bodyLog
          .filter((b) => b.bodyFatPct != null)
          .map((b) => ({ date: b.date, value: b.bodyFatPct as number })),
      status,
      caption,
      detail,
    });
  }

  // ---------- ALCOHOL — only when tracking has started ----------
  // Two tiles share the same deterministic read (rides on `alcohol`). Tone is
  // win-not-shame: dry days count UP; drinking within budget is NEUTRAL (status
  // 'appropriate', the tile renders a grey pill, NOT red); over budget is a soft
  // 'attention' nudge — we never use 'under'/'over' here (those map to red).
  if (d.alcohol?.active) {
    const a = d.alcohol;

    // Dry days — the positive metric (green when the weekly target is met).
    {
      let status: InsightStatus;
      if (a.seedState) status = "early";
      else if (a.dryDaysThisWeek >= a.dryDaysTarget) status = "ahead";
      else status = "attention";
      const toGo = Math.max(0, a.dryDaysTarget - a.dryDaysThisWeek);
      const caption = a.seedState
        ? `${a.dryDaysThisWeek} dry days so far — a couple weeks of logging and I can trend it.`
        : status === "ahead"
          ? `${a.dryDaysThisWeek} dry days this week — target ${a.dryDaysTarget} hit. 🙌`
          : `${a.dryDaysThisWeek} of ${a.dryDaysTarget} dry days so far — ${toGo} to go.`;
      const trendTxt =
        a.weeksTracked > 0
          ? `${a.weeksOnTarget} of the last ${a.weeksTracked} completed week(s) hit target, averaging ${a.avgDryPerWeek ?? "—"} dry days/week` +
            (a.weeksOnTargetStreak > 0 ? `, a ${a.weeksOnTargetStreak}-week on-target streak` : "") +
            "."
          : "Not enough completed weeks yet to call a week-over-week trend.";
      const detail = a.seedState
        ? `Dry days are the win, and they count up toward ${a.dryDaysTarget}/week. Keep logging drinks (and tap "Mark dry" on the clean days) for a couple of weeks and the streak + trend fill in.`
        : `Current dry streak ${a.currentDryStreak} day(s) (longest ${a.longestDryStreak}). ${trendTxt}`;
      out.push({
        id: "dryDays",
        label: "Dry days",
        group: "alcohol",
        unit: "days",
        actual: a.dryDaysThisWeek,
        target: a.dryDaysTarget,
        direction: "higher_better",
        status,
        alcohol: a,
        subMetric: `${a.dryDaysThisWeek}/${a.dryDaysTarget} this week`,
        caption,
        detail,
      });
    }

    // Alcohol intake — what this week's drinking is costing (never red).
    {
      const overBudget = a.drinkingDaysThisWeek > a.drinkingBudget;
      const status: InsightStatus = a.seedState
        ? "early"
        : overBudget
          ? "attention"
          : "appropriate";
      const caption = a.seedState
        ? `${a.weekDrinks} drinks this week — early days, keep logging.`
        : overBudget
          ? `${a.weekDrinks} drinks across ${a.drinkingDaysThisWeek} days — over your ${a.drinkingBudget}-day budget.`
          : `${a.weekDrinks} drinks, ${a.drinkingDaysThisWeek}/${a.drinkingBudget} drinking days — inside budget.`;
      const impactLine = a.impact.length > 0 ? " " + a.impact[0]!.note : "";
      const detail = a.seedState
        ? `Once there's ~2 weeks logged I'll compare your drinking days to your dry days — next-day training, protein, calories, hydration — so you can see the real cost. No verdicts on a handful of days.`
        : `${a.impact.map((i) => i.note).join(" ")}`.trim() ||
          `Drinking sat ${overBudget ? "over" : "inside"} budget this week. Within budget is fine; the cost shows up next-day in training and recovery, so keep stacking dry days.`;
      out.push({
        id: "alcohol",
        label: "Alcohol",
        group: "alcohol",
        unit: "drinks",
        actual: a.weekDrinks,
        target: null,
        direction: "lower_better",
        status,
        alcohol: a,
        subMetric: `${a.drinkingDaysThisWeek}/${a.drinkingBudget} drinking days` + impactLine,
        caption,
        detail,
      });
    }
  }

  // Significance-rank: float health flags (under/over) to the top, then
  // attention/early, then the steady reads. Stable within each tier by a fixed
  // priority so the order is deterministic.
  const tier = (s: InsightStatus) =>
    statusColorIsHealthFlag(s) ? 0 : s === "attention" || s === "early" ? 1 : 2;
  const priority: Record<NutritionInsight["id"], number> = {
    fuelling: 0,
    protein: 1,
    bodycomp: 2,
    carbs: 3,
    fat: 4,
    hydration: 5,
    sodium: 6,
    // Alcohol reads sit after the core nutrition reads in the steady tier.
    dryDays: 7,
    alcohol: 8,
  };
  return out.sort((a, b) => tier(a.status) - tier(b.status) || priority[a.id] - priority[b.id]);
}

export { PROTEIN_FLOOR_G_PER_LB };
