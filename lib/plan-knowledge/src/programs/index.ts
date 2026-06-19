// Typed Tonal program library. These are REAL, named Tonal programs whose
// STRUCTURE (split, length, cadence, emphasis, progression style, movement-
// pattern skeleton) is replicated from public information — NOT copied marketing
// prose, and NOT a live import. Tonal has no public API, so the coach replicates
// a program's structure and tailors it to this client; the runner should run the
// official program in the Tonal app itself for the in-app coaching.
//
// Honesty: every entry is sourced. `confidence: "exact"` means the split /
// length / cadence / emphasis came straight from Tonal's own published material
// for that program; `"approx"` means the program is real and named but its
// per-day exercise sheet isn't public, so the weekly skeleton is a faithful
// structural reconstruction consistent with its stated level + emphasis.
//
// Progression note: Tonal does NOT publish week-by-week % loading — its digital
// weight (electromagnetic resistance, ~1 lb increments) auto-calibrates per
// movement and IS the progressive-overload engine. So `progressionScheme`
// describes the STRUCTURAL progression (volume accumulation, ABAB rotation,
// wave/ascending/burnout, max/dynamic effort) layered on top of machine
// auto-load — not a hand-coded percentage table.

import type { MovementPattern } from "../types";

export type ProgramEmphasis =
  | "strength"
  | "hypertrophy"
  | "powerbuilding"
  | "recomp"
  | "endurance"
  | "general";

export type ProgramConfidence = "exact" | "approx";

/** Tonal's five "smart" / dynamic weight modes — session-level modifiers that
 * change how load is applied within a set (not load percentages). The coach can
 * name these on a strength block via AiStrengthBlock.tonalMode. */
export const TONAL_DYNAMIC_MODES = [
  "Spotter", // auto-drops weight when you fail a rep
  "Smart Flex", // variable resistance — heavier where strong, lighter at sticking points
  "Eccentric", // adds weight on the lowering phase
  "Chains", // load builds through the concentric range; speed/power days
  "Burnout", // drops weight as you fatigue to push past failure
] as const;

export interface TonalProgramDay {
  /** Session label, e.g. "Lower", "Upper Push", "Full A". */
  label: string;
  /** Movement patterns emphasized that day (for tailoring + balance). */
  patterns: MovementPattern[];
}

export interface TonalProgram {
  /** Stable slug used when the coach anchors a plan to this program. */
  id: string;
  name: string;
  coach: string | null;
  /** Program length in weeks; null when not publicly stated. */
  weeks: number | null;
  daysPerWeek: number;
  /** e.g. "Upper/Lower", "Push/Pull/Legs", "Full-body", "Body-part". */
  split: string;
  emphasis: ProgramEmphasis;
  /** Structural progression (paraphrased) layered on Tonal's auto-load. */
  progressionScheme: string;
  /** Representative week as labeled days -> emphasized movement patterns. */
  weeklySkeleton: TonalProgramDay[];
  /** Dynamic weight modes this program leans on, if any. */
  dynamicModes?: string[];
  confidence: ProgramConfidence;
  sources?: string[];
}

const P = (
  label: string,
  patterns: MovementPattern[],
): TonalProgramDay => ({ label, patterns });

