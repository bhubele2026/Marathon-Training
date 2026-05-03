// Pre-built plan template library (Task #84).
//
// Each template is a deterministic function `expand(totalUserWeeks)` that
// returns an ordered PhaseBlock[] summing to exactly `totalUserWeeks`. The
// resulting blocks slot into the existing PlannerConfig.blocks array and
// flow through the SAME generator/recipes pipeline as a hand-built config,
// which means the runner gets a fully populated 7-day-a-week plan with
// strength + cardio + run prescriptions for free — no separate engine.
//
// "User-block weeks" means the weeks BEFORE the auto-pinned 16-week
// Marathon-Specific tail. The marathon-specific block is always appended
// at generation time (see expandPlannerBlocks in ./index.ts) so a template
// only needs to fill the runner's training period leading up to the
// race-specific final phase.
//
// All templates are offline + deterministic — no LLM at Apply time. The
// citations below name the published source each template's mileage and
// phase shape were drawn from so the runner can read the original program.

import type { FocusType, PhaseBlock } from "./index.js";

export interface PlanTemplate {
  id: string;
  name: string;
  goalDistance: string;
  source: string;
  citation: string;
  shortDescription: string;
  longDescription: string;
  minUserWeeks: number;
  maxUserWeeks: number;
  defaultUserWeeks: number;
  // Deterministic expansion. Returns blocks summing to exactly the
  // `totalUserWeeks` argument; if the runner picks a value outside
  // [minUserWeeks, maxUserWeeks] the function still returns a valid
  // distribution but the UI surfaces a warning so the runner knows
  // the program may not match the published source.
  expand: (totalUserWeeks: number) => PhaseBlock[];
}

function makeBlock(
  focusType: FocusType,
  weeks: number,
  opts: { customName?: string; customNotes?: string } = {},
): PhaseBlock {
  return {
    focusType,
    weeks,
    customName:
      focusType === "Custom" ? opts.customName?.trim() || null : null,
    customNotes: opts.customNotes?.trim() || null,
  };
}

// Distribute `total` weeks across an ordered list of segments using
// proportional weights and per-segment minimums. Always returns blocks
// summing to exactly `total` (when total >= sum-of-mins); when total is
// below the sum of mins, segments are honored in order until the budget
// runs out so the runner still gets the most important phases.
interface Segment {
  focus: FocusType;
  weight: number;
  min: number;
  customName?: string;
  customNotes?: string;
}

function distribute(total: number, segments: Segment[]): PhaseBlock[] {
  const t = Math.max(0, Math.floor(total));
  if (t === 0 || segments.length === 0) return [];
  const minSum = segments.reduce((s, x) => s + x.min, 0);
  if (t < minSum) {
    const out: PhaseBlock[] = [];
    let remaining = t;
    for (const s of segments) {
      const w = Math.min(remaining, s.min);
      if (w > 0) {
        out.push(
          makeBlock(s.focus, w, {
            customName: s.customName,
            customNotes: s.customNotes,
          }),
        );
        remaining -= w;
      }
      if (remaining <= 0) break;
    }
    return out;
  }
  const extra = t - minSum;
  const totalWeight = segments.reduce((s, x) => s + x.weight, 0) || 1;
  const raw = segments.map(
    (s) => s.min + (extra * s.weight) / totalWeight,
  );
  const ints = raw.map((v) => Math.floor(v));
  let used = ints.reduce((s, n) => s + n, 0);
  const remainders = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  let k = 0;
  while (used < t && remainders.length > 0) {
    const idx = remainders[k % remainders.length]!.i;
    ints[idx] = (ints[idx] ?? 0) + 1;
    used += 1;
    k += 1;
  }
  return segments.map((s, i) =>
    makeBlock(s.focus, ints[i] ?? 0, {
      customName: s.customName,
      customNotes: s.customNotes,
    }),
  );
}

