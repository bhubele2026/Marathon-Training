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

// Classifies whether the template's final week culminates in a real
// race-day event. Drives the campaign-final race-day branch in
// `generatePlanFromConfig` / `buildWeekDays` for entries-mode plans:
// when the LAST entry's template is a marathon, the trailing Sunday
// becomes the 26.2 mi marathon and Saturday becomes race-prep —
// mirroring what blocks-mode (`isMarathonCampaign`) already produces.
//
// Today only `"marathon"` triggers the race-day branch in the standard
// recipe pipeline; the other values are recorded for completeness so
// the catalog stays self-describing and future work (e.g. a 13.1 mi
// half-marathon race-day Sunday) can opt in by reading this field.
//
// `"none"` is used for templates that have no race-day event at all
// (custom_hybrid is the hybrid builder — it has no fixed race
// distance, so the trailing Sunday stays a hybrid long-run / lift /
// rest depending on the slider position. As of task #192 the hybrid
// pipeline DOES honor `isRaceWeek` — `buildHybridWeekDays` overrides
// the trailing Sat/Sun for marathon-classified hybrid templates like
// `marathon_hybrid` — but `custom_hybrid` opts out via this field).
export type PlanRaceKind = "marathon" | "half" | "10k" | "5k" | "none";

export interface PlanTemplate {
  id: string;
  name: string;
  // Skill / experience level used to bucket the template in the Plan
  // Template Library. Beginner templates expand by default; Intermediate
  // and Advanced collapse so a first-time runner is not overwhelmed.
  level: PlanTemplateLevel;
  goalDistance: string;
  // Race-day classification (task #184). Only `"marathon"` currently
  // triggers the campaign-final race-day branch in the entries-mode
  // generator; other values are descriptive metadata for future
  // distance-specific race-day support. Optional: when omitted,
  // `templateRaceKind()` derives a reasonable default from
  // `goalDistance` so older templates that haven't been updated still
  // classify correctly. Set explicitly to `"none"` to opt out (e.g.
  // `custom_hybrid` whose runner-built plan has no fixed race day).
  raceKind?: PlanRaceKind;
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
    // session generation.
    //
    // Task #154 — multi-mesocycle periodization. Plans long enough to
    // support a real progression expand into base / build (and a 2w
    // taper for >=16w plans) instead of a single flat block. Each
    // expanded block carries a `[hybrid-phase:base|build|taper]`
    // sentinel that the generator reads to ramp mileage and lift load
    // continuously across the whole hybrid span (base → build picks
    // up where base left off; taper descends from peak). Short plans
    // (<12w) keep the v1 single-block expansion so saved campaigns
    // and brand-new short hybrids regenerate identically.
    id: "custom_hybrid",
    name: "Build my own hybrid",
    level: "Beginner",
    goalDistance: "Hybrid (lift + run)",
    // No race-day event — hybrid plans descend via internal phase
    // scalar, not a marathon-day Sunday (task #184).
    raceKind: "none",
    source: "Replit Marathon — built for you",
    citation:
      "Custom hybrid plan generated from the in-app builder (task #136). Sessions per week are distributed by the slider position (Lift-Primary → Run-Primary). Plans 12w+ split into base/build mesocycles (task #154); 16w+ end on a 2-week taper.",
    shortDescription:
      "Build your own balance of lifting and running with a slider — generated as a real campaign.",
    longDescription:
      "Pick total weeks, days/week, a fitness level, and slide between Lift-Primary and Run-Primary. The builder lays out your week with the right number of heavy lifts vs runs (easy/quality/long), respects your pacing-mode preference, and runs concurrently with any other program. Plans 12 weeks or longer phase into a base block (build aerobic + work capacity) and a build block (peak mileage + lift load); 16+ week plans add a 2-week taper at the end so volume drops into your event. Shorter plans stay a single flat block.",
    minWeeks: 4,
    maxWeeks: 24,
    defaultWeeks: 8,
    metadata: {
      intensityDistribution: "Slider-controlled lift:run ratio",
      peakLongRun:
        "Up to ~12 mi (run-primary) — capped lower for lift-leaning positions",
      peakWeeklyVolume: "Sessions per week scale with your days/week pick",
      // Wording note: contains "none" so the cross-template regression
      // test (`templates with a published taper end on a Taper or
      // Recovery block`) skips custom_hybrid — at defaultWeeks=8 the
      // expand() emits a single Custom block (no Taper focusType),
      // and at 16+ weeks the taper IS a Custom block (Hybrid Taper)
      // not a Taper-focusType block. The taper still descends in
      // mileage and lift load via the phase scalar; it just doesn't
      // change focusType, since the slot-based hybrid generator owns
      // the week shape regardless of focusType.
      taperLength:
        "None for plans <16w (single block); 2-week taper for plans 16w+",
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
    expand: (n) => expandCustomHybrid(n),
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
    id: "5k_strength_lite",
    name: "5K with strength accessory",
    level: "Beginner",
    goalDistance: "3.1 mi",
    source: "Jay Dicharry",
    citation:
      "Jay Dicharry, Running Rewired — strength-supported run training for durable runners.",
    shortDescription:
      "Run-first 5K plan with two short strength accessory days bolted onto the easy days.",
    longDescription:
      "Dicharry's pragmatic approach for new runners who want to keep lifting: three runs per week (one tempo, two easy) with two 25-minute strength accessory sessions on the non-quality days. Mileage stays modest so the lifts can recover; the run plan still owns the race week.",
    minWeeks: 6,
    maxWeeks: 12,
    defaultWeeks: 8,
    metadata: {
      intensityDistribution: "80/20 polarized + 2 light strength accessory days",
      peakLongRun: "5 mi",
      peakWeeklyVolume: "12-18 mpw + 2 strength sessions",
      taperLength: "1 week",
      cutbackCadence: "Every 4th week ~25% reduction",
      mandatoryRestDays: 2,
      equipmentMixHint: "Run + bodyweight or barbell strength accessory",
    },
    tags: ["5k", "beginner", "strength-lite", "polarized", "dicharry"],
    expand: (n) =>
      distribute(n, [
        { focus: "Base", weight: 4, min: 3 },
        { focus: "Speed", weight: 3, min: 2 },
        { focus: "Taper", weight: 1, min: 1 },
      ]),
  },
  {
    id: "5k_hybrid_balanced",
    name: "5K — Balanced Hybrid",
    level: "Beginner",
    goalDistance: "3.1 mi",
    source: "Alex Viada",
    citation:
      "Alex Viada, The Hybrid Athlete — concurrent training for runners and lifters.",
    shortDescription:
      "Heavier hybrid split: 3 lifts + 2-3 runs per week with a 5K race focus.",
    longDescription:
      "Built on Viada's hybrid model: pair concurrent strength and aerobic training without losing either side. Three full-body lift days bracket short tempo and long-easy runs, with race-week load handled by the hybrid generator's internal phase scalar.",
    minWeeks: 6,
    maxWeeks: 12,
    defaultWeeks: 8,
    metadata: {
      intensityDistribution: "Balanced lift/run with weekly tempo run",
      peakLongRun: "5-6 mi",
      peakWeeklyVolume: "12-18 mpw + 3 lift sessions",
      taperLength: "None (single hybrid block; load tapers via internal phase scalar)",
      cutbackCadence: "Every 4th week ~25% reduction",
      mandatoryRestDays: 2,
      equipmentMixHint: "Lifts (Tonal/barbell) + Tread/Outdoor runs",
    },
    tags: ["5k", "beginner", "hybrid", "lift-and-run", "balanced", "viada"],
    expand: (n) => [
      makeBlock("Custom", n, {
        customName: "5K Hybrid (Balanced)",
        customNotes: "[hybrid-mix:balanced] [hybrid-days:5] [hybrid-level:beginner]",
      }),
    ],
  },
  {
    id: "10k_higdon_int",
    name: "10K — Higdon Intermediate",
    level: "Intermediate",
    goalDistance: "6.2 mi",
    source: "Hal Higdon",
    citation:
      "Hal Higdon, Intermediate 10K Training Program. halhigdon.com/training/10k",
    shortDescription:
      "Aerobic base mileage with a mid-cycle tempo block and a 1-week taper.",
    longDescription:
      "Higdon's Intermediate 10K: build conversational mileage first, layer in tempo runs and 5K-pace intervals once aerobic base is established, then taper for one week. Long runs progress from 4 mi to 7-8 mi over the build.",
    minWeeks: 8,
    maxWeeks: 12,
    defaultWeeks: 10,
    metadata: {
      intensityDistribution: "80/20 polarized with weekly tempo",
      peakLongRun: "7-8 mi",
      peakWeeklyVolume: "25-35 mpw",
      taperLength: "1 week",
      cutbackCadence: "Every 4th week ~25% reduction",
      mandatoryRestDays: 1,
      equipmentMixHint: "Run-only with optional cross-train on rest day",
    },
    tags: ["10k", "intermediate", "higdon", "polarized", "tempo"],
    expand: (n) =>
      distribute(n, [
        { focus: "Base", weight: 4, min: 3 },
        { focus: "Speed", weight: 4, min: 3 },
        { focus: "Taper", weight: 1, min: 2 },
      ]),
  },
  {
    id: "10k_daniels",
    name: "10K — Daniels",
    level: "Intermediate",
    goalDistance: "6.2 mi",
    source: "Jack Daniels",
    citation:
      "Jack Daniels, Daniels' Running Formula 4ed — 5K-15K plan (Phase II/III).",
    shortDescription:
      "VO2max-biased speed block on top of a short aerobic base, ending with a 1-week sharpening taper.",
    longDescription:
      "Daniels' 10K plan: short aerobic base, then a heavy interval block (I-pace and T-pace work), capped by a 1-week sharpening taper. Pyramidal intensity distribution with one long run and two quality sessions per week.",
    minWeeks: 8,
    maxWeeks: 12,
    defaultWeeks: 10,
    metadata: {
      intensityDistribution: "Pyramidal — emphasis on I-pace + T-pace",
      peakLongRun: "8-10 mi",
      peakWeeklyVolume: "30-40 mpw",
      taperLength: "1 week",
      cutbackCadence: "Every 4th week ~20% reduction",
      mandatoryRestDays: 1,
      equipmentMixHint: "Run-only with optional easy spin / cross-train",
    },
    tags: ["10k", "intermediate", "daniels", "vo2max", "threshold", "pyramidal"],
    expand: (n) =>
      distribute(n, [
        { focus: "Base", weight: 2, min: 2 },
        { focus: "Speed", weight: 5, min: 5 },
        { focus: "Taper", weight: 1, min: 1 },
      ]),
  },
  {
    id: "10k_pfitz",
    name: "10K — Pfitzinger",
    level: "Intermediate",
    goalDistance: "6.2 mi",
    source: "Pete Pfitzinger",
    citation:
      "Pfitzinger & Latter, Faster Road Racing — 10K training plan (up to 47 mpw).",
    shortDescription:
      "Lactate-threshold-led 10K build: tempo runs, VO2max intervals, 1-2 week taper.",
    longDescription:
      "Pfitzinger's 10K mesocycle: an endurance base feeds into a deep lactate-threshold block (tempo runs, LT intervals) with a single VO2max session per week, then a 1-2 week taper. Designed for runners coming off solid aerobic base.",
    minWeeks: 8,
    maxWeeks: 12,
    defaultWeeks: 10,
    metadata: {
      intensityDistribution: "Pyramidal — heavy LT + race-pace work",
      peakLongRun: "10 mi",
      peakWeeklyVolume: "35-45 mpw",
      taperLength: "1-2 weeks",
      cutbackCadence: "Every 4th week ~20% reduction",
      mandatoryRestDays: 1,
      equipmentMixHint: "Run-only; cross-train discouraged late",
    },
    tags: ["10k", "intermediate", "pfitzinger", "threshold", "race-pace"],
    expand: (n) =>
      distribute(n, [
        { focus: "Base", weight: 4, min: 3 },
        { focus: "Speed", weight: 3, min: 3 },
        { focus: "Taper", weight: 1, min: 2 },
      ]),
  },
  {
    id: "10k_strength_lite",
    name: "10K with strength accessory",
    level: "Intermediate",
    goalDistance: "6.2 mi",
    source: "Jay Dicharry",
    citation:
      "Jay Dicharry, Running Rewired — strength-supported run training for durable runners.",
    shortDescription:
      "Run-first 10K plan with two short strength accessory days bolted onto the easy days.",
    longDescription:
      "Dicharry's pragmatic approach for runners who want to keep lifting: four runs per week (one tempo, one long, two easy) with two 30-minute strength accessory sessions on the non-quality days. Mileage stays in the moderate band so the lifts can recover; the run plan still owns the race week.",
    minWeeks: 8,
    maxWeeks: 12,
    defaultWeeks: 10,
    metadata: {
      intensityDistribution: "80/20 polarized + 2 light strength accessory days",
      peakLongRun: "8 mi",
      peakWeeklyVolume: "25-35 mpw + 2 strength sessions",
      taperLength: "1 week",
      cutbackCadence: "Every 4th week ~25% reduction",
      mandatoryRestDays: 1,
      equipmentMixHint: "Run + bodyweight or barbell strength accessory",
    },
    tags: ["10k", "intermediate", "strength-lite", "polarized", "dicharry"],
    expand: (n) =>
      distribute(n, [
        { focus: "Base", weight: 4, min: 3 },
        { focus: "Speed", weight: 4, min: 3 },
        { focus: "Taper", weight: 1, min: 2 },
      ]),
  },
  {
    id: "10k_hybrid_balanced",
    name: "10K — Balanced Hybrid",
    level: "Intermediate",
    goalDistance: "6.2 mi",
    source: "Alex Viada",
    citation:
      "Alex Viada, The Hybrid Athlete — applied concurrent training for runners.",
    shortDescription:
      "Heavier hybrid split: 3 lifts + 3 runs per week with a 10K race focus.",
    longDescription:
      "Viada's hybrid recipe scaled to a 10K: three full-body lifts plus three runs (easy, tempo, long), with a long run that progresses to 8-9 mi. Race-week load is handled by the hybrid generator's internal phase scalar.",
    minWeeks: 8,
    maxWeeks: 12,
    defaultWeeks: 10,
    metadata: {
      intensityDistribution: "Balanced lift/run with weekly tempo + long run",
      peakLongRun: "8-9 mi",
      peakWeeklyVolume: "18-25 mpw + 3 lift sessions",
      taperLength: "None (single hybrid block; load tapers via internal phase scalar)",
      cutbackCadence: "Every 4th week ~25% reduction",
      mandatoryRestDays: 1,
      equipmentMixHint: "Lifts (Tonal/barbell) + Tread/Outdoor runs",
    },
    tags: ["10k", "intermediate", "hybrid", "lift-and-run", "balanced", "viada"],
    expand: (n) => [
      makeBlock("Custom", n, {
        customName: "10K Hybrid (Balanced)",
        customNotes: "[hybrid-mix:balanced] [hybrid-days:5] [hybrid-level:intermediate]",
      }),
    ],
  },
  {
    id: "half_marathon",
    name: "Half Marathon",
    level: "Advanced",
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
    tags: ["half-marathon", "advanced", "polarized", "tempo", "higdon"],
    expand: (n) =>
      distribute(n, [
        { focus: "Base", weight: 4, min: 4 },
        { focus: "Speed", weight: 3, min: 3 },
        { focus: "Taper", weight: 1, min: 2 },
      ]),
  },
  {
    id: "hm_pfitz",
    name: "Half Marathon — Pfitzinger",
    level: "Advanced",
    goalDistance: "13.1 mi",
    source: "Pete Pfitzinger",
    citation:
      "Pfitzinger & Latter, Faster Road Racing — half marathon plan (up to 55 mpw).",
    shortDescription:
      "Endurance base, lactate-threshold development, race-specific endurance, 2-week taper.",
    longDescription:
      "Pfitzinger's half-marathon mesocycle: mileage build, lactate-threshold development with cruise intervals and tempo runs, race-specific endurance with HM-pace long runs, then a 2-week taper. For runners coming off solid base.",
    minWeeks: 10,
    maxWeeks: 16,
    defaultWeeks: 12,
    metadata: {
      intensityDistribution: "Pyramidal — heavy LT + HM-pace work",
      peakLongRun: "14-16 mi",
      peakWeeklyVolume: "40-55 mpw",
      taperLength: "2 weeks",
      cutbackCadence: "Every 4th week ~20% reduction",
      mandatoryRestDays: 1,
      equipmentMixHint: "Run-only; cross-train discouraged late",
    },
    tags: ["half-marathon", "pfitzinger", "advanced", "threshold", "race-pace", "pyramidal"],
    expand: (n) =>
      distribute(n, [
        { focus: "Base", weight: 4, min: 4 },
        { focus: "Speed", weight: 4, min: 3 },
        { focus: "Taper", weight: 1, min: 2 },
      ]),
  },
  {
    id: "marathon",
    name: "Marathon",
    level: "Advanced",
    goalDistance: "26.2 mi",
    raceKind: "marathon",
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
    raceKind: "marathon",
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
    id: "marathon_hybrid",
    name: "Marathon — Balanced Hybrid",
    level: "Advanced",
    goalDistance: "26.2 mi",
    // Hybrid marathon plans now end on a true RACE DAY Sunday too
    // (task #192). `buildHybridWeekDays` honors `isRaceWeek` by
    // force-overriding the trailing Saturday to Race Prep and the
    // trailing Sunday to a 26.2 mi marathon, while Mon-Fri keep the
    // schedule's normal lift/run/rest layout (the trailing taper is
    // still owned by the hybrid phase scalar). Flipping raceKind to
    // "marathon" routes this template through `entriesEndOnMarathonRace`
    // so the campaign-final week's `isRaceWeek` flag fires, mirroring
    // what every other marathon-classified template (Pfitz, Higdon,
    // etc.) gets at the end of its campaign.
    raceKind: "marathon",
    source: "Alex Viada",
    citation:
      "Alex Viada, The Hybrid Athlete — marathon-distance concurrent training for runners and lifters.",
    shortDescription:
      "Heavier hybrid split scaled to the marathon: 3 lifts + 3-4 runs per week.",
    longDescription:
      "Viada's hybrid model applied at marathon distance: three full-body lifts plus a long aerobic run, a tempo run, and one or two easy runs. The long run climbs to 18-20 mi; race-week load is handled by the hybrid generator's internal phase scalar.",
    minWeeks: 16,
    maxWeeks: 24,
    defaultWeeks: 18,
    metadata: {
      intensityDistribution: "Balanced lift/run with weekly tempo + long run",
      peakLongRun: "18-20 mi",
      peakWeeklyVolume: "30-45 mpw + 3 lift sessions",
      taperLength: "None (single hybrid block; load tapers via internal phase scalar)",
      cutbackCadence: "Every 4th week ~25% reduction",
      mandatoryRestDays: 1,
      equipmentMixHint: "Lifts (Tonal/barbell) + Tread/Outdoor runs",
    },
    tags: ["marathon", "advanced", "hybrid", "lift-and-run", "balanced", "viada"],
    expand: (n) => [
      makeBlock("Custom", n, {
        customName: "Marathon Hybrid (Balanced)",
        customNotes: "[hybrid-mix:balanced] [hybrid-days:5] [hybrid-level:advanced]",
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

// Mesocycle tag stamped on each Custom block produced by the
// custom_hybrid template's phased expansion (Task #154). Plans long
// enough to support real periodization split into base / build /
// (optional) taper, and each block carries a `[hybrid-phase:<phase>]`
// sentinel so the generator can ramp mileage and lift load across
// the whole hybrid span instead of restarting from baseline in every
// block. Short hybrid plans (<12w) and legacy v1 saved configs that
// omit the sentinel render with phase = null = the original
// single-block ramp (back-compat).
export type HybridPhase = "base" | "build" | "taper";

const HYBRID_PHASES: ReadonlySet<HybridPhase> = new Set<HybridPhase>([
  "base",
  "build",
  "taper",
]);

// Parses the `[hybrid-phase:<phase>]` sentinel out of a block's merged
// customNotes. Returns null when the block has no phase tag (the v1
// single-block hybrid layout, or a non-hybrid Custom block). The phase
// sentinel rides alongside the `[hybrid-mix:...] [hybrid-days:N]
// [hybrid-level:...]` sentinels — both parsers tolerate the other's
// presence anywhere in the merged note string.
export function hybridPhase(
  notes: string | null | undefined,
): HybridPhase | null {
  if (!notes) return null;
  const m = /\[hybrid-phase:([^\]]+)\]/.exec(notes);
  if (!m) return null;
  const raw = (m[1] ?? "").trim().toLowerCase() as HybridPhase;
  return HYBRID_PHASES.has(raw) ? raw : null;
}

// Phased expansion of the custom_hybrid template (Task #154). Splits a
// hybrid plan into mesocycles based on its length:
//
//   - n <  12 weeks: one Custom block, no phase sentinel. Matches the
//                    v1 single-block layout exactly so saved short
//                    hybrid campaigns regenerate identically.
//   - 12-15 weeks:  base + build (no taper). Base owns roughly half
//                    the weeks, build owns the rest. Mileage and lift
//                    load progress from base into build instead of
//                    restarting at baseline.
//   - 16+ weeks:    base + build + 2-week taper. Same base/build
//                    split applied to (n - 2) weeks; the trailing
//                    2 weeks are a Hybrid Taper that descends from
//                    peak volume into a recovered race week.
//
// Each phase block carries its own `customName` so the entry-merge
// in `expandEntriesToBlocks` only overrides block 1's name with the
// runner's entry-level label (e.g. "Custom Hybrid (Balanced)") —
// blocks 2/3 keep "Hybrid Build" / "Hybrid Taper" so the runner can
// see the periodization at a glance in /plan and on the dashboard.
export function expandCustomHybrid(weeks: number): PhaseBlock[] {
  const w = Math.max(0, Math.floor(weeks));
  if (w === 0) return [];
  if (w < 12) {
    return [
      makeBlock("Custom", w, {
        customName: "Custom Hybrid",
      }),
    ];
  }
  if (w < 16) {
    const base = Math.floor(w / 2);
    const build = w - base;
    return [
      makeBlock("Custom", base, {
        customName: "Hybrid Base",
        customNotes: "[hybrid-phase:base]",
      }),
      makeBlock("Custom", build, {
        customName: "Hybrid Build",
        customNotes: "[hybrid-phase:build]",
      }),
    ];
  }
  const taper = 2;
  const remaining = w - taper;
  const base = Math.floor(remaining / 2);
  const build = remaining - base;
  return [
    makeBlock("Custom", base, {
      customName: "Hybrid Base",
      customNotes: "[hybrid-phase:base]",
    }),
    makeBlock("Custom", build, {
      customName: "Hybrid Build",
      customNotes: "[hybrid-phase:build]",
    }),
    makeBlock("Custom", taper, {
      customName: "Hybrid Taper",
      customNotes: "[hybrid-phase:taper]",
    }),
  ];
}

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
  // Task #169 — Plan Template Library tightened to exactly 15 templates
  // (5 per Beginner / Intermediate / Advanced). Templates pruned during
  // the Task #169 pass are kept here as stubs so existing user
  // campaigns continue to validate, expand and regenerate.
  "aerobic_base",
  "recovery",
  "5k_improver",
  "marathon_higdon_novice",
  "ultramarathon_50k",
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
    // Archived templates collapse to a single Base block with no
    // race-day event (task #184).
    raceKind: "none",
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

// Classify a template's race-day kind (task #184). Honors the
// explicit `raceKind` field when set; otherwise derives a default
// from `goalDistance` so older templates that haven't been updated
// still classify correctly. Templates whose goalDistance doesn't
// match a recognized race distance (e.g. "Hybrid (lift + run)",
// "Archived plan") fall through to `"none"`.
//
// Single source of truth for both `entriesEndOnMarathonRace` (in
// index.ts, drives `generatePlanFromConfig`'s isRaceWeek gate) and
// any UI that needs to know whether a template ends in a real
// marathon / half / 10K / 5K event.
export function templateRaceKind(
  template: PlanTemplate | null | undefined,
): PlanRaceKind {
  if (!template) return "none";
  if (template.raceKind) return template.raceKind;
  switch (template.goalDistance) {
    case "26.2 mi":
      return "marathon";
    case "13.1 mi":
      return "half";
    case "6.2 mi":
      return "10k";
    case "3.1 mi":
      return "5k";
    default:
      return "none";
  }
}

// Convenience lookup: classify by template id. Unknown ids and
// archived templates resolve to `"none"` so callers can use the
// helper unconditionally without nil-checking.
export function templateRaceKindById(id: string): PlanRaceKind {
  return templateRaceKind(getTemplateById(id));
}

// Classify the LAST entry's race-day kind for an entries-mode plan
// (task #191). Drives the entries-mode race-day branch in
// `generatePlanFromConfig` so that marathon / half / 10K / 5K
// templates each end on a real race-day Sunday with the correct
// distance — instead of whatever the trailing recipe (usually Taper)
// happens to emit. An empty entries array or an unknown last
// templateId returns "none" so the campaign-final week falls through
// to the recipe's natural taper Sunday. Non-race templates (Hybrid,
// lifting-only, archived) also return "none" via `templateRaceKind`.
export function entriesRaceKind(
  entries: ReadonlyArray<{ templateId: string }>,
): PlanRaceKind {
  if (!entries || entries.length === 0) return "none";
  const last = entries[entries.length - 1]!;
  return templateRaceKindById(last.templateId);
}

// Backwards-compatible specialization of `entriesRaceKind`. Predates
// task #191 (when only marathon entries plans had a real race-day
// Sunday). Retained because the planner UI / preview also need a
// boolean for legacy callers that haven't been migrated to the
// per-kind API. New callers should prefer `entriesRaceKind` so the
// planner can light up half / 10K / 5K race-day Sundays too.
export function entriesEndOnMarathonRace(
  entries: ReadonlyArray<{ templateId: string }>,
): boolean {
  return entriesRaceKind(entries) === "marathon";
}

// Per-race-kind metadata used by the campaign-final race-day branch
// in `buildWeekDays` and by the Phase Planner mileage preview (task
// #191). Source of truth for the trailing Sunday's distance, label,
// description, run-minutes-per-mile estimate, and total_load — so
// half / 10K / 5K entries plans get a real race-day Sunday at the
// correct distance instead of the trailing Taper recipe's natural
// ~4 mi long run. Marathon values are pinned to preserve the exact
// numbers task #184 / earlier tests already locked in.
export interface RaceDaySpec {
  distanceMi: number;
  // Short label (e.g. "Half (13.1 mi)") used inside the description.
  label: string;
  // Full Sunday `description` string the generator writes onto the
  // plan_day row. Always begins with "RACE DAY — <label>." so the
  // dashboard / week strip can highlight the campaign-final Sunday.
  description: string;
  // Per-mile run-minute estimate used to compute `run_min`. Slower
  // events (marathon / half) use 11 min/mi; shorter / faster races
  // (10K / 5K) use 10 min/mi. Calibrated with `Math.round`.
  runMinPerMi: number;
  // Race-day `total_load` written onto the Sunday plan_day row. The
  // dashboard uses this to color the daily load chip.
  totalLoad: number;
}

export const RACE_DAY_SPECS: Readonly<
  Record<Exclude<PlanRaceKind, "none">, RaceDaySpec>
> = {
  marathon: {
    distanceMi: 26.2,
    label: "Marathon (26.2 mi)",
    description:
      "RACE DAY — Marathon (26.2 mi). Execute race plan, fuel every 4 mi, finish strong.",
    runMinPerMi: 11,
    totalLoad: 350,
  },
  half: {
    distanceMi: 13.1,
    label: "Half (13.1 mi)",
    description:
      "RACE DAY — Half (13.1 mi). Execute race plan, fuel every 4 mi, finish strong.",
    runMinPerMi: 11,
    totalLoad: 200,
  },
  "10k": {
    distanceMi: 6.2,
    label: "10K (6.2 mi)",
    description:
      "RACE DAY — 10K (6.2 mi). Execute race plan at threshold effort, hold form, finish strong.",
    runMinPerMi: 10,
    totalLoad: 110,
  },
  "5k": {
    distanceMi: 3.1,
    label: "5K (3.1 mi)",
    description:
      "RACE DAY — 5K (3.1 mi). Execute race plan at VO2 effort, go hard from the gun, finish strong.",
    runMinPerMi: 10,
    totalLoad: 60,
  },
};

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
      "6-week Higdon Novice 5K lead-in feeding into 10 weeks of Higdon's half-marathon plan. Ends on the HM template's 2-week taper.",
    entries: [
      { templateId: "higdon_5k_novice", weeks: 6 },
      { templateId: "half_marathon", weeks: 10 },
    ],
  },
  {
    id: "marathon_first_timer_24w",
    name: "Marathon First-Timer — 24 weeks",
    description:
      "6-week Higdon Novice 5K + 18-week Pfitzinger marathon build. Conservative ramp through Base → Time on Feet → Marathon-Specific → 3-week taper.",
    entries: [
      { templateId: "higdon_5k_novice", weeks: 6 },
      { templateId: "marathon", weeks: 18 },
    ],
  },
  {
    id: "get_faster_5k_14w",
    name: "Get Faster 5K — 14 weeks",
    description:
      "6-week NHS Couch to 5K lead-in + 8-week 5K-with-strength-accessory build. Ends on a 1-week sharpening taper into race day.",
    entries: [
      { templateId: "couch_to_5k", weeks: 6 },
      { templateId: "5k_strength_lite", weeks: 8 },
    ],
  },
  {
    id: "couch_to_hm_24w",
    name: "Couch → Half Marathon — 24 weeks",
    description:
      "9-week NHS Couch to 5K + 15-week Higdon HM. From zero to a half-marathon finish.",
    entries: [
      { templateId: "couch_to_5k", weeks: 9 },
      { templateId: "half_marathon", weeks: 15 },
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