export const TONAL_PROGRAMS: TonalProgram[] = [
  {
    id: "making-muscle-1",
    name: "Making Muscle: Beginner (Phase 1)",
    coach: "Nicolette Amarillas",
    weeks: 4,
    daysPerWeek: 3,
    split: "Full-body",
    emphasis: "hypertrophy",
    progressionScheme:
      "Intensification phase: high-volume full-body to groove patterns; weekly sessions repeat while Tonal's digital weight creeps load up ~1 lb as strength registers. Feeds straight into Phase 2.",
    weeklySkeleton: [
      P("Full A", ["squat", "hinge", "horizontal_push", "vertical_push", "horizontal_pull", "core"]),
      P("Full B", ["squat", "hinge", "vertical_pull", "horizontal_push", "core"]),
      P("Full C", ["lunge", "hinge", "horizontal_push", "horizontal_pull", "core"]),
    ],
    confidence: "exact",
    sources: ["https://www.tonal.com/blog/program-making-muscle/"],
  },
  {
    id: "making-muscle-2",
    name: "Making Muscle: Intermediate (Phase 2)",
    coach: "Nicolette Amarillas",
    weeks: 4,
    daysPerWeek: 3,
    split: "Full-body",
    emphasis: "hypertrophy",
    progressionScheme:
      "Accumulation phase built on Phase 1: more weight/intensity and advanced movement variants; auto-load progresses and structural difficulty ramps versus the beginner phase.",
    weeklySkeleton: [
      P("Full A", ["squat", "horizontal_push", "vertical_pull", "core"]),
      P("Full B", ["hinge", "horizontal_push", "lunge", "horizontal_pull", "core"]),
      P("Full C", ["vertical_push", "lunge", "horizontal_pull", "core"]),
    ],
    confidence: "exact",
    sources: ["https://www.tonal.com/blog/program-making-muscle/"],
  },
  {
    id: "house-of-volume",
    name: "House of Volume",
    coach: "Joe Rodonis",
    weeks: 4,
    daysPerWeek: 4,
    split: "Body-part",
    emphasis: "hypertrophy",
    progressionScheme:
      "Volume accumulation in the 12–20 rep range with short rest; each week adds weight AND reps. Heavy compound supersets early in a session, high-rep accessory burnout late.",
    weeklySkeleton: [
      P("Chest/Back", ["horizontal_push", "horizontal_pull", "core"]),
      P("Lower", ["squat", "hinge", "lunge", "core"]),
      P("Shoulders", ["vertical_push", "vertical_pull", "horizontal_pull", "core"]),
      P("Full", ["squat", "horizontal_push", "horizontal_pull", "core"]),
    ],
    dynamicModes: ["Burnout"],
    confidence: "exact",
    sources: ["https://tonal.com/blogs/all/house-of-volume-joe-rodonis"],
  },
  {
    id: "fast-track-build-1",
    name: "Fast Track: Build — Level I",
    coach: "Tim Landicho, Tanysha Renee, Kristina Centenari",
    weeks: 4,
    daysPerWeek: 3,
    split: "Push/Pull/Legs",
    emphasis: "hypertrophy",
    progressionScheme:
      "ABAB weekly rotation: weeks 1 & 3 share one exercise set, weeks 2 & 4 another, deliberately varying movements to recruit different fibers rather than only piling on volume; Tonal auto-loads. Main blocks are tri-sets, accessory uses shock sets (6-12-25).",
    weeklySkeleton: [
      P("Upper Push", ["horizontal_push", "vertical_push", "core"]),
      P("Lower", ["squat", "hinge", "lunge", "core"]),
      P("Upper Pull", ["horizontal_pull", "vertical_pull", "core"]),
    ],
    confidence: "exact",
    sources: ["https://tonal.com/blogs/all/fall-workout-challenge-four-week-fast-track"],
  },
  {
    id: "fast-track-build-2",
    name: "Fast Track: Build — Level II",
    coach: "Kendall Wood, Joe Rodonis, Ash Wilking, Ackeem Emmons",
    weeks: 4,
    daysPerWeek: 5,
    split: "Body-part (bro split)",
    emphasis: "hypertrophy",
    progressionScheme:
      "Same ABAB 4-week exercise rotation with Tonal auto-loading, but higher frequency: main work is 4-exercise mega-sets back-to-back, followed by active recovery and shock-set / eccentric-focused accessory burnouts. Advanced.",
    weeklySkeleton: [
      P("Chest/Tri", ["horizontal_push", "vertical_push", "core"]),
      P("Back/Bi", ["horizontal_pull", "vertical_pull"]),
      P("Legs", ["squat", "hinge", "lunge", "core"]),
      P("Shoulders/Core", ["vertical_push", "core", "carry"]),
      P("Arms", ["horizontal_push", "horizontal_pull"]),
    ],
    dynamicModes: ["Eccentric"],
    confidence: "exact",
    sources: ["https://tonal.com/blogs/all/fall-workout-challenge-four-week-fast-track"],
  },
  {
    id: "fast-track-torched-1",
    name: "Fast Track: Torched — Level I",
    coach: "Ash Wilking, Ackeem Emmons, Kristina Centenari",
    weeks: 4,
    daysPerWeek: 3,
    split: "Full-body",
    emphasis: "recomp",
    progressionScheme:
      "Body recomposition via faster, duration-based sets (German Body Composition, R.E.P.S., metabolic resistance training) for a higher metabolic response; methodology held consistent week to week while load auto-adjusts. Alternating on/rest cadence.",
    weeklySkeleton: [
      P("Full (GBC)", ["squat", "horizontal_push", "horizontal_pull", "core"]),
      P("Full (MRT)", ["hinge", "vertical_push", "lunge", "core"]),
      P("Full + Mobility", ["squat", "horizontal_pull", "core"]),
    ],
    confidence: "exact",
    sources: ["https://tonal.com/blogs/all/workout-challenge-four-week-fast-track"],
  },
  {
    id: "fast-track-torched-2",
    name: "Fast Track: Torched — Level II",
    coach: "Tim Landicho, Tanysha Renee, Joe Rodonis, Kendall Wood",
    weeks: 4,
    daysPerWeek: 4,
    split: "Full-body + upper-strength",
    emphasis: "recomp",
    progressionScheme:
      "Rep-driven strength + metabolic mix: one full-body GBC day, two upper-body strength days, one metabolic-resistance day, plus mobility; consistent methodology across 4 weeks with auto-load.",
    weeklySkeleton: [
      P("Full (GBC)", ["squat", "hinge", "horizontal_push", "core"]),
      P("Upper Strength", ["horizontal_push", "vertical_push", "horizontal_pull"]),
      P("Upper Strength", ["vertical_pull", "horizontal_pull", "core"]),
      P("Full (MRT)", ["squat", "lunge", "horizontal_push", "core"]),
    ],
    confidence: "exact",
    sources: ["https://tonal.com/blogs/all/workout-challenge-four-week-fast-track"],
  },
  {
    id: "off-season-strength",
    name: "Off-Season Strength",
    coach: "Kristina Centenari",
    weeks: 4,
    daysPerWeek: 4,
    split: "Upper/Lower (max + dynamic effort)",
    emphasis: "strength",
    progressionScheme:
      "Conjugate-style: two max-effort days use a descending rep scheme up to a heavy top set; two dynamic-effort days use Chains mode to drive bar velocity (target >80% on the power meter). Hypertrophy/core and rotational/anti-rotational core layered in.",
    weeklySkeleton: [
      P("Max-Effort Lower", ["squat", "hinge", "core"]),
      P("Max-Effort Upper", ["horizontal_push", "vertical_push", "horizontal_pull", "core"]),
      P("Dynamic-Effort Lower", ["squat", "hinge", "core"]),
      P("Dynamic-Effort Upper", ["horizontal_push", "horizontal_pull", "core"]),
    ],
    dynamicModes: ["Chains"],
    confidence: "exact",
    sources: ["https://www.tonal.com/blog/off-season-strength-program/"],
  },
  {
    id: "go-big-or-go-home-3",
    name: "Go Big or Go Home 3",
    coach: "Jackson Bloore",
    weeks: 4,
    daysPerWeek: 4,
    split: "Push/Pull/Legs",
    emphasis: "powerbuilding",
    progressionScheme:
      "Bodybuilding-inspired high volume, a step up in intensity from GBOGH 1 & 2: Block 1 modified wave loading (alternating high/low rep sets), Block 2 ascending rep scheme, Block 3 straight sets up to 20 reps in Burnout mode; auto-load across weeks.",
    weeklySkeleton: [
      P("Push", ["horizontal_push", "vertical_push", "core"]),
      P("Pull", ["horizontal_pull", "vertical_pull"]),
      P("Legs", ["squat", "hinge", "lunge", "core"]),
      P("Push-Pull", ["horizontal_push", "horizontal_pull", "vertical_push"]),
    ],
    dynamicModes: ["Burnout"],
    confidence: "exact",
    sources: ["https://www.tonal.com/blog/go-big-or-go-home-3/"],
  },
  {
    id: "slow-and-strong",
    name: "Slow and Strong",
    coach: "Nicolette Amarillas",
    weeks: 4,
    daysPerWeek: 4,
    split: "Full-body",
    emphasis: "general",
    progressionScheme:
      "Beginner foundation: 35–45 min full-body sessions teaching fundamental movement patterns at a controlled tempo; sessions repeat weekly so the lifter learns the moves while Tonal nudges load up. Exact weekly loading not public.",
    weeklySkeleton: [
      P("Full A", ["squat", "horizontal_push", "horizontal_pull", "core"]),
      P("Full B", ["hinge", "vertical_push", "lunge", "core"]),
      P("Full C", ["squat", "horizontal_pull", "core"]),
      P("Full D", ["hinge", "horizontal_push", "lunge", "core"]),
    ],
    confidence: "approx",
    sources: ["https://tonal.com/blogs/all/workout-plan-improve-fitness"],
  },
  {
    id: "power-build",
    name: "Power Build",
    coach: "Joe Rodonis",
    weeks: 4,
    daysPerWeek: 4,
    split: "Full-body / Upper-Lower",
    emphasis: "powerbuilding",
    progressionScheme:
      "Advanced: heavy compound lifting combined with explosive plyometrics to build muscle and power; likely Chains/velocity work on the power portions plus heavy auto-loaded strength. Exact weekly loading not public.",
    weeklySkeleton: [
      P("Day 1", ["squat", "horizontal_push", "core"]),
      P("Day 2", ["hinge", "horizontal_pull", "core"]),
      P("Day 3", ["vertical_push", "lunge", "core"]),
      P("Day 4", ["squat", "horizontal_pull", "core"]),
    ],
    dynamicModes: ["Chains"],
    confidence: "approx",
    sources: ["https://tonal.com/blogs/all/build-muscle-programs"],
  },
];

