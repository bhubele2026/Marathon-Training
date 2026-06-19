// JSON Schema for Claude's `propose_plan` tool. Claude calls this tool to emit
// (or re-emit) the full plan as validated, structured data — never loose text.
// Kept in sync with the AiPlan types in ./types.ts.

export const PROPOSE_PLAN_TOOL_NAME = "propose_plan";

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
        'Short label, e.g. "Rest", "Long Run", "Strength + Cardio", "Run + Accessory".',
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
  required: ["summary", "name", "raceKind", "startDate", "weeks"],
  properties: {
    summary: {
      type: "string",
      description:
        "2-4 sentence plain-language summary of the plan for the chat.",
    },
    name: {
      type: "string",
      description: 'Suggested config name, e.g. "12-Week Lift + 10K Build".',
    },
    raceKind: {
      type: "string",
      enum: ["marathon", "half", "10k", "5k", "none"],
      description:
        'What the plan builds toward. Use "none" for a pure workout/strength plan with no race.',
    },
    startDate: {
      type: "string",
      description:
        'Campaign start as ISO yyyy-mm-dd. MUST be a Monday (week 1, day Mon).',
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
    "(every week, every day) — not a diff.",
  input_schema: PROPOSE_PLAN_INPUT_SCHEMA,
} as const;
