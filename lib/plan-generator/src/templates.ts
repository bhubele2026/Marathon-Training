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

export type PlanTemplateLevel = "Beginner" | "Intermediate" | "Advanced";

export interface PlanTemplate {
  id: string;
  name: string;
  // Skill / experience level used to bucket the template in the Plan
  // Template Library. Beginner templates expand by default; Intermediate
  // and Advanced collapse so a first-time runner is not overwhelmed.
  level: PlanTemplateLevel;
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
    // Task #136 — first-class entry into the Beginner section. Unlike
    // every other template, custom_hybrid does NOT prescribe its own
    // intensity distribution: the runner picks a slider position
    // (Lift-Primary → Run-Primary), days/week, fitness level, and
    // optional event date in the in-app builder card. The choices ride
    // on the entry's customNotes (`[hybrid-mix:...] [hybrid-days:N]
    // [hybrid-level:...]`) and `buildHybridWeekDays` in index.ts owns
    // session generation. The template's expand() emits a single Custom
    // block that carries the entry-level notes through to the
    // generator; no taper / cutback periodization is layered (out of
    // scope for v1 per the task spec).
    id: "custom_hybrid",
    name: "Build my own hybrid",
    level: "Beginner",
    goalDistance: "Hybrid (lift + run)",
    source: "Replit Marathon — built for you",
    citation:
      "Custom hybrid plan generated from the in-app builder (task #136). Sessions per week are distributed by the slider position (Lift-Primary → Run-Primary).",
    shortDescription:
      "Build your own balance of lifting and running with a slider — generated as a real campaign.",
    longDescription:
      "Pick total weeks, days/week, a fitness level, and slide between Lift-Primary and Run-Primary. The builder lays out your week with the right number of heavy lifts vs runs (easy/quality/long), respects your pacing-mode preference, and runs concurrently with any other program. Single-block design — no multi-mesocycle periodization in v1.",
    minWeeks: 4,
    maxWeeks: 24,
    defaultWeeks: 8,
    metadata: {
      intensityDistribution: "Slider-controlled lift:run ratio",
      peakLongRun:
        "Up to ~12 mi (run-primary) — capped lower for lift-leaning positions",
      peakWeeklyVolume: "Sessions per week scale with your days/week pick",
      taperLength: "None (single block — set an event date for context only)",
      cutbackCadence: "Every 4th week ~25% volume reduction",
      mandatoryRestDays: 1,
      equipmentMixHint: "Tonal lifts + Tread/Outdoor runs; mix dialed by slider",
    },
    tags: [
      "hybrid",
      "builder",
      "lift-and-run",
      "custom",
      "beginner",
      "fat-loss",
      "muscle-gain",
    ],
    expand: (n) => [
      makeBlock("Custom", n, {
        customName: "Custom Hybrid",
      }),
    ],
  },
  {
    id: "couch_to_5k",
    name: "Couch to 5K",
    level: "Beginner",
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
    id: "higdon_5k_novice",
    name: "5K — Higdon Novice",
    level: "Beginner",
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
    id: "aerobic_base",
    name: "Aerobic Base",
    level: "Beginner",
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
    id: "recovery",
    name: "Recovery",
    level: "Beginner",
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
    id: "5k_improver",
    name: "5K Improver",
    level: "Intermediate",
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
    id: "half_marathon",
    name: "Half Marathon",
    level: "Intermediate",
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
    id: "marathon_higdon_novice",
    name: "Marathon — Higdon Novice 1",
    level: "Intermediate",
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
    id: "marathon",
    name: "Marathon",
    level: "Advanced",
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
    id: "marathon_pfitz_18_70",
    name: "Marathon — Pfitzinger 18/70",
    level: "Advanced",
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
    tags: ["marathon", "pfitzinger", "advanced", "high-mileage", "race-pace", "threshold", "pr"],
    expand: (n) =>
      distribute(n, [
        { focus: "Base", weight: 3, min: 4 },
        { focus: "Time on Feet", weight: 4, min: 5 },
        { focus: "Marathon-Specific", weight: 4, min: 6 },
        { focus: "Taper", weight: 2, min: 3 },
      ]),
  },
  {
    id: "ultramarathon_50k",
    name: "Ultramarathon 50K",
    level: "Advanced",
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

// ---------------------------------------------------------------------------
// CUSTOM HYBRID PLAN BUILDER (Task #136). The runner picks total weeks,
// days/week, a fitness level, and a slider position between Lift-Primary
// and Run-Primary. The builder writes a TemplateEntry pointing at the
// `custom_hybrid` template with the choices encoded as customNotes
// sentinels — `[hybrid-mix:<position>] [hybrid-days:<n>] [hybrid-level:<lvl>]`.
// `expandEntriesToBlocksWithGaps` merges those entry-level notes into the
// expanded Custom block, so the daily-recipes pipeline (`buildWeekDays`)
// can read them anywhere in the merged string and dispatch to
// `buildHybridWeekDays` for slot-by-slot session generation.
// ---------------------------------------------------------------------------

export type HybridMixPosition =
  | "lift_primary"
  | "lift_leaning"
  | "balanced"
  | "run_leaning"
  | "run_primary";

export type HybridFitnessLevel = "beginner" | "intermediate" | "advanced";

export interface HybridMixSpec {
  position: HybridMixPosition;
  daysPerWeek: number;
  level: HybridFitnessLevel;
}

const HYBRID_POSITIONS: ReadonlySet<HybridMixPosition> = new Set<HybridMixPosition>([
  "lift_primary",
  "lift_leaning",
  "balanced",
  "run_leaning",
  "run_primary",
]);

const HYBRID_LEVELS: ReadonlySet<HybridFitnessLevel> = new Set<HybridFitnessLevel>([
  "beginner",
  "intermediate",
  "advanced",
]);

export const HYBRID_DEFAULT_DAYS_PER_WEEK = 5;
export const HYBRID_MIN_DAYS_PER_WEEK = 3;
export const HYBRID_MAX_DAYS_PER_WEEK = 7;

// Parses the custom-hybrid sentinels out of a block's merged customNotes.
// Returns null when the block isn't a custom-hybrid block (no
// `[hybrid-mix:...]` sentinel). Missing days/level fall back to the
// builder defaults so a saved block with only the mix sentinel still
// renders a valid week.
export function hybridMixSpec(
  notes: string | null | undefined,
): HybridMixSpec | null {
  if (!notes) return null;
  const mixMatch = /\[hybrid-mix:([^\]]+)\]/.exec(notes);
  if (!mixMatch) return null;
  const positionRaw = (mixMatch[1] ?? "").trim().toLowerCase() as HybridMixPosition;
  if (!HYBRID_POSITIONS.has(positionRaw)) return null;
  const daysMatch = /\[hybrid-days:(\d+)\]/.exec(notes);
  const daysRaw = daysMatch ? Number(daysMatch[1]) : HYBRID_DEFAULT_DAYS_PER_WEEK;
  const daysPerWeek = Math.min(
    HYBRID_MAX_DAYS_PER_WEEK,
    Math.max(
      HYBRID_MIN_DAYS_PER_WEEK,
      Number.isFinite(daysRaw) ? Math.floor(daysRaw) : HYBRID_DEFAULT_DAYS_PER_WEEK,
    ),
  );
  const levelMatch = /\[hybrid-level:([^\]]+)\]/.exec(notes);
  const levelRaw = ((levelMatch?.[1] ?? "beginner").trim().toLowerCase()) as HybridFitnessLevel;
  const level = HYBRID_LEVELS.has(levelRaw) ? levelRaw : "beginner";
  return { position: positionRaw, daysPerWeek, level };
}

