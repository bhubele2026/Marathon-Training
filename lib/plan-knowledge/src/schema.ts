// JSON Schema for Claude's `propose_plan` tool. Claude calls this tool to emit
// (or re-emit) the full plan as validated, structured data — never loose text.
// Kept in sync with the AiPlan types in ./types.ts.

export const PROPOSE_PLAN_TOOL_NAME = "propose_plan";

// One real movement inside a strength day. The model's missing piece: a
// strength workout is an ordered list of these, not just a minute count.
const STRENGTH_BLOCK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["movement", "pattern", "sets", "reps", "loadType"],
  properties: {
    movement: {
      type: "string",
      description: 'Movement name, e.g. "Back Squat", "Bench Press".',
    },
    pattern: {
      type: "string",
      enum: [
        "squat",
        "hinge",
        "horizontal_push",
        "horizontal_pull",
        "vertical_push",
        "vertical_pull",
        "lunge",
        "carry",
        "core",
      ],
      description:
        "Primary movement pattern — used to balance the week (cover squat, hinge, pushes, pulls, legs, core).",
    },
    sets: { type: "number", description: "Working sets." },
    reps: {
      type: "string",
      description: 'Reps as a number or range, e.g. "5", "8-10", "12-15".',
    },
    loadType: {
      type: "string",
      enum: ["percent_1rm", "rir", "lb", "bodyweight"],
      description:
        "How the working load is targeted: % of 1RM, reps-in-reserve (RIR), absolute pounds, or bodyweight.",
    },
    loadValue: {
      type: ["number", "null"],
      description:
        "Numeric load for loadType: 75 (percent_1rm), 2 (rir), 135 (lb). Null for bodyweight.",
    },
    tempo: {
      type: ["string", "null"],
      description: 'Optional tempo, e.g. "3-1-1" (ecc-pause-con).',
    },
    restSec: {
      type: ["number", "null"],
      description: "Optional rest between sets, seconds.",
    },
    equipment: {
      type: ["string", "null"],
      description: 'Equipment for this movement, e.g. "Tonal", "Tonal + bench".',
    },
    tonalMode: {
      type: ["string", "null"],
      description:
        'Named Tonal mode to run (e.g. "eccentric", "chains", "burnout", "spotter"). Free text — Tonal has no public API.',
    },
    cue: {
      type: ["string", "null"],
      description: "Short coaching cue / note.",
    },
  },
} as const;

const DAY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "day",
    "isRest",
    "sessionType",
    "strengthMin",
    "cardioMin",
    "runMin",
    "equipmentList",
    "description",
  ],
  properties: {
    day: {
      type: "string",
      enum: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    },
    isRest: { type: "boolean", description: "True for full rest days." },
    sessionType: {
      type: "string",
      description:
        'Short label, e.g. "Rest", "Lower A", "Upper Pull", "Conditioning", "Long Run".',
    },
    strengthBlocks: {
      type: "array",
      items: STRENGTH_BLOCK_SCHEMA,
      description:
        "Ordered real strength movements for this day — the ACTUAL workout. " +
        "Required on every strength/lifting day (do NOT emit a lifting day as " +
        "minutes only). Omit / empty on rest, pure-conditioning, or pure-run " +
        "days. Express PROGRESSION by changing these week to week (load up, reps " +
        "up, or volume up) so week 1 differs from week 8 for the same movement.",
    },
    strengthMin: { type: "number", description: "Tonal / lifting minutes." },
    cardioMin: {
      type: "number",
      description: "Non-running cross-train minutes (bike/row/spin).",
    },
    runMin: {
      type: "number",
      description: "Treadmill or outdoor running minutes.",
    },
    distanceMi: {
      type: ["number", "null"],
      description: "Run distance in miles; null for non-run days.",
    },
    pace: {
      type: ["string", "null"],
      description: 'Pace target "mm:ss" per mile; null when not a run.',
    },
    equipmentList: {
      type: "array",
      items: { type: "string" },
      description:
        'Ordered machines used, e.g. ["Tonal", "Peloton Bike"]. Empty on rest days.',
    },
    description: {
      type: "string",
      description: "One-sentence prescription shown on the day card.",
    },
  },
} as const;