/** All programs, optionally filtered by emphasis. */
export function listPrograms(emphasis?: ProgramEmphasis): TonalProgram[] {
  return emphasis
    ? TONAL_PROGRAMS.filter((p) => p.emphasis === emphasis)
    : TONAL_PROGRAMS;
}

export function getProgramById(id: string): TonalProgram | undefined {
  return TONAL_PROGRAMS.find((p) => p.id === id);
}

/** Loose name match so the coach can resolve a client's free-text program name
 * ("the Making Muscle one", "House of Volume") to a catalog entry. */
export function findProgramByName(name: string): TonalProgram | undefined {
  const q = name.trim().toLowerCase();
  if (!q) return undefined;
  const exact = TONAL_PROGRAMS.find((p) => p.name.toLowerCase() === q);
  if (exact) return exact;
  return TONAL_PROGRAMS.find(
    (p) =>
      p.name.toLowerCase().includes(q) ||
      q.includes(p.name.toLowerCase()) ||
      p.id === q.replace(/\s+/g, "-"),
  );
}

/** Programs best suited to recomposition (lose fat + build muscle): recomp-
 * tagged first, then hypertrophy and general. */
export function recommendForRecomp(): TonalProgram[] {
  const order: ProgramEmphasis[] = ["recomp", "hypertrophy", "general", "powerbuilding"];
  // Emphases not in the priority list (e.g. "strength", "endurance") sort last,
  // not first — indexOf would return -1 and float them to the top.
  const rank = (e: ProgramEmphasis) => {
    const i = order.indexOf(e);
    return i === -1 ? order.length : i;
  };
  return [...TONAL_PROGRAMS].sort((a, b) => rank(a.emphasis) - rank(b.emphasis));
}

/** Compact catalog text injected into the coach's system prompt so it can list,
 * recommend, and anchor to real programs without a web round-trip for the
 * flagship catalog. */
export function programCatalogForPrompt(): string {
  const rows = TONAL_PROGRAMS.map((p) => {
    const split = `${p.weeks ?? "?"}wk · ${p.daysPerWeek}d/wk · ${p.split}`;
    const modes = p.dynamicModes?.length ? ` · modes: ${p.dynamicModes.join("/")}` : "";
    const conf = p.confidence === "approx" ? " (approx structure)" : "";
    const skel = p.weeklySkeleton
      .map((d) => `${d.label}[${d.patterns.join(",")}]`)
      .join(" ");
    return `- ${p.name}${p.coach ? ` (${p.coach})` : ""} — ${p.emphasis}, ${split}${modes}${conf}\n    progression: ${p.progressionScheme}\n    week: ${skel}`;
  });
  return rows.join("\n");
}