// Runner-facing labels and one-line blurbs for each slider stop. Shared
// between the builder UI (live preview), the picker card, and any
// surface that needs to describe a hybrid plan in human terms.
export const HYBRID_POSITION_LABEL: Record<HybridMixPosition, string> = {
  lift_primary: "Lift-Primary",
  lift_leaning: "Lift-Leaning",
  balanced: "Balanced",
  run_leaning: "Run-Leaning",
  run_primary: "Run-Primary",
};

export const HYBRID_POSITION_BLURB: Record<HybridMixPosition, string> = {
  lift_primary:
    "4 lifts + 1-2 short runs/week. Strength is the centerpiece; runs are easy aerobic conditioning.",
  lift_leaning:
    "3 lifts + 2 runs/week. Strength bias with one quality and one easy run.",
  balanced:
    "3 lifts + 3 runs/week. Equal emphasis on lifting and running, with a long run on Sunday.",
  run_leaning:
    "2 lifts + 3-4 runs/week (easy, quality, long). Running bias with maintenance lifting.",
  run_primary:
    "2 lifts + 4 runs/week with longer aerobic work. Running is the centerpiece, lifts keep strength on the table.",
};

// Ordered slider stops, low (lift) to high (run). Used by the builder UI
// to render the slider and by tests to enumerate every position.
export const HYBRID_POSITIONS_ORDERED: ReadonlyArray<HybridMixPosition> = [
  "lift_primary",
  "lift_leaning",
  "balanced",
  "run_leaning",
  "run_primary",
];

