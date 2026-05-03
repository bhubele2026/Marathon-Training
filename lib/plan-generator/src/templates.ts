// Pre-built plan template library.
//
// Each template is a deterministic function `expand(weeks)` that returns
// an ordered PhaseBlock[] summing to exactly `weeks`. The template OWNS
// its own taper / race week — there is no auto-pinned 16-week tail
// appended by the generator when a config is built from entries (see
// PlannerConfig.entries in ./index.ts and the entries-mode branch of
// expandPlannerBlocks / validatePlannerConfig).
//
// Composition: a runner builds a plan by ORDERING template entries
// (e.g. [Aerobic Base 8w] then [Half Marathon 12w] = 20-week plan that
// ends on the half-marathon taper). Entries are added/reordered/removed
// in the planner UI; the deterministic engine expands each entry's
// template, concatenates the blocks, and feeds them through the same
// recipes pipeline that generates every workout.

import type { FocusType, PhaseBlock } from "./index.js";

export interface PlanTemplateMetadata {
  // Polarized / pyramidal / threshold-heavy / tempo-heavy / strength-priority
  intensityDistribution: string;
  // Mileage or duration of the peak long run (e.g. "20 mi", "16 mi cap", "30-min continuous")
  peakLongRun: string;
  // Peak weekly run volume rule (e.g. "~40-50 mpw", "Run-only 25-35 mpw")
  peakWeeklyVolume: string;
  // Taper length expressed in weeks (e.g. "2 weeks", "1 week", "None")
  taperLength: string;
  // Cutback / down-week cadence (e.g. "Every 4th week ~25% reduction")
  cutbackCadence: string;
  // Mandatory rest days per week (1 or 2 typically)
  mandatoryRestDays: number;
  // Equipment mix hint shown in the template card so the runner knows
  // what gear / cross-training the program assumes.
  equipmentMixHint: string;
}

export interface PlanTemplate {
  id: string;
  name: string;
  goalDistance: string;
  source: string;
  citation: string;
  shortDescription: string;
  longDescription: string;
  // Inclusive bounds for the runner-facing weeks selector. Picking a
  // value outside [min, max] is allowed but surfaces an "outside the
  // published range" warning in the UI.
  minWeeks: number;
  maxWeeks: number;
  defaultWeeks: number;
  metadata: PlanTemplateMetadata;
  // Lightweight, runner-facing topic tags surfaced as searchable chips
  // on the template card and matched by the planner's free-text filter.
  // Use short, lowercase, hyphen-or-space tokens (e.g. "polarized",
  // "hill focus", "low-mileage", "first-timer") so the runner can type
  // any chip text to find similar plans. Plumbed through the same
  // SEARCHABLE_FIELDS helper as name/source/equipment so adding new
  // tags lights them up in both the Plan Template Library card and the
  // entries-mode quick-add combobox in lock-step.
  tags: string[];
  // Deterministic expansion. Returns blocks summing to exactly the
  // `weeks` argument. Templates that include a taper place it as the
  // LAST block so the entry naturally ends on race week. Templates
  // without a race (recovery, maintenance, hybrid strength, etc.) omit
  // the taper.
  expand: (weeks: number) => PhaseBlock[];
}