export const PLAN_TEMPLATES: PlanTemplate[] = [
  {
    id: "half_marathon",
    name: "Half Marathon",
    goalDistance: "13.1 mi",
    source: "Hal Higdon",
    citation:
      "Hal Higdon, Half Marathon Training Guide (Novice 2 / Intermediate). halhigdon.com",
    shortDescription:
      "Aerobic base mileage with a mid-cycle speed block and a 2-week taper.",
    longDescription:
      "Higdon's half-marathon recipe: build conversational mileage first, layer in tempo and cruise intervals once aerobic base is established, then taper for two weeks. Long runs progress from 4 mi to 10–12 mi over the build.",
    minUserWeeks: 8,
    maxUserWeeks: 24,
    defaultUserWeeks: 16,
    expand: (n) =>
      distribute(n, [
        { focus: "Base", weight: 5, min: 4 },
        { focus: "Speed", weight: 3, min: 3 },
        { focus: "Taper", weight: 1, min: 2 },
      ]),
  },
  {
    id: "marathon",
    name: "Marathon",
    goalDistance: "26.2 mi",
    source: "Pete Pfitzinger",
    citation:
      "Pfitzinger & Douglas, Advanced Marathoning (Up to 55 mpw plan).",
    shortDescription:
      "Endurance + lactate-threshold focus, then race-specific work in the auto-pinned tail.",
    longDescription:
      "Pfitzinger's mesocycle structure: mileage build, lactate threshold development, race-specific endurance, taper. The trailing 16-week Marathon-Specific block (auto-pinned) handles the final race-specific phase, so this template fills the lead-in build with Base + Time on Feet + Speed.",
    minUserWeeks: 8,
    maxUserWeeks: 30,
    defaultUserWeeks: 18,
    expand: (n) =>
      distribute(n, [
        { focus: "Base", weight: 4, min: 4 },
        { focus: "Time on Feet", weight: 4, min: 4 },
        { focus: "Speed", weight: 2, min: 2 },
      ]),
  },
  {
    id: "hansons_marathon",
    name: "Marathon (Hansons)",
    goalDistance: "26.2 mi",
    source: "Hansons-Brooks",
    citation:
      "Luke Humphrey, Hansons Marathon Method (Beginner / Advanced).",
    shortDescription:
      "Cumulative-fatigue model: capped long runs, six-day-a-week running, heavy mid-week tempo.",
    longDescription:
      "Hansons caps the long run at 16 mi and emphasizes consistent weekly mileage with hard tempo work. Two strength blocks bracket a sustained Time-on-Feet phase. The auto-pinned final 16 weeks layer in marathon-pace tempos.",
    minUserWeeks: 10,
    maxUserWeeks: 24,
    defaultUserWeeks: 18,
    expand: (n) =>
      distribute(n, [
        { focus: "Base", weight: 3, min: 3 },
        { focus: "Time on Feet", weight: 5, min: 5 },
        { focus: "Speed", weight: 2, min: 2 },
      ]),
  },
  {
    id: "5k_improver",
    name: "5K Improver",
    goalDistance: "3.1 mi",
    source: "Jack Daniels",
    citation:
      "Jack Daniels, Daniels' Running Formula 4ed — 5K-10K plan (Phase II/III).",
    shortDescription:
      "VO2max-biased speed block on top of a short aerobic base.",
    longDescription:
      "Daniels' 5K plan: short aerobic base, then a heavy interval block (R-pace and I-pace work) followed by a sharpening week. Use this as a 6–14 week in-season speed sharpener within the longer marathon campaign.",
    minUserWeeks: 6,
    maxUserWeeks: 14,
    defaultUserWeeks: 10,
    expand: (n) =>
      distribute(n, [
        { focus: "Base", weight: 2, min: 2 },
        { focus: "Speed", weight: 5, min: 4 },
        { focus: "Taper", weight: 1, min: 1 },
      ]),
  },
  {
    id: "couch_to_5k",
    name: "Couch to 5K",
    goalDistance: "3.1 mi",
    source: "NHS",
    citation:
      "NHS Couch to 5K (BBC One You) — 9-week run/walk progression.",
    shortDescription:
      "Run/walk intervals graduating from 60-second jogs to a continuous 30-minute run.",
    longDescription:
      "The classic NHS C25K progression: walk-run intervals across 9 weeks, building to a continuous 30-min run by week 9. Encoded as a Recovery + Base block sequence so cardio sessions stay short and conversational.",
    minUserWeeks: 6,
    maxUserWeeks: 12,
    defaultUserWeeks: 9,
    expand: (n) =>
      distribute(n, [
        { focus: "Recovery", weight: 1, min: 2 },
        { focus: "Base", weight: 2, min: 4 },
      ]),
  },
  {
    id: "10k_builder",
    name: "10K Builder",
    goalDistance: "6.2 mi",
    source: "Hal Higdon",
    citation:
      "Hal Higdon, 10K Training Guide (Intermediate). halhigdon.com",
    shortDescription:
      "Balanced base and speed for a fast 10K — perfect mid-campaign tune-up race.",
    longDescription:
      "Higdon's 10K formula: 60% aerobic base, 30% threshold/speed work, 10% taper. Best slotted as a tune-up race block 8–12 weeks before the marathon.",
    minUserWeeks: 6,
    maxUserWeeks: 16,
    defaultUserWeeks: 10,
    expand: (n) =>
      distribute(n, [
        { focus: "Base", weight: 3, min: 3 },
        { focus: "Speed", weight: 2, min: 2 },
        { focus: "Taper", weight: 1, min: 1 },
      ]),
  },
  {
    id: "aerobic_base",
    name: "Aerobic Base",
    goalDistance: "Aerobic capacity",
    source: "Arthur Lydiard",
    citation:
      "Arthur Lydiard, Running with Lydiard — Aerobic Base / Marathon Conditioning phase.",
    shortDescription:
      "Pure conversational mileage to build mitochondrial density and tendon resilience.",
    longDescription:
      "Lydiard's foundational philosophy: 4–16 weeks of aerobic-only running, all conversational, no quality work. Cutback weeks every 4th week. Builds the engine that all later speed work sits on top of.",
    minUserWeeks: 4,
    maxUserWeeks: 20,
    defaultUserWeeks: 12,
    expand: (n) => [makeBlock("Base", n)],
  },
  {
    id: "speed_block",
    name: "Speed Block",
    goalDistance: "Race sharpening",
    source: "Jack Daniels",
    citation:
      "Jack Daniels, Daniels' Running Formula 4ed — Phase III/IV quality.",
    shortDescription:
      "Concentrated VO2max + threshold block on a pre-built aerobic base.",
    longDescription:
      "Daniels' quality phases: 4–12 weeks of focused interval and tempo work. Assumes the runner already has aerobic base in the bank — pair this AFTER an Aerobic Base or Base template inside the same campaign.",
    minUserWeeks: 4,
    maxUserWeeks: 12,
    defaultUserWeeks: 8,
    expand: (n) => [makeBlock("Speed", n)],
  },
  {
    id: "hybrid_strength",
    name: "Hybrid Strength + Run",
    goalDistance: "General fitness",
    source: "Tactical Barbell",
    citation:
      "K. Black, Tactical Barbell II: Conditioning — Operator template.",
    shortDescription:
      "Heavy lifting prioritized; running stays at base aerobic volume to support recovery.",
    longDescription:
      "Tactical Barbell's Operator template: 3 heavy strength sessions per week as the primary stressor; running stays at conversational base pace to keep recovery cost low. Custom block tags every day with a strength-priority note.",
    minUserWeeks: 6,
    maxUserWeeks: 16,
    defaultUserWeeks: 12,
    expand: (n) =>
      distribute(n, [
        {
          focus: "Custom",
          weight: 4,
          min: 4,
          customName: "Strength Block",
          customNotes: "Strength is primary — keep runs conversational",
        },
        { focus: "Base", weight: 3, min: 2 },
      ]),
  },
  {
    id: "cardio_weight_loss",
    name: "Cardio + Weight Loss",
    goalDistance: "Body recomposition",
    source: "Phil Maffetone",
    citation:
      "Phil Maffetone, The Big Book of Endurance Training and Racing — MAF method.",
    shortDescription:
      "Low-HR aerobic emphasis with extra cross-train cardio for caloric throughput.",
    longDescription:
      "Maffetone's MAF method, adapted: keep all running below the aerobic ceiling, add 25 min of cross-train cardio onto strength days. Pair a short Recovery deload at the end so the body can adapt without pushing into overreaching.",
    minUserWeeks: 4,
    maxUserWeeks: 20,
    defaultUserWeeks: 12,
    expand: (n) =>
      distribute(n, [
        { focus: "Cardio + Weight Loss", weight: 5, min: 4 },
        { focus: "Recovery", weight: 1, min: 1 },
      ]),
  },
  {
    id: "recovery",
    name: "Recovery",
    goalDistance: "Active recovery",
    source: "Iñigo Mujika",
    citation:
      "Iñigo Mujika, Endurance Training — Science and Practice (transition phase guidance).",
    shortDescription:
      "Active recovery: short easy runs, low load, two rest days per week.",
    longDescription:
      "Mujika's transition-phase prescription for in-season recovery: 2–6 weeks of low-volume, low-intensity work to restore freshness. Friday quality is dropped for an extra rest day; long runs cap at 4 mi.",
    minUserWeeks: 2,
    maxUserWeeks: 6,
    defaultUserWeeks: 3,
    expand: (n) => [makeBlock("Recovery", n)],
  },
  {
    id: "maintenance",
    name: "Maintenance",
    goalDistance: "Hold fitness",
    source: "Hal Higdon",
    citation:
      "Hal Higdon, Maintenance training (post-marathon / between cycles).",
    shortDescription:
      "Hold current fitness with a steady aerobic diet — no new stress.",
    longDescription:
      "A holding pattern between training cycles: 4–12 weeks of conversational base running, no progressive overload. Useful for life-busy stretches when the goal is to NOT lose fitness rather than to gain it.",
    minUserWeeks: 4,
    maxUserWeeks: 12,
    defaultUserWeeks: 6,
    expand: (n) => [makeBlock("Base", n)],
  },
];