// IDs of templates that previously shipped in the catalog but have been
// pruned during the level-grouped curation pass. They are kept here as
// stub registrations so existing user campaigns referencing these IDs
// continue to validate, expand and regenerate (just as a single "Base"
// block of the saved length). They are intentionally NOT included in
// PLAN_TEMPLATES so they never appear in pickers / catalog endpoints.
const ARCHIVED_TEMPLATE_IDS: readonly string[] = [
  "10k_builder",
  "cardio_weight_loss",
  "hybrid_strength",
  "maintenance",
  "speed_block",
  "tonal_strength_upper",
  "tonal_strength_lower",
  "push_pull_legs",
  "tonal_conditioning",
  "couch_to_5k_alt",
  "higdon_5k_intermediate",
  "higdon_5k_advanced",
  "higdon_10k_advanced",
  "hm_higdon_novice2",
  "hm_pfitz",
  "hm_hansons",
  "marathon_pfitz_12_55",
  "marathon_hansons",
  "marathon_8020",
  "marathon_higdon_advanced",
  "ultra_50_mile",
  "ultra_100k",
  "norwegian_singles",
  "pelo_bike_you_can_ride",
  "pelo_bike_pz_beginner",
  "pelo_bike_pz_intermediate",
  "pelo_bike_pz_advanced",
  "pelo_bike_strength_for_cyclists",
  "pelo_row_dpz",
  "c2_row_30day",
  "c2_row_5k",
  "c2_row_2k",
  "tonal_full_body_5x",
  "starting_strength",
  "stronglifts_5x5",
  "wendler_531_bbb",
  "phul",
  "ppl_6day",
  "simple_and_sinister",
  "nick_bare_1_0",
  "pelo_x_hyrox",
  "maf_180",
  "bike_bootcamp_builder",
  "ywa_30day",
  "run_custom",
  "bike_custom",
  "row_custom",
  "strength_custom",
  "hybrid_custom",
  "race_countdown",
];

const ARCHIVED_TEMPLATE_ID_SET: ReadonlySet<string> = new Set(
  ARCHIVED_TEMPLATE_IDS,
);

function makeArchivedStub(id: string): PlanTemplate {
  return {
    id,
    name: `(Archived) ${id}`,
    level: "Beginner",
    goalDistance: "Archived plan",
    source: "archived",
    citation:
      "Archived template — preserved so legacy campaigns still load and regenerate.",
    shortDescription:
      "Archived template; kept only so existing campaigns referencing it continue to work.",
    longDescription:
      "This template was retired during catalog curation. It no longer appears in the picker and cannot be added to new campaigns, but existing campaigns that reference it continue to validate and regenerate as a single Base block of the saved length.",
    minWeeks: 1,
    maxWeeks: 52,
    defaultWeeks: 4,
    metadata: {
      intensityDistribution: "n/a (archived)",
      peakLongRun: "n/a",
      peakWeeklyVolume: "n/a",
      taperLength: "None",
      cutbackCadence: "n/a",
      mandatoryRestDays: 1,
      equipmentMixHint: "Run-only",
    },
    tags: ["archived"],
    // Archived templates expand to a single Base block with a note
    // making the migration explicit. The original training structure
    // is no longer recoverable, but the campaign keeps the same
    // start date, week count and aerobic emphasis it was built on.
    expand: (n) => {
      const weeks = Math.max(0, Math.floor(n));
      return [
        {
          ...makeBlock("Base", weeks),
          customName: `Archived: ${id}`,
          customNotes:
            "Archived template — original training structure was retired during catalog curation; preserved as a Base block for compatibility.",
        },
      ];
    },
  };
}

export const ARCHIVED_PLAN_TEMPLATES: PlanTemplate[] =
  ARCHIVED_TEMPLATE_IDS.map(makeArchivedStub);

export function isArchivedTemplateId(id: string): boolean {
  return ARCHIVED_TEMPLATE_ID_SET.has(id);
}

export function getTemplateById(id: string): PlanTemplate | null {
  const live = PLAN_TEMPLATES.find((t) => t.id === id);
  if (live) return live;
  const archived = ARCHIVED_PLAN_TEMPLATES.find((t) => t.id === id);
  return archived ?? null;
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
  const startMs = _parseUTC(configStartDate);
  if (startMs === null) return out;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    let startISO = cursorISO;
    let gapWeeksBefore = 0;
    // Task #135: allow overlapping entries — accept any Monday on or
    // after the config startDate. If the override is BEFORE the
    // sequential cursor we treat gapWeeksBefore as 0 (overlap with the
    // previous entry); if AFTER, gapWeeksBefore measures the bridge
    // gap as before.
    if (e.startDate && _ISO_DATE_RE.test(e.startDate)) {
      const cursorMs = _parseUTC(cursorISO)!;
      const eMs = _parseUTC(e.startDate);
      if (eMs !== null && eMs >= startMs) {
        const days = Math.round((eMs - cursorMs) / 86400000);
        if (days % 7 === 0) {
          gapWeeksBefore = days > 0 ? days / 7 : 0;
          startISO = e.startDate;
        }
      }
    }
    const weeks = Math.max(0, Math.floor(e.weeks));
    const endISO = _addDaysISO(startISO, weeks * 7 - 1) ?? startISO;
    out.push({ entryIndex: i, startDateISO: startISO, endDateISO: endISO, gapWeeksBefore });
    // Always advance the cursor to the end of this entry, but never
    // regress (so an explicit overlap startDate before the running
    // cursor doesn't pull subsequent entries backward). This keeps
    // back-to-back entries with explicit Monday startDates from
    // double-counting their span as a phantom gap on the next entry.
    const candidateCursor = _addDaysISO(startISO, weeks * 7);
    if (candidateCursor !== null) {
      const candMs = _parseUTC(candidateCursor);
      const curMs = _parseUTC(cursorISO);
      if (candMs !== null && (curMs === null || candMs > curMs)) {
        cursorISO = candidateCursor;
      }
    }
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