const WEEK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["week", "phase", "days"],
  properties: {
    week: { type: "integer", description: "1-based week number." },
    phase: {
      type: "string",
      description:
        'Phase label, e.g. "Foundation Build", "Aerobic Build", "Tempo / Threshold", "Race-Specific", "Taper & Race".',
    },
    days: {
      type: "array",
      description: "Exactly 7 days, Mon→Sun, in order.",
      items: DAY_SCHEMA,
    },
  },
} as const;

// Optional daily nutrition targets the coach attaches to the plan. On accept
// the server safety-clamps these and persists them as the nutrition baseline,
// so macros follow the PLAN (goal + safe deficit), not pure body-comp math.
const NUTRITION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["calorieTarget", "proteinTargetG", "carbsTargetG", "fatTargetG"],
  description:
    "Daily nutrition targets tied to this plan's goal and a SAFE deficit " +
    "(~0.5-1% bodyweight/wk, never a crash cut). Include this whenever the plan " +
    "has a fat-loss or body-composition goal so the macros follow the plan.",
  properties: {
    calorieTarget: { type: "number", description: "Daily calorie target (kcal)." },
    proteinTargetG: {
      type: "number",
      description: "Daily protein (g); ~0.8-1.0 g/lb to spare muscle in a deficit.",
    },
    carbsTargetG: { type: "number", description: "Daily carbohydrate (g)." },
    fatTargetG: { type: "number", description: "Daily fat (g)." },
    weeklyRateLb: {
      type: ["number", "null"],
      description:
        "Safe weekly rate of weight change this plan targets (lb/wk; >0 = loss).",
    },
    rationale: {
      type: ["string", "null"],
      description: "One-sentence rationale for the targets.",
    },
  },
} as const;

export const PROPOSE_PLAN_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "name", "goalKind", "startDate", "weeks"],
  properties: {
    summary: {
      type: "string",
      description:
        "2-4 sentence plain-language summary of the plan for the chat.",
    },
    name: {
      type: "string",
      description: 'Suggested config name, e.g. "12-Week Tonal Recomp".',
    },
    goalKind: {
      type: "string",
      enum: ["recomp", "strength", "hypertrophy", "fat_loss", "general", "race"],
      description:
        'What the plan builds toward. DEFAULT "recomp" (lose fat + build muscle). ' +
        'Use "race" ONLY when the client set a run race; everything else is a ' +
        "strength/body-composition plan where running is optional conditioning.",
    },
    raceKind: {
      type: ["string", "null"],
      enum: ["marathon", "half", "10k", "5k", "none", null],
      description:
        'The race distance when goalKind is "race"; otherwise "none"/null. Do not ' +
        "set a race on a strength/recomp plan the client didn't ask to race.",
    },
    tonalProgram: {
      type: ["string", "null"],
      description:
        "When you anchored this plan to a real Tonal program, its name (for the " +
        '"built around <X>" note). Structure replicated, not imported.',
    },
    startDate: {
      type: "string",
      description:
        "Week-1 start as ISO yyyy-mm-dd. Monday is the rest day; the server snaps " +
        "this to the Monday on/before it, so any date is fine.",
    },
    weeks: {
      type: "array",
      description: "Ordered weeks, each with exactly 7 days.",
      items: WEEK_SCHEMA,
    },
    nutrition: NUTRITION_SCHEMA,
  },
} as const;

export const PROPOSE_PLAN_TOOL = {
  name: PROPOSE_PLAN_TOOL_NAME,
  description:
    "Emit the complete training plan as structured data. Call this whenever you " +
    "want to show the runner a plan or an updated plan. Always emit the FULL plan " +
    "(every week, every day) — not a diff. Every lifting day MUST carry real " +
    "strengthBlocks (movements, sets, reps, load), not just minutes.",
  input_schema: PROPOSE_PLAN_INPUT_SCHEMA,
} as const;