// A single composed entry inside a PlannerConfig. The runner orders an
// array of these to build a plan; each entry references a template by id
// and supplies the runner-chosen week count for that template.
export interface TemplateEntry {
  templateId: string;
  weeks: number;
  // Optional human-friendly label for this entry, e.g. "Spring base
  // build". Surfaced in the composition editor and merged into the
  // first expanded block's customName when present.
  customName?: string | null;
  // Optional per-entry note (appended to expanded block customNotes).
  customNotes?: string | null;
  // Optional absolute start date (ISO yyyy-mm-dd, MUST be a Monday) for
  // this entry. When omitted, the entry stacks immediately after the
  // previous entry (back-to-back). When present and later than the
  // running cursor, a Recovery filler block is inserted to bridge the
  // gap (rest week / travel / off-season). Cannot precede the cursor
  // (no overlapping templates) — the validator rejects that. The first
  // entry's startDate (when set) must equal the config's startDate.
  startDate?: string | null;
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
// summing to exactly `total` (when total >= sum-of-mins). When total is
// below the sum of mins, segments are honored in declared order until
// the budget runs out — the LAST segment (typically the taper) is
// preferentially preserved by listing it with a high min relative to
// its weight so it's never dropped except in the most degenerate case.
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
    // Truncated path: honor declared order, drop trailing segments that
    // can't fit. This is a degenerate case (runner picked < the
    // template's published minimum) but we still produce a valid plan.
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
  const raw = segments.map((s) => s.min + (extra * s.weight) / totalWeight);
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
    id: "couch_to_5k",
    name: "Couch to 5K",
    goalDistance: "3.1 mi",
    source: "NHS / BBC One You",
    citation:
      "NHS Couch to 5K — 9-week run/walk progression. nhs.uk/live-well/exercise/couch-to-5k-week-by-week",
    shortDescription:
      "Run/walk intervals graduating from 60-second jogs to a continuous 30-minute run.",
    longDescription:
      "The classic NHS C25K progression: walk-run intervals across 9 weeks, building to a continuous 30-min run by week 9. Two recovery weeks bookend the build so a true beginner never compounds load.",
    minWeeks: 6,
    maxWeeks: 12,
    defaultWeeks: 9,
    metadata: {
      intensityDistribution: "100% conversational (run-walk)",
      peakLongRun: "30-min continuous run",
      peakWeeklyVolume: "3 short sessions / week",
      taperLength: "None — graduates straight into the 5K event",
      cutbackCadence: "No down weeks (volume already minimal)",
      mandatoryRestDays: 4,
      equipmentMixHint: "Run-only; optional walking on rest days",
    },
    tags: ["5k", "beginner", "first-timer", "run-walk", "low-mileage"],
    expand: (n) =>
      distribute(n, [
        { focus: "Recovery", weight: 1, min: 1 },
        { focus: "Base", weight: 4, min: 5 },
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
      "VO2max-biased speed block on top of a short aerobic base, ending with a 1-week sharpening taper.",
    longDescription:
      "Daniels' 5K plan: short aerobic base, then a heavy interval block (R-pace and I-pace work), capped by a 1-week sharpening taper. Pyramidal intensity distribution with one long run and two quality sessions per week.",
    minWeeks: 6,
    maxWeeks: 12,
    defaultWeeks: 8,
    metadata: {
      intensityDistribution: "Pyramidal — emphasis on R-pace + I-pace",
      peakLongRun: "8-10 mi",
      peakWeeklyVolume: "25-40 mpw",
      taperLength: "1 week",
      cutbackCadence: "Every 4th week ~20% volume reduction",
      mandatoryRestDays: 1,
      equipmentMixHint: "Run-only with optional easy spin / cross-train",
    },
    tags: ["5k", "intermediate", "speed", "vo2max", "pyramidal", "sharpening"],
    expand: (n) =>
      distribute(n, [
        { focus: "Base", weight: 2, min: 2 },
        { focus: "Speed", weight: 5, min: 3 },
        { focus: "Taper", weight: 1, min: 1 },
      ]),
  },
  {
    id: "10k_builder",
    name: "10K Builder",
    goalDistance: "6.2 mi",
    source: "Hal Higdon",
    citation:
      "Hal Higdon, 10K Training Guide (Intermediate). halhigdon.com/training/10k",
    shortDescription:
      "Balanced base and threshold mileage for a fast 10K, with a 1-week taper.",
    longDescription:
      "Higdon's 10K formula: ~60% aerobic base, ~30% threshold/speed work, 1-week taper. Best slotted as a tune-up race block 8-12 weeks before a longer goal race.",
    minWeeks: 8,
    maxWeeks: 14,
    defaultWeeks: 10,
    metadata: {
      intensityDistribution: "80/20 polarized with weekly tempo",
      peakLongRun: "8-10 mi",
      peakWeeklyVolume: "30-45 mpw",
      taperLength: "1 week",
      cutbackCadence: "Every 4th week ~20% volume reduction",
      mandatoryRestDays: 1,
      equipmentMixHint: "Run-only with optional cross-train on rest day",
    },
    tags: ["10k", "intermediate", "polarized", "tempo", "tune-up"],
    expand: (n) =>
      distribute(n, [
        { focus: "Base", weight: 4, min: 4 },
        { focus: "Speed", weight: 3, min: 3 },
        { focus: "Taper", weight: 1, min: 1 },
      ]),
  },
  {
    id: "half_marathon",
    name: "Half Marathon",
    goalDistance: "13.1 mi",
    source: "Hal Higdon",
    citation:
      "Hal Higdon, Half Marathon Training Guide (Intermediate). halhigdon.com/training/half-marathon",
    shortDescription:
      "Aerobic base mileage with a mid-cycle threshold/speed block and a 2-week taper.",
    longDescription:
      "Higdon's Intermediate-1 half-marathon recipe: build conversational mileage first, layer in tempo and cruise intervals once aerobic base is established, then taper for two weeks. Long runs progress from 4 mi to 10-12 mi over the build.",
    minWeeks: 10,
    maxWeeks: 16,
    defaultWeeks: 12,
    metadata: {
      intensityDistribution: "80/20 polarized with weekly tempo",
      peakLongRun: "10-12 mi",
      peakWeeklyVolume: "30-45 mpw",
      taperLength: "2 weeks",
      cutbackCadence: "Every 4th week ~25% volume reduction",
      mandatoryRestDays: 1,
      equipmentMixHint: "Run-only with optional cross-train on rest day",
    },
    tags: ["half-marathon", "intermediate", "polarized", "tempo"],
    expand: (n) =>
      distribute(n, [
        { focus: "Base", weight: 4, min: 4 },
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
      "Pfitzinger & Douglas, Advanced Marathoning 3ed — 18/55 plan (up to 55 mpw).",
    shortDescription:
      "Endurance base, lactate-threshold development, race-specific endurance, 3-week taper.",
    longDescription:
      "Pfitzinger's mesocycle structure: mileage build, lactate-threshold development, race-specific endurance with marathon-pace long runs, then a 3-week taper. The Marathon-Specific block at the end owns the race-pace work.",
    minWeeks: 16,
    maxWeeks: 24,
    defaultWeeks: 18,
    metadata: {
      intensityDistribution: "Pyramidal — heavy LT + MP work",
      peakLongRun: "20-22 mi",
      peakWeeklyVolume: "40-55 mpw",
      taperLength: "3 weeks",
      cutbackCadence: "Every 4th week ~20% volume reduction",
      mandatoryRestDays: 1,
      equipmentMixHint: "Run-only; cross-train discouraged late-cycle",
    },
    tags: ["marathon", "pfitzinger", "advanced", "pyramidal", "threshold", "race-pace"],
    expand: (n) =>
      distribute(n, [
        { focus: "Base", weight: 3, min: 4 },
        { focus: "Time on Feet", weight: 4, min: 4 },
        { focus: "Marathon-Specific", weight: 4, min: 5 },
        { focus: "Taper", weight: 2, min: 3 },
      ]),
  },
  {
    id: "ultramarathon_50k",
    name: "Ultramarathon 50K",
    goalDistance: "31 mi",
    source: "Jason Koop",
    citation:
      "Jason Koop, Training Essentials for Ultrarunning 2ed — 50K base + sustained TOF + 2w taper.",
    shortDescription:
      "Extended Time-on-Feet phase with back-to-back long runs; 2-week taper.",
    longDescription:
      "Koop's ultra prescription for first-timer 50K: aerobic base, then a long sustained Time-on-Feet phase emphasizing back-to-back long runs and time-on-feet over peak speed, capped by a 2-week taper.",
    minWeeks: 16,
    maxWeeks: 24,
    defaultWeeks: 20,
    metadata: {
      intensityDistribution: "85/15 polarized — dominant easy volume",
      peakLongRun: "Back-to-back long runs (e.g. 22 mi + 12 mi)",
      peakWeeklyVolume: "45-60 mpw",
      taperLength: "2 weeks",
      cutbackCadence: "Every 4th week ~30% volume reduction",
      mandatoryRestDays: 1,
      equipmentMixHint: "Run + hike + strength accessory work",
    },
    tags: ["ultra", "50k", "polarized", "back-to-back", "first-timer", "trail"],
    expand: (n) =>
      distribute(n, [
        { focus: "Base", weight: 3, min: 3 },
        { focus: "Time on Feet", weight: 7, min: 11 },
        { focus: "Taper", weight: 1, min: 2 },
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
      "Lydiard's foundational philosophy: 4-16 weeks of aerobic-only running, all conversational, no quality work. The engine that all later speed work sits on top of. Designed to be paired BEFORE a race-specific template entry.",
    minWeeks: 4,
    maxWeeks: 16,
    defaultWeeks: 8,
    metadata: {
      intensityDistribution: "100% conversational",
      peakLongRun: "12-16 mi",
      peakWeeklyVolume: "30-50 mpw",
      taperLength: "None — feeds into a follow-on race-specific entry",
      cutbackCadence: "Every 4th week ~25% volume reduction",
      mandatoryRestDays: 1,
      equipmentMixHint: "Run + optional easy bike / strength on rest days",
    },
    tags: ["base", "lydiard", "easy", "aerobic", "polarized", "lead-in"],
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
      "Concentrated VO2max + threshold block, capped with a 1-week sharpening taper.",
    longDescription:
      "Daniels' quality phases: 4-12 weeks of focused interval and tempo work plus a 1-week sharpening taper. Assumes the runner already has aerobic base in the bank — pair this AFTER an Aerobic Base entry inside the same campaign.",
    minWeeks: 4,
    maxWeeks: 8,
    defaultWeeks: 6,
    metadata: {
      intensityDistribution: "Pyramidal — emphasis on I-pace + T-pace",
      peakLongRun: "8-10 mi",
      peakWeeklyVolume: "30-40 mpw",
      taperLength: "1 week",
      cutbackCadence: "Every 4th week ~20% volume reduction",
      mandatoryRestDays: 1,
      equipmentMixHint: "Run-only; minimize cross-train late",
    },
    tags: ["speed", "vo2max", "threshold", "sharpening", "intermediate", "pyramidal"],
    expand: (n) =>
      distribute(n, [
        { focus: "Speed", weight: 5, min: 3 },
        { focus: "Taper", weight: 1, min: 1 },
      ]),
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
      "Tactical Barbell's Operator template: 3 heavy strength sessions per week as the primary stressor; running stays at conversational base pace to keep recovery cost low. Custom block tags every day with a strength-priority note. No taper — this is an ongoing maintenance template.",
    minWeeks: 6,
    maxWeeks: 12,
    defaultWeeks: 8,
    metadata: {
      intensityDistribution: "Strength-priority; running 100% conversational",
      peakLongRun: "8 mi",
      peakWeeklyVolume: "Run 15-25 mpw + 3 strength sessions",
      taperLength: "None — ongoing maintenance template",
      cutbackCadence: "Every 4th week deload both lifting and running",
      mandatoryRestDays: 1,
      equipmentMixHint: "Strength (barbell) + base running",
    },
    tags: ["hybrid", "strength-priority", "tactical-barbell", "low-mileage", "concurrent"],
    expand: (n) =>
      distribute(n, [
        {
          focus: "Custom",
          weight: 3,
          min: 3,
          customName: "Strength Block",
          customNotes: "Strength is primary — keep runs conversational",
        },
        { focus: "Base", weight: 2, min: 2 },
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
      "Low-HR aerobic emphasis with extra cross-train cardio; ends in a 1-2 week deload.",
    longDescription:
      "Maffetone's MAF method, adapted: keep all running below the aerobic ceiling (180-age HR), add extra cross-train cardio onto strength days for caloric throughput. Pair a short Recovery deload at the end so the body can adapt without pushing into overreaching.",
    minWeeks: 6,
    maxWeeks: 16,
    defaultWeeks: 10,
    metadata: {
      intensityDistribution: "100% sub-MAF aerobic",
      peakLongRun: "60-90 min easy",
      peakWeeklyVolume: "5-7 cardio sessions / week",
      taperLength: "1-2 week recovery deload",
      cutbackCadence: "Every 4th week reduce cardio volume ~25%",
      mandatoryRestDays: 1,
      equipmentMixHint: "Run + bike + rower mix; light strength",
    },
    tags: ["weight-loss", "recomposition", "MAF", "low-intensity", "cross-train"],
    expand: (n) =>
      distribute(n, [
        { focus: "Cardio + Weight Loss", weight: 6, min: 3 },
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
      "Mujika's transition-phase prescription for in-season recovery: 2-6 weeks of low-volume, low-intensity work to restore freshness. Friday quality is dropped for an extra rest day; long runs cap at 4 mi.",
    minWeeks: 2,
    maxWeeks: 6,
    defaultWeeks: 4,
    metadata: {
      intensityDistribution: "100% conversational",
      peakLongRun: "4 mi",
      peakWeeklyVolume: "10-20 mpw",
      taperLength: "N/A (entire entry IS the deload)",
      cutbackCadence: "Continuous reduced load; no further cutbacks",
      mandatoryRestDays: 2,
      equipmentMixHint: "Run + walking; mobility/stretching emphasis",
    },
    tags: ["recovery", "deload", "low-mileage", "transition", "off-season"],
    expand: (n) => [makeBlock("Recovery", n)],
  },
  {
    id: "maintenance",
    name: "Maintenance",
    goalDistance: "Hold fitness",
    source: "Hal Higdon",
    citation:
      "Hal Higdon, Maintenance training (between cycles / off-season).",
    shortDescription:
      "Hold current fitness with a steady aerobic diet — no progressive overload.",
    longDescription:
      "A holding pattern between training cycles: 4-12 weeks of conversational base running, no progressive overload. Useful for life-busy stretches when the goal is to NOT lose fitness rather than to gain it.",
    minWeeks: 4,
    maxWeeks: 12,
    defaultWeeks: 6,
    metadata: {
      intensityDistribution: "90/10 conversational with one easy stride day",
      peakLongRun: "8-10 mi",
      peakWeeklyVolume: "20-30 mpw",
      taperLength: "None — ongoing template",
      cutbackCadence: "No structured cutbacks",
      mandatoryRestDays: 1,
      equipmentMixHint: "Run + light cross-train on rest day",
    },
    tags: ["maintenance", "off-season", "easy", "low-mileage", "hold-fitness"],
    expand: (n) => [makeBlock("Base", n)],
  },
  // ---------------------------------------------------------------------
  // Tonal-first / non-running templates. Each expands into a single
  // Custom block whose customNotes carries the `[lift-primary:<kind>]`
  // sentinel that the generator's daily-recipes pipeline detects to
  // emit a lift-only week (Mon/Wed/Fri/Sat heavy Tonal lift; Tue/Thu/Sun
  // rest — no runs, no cardio sessions). These are the default starting
  // point for runners who use the Command Center as a general workout
  // planner instead of a marathon trainer.
  // ---------------------------------------------------------------------
  {
    id: "tonal_strength_upper",
    name: "Tonal Strength · Upper-Body Focus",
    goalDistance: "Upper-body strength",
    source: "Tonal coaching library",
    citation:
      "Tonal Strength Score — upper-body progression block (push/pull/core).",
    shortDescription:
      "Four heavy upper-body Tonal sessions per week with three full rest days.",
    longDescription:
      "Lift-primary Tonal block emphasizing upper-body push/pull (bench, row, overhead press, pull-up patterns) plus core. Mon/Wed/Fri/Sat are heavy Tonal sessions; Tue/Thu/Sun are full rest days for systemic recovery. No running or cardio sessions are scheduled — pair with another template for cardio if needed.",
    minWeeks: 4,
    maxWeeks: 16,
    defaultWeeks: 8,
    metadata: {
      intensityDistribution: "Strength-priority — 4 heavy lift days / week",
      peakLongRun: "N/A — lift-only template",
      peakWeeklyVolume: "4 heavy Tonal sessions / week",
      taperLength: "None — ongoing strength block",
      cutbackCadence: "Every 4th week deload Tonal load ~25%",
      mandatoryRestDays: 3,
      equipmentMixHint: "Tonal only (no cardio machines)",
    },
    tags: ["strength", "lift-only", "upper-body", "tonal", "hypertrophy"],
    expand: (n) => [
      makeBlock("Custom", n, {
        customName: "Tonal Upper Block",
        customNotes:
          "[lift-primary:upper] Upper-body push/pull emphasis — no runs scheduled",
      }),
    ],
  },
  {
    id: "tonal_strength_lower",
    name: "Tonal Strength · Lower-Body Focus",
    goalDistance: "Lower-body strength",
    source: "Tonal coaching library",
    citation:
      "Tonal Strength Score — lower-body progression block (squat/hinge/lunge).",
    shortDescription:
      "Four heavy lower-body Tonal sessions per week with three full rest days.",
    longDescription:
      "Lift-primary Tonal block emphasizing lower-body squat/hinge/lunge patterns plus posterior-chain accessory work. Mon/Wed/Fri/Sat are heavy Tonal sessions; Tue/Thu/Sun are full rest days. No running or cardio sessions are scheduled.",
    minWeeks: 4,
    maxWeeks: 16,
    defaultWeeks: 8,
    metadata: {
      intensityDistribution: "Strength-priority — 4 heavy lift days / week",
      peakLongRun: "N/A — lift-only template",
      peakWeeklyVolume: "4 heavy Tonal sessions / week",
      taperLength: "None — ongoing strength block",
      cutbackCadence: "Every 4th week deload Tonal load ~25%",
      mandatoryRestDays: 3,
      equipmentMixHint: "Tonal only (no cardio machines)",
    },
    tags: ["strength", "lift-only", "lower-body", "tonal", "hypertrophy"],
    expand: (n) => [
      makeBlock("Custom", n, {
        customName: "Tonal Lower Block",
        customNotes:
          "[lift-primary:lower] Lower-body squat/hinge emphasis — no runs scheduled",
      }),
    ],
  },
  {
    id: "push_pull_legs",
    name: "Push / Pull / Legs",
    goalDistance: "General hypertrophy",
    source: "Classic bodybuilding split",
    citation:
      "Schoenfeld et al., 'Strength and Hypertrophy Adaptations Between Low- vs. High-Load Resistance Training' — PPL split.",
    shortDescription:
      "Rotating push, pull, and legs days four times per week with rest in between.",
    longDescription:
      "Classic push/pull/legs hypertrophy split run on Tonal. Mon/Wed/Fri/Sat alternate through Push (chest/shoulders/triceps), Pull (back/biceps), and Legs (quads/hamstrings/glutes), then start the rotation again. Tue/Thu/Sun are full rest days. No running or cardio sessions are scheduled.",
    minWeeks: 4,
    maxWeeks: 16,
    defaultWeeks: 8,
    metadata: {
      intensityDistribution: "Hypertrophy-priority — rotating PPL split",
      peakLongRun: "N/A — lift-only template",
      peakWeeklyVolume: "4 lift sessions / week (PPL rotation)",
      taperLength: "None — ongoing hypertrophy block",
      cutbackCadence: "Every 4th week deload all lifts ~25%",
      mandatoryRestDays: 3,
      equipmentMixHint: "Tonal only (no cardio machines)",
    },
    tags: ["strength", "lift-only", "ppl", "hypertrophy", "tonal", "split"],
    expand: (n) => [
      makeBlock("Custom", n, {
        customName: "Push / Pull / Legs",
        customNotes:
          "[lift-primary:ppl] Rotating push/pull/legs split — no runs scheduled",
      }),
    ],
  },
  {
    id: "tonal_conditioning",
    name: "Tonal Strength + Conditioning",
    goalDistance: "Strength + work capacity",
    source: "Tonal coaching library",
    citation:
      "Tonal Strength Score — full-body strength + conditioning circuit block.",
    shortDescription:
      "Heavy full-body Tonal lifts paired with metabolic conditioning finishers.",
    longDescription:
      "Lift-primary block: heavy full-body Tonal compound lifts (squat, bench, row, press, deadlift) with short metabolic conditioning finishers on the same Tonal session — no separate cardio machine work. Mon/Wed/Fri/Sat are sessions; Tue/Thu/Sun are full rest days.",
    minWeeks: 4,
    maxWeeks: 16,
    defaultWeeks: 8,
    metadata: {
      intensityDistribution: "Strength + conditioning — 4 sessions / week",
      peakLongRun: "N/A — lift-only template",
      peakWeeklyVolume: "4 Tonal strength + finisher sessions / week",
      taperLength: "None — ongoing strength block",
      cutbackCadence: "Every 4th week deload load + finisher volume ~25%",
      mandatoryRestDays: 3,
      equipmentMixHint: "Tonal only (finishers performed on Tonal)",
    },
    tags: ["strength", "lift-only", "conditioning", "tonal", "full-body", "metcon"],
    expand: (n) => [
      makeBlock("Custom", n, {
        customName: "Tonal Conditioning Block",
        customNotes:
          "[lift-primary:conditioning] Full-body lift + finisher — no runs scheduled",
      }),
    ],
  },
  // ========================================================================
  // Task #97 launch picks (research-backed). Lift-only programs carry the
  // [lift-primary:<kind>] sentinel so the daily-recipes pipeline emits a
  // Tonal-only week. Bike-only / Row-only programs carry a
  // [primary-machine:<bike|row>] sentinel as a routing hint for the
  // engine; surface focus type stays Base/Speed/Taper so the existing
  // pipeline keeps producing valid blocks until equipment routing lands.
  // ========================================================================
  {
    id: "couch_to_5k_alt",
    name: "Couch to 5K (Active Beginner)",
    goalDistance: "3.1 mi",
    source: "Active.com Beginner 5K",
    citation:
      "Active.com Beginner 5K Training Plan — 8-week walk/run progression.",
    shortDescription:
      "Conservative walk-to-run alternative to NHS C25K — adds an extra recovery cushion.",
    longDescription:
      "Active.com's Beginner 5K plan: 8 weeks of walk/run intervals with a slower ramp than the NHS C25K, an extra recovery week, and a graduated final week into a 5K event. Best for runners returning from a long layoff or carrying extra weight.",
    minWeeks: 8,
    maxWeeks: 12,
    defaultWeeks: 8,
    metadata: {
      intensityDistribution: "100% conversational (walk/run intervals)",
      peakLongRun: "30-min continuous run",
      peakWeeklyVolume: "3 short sessions / week",
      taperLength: "1 week graduated cooldown",
      cutbackCadence: "Built-in — every 4th week is lighter",
      mandatoryRestDays: 4,
      equipmentMixHint: "Run-only; optional walking on rest days",
    },
    tags: ["5k", "beginner", "first-timer", "run-walk", "low-mileage", "active-beginner"],
    expand: (n) =>
      distribute(n, [
        { focus: "Recovery", weight: 1, min: 1 },
        { focus: "Base", weight: 5, min: 6 },
        { focus: "Taper", weight: 1, min: 1 },
      ]),
  },
  {
    id: "higdon_5k_novice",
    name: "5K — Higdon Novice",
    goalDistance: "3.1 mi",
    source: "Hal Higdon",
    citation:
      "Hal Higdon, Novice 5K Training Program. halhigdon.com/training/5k",
    shortDescription:
      "Beginner-friendly 5K build: 3 runs/week, no quality work, gentle ramp.",
    longDescription:
      "Higdon's Novice 5K: 8 weeks of conversational running, three days per week, with a long run that grows from 1.5 to 3+ miles. No tempo or interval work. Designed for first-time 5K runners who can already jog continuously.",
    minWeeks: 6,
    maxWeeks: 10,
    defaultWeeks: 8,
    metadata: {
      intensityDistribution: "100% conversational",
      peakLongRun: "3 mi",
      peakWeeklyVolume: "10-15 mpw",
      taperLength: "1 week",
      cutbackCadence: "Every 4th week ~25% reduction",
      mandatoryRestDays: 2,
      equipmentMixHint: "Run-only",
    },
    tags: ["5k", "novice", "beginner", "easy", "low-mileage", "higdon"],
    expand: (n) =>
      distribute(n, [
        { focus: "Base", weight: 5, min: 5 },
        { focus: "Taper", weight: 1, min: 1 },
      ]),
  },
  {
    id: "higdon_5k_intermediate",
    name: "5K — Higdon Intermediate",
    goalDistance: "3.1 mi",
    source: "Hal Higdon",
    citation:
      "Hal Higdon, Intermediate 5K Training Program. halhigdon.com/training/5k",
    shortDescription:
      "Adds tempo runs and strides on top of the Novice 5K base.",
    longDescription:
      "Higdon's Intermediate 5K: 8 weeks of base running plus weekly tempo work and strides. Four runs per week, one day of strength/cross-train, one rest day. Best for runners who've completed a 5K and want a faster time.",
    minWeeks: 6,
    maxWeeks: 10,
    defaultWeeks: 8,
    metadata: {
      intensityDistribution: "Pyramidal — weekly tempo + strides",
      peakLongRun: "5 mi",
      peakWeeklyVolume: "15-25 mpw",
      taperLength: "1 week",
      cutbackCadence: "Every 4th week ~20% reduction",
      mandatoryRestDays: 1,
      equipmentMixHint: "Run + 1 strength / cross-train day",
    },
    tags: ["5k", "intermediate", "tempo", "strides", "higdon"],
    expand: (n) =>
      distribute(n, [
        { focus: "Base", weight: 2, min: 2 },
        { focus: "Speed", weight: 4, min: 3 },
        { focus: "Taper", weight: 1, min: 1 },
      ]),
  },
  {
    id: "higdon_5k_advanced",
    name: "5K — Higdon Advanced",
    goalDistance: "3.1 mi",
    source: "Hal Higdon",
    citation:
      "Hal Higdon, Advanced 5K Training Program. halhigdon.com/training/5k",
    shortDescription:
      "Five quality-biased runs/week with intervals, tempo, and a 1-week taper.",
    longDescription:
      "Higdon's Advanced 5K: 8 weeks of high-touch quality work — VO2max intervals, threshold tempos, and race-pace strides — across five runs per week. For experienced 5K racers chasing a PR.",
    minWeeks: 6,
    maxWeeks: 10,
    defaultWeeks: 8,
    metadata: {
      intensityDistribution: "Pyramidal — heavy I-pace + T-pace",
      peakLongRun: "6 mi",
      peakWeeklyVolume: "25-35 mpw",
      taperLength: "1 week",
      cutbackCadence: "Every 4th week ~20% reduction",
      mandatoryRestDays: 1,
      equipmentMixHint: "Run-only; minimize cross-train late",
    },
    tags: ["5k", "advanced", "pyramidal", "vo2max", "threshold", "higdon"],
    expand: (n) =>
      distribute(n, [
        { focus: "Base", weight: 2, min: 2 },
        { focus: "Speed", weight: 5, min: 3 },
        { focus: "Taper", weight: 1, min: 1 },
      ]),
  },
  {
    id: "higdon_10k_advanced",
    name: "10K — Higdon Advanced",
    goalDistance: "6.2 mi",
    source: "Hal Higdon",
    citation:
      "Hal Higdon, Advanced 10K Training Program. halhigdon.com/training/10k",
    shortDescription:
      "Higher-mileage 10K build with weekly intervals and tempo runs.",
    longDescription:
      "Higdon's Advanced 10K: 8 weeks of structured intervals, tempo runs, and pace work for experienced 10K racers. Long runs reach 10 mi; weekly mileage tops out around 40-50.",
    minWeeks: 8,
    maxWeeks: 14,
    defaultWeeks: 10,
    metadata: {
      intensityDistribution: "Pyramidal — heavy T-pace + I-pace",
      peakLongRun: "10 mi",
      peakWeeklyVolume: "40-50 mpw",
      taperLength: "1 week",
      cutbackCadence: "Every 4th week ~20% reduction",
      mandatoryRestDays: 1,
      equipmentMixHint: "Run-only",
    },
    tags: ["10k", "advanced", "pyramidal", "threshold", "high-mileage", "higdon"],
    expand: (n) =>
      distribute(n, [
        { focus: "Base", weight: 3, min: 4 },
        { focus: "Speed", weight: 4, min: 3 },
        { focus: "Taper", weight: 1, min: 1 },
      ]),
  },
  {
    id: "hm_higdon_novice2",
    name: "Half Marathon — Higdon Novice 2",
    goalDistance: "13.1 mi",
    source: "Hal Higdon",
    citation:
      "Hal Higdon, Novice 2 Half Marathon Training Program. halhigdon.com/training/half-marathon",
    shortDescription:
      "Beginner-plus HM plan with one weekly pace run and a 1-week taper.",
    longDescription:
      "Higdon's Novice 2 half-marathon: 12 weeks of mostly conversational running with one weekly pace run. Long runs build from 4 to 12 miles. Best for runners who have finished a HM and want to run faster but aren't ready for Intermediate.",
    minWeeks: 12,
    maxWeeks: 16,
    defaultWeeks: 12,
    metadata: {
      intensityDistribution: "85/15 polarized — one weekly pace run",
      peakLongRun: "12 mi",
      peakWeeklyVolume: "25-35 mpw",
      taperLength: "1 week",
      cutbackCadence: "Every 4th week ~25% reduction",
      mandatoryRestDays: 1,
      equipmentMixHint: "Run + cross-train day",
    },
    tags: ["half-marathon", "novice", "polarized", "low-mileage", "higdon"],
    expand: (n) =>
      distribute(n, [
        { focus: "Base", weight: 5, min: 6 },
        { focus: "Speed", weight: 4, min: 5 },
        { focus: "Taper", weight: 1, min: 1 },
      ]),
  },
  {
    id: "hm_pfitz",
    name: "Half Marathon — Pfitzinger",
    goalDistance: "13.1 mi",
    source: "Pete Pfitzinger",
    citation:
      "Pfitzinger & Latter, Faster Road Racing — half-marathon plan up to 47 mpw.",
    shortDescription:
      "Threshold-heavy HM build with race-specific long runs and a 2-week taper.",
    longDescription:
      "Pfitzinger's half-marathon mesocycles: endurance base, lactate-threshold development, race-specific long runs at HM pace, then a 2-week taper. For experienced runners targeting a PR.",
    minWeeks: 12,
    maxWeeks: 16,
    defaultWeeks: 12,
    metadata: {
      intensityDistribution: "Pyramidal — heavy LT + HM-pace work",
      peakLongRun: "13 mi (with miles at HM pace)",
      peakWeeklyVolume: "40-47 mpw",
      taperLength: "2 weeks",
      cutbackCadence: "Every 4th week ~20% reduction",
      mandatoryRestDays: 1,
      equipmentMixHint: "Run-only",
    },
    tags: ["half-marathon", "advanced", "pfitzinger", "pyramidal", "threshold", "race-pace"],
    expand: (n) =>
      distribute(n, [
        { focus: "Base", weight: 3, min: 4 },
        { focus: "Speed", weight: 5, min: 6 },
        { focus: "Taper", weight: 1, min: 2 },
      ]),
  },
  {
    id: "hm_hansons",
    name: "Half Marathon — Hansons",
    goalDistance: "13.1 mi",
    source: "Hansons-Brooks",
    citation:
      "Luke Humphrey, Hansons Half-Marathon Method — cumulative-fatigue HM plan.",
    shortDescription:
      "Cumulative-fatigue model with capped 10 mi long runs and weekly SOS days.",
    longDescription:
      "Hansons half-marathon: emphasizes weekly Something-of-Substance sessions (speed, strength tempo, long run capped at ~10 mi) to train on tired legs. 14-16 weeks of structured stress with a short taper.",
    minWeeks: 14,
    maxWeeks: 16,
    defaultWeeks: 14,
    metadata: {
      intensityDistribution: "Threshold-heavy — 3 SOS sessions/week",
      peakLongRun: "10 mi (capped — cumulative fatigue model)",
      peakWeeklyVolume: "40-50 mpw",
      taperLength: "10 days",
      cutbackCadence: "No formal cutbacks — continuous overload",
      mandatoryRestDays: 1,
      equipmentMixHint: "Run-only",
    },
    tags: ["half-marathon", "advanced", "hansons", "cumulative-fatigue", "threshold"],
    expand: (n) =>
      distribute(n, [
        { focus: "Base", weight: 3, min: 4 },
        { focus: "Speed", weight: 6, min: 8 },
        { focus: "Taper", weight: 1, min: 2 },
      ]),
  },
  {
    id: "marathon_pfitz_12_55",
    name: "Marathon — Pfitzinger 12/55",
    goalDistance: "26.2 mi",
    source: "Pete Pfitzinger",
    citation:
      "Pfitzinger & Douglas, Advanced Marathoning 3ed — 12-week, up to 55 mpw plan.",
    shortDescription:
      "Compressed Pfitz mesocycle for runners with aerobic base already in the bank.",
    longDescription:
      "Pfitzinger's 12-week marathon plan capped at 55 mpw: shortened endurance phase, condensed LT block, race-specific endurance, and a 3-week taper. Assumes the runner already has aerobic base — pair after an Aerobic Base entry if not.",
    minWeeks: 12,
    maxWeeks: 14,
    defaultWeeks: 12,
    metadata: {
      intensityDistribution: "Pyramidal — heavy LT + MP work",
      peakLongRun: "20 mi",
      peakWeeklyVolume: "45-55 mpw",
      taperLength: "3 weeks",
      cutbackCadence: "Every 4th week ~20% reduction",
      mandatoryRestDays: 1,
      equipmentMixHint: "Run-only",
    },
    tags: ["marathon", "pfitzinger", "intermediate", "threshold", "race-pace", "compressed"],
    expand: (n) =>
      distribute(n, [
        { focus: "Base", weight: 1, min: 2 },
        { focus: "Time on Feet", weight: 2, min: 3 },
        { focus: "Marathon-Specific", weight: 3, min: 4 },
        { focus: "Taper", weight: 1, min: 3 },
      ]),
  },
  {
    id: "marathon_pfitz_18_70",
    name: "Marathon — Pfitzinger 18/70",
    goalDistance: "26.2 mi",
    source: "Pete Pfitzinger",
    citation:
      "Pfitzinger & Douglas, Advanced Marathoning 3ed — 18-week, up to 70 mpw plan.",
    shortDescription:
      "High-mileage Pfitz mesocycle for experienced runners chasing a marathon PR.",
    longDescription:
      "Pfitzinger's 18-week marathon plan up to 70 mpw: full endurance phase, deep LT block, extensive race-specific endurance with marathon-pace long runs, and a 3-week taper. For runners coming off solid base.",
    minWeeks: 18,
    maxWeeks: 24,
    defaultWeeks: 18,
    metadata: {
      intensityDistribution: "Pyramidal — heavy LT + MP work",
      peakLongRun: "22 mi (with miles at marathon pace)",
      peakWeeklyVolume: "60-70 mpw",
      taperLength: "3 weeks",
      cutbackCadence: "Every 4th week ~20% reduction",
      mandatoryRestDays: 1,
      equipmentMixHint: "Run-only; cross-train discouraged late",
    },
    tags: ["marathon", "pfitzinger", "advanced", "high-mileage", "race-pace", "threshold", "PR"],
    expand: (n) =>
      distribute(n, [
        { focus: "Base", weight: 3, min: 4 },
        { focus: "Time on Feet", weight: 4, min: 5 },
        { focus: "Marathon-Specific", weight: 4, min: 6 },
        { focus: "Taper", weight: 2, min: 3 },
      ]),
  },
  {
    id: "marathon_hansons",
    name: "Marathon — Hansons Method",
    goalDistance: "26.2 mi",
    source: "Hansons-Brooks",
    citation:
      "Luke Humphrey, Hansons Marathon Method — cumulative-fatigue marathon plan.",
    shortDescription:
      "Cumulative-fatigue marathon plan with 16 mi capped long runs and 6 days/week running.",
    longDescription:
      "Hansons marathon method: 6 days/week of running with capped 16 mi long runs, weekly speed/strength/tempo SOS days, and marathon-pace tempo runs that grow to 10 miles. The compressed long run + tempo work trains running on tired legs.",
    minWeeks: 16,
    maxWeeks: 20,
    defaultWeeks: 18,
    metadata: {
      intensityDistribution: "Threshold-heavy — 3 SOS sessions/week",
      peakLongRun: "16 mi (capped — cumulative fatigue model)",
      peakWeeklyVolume: "55-63 mpw",
      taperLength: "10 days",
      cutbackCadence: "No formal cutbacks — continuous overload",
      mandatoryRestDays: 1,
      equipmentMixHint: "Run-only",
    },
    tags: ["marathon", "advanced", "hansons", "cumulative-fatigue", "threshold", "race-pace"],
    expand: (n) =>
      distribute(n, [
        { focus: "Base", weight: 3, min: 4 },
        { focus: "Time on Feet", weight: 3, min: 4 },
        { focus: "Marathon-Specific", weight: 4, min: 6 },
        { focus: "Taper", weight: 1, min: 2 },
      ]),
  },
  {
    id: "marathon_8020",
    name: "Marathon — 80/20",
    goalDistance: "26.2 mi",
    source: "Matt Fitzgerald",
    citation:
      "Matt Fitzgerald, 80/20 Running — Level 2/3 marathon plan.",
    shortDescription:
      "Polarized 80% easy / 20% hard marathon build with structured race-pace work.",
    longDescription:
      "Fitzgerald's 80/20 marathon plan: roughly 80% of running at low intensity, 20% at moderate-to-high intensity. Includes weekly tempo, fast-finish long runs, and a 2-week taper. Lower injury risk than threshold-heavy plans.",
    minWeeks: 16,
    maxWeeks: 24,
    defaultWeeks: 18,
    metadata: {
      intensityDistribution: "80/20 polarized",
      peakLongRun: "20 mi (fast-finish)",
      peakWeeklyVolume: "40-55 mpw",
      taperLength: "2-3 weeks",
      cutbackCadence: "Every 4th week ~25% reduction",
      mandatoryRestDays: 1,
      equipmentMixHint: "Run + optional easy cross-train",
    },
    tags: ["marathon", "intermediate", "polarized", "80/20", "low-injury-risk", "fast-finish"],
    expand: (n) =>
      distribute(n, [
        { focus: "Base", weight: 4, min: 5 },
        { focus: "Time on Feet", weight: 3, min: 3 },
        { focus: "Marathon-Specific", weight: 3, min: 5 },
        { focus: "Taper", weight: 1, min: 2 },
      ]),
  },
  {
    id: "marathon_higdon_novice",
    name: "Marathon — Higdon Novice 1",
    goalDistance: "26.2 mi",
    source: "Hal Higdon",
    citation:
      "Hal Higdon, Novice 1 Marathon Training Program. halhigdon.com/training/marathon",
    shortDescription:
      "Beginner marathon plan: 4 runs/week, conversational pace, single peak 20-miler.",
    longDescription:
      "Higdon's Novice 1: 18 weeks, 4 runs per week, all conversational. Long runs grow to a single 20 mi peak before a 2-week taper. The most accessible first-marathon plan.",
    minWeeks: 16,
    maxWeeks: 22,
    defaultWeeks: 18,
    metadata: {
      intensityDistribution: "100% conversational",
      peakLongRun: "20 mi (single peak)",
      peakWeeklyVolume: "30-40 mpw",
      taperLength: "2 weeks",
      cutbackCadence: "Every 4th week ~25% reduction",
      mandatoryRestDays: 2,
      equipmentMixHint: "Run + cross-train day",
    },
    tags: ["marathon", "novice", "first-timer", "easy", "low-mileage", "higdon"],
    expand: (n) =>
      distribute(n, [
        { focus: "Base", weight: 3, min: 4 },
        { focus: "Time on Feet", weight: 6, min: 10 },
        { focus: "Taper", weight: 1, min: 2 },
      ]),
  },
  {
    id: "marathon_higdon_advanced",
    name: "Marathon — Higdon Advanced 1",
    goalDistance: "26.2 mi",
    source: "Hal Higdon",
    citation:
      "Hal Higdon, Advanced 1 Marathon Training Program. halhigdon.com/training/marathon",
    shortDescription:
      "Advanced marathon plan with weekly tempo, intervals, race-pace runs, and 3 long runs at 20 mi.",
    longDescription:
      "Higdon's Advanced 1: 18 weeks, 6 runs per week including weekly tempo, intervals, hill work, and pace runs. Three peak 20-mile long runs, then a 3-week taper. For experienced marathoners chasing a PR.",
    minWeeks: 18,
    maxWeeks: 24,
    defaultWeeks: 18,
    metadata: {
      intensityDistribution: "Pyramidal — weekly tempo + intervals",
      peakLongRun: "20 mi (3x peak)",
      peakWeeklyVolume: "50-60 mpw",
      taperLength: "3 weeks",
      cutbackCadence: "Every 4th week ~20% reduction",
      mandatoryRestDays: 1,
      equipmentMixHint: "Run-only",
    },
    tags: ["marathon", "advanced", "pyramidal", "tempo", "high-mileage", "hill focus", "higdon", "PR"],
    expand: (n) =>
      distribute(n, [
        { focus: "Base", weight: 2, min: 3 },
        { focus: "Time on Feet", weight: 3, min: 4 },
        { focus: "Marathon-Specific", weight: 4, min: 8 },
        { focus: "Taper", weight: 1, min: 3 },
      ]),
  },
  {
    id: "ultra_50_mile",
    name: "Ultramarathon 50 Mile",
    goalDistance: "50 mi",
    source: "Jason Koop",
    citation:
      "Jason Koop, Training Essentials for Ultrarunning 2ed — 50-mile build.",
    shortDescription:
      "Sustained Time-on-Feet block with back-to-back long runs; 2-3 week taper.",
    longDescription:
      "Koop's 50-mile prescription: deep aerobic base, then a sustained Time-on-Feet block emphasizing back-to-back long runs (e.g. 30 mi + 15 mi), trail-specific climbing volume, and fueling practice. 2-3 week taper.",
    minWeeks: 20,
    maxWeeks: 30,
    defaultWeeks: 24,
    metadata: {
      intensityDistribution: "85/15 polarized — dominant easy volume",
      peakLongRun: "Back-to-back (30 mi + 15 mi)",
      peakWeeklyVolume: "55-75 mpw",
      taperLength: "2-3 weeks",
      cutbackCadence: "Every 4th week ~30% reduction",
      mandatoryRestDays: 1,
      equipmentMixHint: "Run + hike + strength accessory",
    },
    tags: ["ultra", "50-mile", "polarized", "back-to-back", "trail", "koop"],
    expand: (n) =>
      distribute(n, [
        { focus: "Base", weight: 3, min: 4 },
        { focus: "Time on Feet", weight: 7, min: 14 },
        { focus: "Taper", weight: 1, min: 2 },
      ]),
  },
  {
    id: "ultra_100k",
    name: "Ultramarathon 100K",
    goalDistance: "62 mi",
    source: "Jason Koop",
    citation:
      "Jason Koop, Training Essentials for Ultrarunning 2ed — 100K build.",
    shortDescription:
      "Long Time-on-Feet block with peak 35-40 mi long runs and 3-week taper.",
    longDescription:
      "Koop's 100K plan: aerobic base, extended Time-on-Feet phase with peak 35-40 mi long runs (often back-to-back across a weekend), and a 3-week taper. Emphasizes night-running practice and crew/aid-station rehearsals.",
    minWeeks: 20,
    maxWeeks: 32,
    defaultWeeks: 24,
    metadata: {
      intensityDistribution: "85/15 polarized — dominant easy volume",
      peakLongRun: "Back-to-back (40 mi + 20 mi)",
      peakWeeklyVolume: "65-90 mpw",
      taperLength: "3 weeks",
      cutbackCadence: "Every 4th week ~30% reduction",
      mandatoryRestDays: 1,
      equipmentMixHint: "Run + hike + strength + bike on rest days",
    },
    tags: ["ultra", "100k", "polarized", "back-to-back", "trail", "koop", "high-mileage"],
    expand: (n) =>
      distribute(n, [
        { focus: "Base", weight: 3, min: 4 },
        { focus: "Time on Feet", weight: 7, min: 13 },
        { focus: "Taper", weight: 1, min: 3 },
      ]),
  },
  {
    id: "norwegian_singles",
    name: "Norwegian Singles Method",
    goalDistance: "5K-marathon",
    source: "Marius Bakken / Sirpoma",
    citation:
      "Norwegian Singles training method — sub-threshold doubles framework adapted for single sessions.",
    shortDescription:
      "Triple-weekly sub-threshold sessions (lactate-controlled) bracketed by easy mileage.",
    longDescription:
      "Single-session adaptation of the Norwegian double-threshold model: three weekly sub-threshold sessions (typically Tuesday/Thursday/Saturday) at ~2.5 mmol/L lactate, with easy aerobic running on the remaining days. Builds enormous threshold capacity over 12-24 weeks.",
    minWeeks: 12,
    maxWeeks: 24,
    defaultWeeks: 16,
    metadata: {
      intensityDistribution: "Threshold-dominant — 3 sub-T sessions/week",
      peakLongRun: "14-16 mi",
      peakWeeklyVolume: "45-65 mpw",
      taperLength: "1-2 weeks",
      cutbackCadence: "Every 4th week ~20% reduction",
      mandatoryRestDays: 1,
      equipmentMixHint: "Run-only with light strength",
    },
    tags: ["norwegian", "sub-threshold", "threshold", "advanced", "lactate", "doubles"],
    expand: (n) =>
      distribute(n, [
        { focus: "Base", weight: 2, min: 3 },
        { focus: "Speed", weight: 6, min: 8 },
        { focus: "Taper", weight: 1, min: 1 },
      ]),
  },
  // ---------- Peloton Bike ----------
  {
    id: "pelo_bike_you_can_ride",
    name: "Peloton · You Can Ride",
    goalDistance: "Bike 30-min continuous",
    source: "Peloton",
    citation:
      "Peloton — You Can Ride beginner cycling program (4-week onboarding).",
    shortDescription:
      "Beginner Peloton Bike onramp: short rides building to a continuous 30 min.",
    longDescription:
      "Peloton's You Can Ride: 4 weeks of structured beginner rides building from 10 to 30 minutes continuous. Three short rides per week, no high-intensity work. Best as the very first Peloton Bike block.",
    minWeeks: 4,
    maxWeeks: 6,
    defaultWeeks: 4,
    metadata: {
      intensityDistribution: "100% conversational (beginner zones)",
      peakLongRun: "N/A — bike-only template",
      peakWeeklyVolume: "3 short rides / week (~60-90 min total)",
      taperLength: "None",
      cutbackCadence: "No cutbacks (volume already minimal)",
      mandatoryRestDays: 4,
      equipmentMixHint: "Peloton Bike only",
    },
    tags: ["bike", "peloton", "beginner", "first-timer", "low-mileage", "onramp"],
    expand: (n) => [
      makeBlock("Base", n, {
        customNotes: "[primary-machine:bike] Peloton Bike onramp",
      }),
    ],
  },
  {
    id: "pelo_bike_pz_beginner",
    name: "Peloton · Power Zone Beginner",
    goalDistance: "Functional Threshold Power",
    source: "Peloton Power Zone",
    citation:
      "Peloton Power Zone Pack — Beginner PZ program (8 weeks).",
    shortDescription:
      "Establish FTP and grow base PZ training time across 4 zone-controlled rides/week.",
    longDescription:
      "Peloton's Beginner Power Zone block: take an FTP test, then 8 weeks of zone-controlled rides — Endurance Z2, Sweet Spot Z3, and short Z4 efforts. 4 rides/week, mostly 30-45 min.",
    minWeeks: 6,
    maxWeeks: 12,
    defaultWeeks: 8,
    metadata: {
      intensityDistribution: "Pyramidal — Z2 base + weekly Z3-Z4 work",
      peakLongRun: "N/A — bike-only template",
      peakWeeklyVolume: "4 PZ rides / week (~3 hr total)",
      taperLength: "1 week",
      cutbackCadence: "Every 4th week deload + retest FTP",
      mandatoryRestDays: 2,
      equipmentMixHint: "Peloton Bike only",
    },
    expand: (n) =>
      distribute(n, [
        {
          focus: "Base",
          weight: 3,
          min: 3,
          customNotes: "[primary-machine:bike] Power Zone Beginner — Z2 base",
        },
        {
          focus: "Speed",
          weight: 3,
          min: 2,
          customNotes:
            "[primary-machine:bike] Power Zone Beginner — Z3-Z4 work",
        },
        {
          focus: "Taper",
          weight: 1,
          min: 1,
          customNotes: "[primary-machine:bike] PZ taper / FTP retest",
        },
      ]),
    tags: ["bike", "peloton", "power-zone", "ftp", "beginner"],
  },
  {
    id: "pelo_bike_pz_intermediate",
    name: "Peloton · Power Zone Intermediate",
    goalDistance: "Functional Threshold Power",
    source: "Peloton Power Zone",
    citation:
      "Peloton Power Zone Pack — Intermediate PZ program (8 weeks).",
    shortDescription:
      "Adds Z4 intervals and longer Z3 blocks on top of the beginner base.",
    longDescription:
      "Peloton's Intermediate PZ block: 8 weeks of layered FTP-based work — extended Z2 endurance, structured Z3 sweet-spot, and progressively longer Z4 intervals. 4-5 rides/week.",
    minWeeks: 6,
    maxWeeks: 12,
    defaultWeeks: 8,
    metadata: {
      intensityDistribution: "Pyramidal — heavy Z3 + Z4 work",
      peakLongRun: "N/A — bike-only template",
      peakWeeklyVolume: "4-5 PZ rides / week (~4 hr total)",
      taperLength: "1 week",
      cutbackCadence: "Every 4th week deload + retest FTP",
      mandatoryRestDays: 2,
      equipmentMixHint: "Peloton Bike only",
    },
    expand: (n) =>
      distribute(n, [
        {
          focus: "Base",
          weight: 2,
          min: 2,
          customNotes:
            "[primary-machine:bike] Intermediate PZ — Z2 endurance",
        },
        {
          focus: "Speed",
          weight: 4,
          min: 3,
          customNotes:
            "[primary-machine:bike] Intermediate PZ — Z3/Z4 intervals",
        },
        {
          focus: "Taper",
          weight: 1,
          min: 1,
          customNotes: "[primary-machine:bike] PZ taper / FTP retest",
        },
      ]),
    tags: ["bike", "peloton", "power-zone", "ftp", "intermediate"],
  },
  {
    id: "pelo_bike_pz_advanced",
    name: "Peloton · Power Zone Advanced",
    goalDistance: "Functional Threshold Power",
    source: "Peloton Power Zone",
    citation:
      "Peloton Power Zone Pack — Advanced PZ program (10 weeks).",
    shortDescription:
      "High-touch FTP block with Z4-Z5 intervals and 60-90 min Z2 endurance rides.",
    longDescription:
      "Peloton's Advanced PZ block: 10 weeks of high-volume FTP-targeted training. Long Z2 rides (60-90 min), structured Z4 over-unders, and Z5 VO2 work. 5 rides/week with one long endurance ride.",
    minWeeks: 8,
    maxWeeks: 12,
    defaultWeeks: 10,
    metadata: {
      intensityDistribution: "Pyramidal — heavy Z4-Z5 with long Z2 endurance",
      peakLongRun: "N/A — bike-only template",
      peakWeeklyVolume: "5 PZ rides / week (~6 hr total)",
      taperLength: "1 week",
      cutbackCadence: "Every 4th week deload + retest FTP",
      mandatoryRestDays: 2,
      equipmentMixHint: "Peloton Bike only",
    },
    expand: (n) =>
      distribute(n, [
        {
          focus: "Base",
          weight: 2,
          min: 2,
          customNotes:
            "[primary-machine:bike] Advanced PZ — long Z2 endurance",
        },
        {
          focus: "Speed",
          weight: 5,
          min: 5,
          customNotes:
            "[primary-machine:bike] Advanced PZ — Z4 over-unders + Z5 VO2",
        },
        {
          focus: "Taper",
          weight: 1,
          min: 1,
          customNotes: "[primary-machine:bike] PZ taper / FTP retest",
        },
      ]),
    tags: ["bike", "peloton", "power-zone", "ftp", "advanced", "high-mileage"],
  },
  {
    id: "pelo_bike_strength_for_cyclists",
    name: "Peloton · Strength for Cyclists",
    goalDistance: "Bike-supportive strength",
    source: "Peloton",
    citation:
      "Peloton — Strength for Cyclists program (off-bike strength).",
    shortDescription:
      "Off-bike strength block targeting glutes, posterior chain, and core for cyclists.",
    longDescription:
      "Peloton's Strength for Cyclists: 4-8 weeks of cycling-supportive lifting (glute bridges, RDLs, single-leg squats, core) paired with reduced bike volume. Best slotted between bike PZ blocks to address muscular weaknesses.",
    minWeeks: 4,
    maxWeeks: 8,
    defaultWeeks: 6,
    metadata: {
      intensityDistribution: "Strength-priority + reduced Z2 bike volume",
      peakLongRun: "N/A",
      peakWeeklyVolume: "3 strength + 2 short bike sessions / week",
      taperLength: "None — pair with a follow-on bike block",
      cutbackCadence: "Every 4th week deload all lifts ~25%",
      mandatoryRestDays: 2,
      equipmentMixHint: "Tonal + Peloton Bike",
    },
    tags: ["bike", "strength", "cycling-supportive", "tonal", "peloton", "lift-primary"],
    expand: (n) => [
      makeBlock("Custom", n, {
        customName: "Strength for Cyclists",
        customNotes:
          "[lift-primary:lower] Cycling-supportive strength — glutes/posterior chain",
      }),
    ],
  },
  // ---------- Peloton / Concept2 Row ----------
  {
    id: "pelo_row_dpz",
    name: "Peloton · Discover Power Zone Row",
    goalDistance: "Row FTP / 2K",
    source: "Peloton Row",
    citation:
      "Peloton Row — Discover Power Zone Row beginner-to-intermediate program.",
    shortDescription:
      "Establish row FTP and progress through PZ workouts on Peloton Row.",
    longDescription:
      "Peloton Row's DPZ-Row: take an FTP row test, then 6-12 weeks of zone-controlled rowing — endurance Z2, sweet-spot Z3, and short Z4 efforts. 4 sessions/week, 30-45 min each.",
    minWeeks: 6,
    maxWeeks: 12,
    defaultWeeks: 8,
    metadata: {
      intensityDistribution: "Pyramidal — Z2 base + Z3-Z4 intervals",
      peakLongRun: "N/A — row-only template",
      peakWeeklyVolume: "4 row sessions / week (~3 hr total)",
      taperLength: "1 week",
      cutbackCadence: "Every 4th week deload + FTP retest",
      mandatoryRestDays: 2,
      equipmentMixHint: "Peloton Row only",
    },
    expand: (n) =>
      distribute(n, [
        {
          focus: "Base",
          weight: 3,
          min: 3,
          customNotes:
            "[primary-machine:row] DPZ-Row — Z2 endurance base",
        },
        {
          focus: "Speed",
          weight: 3,
          min: 2,
          customNotes: "[primary-machine:row] DPZ-Row — Z3/Z4 intervals",
        },
        {
          focus: "Taper",
          weight: 1,
          min: 1,
          customNotes: "[primary-machine:row] DPZ-Row taper / FTP retest",
        },
      ]),
    tags: ["row", "peloton", "power-zone", "ftp", "beginner", "intermediate"],
  },
  {
    id: "c2_row_30day",
    name: "Concept2 · Beginner 30 Day",
    goalDistance: "Row 30-min continuous",
    source: "Concept2",
    citation:
      "Concept2 Logbook — Beginner 30-Day Plan. concept2.com/training/training-plans",
    shortDescription:
      "Concept2's beginner 30-day rowing onramp: 5 short sessions/week.",
    longDescription:
      "Concept2's Beginner 30-Day plan: 4 weeks of short rowing sessions (15-30 min) building to a continuous 30-min row. Five sessions/week with technique focus. Best as the first row block ever.",
    minWeeks: 4,
    maxWeeks: 6,
    defaultWeeks: 4,
    metadata: {
      intensityDistribution: "100% conversational (technique focus)",
      peakLongRun: "N/A — row-only template",
      peakWeeklyVolume: "5 short rows / week (~2 hr total)",
      taperLength: "None",
      cutbackCadence: "No cutbacks (volume minimal)",
      mandatoryRestDays: 2,
      equipmentMixHint: "Concept2 / Peloton Row",
    },
    tags: ["row", "concept2", "beginner", "first-timer", "low-mileage", "onramp"],
    expand: (n) => [
      makeBlock("Base", n, {
        customNotes:
          "[primary-machine:row] Concept2 30-Day onramp — technique focus",
      }),
    ],
  },
  {
    id: "c2_row_5k",
    name: "Concept2 · 5K Row PR",
    goalDistance: "5000m row",
    source: "Concept2",
    citation:
      "Concept2 Logbook — 5K PR plan (8 weeks).",
    shortDescription:
      "8-week build to a 5000m row PR with weekly steady, threshold, and interval sessions.",
    longDescription:
      "Concept2's 5K PR plan: 8 weeks of structured rowing — long steady Z2 rows, threshold work at 2K + 12s pace, and short VO2 intervals. 4-5 sessions/week with a 1-week taper.",
    minWeeks: 6,
    maxWeeks: 10,
    defaultWeeks: 8,
    metadata: {
      intensityDistribution: "Pyramidal — heavy threshold + intervals",
      peakLongRun: "N/A — row-only template",
      peakWeeklyVolume: "4-5 rows / week (~4 hr total)",
      taperLength: "1 week",
      cutbackCadence: "Every 4th week ~25% reduction",
      mandatoryRestDays: 2,
      equipmentMixHint: "Concept2 / Peloton Row",
    },
    expand: (n) =>
      distribute(n, [
        {
          focus: "Base",
          weight: 2,
          min: 2,
          customNotes: "[primary-machine:row] 5K Row — Z2 base",
        },
        {
          focus: "Speed",
          weight: 4,
          min: 3,
          customNotes:
            "[primary-machine:row] 5K Row — threshold + intervals",
        },
        {
          focus: "Taper",
          weight: 1,
          min: 1,
          customNotes: "[primary-machine:row] 5K Row taper",
        },
      ]),
    tags: ["row", "concept2", "5k-row", "intermediate", "threshold", "PR"],
  },
  {
    id: "c2_row_2k",
    name: "Concept2 · 2K Row PR",
    goalDistance: "2000m row",
    source: "Concept2",
    citation:
      "Concept2 Logbook — 2K PR plan (8-12 weeks).",
    shortDescription:
      "Quality-heavy 2K row PR build with sprint intervals and a sharpening taper.",
    longDescription:
      "Concept2's 2K PR plan: 8-12 weeks of high-touch quality work — short sprint intervals, race-pace pieces, and threshold rows. Lower volume than the 5K plan; emphasis on power and stroke rate. 1-week sharpening taper.",
    minWeeks: 6,
    maxWeeks: 12,
    defaultWeeks: 8,
    metadata: {
      intensityDistribution: "Pyramidal — heavy I-pace + race-pace work",
      peakLongRun: "N/A — row-only template",
      peakWeeklyVolume: "4-5 rows / week (~3 hr total)",
      taperLength: "1 week",
      cutbackCadence: "Every 4th week ~20% reduction",
      mandatoryRestDays: 2,
      equipmentMixHint: "Concept2 / Peloton Row",
    },
    expand: (n) =>
      distribute(n, [
        {
          focus: "Base",
          weight: 1,
          min: 1,
          customNotes: "[primary-machine:row] 2K Row — Z2 prep",
        },
        {
          focus: "Speed",
          weight: 5,
          min: 4,
          customNotes:
            "[primary-machine:row] 2K Row — sprint + race-pace intervals",
        },
        {
          focus: "Taper",
          weight: 1,
          min: 1,
          customNotes: "[primary-machine:row] 2K Row sharpening taper",
        },
      ]),
    tags: ["row", "concept2", "2k-row", "advanced", "speed", "sprint", "PR"],
  },
  // ---------- Strength (named programs) ----------
  {
    id: "tonal_full_body_5x",
    name: "Tonal Strength · Full Body 5x/Week",
    goalDistance: "General strength",
    source: "Tonal coaching library",
    citation:
      "Tonal Strength Score — full-body 5-day frequency program.",
    shortDescription:
      "Five short full-body Tonal sessions per week with two rest days.",
    longDescription:
      "High-frequency Tonal block: five compact full-body sessions per week (Mon/Tue/Thu/Fri/Sat) rotating push, pull, squat, hinge, and accessory emphases. Two rest days (Wed/Sun). Best for runners adding strength without driving up systemic fatigue.",
    minWeeks: 4,
    maxWeeks: 16,
    defaultWeeks: 8,
    metadata: {
      intensityDistribution: "Strength-priority — 5 short lifts / week",
      peakLongRun: "N/A — lift-only template",
      peakWeeklyVolume: "5 Tonal sessions / week",
      taperLength: "None — ongoing strength block",
      cutbackCadence: "Every 4th week deload load ~25%",
      mandatoryRestDays: 2,
      equipmentMixHint: "Tonal only",
    },
    tags: ["strength", "lift-only", "full-body", "tonal", "high-frequency"],
    expand: (n) => [
      makeBlock("Custom", n, {
        customName: "Tonal Full Body 5x",
        customNotes:
          "[lift-primary:conditioning] Full-body 5x/week rotating emphasis",
      }),
    ],
  },
  {
    id: "starting_strength",
    name: "Starting Strength",
    goalDistance: "Linear strength",
    source: "Mark Rippetoe",
    citation:
      "Mark Rippetoe, Starting Strength 3ed — novice linear progression.",
    shortDescription:
      "3 days/week novice linear progression: squat, bench, press, deadlift, power clean.",
    longDescription:
      "Rippetoe's Starting Strength: 3 sessions per week (e.g. Mon/Wed/Fri) of compound barbell lifts with 5-rep linear progression. Two alternating workouts (A: squat/bench/deadlift; B: squat/press/clean). Best for true novices.",
    minWeeks: 8,
    maxWeeks: 24,
    defaultWeeks: 12,
    metadata: {
      intensityDistribution: "Strength-priority — 3 heavy lift days/week",
      peakLongRun: "N/A — lift-only template",
      peakWeeklyVolume: "3 Tonal sessions / week",
      taperLength: "None — linear progression program",
      cutbackCadence: "No cutbacks until stalls require a reset",
      mandatoryRestDays: 4,
      equipmentMixHint: "Tonal (barbell-equivalent loads)",
    },
    tags: ["strength", "lift-only", "linear-progression", "novice", "barbell", "5x5"],
    expand: (n) => [
      makeBlock("Custom", n, {
        customName: "Starting Strength",
        customNotes:
          "[lift-primary:lower] 5x5 linear progression — squat/bench/press/DL/clean",
      }),
    ],
  },
  {
    id: "stronglifts_5x5",
    name: "StrongLifts 5x5",
    goalDistance: "Linear strength",
    source: "Mehdi (StrongLifts)",
    citation:
      "Mehdi, StrongLifts 5x5 — beginner barbell program.",
    shortDescription:
      "3 days/week 5x5 alternating workouts: squat/bench/row vs squat/press/deadlift.",
    longDescription:
      "StrongLifts 5x5: alternating Workout A (squat/bench/row) and Workout B (squat/press/deadlift) three times per week. 5 sets of 5 with linear weekly load progression. Simpler progression rules than Starting Strength.",
    minWeeks: 8,
    maxWeeks: 24,
    defaultWeeks: 12,
    metadata: {
      intensityDistribution: "Strength-priority — 3 heavy lift days/week",
      peakLongRun: "N/A — lift-only template",
      peakWeeklyVolume: "3 Tonal sessions / week",
      taperLength: "None — linear progression program",
      cutbackCadence: "Auto-deload after 3 stalls (program rule)",
      mandatoryRestDays: 4,
      equipmentMixHint: "Tonal (barbell-equivalent loads)",
    },
    tags: ["strength", "lift-only", "linear-progression", "novice", "barbell", "5x5"],
    expand: (n) => [
      makeBlock("Custom", n, {
        customName: "StrongLifts 5x5",
        customNotes:
          "[lift-primary:lower] 5x5 alternating A/B — squat-bias linear progression",
      }),
    ],
  },
  {
    id: "wendler_531_bbb",
    name: "5/3/1 — Boring But Big",
    goalDistance: "Strength + hypertrophy",
    source: "Jim Wendler",
    citation:
      "Jim Wendler, 5/3/1 2ed — Boring But Big template.",
    shortDescription:
      "4-week 5/3/1 cycles with 5x10 hypertrophy assistance (Boring But Big).",
    longDescription:
      "Wendler's 5/3/1 BBB template: 4 lifts (squat/bench/deadlift/press), each on its own day, run on a 4-week wave (5s/3s/1s/deload). After the main 5/3/1 work, 5x10 BBB sets at 50-60% drive hypertrophy. Run for 3+ cycles.",
    minWeeks: 12,
    maxWeeks: 16,
    defaultWeeks: 12,
    metadata: {
      intensityDistribution: "Strength + hypertrophy — 4 lifts / week",
      peakLongRun: "N/A — lift-only template",
      peakWeeklyVolume: "4 Tonal sessions / week",
      taperLength: "None — built-in deload every 4th week",
      cutbackCadence: "Every 4th week is a programmed deload",
      mandatoryRestDays: 3,
      equipmentMixHint: "Tonal (barbell-equivalent loads)",
    },
    tags: ["strength", "lift-only", "531", "wendler", "hypertrophy", "intermediate", "barbell"],
    expand: (n) => [
      makeBlock("Custom", n, {
        customName: "5/3/1 Boring But Big",
        customNotes:
          "[lift-primary:conditioning] 5/3/1 main lift + 5x10 BBB hypertrophy",
      }),
    ],
  },
  {
    id: "phul",
    name: "PHUL (Power Hypertrophy Upper Lower)",
    goalDistance: "Strength + hypertrophy",
    source: "Brandon Campbell",
    citation:
      "Brandon Campbell, PHUL — 4-day Power Hypertrophy Upper Lower template.",
    shortDescription:
      "4 days/week alternating Power Upper, Power Lower, Hypertrophy Upper, Hypertrophy Lower.",
    longDescription:
      "PHUL: four sessions per week — two heavy power days (3-5 reps) and two higher-rep hypertrophy days (8-12 reps), alternating Upper/Lower. Pairs strength and size training in a single block.",
    minWeeks: 8,
    maxWeeks: 16,
    defaultWeeks: 12,
    metadata: {
      intensityDistribution: "Strength + hypertrophy — 4 sessions / week",
      peakLongRun: "N/A — lift-only template",
      peakWeeklyVolume: "4 Tonal sessions / week",
      taperLength: "None — ongoing block",
      cutbackCadence: "Every 4th week deload all lifts ~25%",
      mandatoryRestDays: 3,
      equipmentMixHint: "Tonal only",
    },
    tags: ["strength", "lift-only", "hypertrophy", "upper-lower", "intermediate", "split"],
    expand: (n) => [
      makeBlock("Custom", n, {
        customName: "PHUL",
        customNotes:
          "[lift-primary:upper] Power + Hypertrophy Upper/Lower 4-day split",
      }),
    ],
  },
  {
    id: "ppl_6day",
    name: "Push / Pull / Legs · 6-Day",
    goalDistance: "Hypertrophy",
    source: "Classic bodybuilding split",
    citation:
      "PPL 6-day high-frequency hypertrophy split (Schoenfeld frequency research).",
    shortDescription:
      "Six lift days/week rotating Push/Pull/Legs twice — one full rest day.",
    longDescription:
      "High-frequency PPL: six sessions/week (Push/Pull/Legs/Push/Pull/Legs) with one rest day. Each muscle group hit twice/week. Highest training frequency in the strength catalog — best for advanced lifters with no concurrent run/cardio load.",
    minWeeks: 6,
    maxWeeks: 12,
    defaultWeeks: 8,
    metadata: {
      intensityDistribution: "Hypertrophy-priority — 6 lift days / week",
      peakLongRun: "N/A — lift-only template",
      peakWeeklyVolume: "6 Tonal sessions / week",
      taperLength: "None — ongoing block",
      cutbackCadence: "Every 4th week deload all lifts ~25%",
      mandatoryRestDays: 1,
      equipmentMixHint: "Tonal only",
    },
    tags: ["strength", "lift-only", "ppl", "hypertrophy", "advanced", "high-frequency", "split"],
    expand: (n) => [
      makeBlock("Custom", n, {
        customName: "PPL 6-Day",
        customNotes:
          "[lift-primary:ppl] High-frequency PPL — twice through each pattern weekly",
      }),
    ],
  },
  {
    id: "simple_and_sinister",
    name: "Simple & Sinister (Kettlebell)",
    goalDistance: "Strength + conditioning",
    source: "Pavel Tsatsouline",
    citation:
      "Pavel Tsatsouline, Simple & Sinister — daily kettlebell swing + getup program.",
    shortDescription:
      "Daily 100 swings + 10 Turkish getups; 6 days/week minimalist strength program.",
    longDescription:
      "Pavel's Simple & Sinister: 100 single-arm kettlebell swings + 10 Turkish getups, 6 days/week. Builds posterior chain strength, grip, and conditioning in 30 min/session. Run for 8-24 weeks chasing the Simple (32 kg) or Sinister (48 kg) standards.",
    minWeeks: 8,
    maxWeeks: 24,
    defaultWeeks: 12,
    metadata: {
      intensityDistribution: "Strength + conditioning — 6 short lifts / week",
      peakLongRun: "N/A — lift-only template",
      peakWeeklyVolume: "6 sessions / week (~3 hr total)",
      taperLength: "None — ongoing block",
      cutbackCadence: "No formal cutbacks; daily auto-regulation",
      mandatoryRestDays: 1,
      equipmentMixHint: "Kettlebell (Tonal-substitutable)",
    },
    tags: ["strength", "lift-only", "kettlebell", "conditioning", "minimalist", "daily"],
    expand: (n) => [
      makeBlock("Custom", n, {
        customName: "Simple & Sinister",
        customNotes:
          "[lift-primary:conditioning] Daily KB swings + Turkish getups",
      }),
    ],
  },
  // ---------- Hybrid ----------
  {
    id: "nick_bare_1_0",
    name: "Hybrid · Nick Bare 1.0",
    goalDistance: "Half marathon + lift",
    source: "Nick Bare",
    citation:
      "Nick Bare, BPN Hybrid Athlete 1.0 — concurrent run + lift program.",
    shortDescription:
      "Concurrent half-marathon build + upper/lower lift split, 6 days/week.",
    longDescription:
      "Nick Bare's Hybrid Athlete 1.0: concurrent half-marathon training (4 runs/week including a long run, tempo, and intervals) plus 3 heavy upper/lower lift days. Designed for runners who refuse to give up the gym.",
    minWeeks: 8,
    maxWeeks: 16,
    defaultWeeks: 12,
    metadata: {
      intensityDistribution: "Hybrid — 4 runs + 3 lifts / week",
      peakLongRun: "10-12 mi",
      peakWeeklyVolume: "Run 25-35 mpw + 3 heavy lift sessions",
      taperLength: "1 week",
      cutbackCadence: "Every 4th week deload run + lift ~20%",
      mandatoryRestDays: 1,
      equipmentMixHint: "Tonal + run (Tread + outdoor)",
    },
    tags: ["hybrid", "half-marathon", "strength", "concurrent", "nick-bare"],
    expand: (n) =>
      distribute(n, [
        {
          focus: "Custom",
          weight: 3,
          min: 3,
          customName: "Hybrid Build",
          customNotes:
            "Concurrent run + heavy lift — 4 runs / 3 lifts weekly",
        },
        { focus: "Speed", weight: 3, min: 3 },
        { focus: "Taper", weight: 1, min: 1 },
      ]),
  },
  // ---------- Cross-modal ----------
  {
    id: "pelo_x_hyrox",
    name: "Peloton x HYROX Prep",
    goalDistance: "HYROX race",
    source: "Peloton x HYROX",
    citation:
      "Peloton x HYROX Official Training Program — fitness race prep.",
    shortDescription:
      "Run + functional strength prep for a HYROX fitness race: 8 stations + 8 x 1km runs.",
    longDescription:
      "Peloton x HYROX: 8-16 weeks of mixed-modal training — running intervals, sled work, burpee broad jumps, wall balls, rowing, and functional carries. Mirrors the 8-station + 8 x 1km HYROX format. Includes a 1-week sharpening taper.",
    minWeeks: 8,
    maxWeeks: 16,
    defaultWeeks: 12,
    metadata: {
      intensityDistribution: "Mixed-modal — concurrent run + functional",
      peakLongRun: "8-10 mi",
      peakWeeklyVolume: "4 runs + 3 functional sessions / week",
      taperLength: "1 week",
      cutbackCadence: "Every 4th week deload all modes ~25%",
      mandatoryRestDays: 1,
      equipmentMixHint: "Run + Tonal + Peloton Row + sled/wall ball",
    },
    tags: ["hyrox", "hybrid", "race-prep", "functional", "mixed-modal", "peloton"],
    expand: (n) =>
      distribute(n, [
        {
          focus: "Custom",
          weight: 2,
          min: 2,
          customName: "HYROX Base",
          customNotes:
            "Aerobic base + technique on each HYROX station",
        },
        {
          focus: "Speed",
          weight: 5,
          min: 5,
          customNotes:
            "Race-pace simulations: 8 stations + 8 x 1km run intervals",
        },
        { focus: "Taper", weight: 1, min: 1 },
      ]),
  },
  // ---------- Conditioning / lifestyle ----------
  {
    id: "maf_180",
    name: "MAF 180 Aerobic Base",
    goalDistance: "Aerobic capacity",
    source: "Phil Maffetone",
    citation:
      "Phil Maffetone, The Big Book of Endurance Training — MAF 180-formula aerobic base.",
    shortDescription:
      "Strict sub-MAF heart-rate training (180-age) to rebuild the aerobic engine.",
    longDescription:
      "Maffetone's MAF 180: every run capped at 180-age bpm (with adjustments for health/training history). Ignores pace; rewards aerobic efficiency. 8-16 weeks of strict-HR running rebuilds fat-burning capacity and durability. No quality work.",
    minWeeks: 8,
    maxWeeks: 16,
    defaultWeeks: 12,
    metadata: {
      intensityDistribution: "100% sub-MAF aerobic",
      peakLongRun: "60-90 min easy",
      peakWeeklyVolume: "5-7 runs / week (HR-capped)",
      taperLength: "None — feeds into a follow-on race-specific entry",
      cutbackCadence: "Every 4th week ~25% reduction",
      mandatoryRestDays: 1,
      equipmentMixHint: "Run + optional easy bike",
    },
    tags: ["MAF", "base", "low-intensity", "aerobic", "heart-rate", "maffetone"],
    expand: (n) => [makeBlock("Base", n, { customNotes: "MAF 180 HR-capped block" })],
  },
  {
    id: "bike_bootcamp_builder",
    name: "Peloton Bike Bootcamp Builder",
    goalDistance: "Bike + bodyweight",
    source: "Peloton",
    citation:
      "Peloton — Bike Bootcamp Builder program (bike + floor strength).",
    shortDescription:
      "Mixed Bike Bootcamp sessions: alternating bike intervals and floor strength.",
    longDescription:
      "Peloton's Bike Bootcamp Builder: 4-8 weeks of Bike Bootcamp class progression — alternating bike intervals and bodyweight floor work in the same session. 4 sessions/week.",
    minWeeks: 4,
    maxWeeks: 8,
    defaultWeeks: 6,
    metadata: {
      intensityDistribution: "Mixed — bike intervals + bodyweight strength",
      peakLongRun: "N/A — bike + bodyweight template",
      peakWeeklyVolume: "4 bootcamp sessions / week",
      taperLength: "None — ongoing maintenance template",
      cutbackCadence: "Every 4th week deload ~25%",
      mandatoryRestDays: 2,
      equipmentMixHint: "Peloton Bike + bodyweight floor",
    },
    tags: ["bike", "peloton", "bootcamp", "bodyweight", "mixed-modal"],
    expand: (n) => [
      makeBlock("Cardio + Weight Loss", n, {
        customNotes:
          "[primary-machine:bike] Bike Bootcamp — alternating intervals + floor strength",
      }),
    ],
  },
  {
    id: "ywa_30day",
    name: "Yoga With Adriene · 30-Day Journey",
    goalDistance: "Mobility + recovery",
    source: "Yoga With Adriene",
    citation:
      "Yoga With Adriene — 30-day yoga journey series (e.g. Center, Move, Breath).",
    shortDescription:
      "Daily 20-30 min yoga flow for 30 days — mobility, breath, and recovery.",
    longDescription:
      "YWA 30-Day Journey: a daily 20-30 min yoga flow for 30 days. Best slotted as a recovery-focused entry alongside other training, or as a true off-month for mobility and breath work.",
    minWeeks: 4,
    maxWeeks: 6,
    defaultWeeks: 4,
    metadata: {
      intensityDistribution: "100% recovery / mobility",
      peakLongRun: "N/A — yoga template",
      peakWeeklyVolume: "7 short yoga sessions / week",
      taperLength: "N/A — entire entry IS recovery",
      cutbackCadence: "No cutbacks (load already minimal)",
      mandatoryRestDays: 1,
      equipmentMixHint: "Mat-only / no equipment",
    },
    tags: ["yoga", "mobility", "recovery", "low-intensity", "daily"],
    expand: (n) => [
      makeBlock("Recovery", n, {
        customNotes: "YWA 30-day yoga journey — daily 20-30 min flow",
      }),
    ],
  },
  // ---------- Customizable scaffolds ----------
  {
    id: "run_custom",
    name: "Custom · Run",
    goalDistance: "Custom",
    source: "User-defined",
    citation:
      "Customizable run scaffold — runner sets weeks and notes; engine emits the canonical run/lift/cardio week pattern.",
    shortDescription:
      "Open-ended running block: pick weeks and add your own notes for shape and intent.",
    longDescription:
      "A blank-canvas run block. Use it to fill a stretch of your plan with the engine's canonical run pattern (Wed easy, Fri quality, Sun long) when no published program fits. Add per-entry customNotes to describe your intent so the daily plan picks it up.",
    minWeeks: 1,
    maxWeeks: 52,
    defaultWeeks: 8,
    metadata: {
      intensityDistribution: "Runner-defined",
      peakLongRun: "Runner-defined",
      peakWeeklyVolume: "Runner-defined",
      taperLength: "Runner-defined (none by default)",
      cutbackCadence: "Every 4th week ~20% reduction",
      mandatoryRestDays: 1,
      equipmentMixHint: "Run + optional cross-train",
    },
    tags: ["custom", "run", "scaffold"],
    expand: (n) => [
      makeBlock("Custom", n, {
        customName: "Custom Run",
        customNotes: "Custom run block — fill with your own shape and notes",
      }),
    ],
  },
  {
    id: "bike_custom",
    name: "Custom · Bike",
    goalDistance: "Custom",
    source: "User-defined",
    citation:
      "Customizable bike scaffold — runner sets weeks and notes; engine routes to Peloton Bike.",
    shortDescription:
      "Open-ended Peloton Bike block — pick weeks and add your own intent.",
    longDescription:
      "A blank-canvas bike block. Use when no published bike program fits. The [primary-machine:bike] sentinel hints to the engine that the runner's primary machine for this block is the bike.",
    minWeeks: 1,
    maxWeeks: 52,
    defaultWeeks: 8,
    metadata: {
      intensityDistribution: "Runner-defined",
      peakLongRun: "N/A — bike-only template",
      peakWeeklyVolume: "Runner-defined",
      taperLength: "None — runner-defined",
      cutbackCadence: "Every 4th week ~20% reduction",
      mandatoryRestDays: 2,
      equipmentMixHint: "Peloton Bike",
    },
    tags: ["custom", "bike", "scaffold"],
    expand: (n) => [
      makeBlock("Custom", n, {
        customName: "Custom Bike",
        customNotes:
          "[primary-machine:bike] Custom bike block — fill with your own shape",
      }),
    ],
  },
  {
    id: "row_custom",
    name: "Custom · Row",
    goalDistance: "Custom",
    source: "User-defined",
    citation:
      "Customizable row scaffold — runner sets weeks and notes; engine routes to Peloton/Concept2 Row.",
    shortDescription:
      "Open-ended Row block — pick weeks and add your own intent.",
    longDescription:
      "A blank-canvas row block. Use when no published row program fits. The [primary-machine:row] sentinel hints to the engine that the runner's primary machine for this block is the rower.",
    minWeeks: 1,
    maxWeeks: 52,
    defaultWeeks: 8,
    metadata: {
      intensityDistribution: "Runner-defined",
      peakLongRun: "N/A — row-only template",
      peakWeeklyVolume: "Runner-defined",
      taperLength: "None — runner-defined",
      cutbackCadence: "Every 4th week ~20% reduction",
      mandatoryRestDays: 2,
      equipmentMixHint: "Peloton Row / Concept2",
    },
    tags: ["custom", "row", "scaffold"],
    expand: (n) => [
      makeBlock("Custom", n, {
        customName: "Custom Row",
        customNotes:
          "[primary-machine:row] Custom row block — fill with your own shape",
      }),
    ],
  },
  {
    id: "strength_custom",
    name: "Custom · Strength",
    goalDistance: "Custom",
    source: "User-defined",
    citation:
      "Customizable strength scaffold — runner sets weeks and notes; engine emits a Tonal-only week.",
    shortDescription:
      "Open-ended lift-only block — pick weeks; engine emits a Tonal-only week pattern.",
    longDescription:
      "A blank-canvas lift-only block. Carries the [lift-primary:conditioning] sentinel so the daily-recipes pipeline emits Mon/Wed/Fri/Sat Tonal sessions with Tue/Thu/Sun rest days. Add notes describing your intended split.",
    minWeeks: 1,
    maxWeeks: 52,
    defaultWeeks: 8,
    metadata: {
      intensityDistribution: "Runner-defined",
      peakLongRun: "N/A — lift-only template",
      peakWeeklyVolume: "4 Tonal sessions / week",
      taperLength: "None — runner-defined",
      cutbackCadence: "Every 4th week deload ~25%",
      mandatoryRestDays: 3,
      equipmentMixHint: "Tonal only",
    },
    tags: ["custom", "strength", "lift-only", "scaffold"],
    expand: (n) => [
      makeBlock("Custom", n, {
        customName: "Custom Strength",
        customNotes:
          "[lift-primary:conditioning] Custom lift block — fill with your own split",
      }),
    ],
  },
  {
    id: "hybrid_custom",
    name: "Custom · Hybrid",
    goalDistance: "Custom",
    source: "User-defined",
    citation:
      "Customizable hybrid scaffold — runner sets weeks and notes for a concurrent run + lift block.",
    shortDescription:
      "Open-ended concurrent run + lift block — pick weeks and add your own intent.",
    longDescription:
      "A blank-canvas hybrid block. Uses the engine's canonical week pattern (run + heavy lift days) so a runner can compose a concurrent block when no published hybrid program fits.",
    minWeeks: 1,
    maxWeeks: 52,
    defaultWeeks: 8,
    metadata: {
      intensityDistribution: "Runner-defined hybrid",
      peakLongRun: "Runner-defined",
      peakWeeklyVolume: "Runner-defined",
      taperLength: "None — runner-defined",
      cutbackCadence: "Every 4th week deload ~20%",
      mandatoryRestDays: 1,
      equipmentMixHint: "Tonal + run + cardio",
    },
    tags: ["custom", "hybrid", "concurrent", "scaffold"],
    expand: (n) => [
      makeBlock("Custom", n, {
        customName: "Custom Hybrid",
        customNotes:
          "Custom hybrid block — concurrent run + lift, fill with your own shape",
      }),
    ],
  },
  {
    id: "race_countdown",
    name: "Race Countdown (Generic)",
    goalDistance: "Custom race",
    source: "User-defined",
    citation:
      "Generic race countdown scaffold — base + sharpening + taper for any race distance.",
    shortDescription:
      "Generic Base → Speed → Taper countdown scaffold for any race distance.",
    longDescription:
      "A configurable race countdown: distributes weeks into Base, Speed, and a 1-week Taper so a runner facing an unusual race (obstacle, trail, mixed-modal) can still get a structured countdown without picking a published program.",
    minWeeks: 4,
    maxWeeks: 52,
    defaultWeeks: 8,
    metadata: {
      intensityDistribution: "Pyramidal — base + sharpening + taper",
      peakLongRun: "Runner-defined",
      peakWeeklyVolume: "Runner-defined",
      taperLength: "1 week",
      cutbackCadence: "Every 4th week ~20% reduction",
      mandatoryRestDays: 1,
      equipmentMixHint: "Runner-defined",
    },
    tags: ["custom", "race-prep", "scaffold", "taper", "countdown"],
    expand: (n) =>
      distribute(n, [
        { focus: "Base", weight: 2, min: 2 },
        { focus: "Speed", weight: 3, min: 1 },
        { focus: "Taper", weight: 1, min: 1 },
      ]),
  },
];

// Returns the lift-primary "kind" parsed out of a Custom block's
// customNotes sentinel (e.g. `[lift-primary:upper] ...` → `"upper"`),
// or null when the block is not a lift-primary block. Used by the
// daily-recipes pipeline (`buildWeekDays`) and the mileage preview to
// emit a lift-only week (Mon/Wed/Fri/Sat lift; Tue/Thu/Sun rest; no
// runs, no cardio sessions).
export function liftPrimaryKind(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const m = /^\[lift-primary:([^\]]+)\]/.exec(notes.trim());
  return m ? (m[1] ?? "").trim() || null : null;
}

// Returns the primary-machine "kind" parsed out of a block's customNotes
// sentinel (e.g. `[primary-machine:bike] ...` → `"bike"`,
// `[primary-machine:row] ...` → `"row"`), or null when the block does
// not carry the sentinel. Used by the daily-recipes pipeline
// (`buildWeekDays`) and the mileage preview to swap the canonical
// run-biased Wed/Fri/Sun sessions for Bike-only or Row-only sessions
// without changing the surrounding lift/cardio days. Unlike
// `liftPrimaryKind`, this sentinel can ride on ANY focus type (Base,
// Speed, Taper, Custom, ...) — bike/row templates split themselves
// across Base + Speed + Taper blocks while pinning the same machine
// hint on each one.
export type PrimaryMachineKind = "bike" | "row";
export function primaryMachineKind(
  notes: string | null | undefined,
): PrimaryMachineKind | null {
  if (!notes) return null;
  const m = /\[primary-machine:([^\]]+)\]/.exec(notes);
  if (!m) return null;
  const kind = (m[1] ?? "").trim().toLowerCase();
  if (kind === "bike" || kind === "row") return kind;
  return null;
}

export function getTemplateById(id: string): PlanTemplate | null {
  return PLAN_TEMPLATES.find((t) => t.id === id) ?? null;
}

// Opinionated starter shortcuts surfaced as one-click "Use this starter"
// buttons. Each starter is a COMPOSITION of TemplateEntry objects — an
// Aerobic Base lead-in followed by a race-specific template — so that
// the runner gets the canonical "build your engine first, then sharpen"
// structure recommended by every coach in the citation list.
export interface StarterShortcut {
  id: string;
  name: string;
  description: string;
  // Sum of entries.weeks is the total span. No auto-pinned tail.
  entries: ReadonlyArray<{ templateId: string; weeks: number }>;
}

export const STARTER_SHORTCUTS: StarterShortcut[] = [
  {
    id: "hm_beginner_16w",
    name: "HM Beginner — 16 weeks",
    description:
      "4-week Aerobic Base lead-in (Lydiard) feeding into 12 weeks of Higdon's Intermediate-1 half-marathon plan. Ends on the HM template's 2-week taper.",
    entries: [
      { templateId: "aerobic_base", weeks: 4 },
      { templateId: "half_marathon", weeks: 12 },
    ],
  },
  {
    id: "marathon_first_timer_24w",
    name: "Marathon First-Timer — 24 weeks",
    description:
      "6-week Aerobic Base + 18-week Pfitzinger marathon build. Conservative ramp through Base → Time on Feet → Marathon-Specific → 3-week taper.",
    entries: [
      { templateId: "aerobic_base", weeks: 6 },
      { templateId: "marathon", weeks: 18 },
    ],
  },
  {
    id: "get_faster_5k_14w",
    name: "Get Faster 5K — 14 weeks",
    description:
      "6-week Aerobic Base lead-in + 8-week Daniels 5K Improver speed block. Ends on a 1-week sharpening taper into race day.",
    entries: [
      { templateId: "aerobic_base", weeks: 6 },
      { templateId: "5k_improver", weeks: 8 },
    ],
  },
  // Task #97 picked starter shortcuts.
  {
    id: "marathon_pfitz_70_24w",
    name: "Marathon PR (Pfitz 70) — 24 weeks",
    description:
      "6-week Aerobic Base + 18-week Pfitzinger 18/70 high-mileage marathon plan. Ends on Pfitz's 3-week taper.",
    entries: [
      { templateId: "aerobic_base", weeks: 6 },
      { templateId: "marathon_pfitz_18_70", weeks: 18 },
    ],
  },
  {
    id: "marathon_hansons_22w",
    name: "Marathon — Hansons 22 weeks",
    description:
      "4-week Aerobic Base + 18-week Hansons Marathon Method. Cumulative-fatigue model with capped 16 mi long runs.",
    entries: [
      { templateId: "aerobic_base", weeks: 4 },
      { templateId: "marathon_hansons", weeks: 18 },
    ],
  },
  {
    id: "ultra_50m_30w",
    name: "Ultra 50 Mile — 30 weeks",
    description:
      "6-week Aerobic Base + 24-week Koop 50-mile build. Sustained Time-on-Feet block ending on a 2-3 week taper.",
    entries: [
      { templateId: "aerobic_base", weeks: 6 },
      { templateId: "ultra_50_mile", weeks: 24 },
    ],
  },
  {
    id: "bike_pz_ladder_24w",
    name: "Bike PZ Ladder — 24 weeks",
    description:
      "8w Beginner PZ → 8w Intermediate PZ → 8w Advanced PZ. Three-stage Power Zone progression with FTP retests.",
    entries: [
      { templateId: "pelo_bike_pz_beginner", weeks: 8 },
      { templateId: "pelo_bike_pz_intermediate", weeks: 8 },
      { templateId: "pelo_bike_pz_advanced", weeks: 8 },
    ],
  },
  {
    id: "tonal_recomp_16w",
    name: "Tonal Recomp — 16 weeks",
    description:
      "8-week Cardio + Weight Loss block + 8-week Tonal full-body 5x. Caloric throughput first, hypertrophy on top.",
    entries: [
      { templateId: "cardio_weight_loss", weeks: 8 },
      { templateId: "tonal_full_body_5x", weeks: 8 },
    ],
  },
  {
    id: "strength_then_hm_20w",
    name: "Strength → Half Marathon — 20 weeks",
    description:
      "8-week Starting Strength linear progression, then a 12-week Higdon HM build ending on a 2-week taper.",
    entries: [
      { templateId: "starting_strength", weeks: 8 },
      { templateId: "half_marathon", weeks: 12 },
    ],
  },
  {
    id: "hyrox_prep_20w",
    name: "HYROX Prep — 20 weeks",
    description:
      "4-week Aerobic Base + 16-week Peloton x HYROX prep. Mixed-modal race-pace simulations into a 1-week taper.",
    entries: [
      { templateId: "aerobic_base", weeks: 4 },
      { templateId: "pelo_x_hyrox", weeks: 16 },
    ],
  },
  {
    id: "couch_to_hm_24w",
    name: "Couch → Half Marathon — 24 weeks",
    description:
      "9-week NHS Couch to 5K + 4-week Aerobic Base bridge + 11-week Higdon HM. From zero to a half-marathon finish.",
    entries: [
      { templateId: "couch_to_5k", weeks: 9 },
      { templateId: "aerobic_base", weeks: 4 },
      { templateId: "half_marathon", weeks: 11 },
    ],
  },
  {
    id: "nick_bare_hybrid_16w",
    name: "Nick Bare Hybrid — 16 weeks",
    description:
      "Pure 16-week Nick Bare 1.0 hybrid block: concurrent half-marathon training + 3 heavy lift days/week.",
    entries: [{ templateId: "nick_bare_1_0", weeks: 16 }],
  },
];

// Expand an ordered list of TemplateEntry into a flat PhaseBlock[] for
// the generator. Unknown template ids are skipped here; callers that
// need strict behavior (the validator on the apply path) reject unknown
// ids before reaching this function. Per-entry customNotes are merged
// into each expanded block's notes so the runner-supplied context
// surfaces in the daily plan.
//
// NOTE: this overload does NOT honor per-entry `startDate` gaps — it
// stacks entries back-to-back. Callers that need gap support (the
// generator, the validator, the planner UI) should use
// `expandEntriesToBlocksWithGaps(entries, configStartDate)` instead.
export function expandEntriesToBlocks(
  entries: ReadonlyArray<TemplateEntry>,
): PhaseBlock[] {
  const out: PhaseBlock[] = [];
  for (const entry of entries) {
    const tpl = getTemplateById(entry.templateId);
    if (!tpl) continue;
    const blocks = tpl.expand(Math.max(0, Math.floor(entry.weeks)));
    const note = entry.customNotes?.trim() || null;
    const label = entry.customName?.trim() || null;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i]!;
      const merged: PhaseBlock = { ...b };
      if (note) {
        const existing = b.customNotes?.trim();
        merged.customNotes = existing ? `${existing}; ${note}` : note;
      }
      // Apply the entry-level label only to the first block of the
      // entry — that's the runner's named "section" of their plan.
      if (label && i === 0) {
        merged.customName = label;
      }
      out.push(merged);
    }
  }
  return out;
}

const _ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function _parseUTC(iso: string): number | null {
  if (!_ISO_DATE_RE.test(iso)) return null;
  const t = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(t) ? t : null;
}

function _addDaysISO(iso: string, days: number): string | null {
  const t = _parseUTC(iso);
  if (t === null) return null;
  return new Date(t + days * 86400000).toISOString().slice(0, 10);
}

// Per-entry projection used by both the generator (gap-aware block
// expansion) and the planner UI (per-entry start/end date display).
// Each item describes the runner's logical "section" of the plan plus
// any leading filler gap before it.
export interface EntryProjection {
  // Index into the source entries[] array.
  entryIndex: number;
  // The Monday this entry actually begins on. Equals the running
  // cursor unless the entry has an explicit (later) startDate set.
  startDateISO: string;
  // The Sunday this entry ends on (startDate + weeks*7 - 1 days).
  endDateISO: string;
  // Number of filler weeks inserted BEFORE this entry to bridge a
  // user-chosen gap between this entry and the previous one. 0 when
  // the entry stacks immediately after the previous one.
  gapWeeksBefore: number;
}

// Compute per-entry start/end dates and any leading gaps, given the
// config's startDate. Entries with malformed startDate values are
// silently treated as "no override" (back-to-back) — the validator
// surfaces the format error to the runner separately.
export function projectEntries(
  entries: ReadonlyArray<TemplateEntry>,
  configStartDate: string,
): EntryProjection[] {
  const out: EntryProjection[] = [];
  let cursorISO = configStartDate;
  if (_parseUTC(cursorISO) === null) return out;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    let startISO = cursorISO;
    let gapWeeksBefore = 0;
    if (e.startDate && _ISO_DATE_RE.test(e.startDate)) {
      const cursorMs = _parseUTC(cursorISO)!;
      const eMs = _parseUTC(e.startDate);
      if (eMs !== null && eMs >= cursorMs) {
        const days = Math.round((eMs - cursorMs) / 86400000);
        if (days % 7 === 0) {
          gapWeeksBefore = days / 7;
          startISO = e.startDate;
        }
      }
    }
    const weeks = Math.max(0, Math.floor(e.weeks));
    const endISO = _addDaysISO(startISO, weeks * 7 - 1) ?? startISO;
    out.push({ entryIndex: i, startDateISO: startISO, endDateISO: endISO, gapWeeksBefore });
    cursorISO = _addDaysISO(startISO, weeks * 7) ?? cursorISO;
  }
  return out;
}

// Gap-aware expansion: walks `entries` against the config startDate,
// inserting a Recovery filler PhaseBlock before any entry whose
// `startDate` is later than the running cursor. Use this from the
// generator / validator / preview so saved `blocks` reflect the chosen
// dates exactly. When `configStartDate` is malformed, falls back to the
// stack-back-to-back expansion (matches `expandEntriesToBlocks`).
export function expandEntriesToBlocksWithGaps(
  entries: ReadonlyArray<TemplateEntry>,
  configStartDate: string,
): PhaseBlock[] {
  if (_parseUTC(configStartDate) === null) {
    return expandEntriesToBlocks(entries);
  }
  const projections = projectEntries(entries, configStartDate);
  const out: PhaseBlock[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const tpl = getTemplateById(entry.templateId);
    if (!tpl) continue;
    const proj = projections.find((p) => p.entryIndex === i);
    const gap = proj?.gapWeeksBefore ?? 0;
    if (gap > 0) {
      out.push({
        focusType: "Recovery",
        weeks: gap,
        customName: null,
        customNotes: "Gap between templates",
      });
    }
    const blocks = tpl.expand(Math.max(0, Math.floor(entry.weeks)));
    const note = entry.customNotes?.trim() || null;
    const label = entry.customName?.trim() || null;
    for (let j = 0; j < blocks.length; j++) {
      const b = blocks[j]!;
      const merged: PhaseBlock = { ...b };
      if (note) {
        const existing = b.customNotes?.trim();
        merged.customNotes = existing ? `${existing}; ${note}` : note;
      }
      if (label && j === 0) {
        merged.customName = label;
      }
      out.push(merged);
    }
  }
  return out;
}
