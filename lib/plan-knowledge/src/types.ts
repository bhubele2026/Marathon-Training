import type { DayName } from "./dates";

// ---------------------------------------------------------------------------
// AiPlan — the structured object Claude returns via the `propose_plan` tool.
//
// Design choices that keep Claude reliable:
//  - Claude does NOT emit calendar dates. It emits a `startDate` (a Monday) and
//    a week index per week; the server computes every day's ISO date. Date math
//    is the most error-prone thing for an LLM, so we don't ask it to.
//  - Claude emits the three-bucket minute breakdown (strength/cardio/run) plus
//    optional distance + pace. The server derives load/equipment-scalar/total
//    and the weekly aggregates. This is exactly the plan_days contract minus the
//    bookkeeping columns.
// ---------------------------------------------------------------------------

export type RaceKind = "marathon" | "half" | "10k" | "5k" | "none";

export interface AiDay {
  day: DayName;
  isRest: boolean;
  /** e.g. "Rest", "Long Run", "Strength + Cardio", "Run + Accessory". */
  sessionType: string;
  /** Tonal / lifting minutes. */
  strengthMin: number;
  /** Non-running cross-train minutes (bike/row/spin). */
  cardioMin: number;
  /** Treadmill or outdoor running minutes. */
  runMin: number;
  /** Run distance in miles (omit/null for non-run days). */
  distanceMi?: number | null;
  /** Pace target, "mm:ss" per mile (omit/null when not a run). */
  pace?: string | null;
  /** Ordered machines used that day (e.g. ["Tonal", "Peloton Bike"]). */
  equipmentList: string[];
  /** One-sentence prose prescription shown on the day card. */
  description: string;
}

export interface AiWeek {
  week: number;
  /** Phase label, e.g. "Foundation Build", "Aerobic Build", "Taper & Race". */
  phase: string;
  days: AiDay[];
}

export interface AiPlan {
  /** Short human summary shown in the chat after a proposal. */
  summary: string;
  /** Suggested config name (the runner can override). */
  name: string;
  /** What the plan builds toward; gates race-week framing. */
  raceKind: RaceKind;
  /** Campaign start — must be a Monday (week 1, day Mon). */
  startDate: string;
  weeks: AiWeek[];
}

// ---------------------------------------------------------------------------
// Personalization context fed into the system briefing (gathered server-side
// from the DB — measurements, prefs, equipment usage, active config).
// ---------------------------------------------------------------------------

export interface DailyBudget {
  weekdayMin?: number | null;
  weekdayMax?: number | null;
  weekendMin?: number | null;
}

export interface PersonalContext {
  /** ISO date "today" (UTC) so Claude anchors relative dates correctly. */
  todayISO: string;
  currentWeightLbs?: number | null;
  goalWeightLbs?: number | null;
  /** Machines the runner owns / uses, canonical order. */
  equipment: string[];
  budget: DailyBudget;
  /** Free-text rollup of recent logged workouts + weight trend, if any. */
  recentActivitySummary?: string | null;
  /** Anything the runner typed into the active config's notes field. */
  notes?: string | null;
}

// ---------------------------------------------------------------------------
// Guardrail findings — soft checks run over a proposed plan. Never block; they
// are surfaced to the runner and (optionally) fed back to Claude to self-correct.
// ---------------------------------------------------------------------------

export type GuardrailLevel = "warn" | "info";

export interface Guardrail {
  level: GuardrailLevel;
  code: string;
  message: string;
  week?: number;
  day?: DayName;
}
