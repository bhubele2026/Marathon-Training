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
    expand: (n) => [
      makeBlock("Custom", n, {
        customName: "Tonal Conditioning Block",
        customNotes:
          "[lift-primary:conditioning] Full-body lift + finisher — no runs scheduled",
      }),
    ],
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