export function getTemplateById(id: string): PlanTemplate | null {
  return PLAN_TEMPLATES.find((t) => t.id === id) ?? null;
}

// Three opinionated starter shortcuts: each picks a template AND a date span
// (relative to "next Monday"). Used by the planner page to one-click a fully
// populated config for the most common runner journeys.
export interface StarterShortcut {
  id: string;
  name: string;
  description: string;
  templateId: string;
  // Total weeks from training-start Monday to race-day Sunday (inclusive).
  // The auto-pinned 16-week tail is included in this number, so the
  // template fills (totalWeeks - 16) user-block weeks.
  totalWeeks: number;
}

export const STARTER_SHORTCUTS: StarterShortcut[] = [
  {
    id: "hm_beginner_16w",
    name: "HM Beginner — 16 weeks",
    description:
      "Half-marathon prep using Higdon's Novice 2. Ends with the auto-pinned 16-week marathon-specific tail (32 weeks total).",
    templateId: "half_marathon",
    totalWeeks: 32,
  },
  {
    id: "marathon_first_timer_24w",
    name: "Marathon First-Timer — 24 weeks",
    description:
      "Pfitzinger 18/55 build + auto-pinned race-specific tail. 40 weeks total — gentle ramp for a first marathon.",
    templateId: "marathon",
    totalWeeks: 40,
  },
  {
    id: "get_faster_5k_14w",
    name: "Get Faster 5K — 14 weeks",
    description:
      "Daniels 5K speed block followed by the auto-pinned marathon-specific tail. 30 weeks total — sharpen, then build for the marathon.",
    templateId: "5k_improver",
    totalWeeks: 30,
  },
];
