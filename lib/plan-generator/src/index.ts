// Pure plan-generation logic. Shared between the seeding CLI
// (`@workspace/scripts`) and the API server's "Full Reset" endpoint
// (`@workspace/api-server`). Must stay free of node-only side effects (no
// fs / process / dirname) so it can be imported by browser-adjacent
// bundlers if needed and so the api-server test suite can call it
// directly without spinning up a CLI.

import {
  entriesEndOnMarathonRace,
  entriesRaceKind,
  expandEntriesToBlocksWithGaps,
  getTemplateById,
  hybridMixSpec,
  hybridPhase,
  HYBRID_RACE_WEEK_TAPER,
  liftPrimaryKind,
  LIFT_PRIMARY_STARTERS,
  DEFAULT_LIFT_PRIMARY_STARTER,
  getLiftPrimaryStarter,
  primaryMachineKind,
  projectEntries,
  buildRaceDaySunRow,
  buildRaceEveSatRow,
  RACE_DAY_SPECS,
  type HybridFitnessLevel,
  type HybridMixPosition,
  type HybridMixSpec,
  type HybridPhase,
  type PlanRaceKind,
  type PrimaryMachineKind,
  type TemplateEntry,
} from "./templates.js";

export type DailyRow = {
  week: number;
  phase: string;
  date: string;
  day: string;
  strength_load: number | null;
  equipment: string;
  // Ordered chip rail of every machine the runner will touch that day, in
  // canonical priority order: Tonal, Peloton Bike, Peloton Row, Peloton
  // Tread, Outdoor (then anything else). Tue/Thu/Sat → ["Tonal", "<cardio
  // machine>"]; Wed and the foundation Fri pair the run with a Tonal
  // accessory block, so the chip rail leads with TONAL. The scalar
  // `equipment` is always set to `equipment_list[0]` (the *primary*
  // machine for that day) so any back-compat code path that still reads
  // the scalar — dashboard equipment-usage, suggestions pairKey,
  // /equipment — agrees with the chip rail's lead chip. Renderers consume
  // this array verbatim; the legacy single-chip code path falls back to
  // `[equipment]` when the column is null on pre-backfill rows.
  equipment_list: string[];
  description: string;
  // Three-bucket minute breakdown — see lib/db/src/schema/planDays.ts for the
  // semantics of strength_min / cardio_min / run_min. The generator always
  // populates explicit numbers (not null) so downstream rendering of TOTAL
  // · LIFT · CARDIO · RUN never has to invent a value.
  strength_min: number;
  cardio_min: number;
  run_min: number;
  distance_mi: number | null;
  pace: string | null;
  session_type: string;
  is_rest: boolean;
  total_load: number;
};

export type WeeklyRow = {
  week: number;
  phase: string;
  start: string;
  end: string;
  planned_strength: number;
  planned_cardio: number;
  planned_total_load: number;
  planned_miles: number;
  long_run_mi: number;
};

export type BodyRow = {
  week: number;
  date: string;
  weight: number | null;
  l_arm: number | null;
  r_arm: number | null;
  l_leg: number | null;
  r_leg: number | null;
  belly: number | null;
  chest: number | null;
  notes: string;
};

// Canonical equipment tag for non-training movement (dog walks, yard
// work, hikes etc.). Centralized so dashboard rollups, plan filters,
// log forms, and seed scripts all share one literal — a typo in any
// one of them silently breaks the Lifestyle filter / mileage exclusion.
export const LIFESTYLE_EQUIPMENT = "Lifestyle";

export const PLAN_START_ISO = "2026-05-04";
export const RACE_DATE_ISO = "2027-05-02";
export const TOTAL_WEEKS = 52;

const longRuns: (number | null)[] = [
  null,
  2.0, 2.5, 3.0, 2.0, 3.5, 4.0,
  4.5, 5.0, 5.5, 4.0, 6.0, 6.5, 7.0, 5.0, 7.5, 8.0, 8.5, 6.5,
  8.5, 9.0, 9.5, 7.0, 9.5, 10.0, 10.5, 8.0, 10.5, 11.0, 10.5, 8.5, 11.0, 11.5,
  11.0, 8.5, 11.5, 12.0, 11.0, 9.0, 11.5, 12.0, 11.0, 9.0, 12.0, 12.0, 10.0, 12.0,
  11.5, 12.0, 12.0, 9.0, 6.0, 13.1,
];

const cutbackWeeks = new Set<number>([4, 10, 14, 18, 22, 26, 30, 34, 38, 42, 45, 50, 51]);

function getPhase(w: number): string {
  if (w <= 6) return "Foundation Build";
  if (w <= 18) return "Aerobic Build";
  if (w <= 32) return "Tempo / Threshold";
  if (w <= 46) return "Race-Specific";
  return "Taper & Race";
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

function easyRunDist(w: number, isCutback: boolean): number {
  let d: number;
  if (w <= 2) d = 1.5;
  else if (w <= 6) d = 2.0;
  else if (w <= 18) d = 3.0;
  else if (w <= 32) d = 3.5;
  else if (w <= 46) d = 4.0;
  else if (w <= 49) d = 3.5;
  else if (w === 50) d = 2.5;
  else d = 2.0;
  return isCutback ? Math.round(d * 0.7 * 10) / 10 : d;
}

function qualityRunDist(w: number, isCutback: boolean): number {
  let d: number;
  if (w <= 2) d = 1.5;
  else if (w <= 6) d = 2.0;
  else if (w <= 18) d = 3.0;
  else if (w <= 32) d = 4.0;
  else if (w <= 46) d = 4.5;
  else if (w <= 49) d = 3.5;
  else if (w === 50) d = 2.5;
  else if (w === 51) d = 2.0;
  else d = 2.0;
  return isCutback ? Math.round(d * 0.7 * 10) / 10 : d;
}

export function generatePlan(): { daily: DailyRow[]; weekly: WeeklyRow[]; body: BodyRow[] } {
  const startDate = new Date(`${PLAN_START_ISO}T00:00:00Z`);
  const weekly: WeeklyRow[] = [];
  const daily: DailyRow[] = [];
  const body: BodyRow[] = [];

  for (let w = 1; w <= TOTAL_WEEKS; w++) {
    const phase = getPhase(w);
    const longRun = longRuns[w] as number;
    const isCutback = cutbackWeeks.has(w);
    const isRaceWeek = w === TOTAL_WEEKS;

    const wkStart = addDays(startDate, (w - 1) * 7);
    const wkEnd = addDays(wkStart, 6);

    const easyPace =
      w <= 6 ? "14:30" : w <= 18 ? "13:30" : w <= 32 ? "12:30" : w <= 49 ? "12:00" : "12:30";
    const longPace =
      w <= 6 ? "15:00" : w <= 18 ? "14:00" : w <= 32 ? "13:00" : w <= 49 ? "12:30" : "13:00";
    const tempoPace = w <= 18 ? "12:30" : w <= 32 ? "11:30" : "11:00";

    // Heavy lift block (Tonal). Capped pairing with short bike/row (20-30 min).
    const heavyStrengthLoad = isCutback ? 45 : 60;
    const heavyTonalMin = isCutback ? 35 : 45;
    const shortCardioMin = isCutback ? 20 : 25;
    // Light Tonal accessory block paired with the Wed/Fri run.
    const accessoryTonalMin = isCutback ? 20 : 25;

    // ---------- MON: REST ----------
    const monDay: DailyRow = {
      week: w,
      phase,
      date: fmt(wkStart),
      day: "Mon",
      strength_load: 0,
      equipment: "Off / Rest",
      equipment_list: ["Off / Rest"],
      description: "Full rest day. Optional 20 min walk, foam roll, mobility, hydrate.",
      strength_min: 0,
      cardio_min: 0,
      run_min: 0,
      distance_mi: null,
      pace: null,
      session_type: "Rest",
      is_rest: true,
      total_load: 0,
    };

    // ---------- TUE: HEAVY LIFT + SHORT BIKE ----------
    const tueDay: DailyRow = {
      week: w,
      phase,
      date: fmt(addDays(wkStart, 1)),
      day: "Tue",
      strength_load: heavyStrengthLoad,
      equipment: "Tonal",
      equipment_list: ["Tonal", "Peloton Bike"],
      description: isCutback
        ? `Heavy upper-body Tonal (${heavyTonalMin} min, push/pull/core), then ${shortCardioMin} min easy Peloton Bike spin to flush legs`
        : `Heavy upper-body Tonal (${heavyTonalMin} min, push/pull at 80-85% effort), then ${shortCardioMin} min easy Peloton Bike spin`,
      strength_min: heavyTonalMin,
      cardio_min: shortCardioMin,
      run_min: 0,
      distance_mi: null,
      pace: null,
      session_type: "Strength + Cardio",
      is_rest: false,
      total_load: heavyStrengthLoad + shortCardioMin,
    };

    // ---------- WED: EASY (or STEADY) RUN + LIGHT TONAL ACCESSORY ----------
    // Race-Specific phase weeks (33-46) upgrade the Wed mid-week aerobic
    // run to a steady-state ("Z3 effort") session on non-cutback weeks
    // so the Run Target chip surfaces the amber-400 Zone 3 swatch on a
    // real prescribed day rather than only being reachable from a
    // unit-test fixture (Task #172). Cutback weeks (34/38/42/45) stay
    // easy — the deload is recovery for Sun's long run, not another
    // quality day. The Tonal accessory block is unchanged so weekly load
    // math is unaffected.
    const wedDist = easyRunDist(w, isCutback);
    const wedRunMin = Math.max(20, Math.round(wedDist * (w <= 6 ? 16 : w <= 18 ? 13 : 12)));
    const wedAccessoryLoad = isCutback ? 20 : 25;
    const wedSteady = w >= 33 && w <= 46 && !isCutback;
    const wedDay: DailyRow = {
      week: w,
      phase,
      date: fmt(addDays(wkStart, 2)),
      day: "Wed",
      strength_load: wedAccessoryLoad,
      // Wed always pairs the run with a Tonal accessory block, so both
      // chips render. Per the task #77 contract the scalar `equipment` is
      // always the first chip in the rail — TONAL on Wed — so dashboard /
      // suggestions / /equipment agree with the chip rail's lead chip.
      equipment: "Tonal",
      equipment_list: ["Tonal", "Peloton Tread"],
      description: wedSteady
        ? `Steady-state Tread run (${wedDist} mi, Z3 controlled effort — comfortably hard but conversational in short sentences), then ${accessoryTonalMin} min Tonal core + accessory work (no heavy lifting)`
        : isCutback
        ? `Easy aerobic Tread run (${wedDist} mi, conversational), then ${accessoryTonalMin} min light Tonal core + mobility`
        : `Easy aerobic Tread run (${wedDist} mi, fully conversational pace), then ${accessoryTonalMin} min Tonal core + accessory work (no heavy lifting)`,
      strength_min: accessoryTonalMin,
      cardio_min: 0,
      run_min: wedRunMin,
      distance_mi: wedDist,
      pace: wedSteady ? tempoPace : easyPace,
      session_type: wedSteady ? "Steady Run + Accessory" : "Run + Accessory",
      is_rest: false,
      total_load: wedRunMin + wedAccessoryLoad,
    };

    // ---------- THU: HEAVY LIFT + SHORT ROW ----------
    const thuDay: DailyRow = {
      week: w,
      phase,
      date: fmt(addDays(wkStart, 3)),
      day: "Thu",
      strength_load: heavyStrengthLoad,
      equipment: "Tonal",
      equipment_list: ["Tonal", "Peloton Row"],
      description: isCutback
        ? `Heavy lower-body Tonal (${heavyTonalMin} min, squat/hinge/lunge), then ${shortCardioMin} min steady Peloton Row`
        : `Heavy lower-body Tonal (${heavyTonalMin} min, squat/hinge/lunge at 80-85% effort), then ${shortCardioMin} min steady Peloton Row`,
      strength_min: heavyTonalMin,
      cardio_min: shortCardioMin,
      run_min: 0,
      distance_mi: null,
      pace: null,
      session_type: "Strength + Cardio",
      is_rest: false,
      total_load: heavyStrengthLoad + shortCardioMin,
    };

    // ---------- FRI: QUALITY RUN (big run = no lift; easy = + accessory) ----------
    const friDist = qualityRunDist(w, isCutback);
    let friType: string;
    let friDesc: string;
    let friPace: string;
    let friLiftLoad: number;
    let friLiftMin: number;
    let friLiftDesc: string;

    if (w <= 6) {
      friType = "Aerobic Base";
      friDesc = `Easy aerobic Tread run (${friDist} mi), build durability`;
      friPace = easyPace;
      friLiftLoad = isCutback ? 18 : 22;
      friLiftMin = accessoryTonalMin;
      friLiftDesc = ` + ${accessoryTonalMin} min Tonal core + mobility`;
    } else if (w <= 18) {
      friType = isCutback ? "Aerobic Base" : "Tempo Run";
      friDesc = isCutback
        ? `Easy recovery Tread run (${friDist} mi)`
        : `Tread tempo (${friDist} mi: 5 min easy, ${Math.max(10, friDist * 4)} min steady tempo, 5 min cool-down)`;
      friPace = isCutback ? easyPace : tempoPace;
      friLiftLoad = 0;
      friLiftMin = 0;
      friLiftDesc = " — no lift today, recover for the long run";
    } else if (w <= 32) {
      friType = isCutback ? "Aerobic Base" : "Threshold Intervals";
      friDesc = isCutback
        ? `Easy recovery Tread run (${friDist} mi)`
        : `Tread threshold (${friDist} mi: warm-up, then 4 x 800m at threshold w/ 90s jog recovery, cool-down)`;
      friPace = isCutback ? easyPace : tempoPace;
      friLiftLoad = 0;
      friLiftMin = 0;
      friLiftDesc = " — no lift today, recover for the long run";
    } else if (w <= 46) {
      friType = isCutback ? "Aerobic Base" : "Race-Pace Workout";
      friDesc = isCutback
        ? `Easy recovery Tread run (${friDist} mi)`
        : `Tread race-pace (${friDist} mi: warm-up, 3 x 1 mi at goal half-marathon pace w/ 2 min recovery, cool-down)`;
      friPace = isCutback ? easyPace : tempoPace;
      friLiftLoad = 0;
      friLiftMin = 0;
      friLiftDesc = " — no lift today, recover for the long run";
    } else if (w <= 49) {
      friType = "Tempo Run";
      friDesc = `Tread sharpener (${friDist} mi: 10 min easy, 15-20 min steady tempo, 5 min cool-down)`;
      friPace = tempoPace;
      friLiftLoad = 0;
      friLiftMin = 0;
      friLiftDesc = " — no lift today";
    } else if (w === 50) {
      friType = "Tempo Run";
      friDesc = `Tread taper tempo (${friDist} mi: 10 min easy, 12 min tempo, 5 min cool-down)`;
      friPace = tempoPace;
      friLiftLoad = 0;
      friLiftMin = 0;
      friLiftDesc = " — no lift today";
    } else if (w === 51) {
      friType = "Sharpener";
      friDesc = `Easy Tread run (${friDist} mi) with 4 x 30s strides in the final mile`;
      friPace = easyPace;
      friLiftLoad = 0;
      friLiftMin = 0;
      friLiftDesc = " — no lift today";
    } else {
      friType = "Race Shakeout";
      friDesc = `Easy Tread shakeout (${friDist} mi) with 3 x 30s strides`;
      friPace = easyPace;
      friLiftLoad = 0;
      friLiftMin = 0;
      friLiftDesc = " — no lift today, race tomorrow";
    }
    const friRunMin = Math.max(20, Math.round(friDist * (w <= 6 ? 16 : w <= 18 ? 13 : w <= 32 ? 12 : 11.5)));
    const friDay: DailyRow = {
      week: w,
      phase,
      date: fmt(addDays(wkStart, 4)),
      day: "Fri",
      strength_load: friLiftLoad,
      // Foundation Fri (W1-6) pairs the run with a Tonal accessory block;
      // from W7 onward Fri is run-only so we drop the Tonal chip. Per the
      // task #77 contract the scalar `equipment` always tracks
      // `equipment_list[0]` — TONAL during foundation, PELOTON TREAD once
      // the accessory block drops away.
      equipment: friLiftMin > 0 ? "Tonal" : "Peloton Tread",
      equipment_list: friLiftMin > 0 ? ["Tonal", "Peloton Tread"] : ["Peloton Tread"],
      description: friDesc + friLiftDesc,
      strength_min: friLiftMin,
      cardio_min: 0,
      run_min: friRunMin,
      distance_mi: friDist,
      pace: friPace,
      session_type: friLiftLoad > 0 ? `${friType} + Accessory` : friType,
      is_rest: false,
      total_load: friRunMin + friLiftLoad,
    };

    // ---------- SAT: HEAVY LIFT + SHORT BIKE/ROW (alternate) ----------
    // Race-eve Sat (race week) is built end-to-end by the shared
    // `buildRaceEveSatRow` helper (Task #215) so every field — minutes,
    // cardio machine alternation, description, session_type, total_load,
    // and the zeroed-out strength_load (the heavy Sat lift is dropped to
    // prioritize freshness; Task #213) — is read from the same source as
    // the other two race-week Sat branches in `buildWeekDays` (line ~2583)
    // and `buildHybridWeekDays` (line ~2124). Non-race weeks keep the
    // recipe-driven heavy lift + short cardio finisher inline; the bike/
    // row alternation rule is the same in both modes.
    let satDay: DailyRow;
    if (isRaceWeek) {
      satDay = buildRaceEveSatRow({
        weekNumber: w,
        phase,
        date: fmt(addDays(wkStart, 5)),
      });
    } else {
      const satCardioName = w % 2 === 0 ? "Peloton Row" : "Peloton Bike";
      const satCardioVerb = w % 2 === 0 ? "steady row" : "steady bike";
      satDay = {
        week: w,
        phase,
        date: fmt(addDays(wkStart, 5)),
        day: "Sat",
        strength_load: heavyStrengthLoad,
        equipment: "Tonal",
        equipment_list: ["Tonal", satCardioName],
        description: isCutback
          ? `Heavy full-body Tonal (${heavyTonalMin} min, mixed push/pull/squat), then ${shortCardioMin} min ${satCardioVerb}`
          : `Heavy full-body Tonal (${heavyTonalMin} min, mixed push/pull/squat at 80-85% effort), then ${shortCardioMin} min ${satCardioVerb} on ${satCardioName}`,
        strength_min: heavyTonalMin,
        cardio_min: shortCardioMin,
        run_min: 0,
        distance_mi: null,
        pace: null,
        session_type: "Strength + Cardio",
        is_rest: false,
        total_load: heavyStrengthLoad + shortCardioMin,
      };
    }

    // ---------- SUN: LONG RUN (no lift) or RACE ----------
    // Race-day Sun (race week, w === TOTAL_WEEKS) is built end-to-end
    // by the shared `buildRaceDaySunRow` helper (Task #217) so every
    // field — distance / description / run_min / total_load /
    // equipment list / session_type / pace — is read from the same
    // `RACE_DAY_SPECS[raceKind]` table the other two race-week Sun
    // branches in `buildWeekDays` (recipe-driven) and
    // `buildHybridWeekDays` (hybrid-driven) consume. The canonical
    // 52-week plan classifies as `raceKind: "half"` (the template
    // ends on a half marathon), so it pulls the half spec here.
    // Before Task #217/#218, this branch inlined "Half Marathon
    // (13.1 mi)" copy, `run_min = round(13.1 * 12) = 157`, and
    // `total_load = 260`, which silently disagreed with the spec
    // table's "Half (13.1 mi)" copy, `runMinPerMi = 11` (→ run_min
    // 144), and `totalLoad = 200`. Task #221 also promoted `pace`
    // into the spec — the post-#218 branch still read the local
    // `tempoPace` (= "11:00" for w=52) and the recipe / hybrid
    // branches read `recipe.tempoPace` / `qualityPace`, which could
    // drift; the helper now reads `pace` from `spec.pace` too so all
    // three callers share a single per-kind source.
    let sunDay: DailyRow;
    if (isRaceWeek) {
      sunDay = buildRaceDaySunRow({
        weekNumber: w,
        phase,
        date: fmt(addDays(wkStart, 6)),
        raceKind: "half",
      });
    } else {
      const longEquipment = w % 2 === 0 ? "Outdoor" : "Peloton Tread";
      const longDesc =
        w <= 6
          ? `Long run/walk (${longRun} mi): easy walk-run intervals, build aerobic durability. NO lift today.`
          : w <= 18
          ? `Long aerobic run (${longRun} mi): conversational pace, focus on time on feet. NO lift today.`
          : w <= 32
          ? `Steady long run (${longRun} mi): build endurance, dial in fueling and hydration. NO lift today.`
          : w <= 46
          ? `Goal-pace long (${longRun} mi): 2 mi easy warm-up, then progressive miles at race pace, 1 mi cool-down. NO lift today.`
          : w <= 49
          ? `Final long efforts (${longRun} mi): steady aerobic, dress-rehearse race kit and fueling. NO lift today.`
          : w === 50
          ? `Reduced long run (${longRun} mi): easy controlled effort, no surges, build freshness. NO lift today.`
          : `Short taper long (${longRun} mi): easy effort, focus on feeling fresh for race day. NO lift today.`;
      const longMin = Math.round(longRun * (w <= 6 ? 16 : w <= 18 ? 14 : w <= 32 ? 13 : 12.5));
      sunDay = {
        week: w,
        phase,
        date: fmt(addDays(wkStart, 6)),
        day: "Sun",
        strength_load: 0,
        equipment: longEquipment,
        equipment_list: [longEquipment],
        description: longDesc,
        strength_min: 0,
        cardio_min: 0,
        run_min: longMin,
        distance_mi: longRun,
        pace: longPace,
        session_type: "Long Run",
        is_rest: false,
        total_load: longMin + 10,
      };
    }

    const days = [monDay, tueDay, wedDay, thuDay, friDay, satDay, sunDay];
    daily.push(...days);

    const planned_strength = days.reduce((s, d) => s + (d.strength_load || 0), 0);
    // Weekly planned_cardio aggregates non-running cardio minutes only; run
    // minutes are excluded so the weekly card's "Cardio" stat doesn't
    // double-count tread/outdoor runs already reflected in planned_miles.
    const planned_cardio = days.reduce((s, d) => s + (d.cardio_min || 0), 0);
    const planned_total_load = days.reduce((s, d) => s + (d.total_load || 0), 0);
    const planned_miles =
      Math.round(days.reduce((s, d) => s + (d.distance_mi || 0), 0) * 10) / 10;

    weekly.push({
      week: w,
      phase,
      start: fmt(wkStart),
      end: fmt(wkEnd),
      planned_strength,
      planned_cardio,
      planned_total_load,
      planned_miles,
      long_run_mi: isRaceWeek ? 13.1 : longRun,
    });

    if (w === 1) {
      body.push({
        week: 1,
        date: fmt(wkStart),
        weight: 281.6,
        l_arm: 17,
        r_arm: 17,
        l_leg: 29.5,
        r_leg: 29.5,
        belly: 53.5,
        chest: 51,
        notes: "Baseline week — enter starting measurements here.",
      });
    } else {
      body.push({
        week: w,
        date: fmt(wkStart),
        weight: null,
        l_arm: null,
        r_arm: null,
        l_leg: null,
        r_leg: null,
        belly: null,
        chest: null,
        notes: "",
      });
    }
  }

  return { daily, weekly, body };
}

// ===========================================================================
// PLANNER CONFIG (Task #80) — parameterized plan generation
// ===========================================================================
//
// The original `generatePlan()` above produces the canonical 52-week
// half-marathon plan that the seed CLI and a brand-new "Full Reset" call use
// when no Planner config has ever been saved. Once the runner saves a
// Planner config (PUT /api/planner/config) and clicks Apply
// (POST /api/planner/apply), the API server calls
// `generatePlanFromConfig(config)` instead so the plan rows reflect the
// runner's chosen marathon date, training start date, and ordered phase
// blocks.
//
// The auto-pinned 16-week Marathon-Specific block is appended to the
// runner's blocks at generation time so the user-facing block list never has
// to include it (and can never accidentally exclude it). Validation enforces
// that user blocks sum to (totalWeeks - MARATHON_TAIL_WEEKS) so the
// generated plan lands exactly on the marathon date with the auto-pinned
// block as the trailing 16 weeks.

export const FOCUS_TYPES = [
  "Base",
  "Time on Feet",
  "Cardio + Weight Loss",
  "Speed",
  "Marathon-Specific",
  "Taper",
  "Recovery",
  "Custom",
] as const;

export type FocusType = (typeof FOCUS_TYPES)[number];

export interface PhaseBlock {
  focusType: FocusType;
  weeks: number;
  customName?: string | null;
  customNotes?: string | null;
}

// Parse mm:ss/mi → seconds; null for blank / malformed input.
export function parseMmSsPace(input: string | null | undefined): number | null {
  if (input == null) return null;
  const trimmed = String(input).trim();
  if (trimmed === "") return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (!m) return null;
  const min = Number(m[1]);
  const sec = Number(m[2]);
  if (!Number.isFinite(min) || !Number.isFinite(sec)) return null;
  if (sec >= 60) return null;
  return min * 60 + sec;
}

// Format sec/mi → mm:ss for plan_days.pace.
export function formatMmSsPace(sec: number): string {
  const safe = Math.max(0, Math.round(sec));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Continuous per-week pace ramp at RAMP_SEC_PER_BLOCK/RAMP_BLOCK_WEEKS
// sec/mi/week from `startingPaceSec`, clamped at the recipe's easy
// floor. Long = easy + 30, tempo = easy − 60 (each floor-clamped).
export const RAMP_SEC_PER_BLOCK = 30;
export const RAMP_BLOCK_WEEKS = 8;
export const RAMP_SEC_PER_WEEK = RAMP_SEC_PER_BLOCK / RAMP_BLOCK_WEEKS;
export function computeEffectivePace(
  startingPaceSec: number,
  campaignWeek: number,
  recipeEasyFloorSec: number,
  recipeLongFloorSec: number,
  recipeTempoFloorSec: number,
): { easySec: number; longSec: number; tempoSec: number } {
  const elapsedWeeks = Math.max(0, campaignWeek - 1);
  const rampedEasyExact = startingPaceSec - elapsedWeeks * RAMP_SEC_PER_WEEK;
  const rampedEasy = Math.max(
    recipeEasyFloorSec,
    Math.round(rampedEasyExact),
  );
  const rampedLong = Math.max(recipeLongFloorSec, rampedEasy + 30);
  const rampedTempo = Math.max(recipeTempoFloorSec, rampedEasy - 60);
  return {
    easySec: rampedEasy,
    longSec: rampedLong,
    tempoSec: rampedTempo,
  };
}

// Walk-run on-ramp: first WALK_RUN_MAX_ENTRY_LOCAL_WEEK weeks of each
// entry whose entry-start effective easy pace is still > 14:00/mi.
export const WALK_RUN_PACE_THRESHOLD_SEC = 840;
export const WALK_RUN_MAX_ENTRY_LOCAL_WEEK = 2;
export const WALK_RUN_MAX_CAMPAIGN_WEEK = WALK_RUN_MAX_ENTRY_LOCAL_WEEK;

// Default starting easy pace (14:30/mi) when none is configured.
export const DEFAULT_STARTING_PACE_SEC = 870;

export function walkRunDescription(runMin: number): string {
  const repeats = Math.max(1, Math.floor(runMin / 3));
  return `${repeats} x (2:00 walk @ 18:00/mi + 1:00 jog @ 14:00/mi) on Peloton Tread`;
}

export interface PlannerConfig {
  // ISO yyyy-mm-dd; week 1 begins on this date. Must be a Monday so the
  // Mon..Sun day pattern lines up with the calendar; the validator enforces
  // this so a runner can't accidentally start mid-week.
  startDate: string;
  // ISO yyyy-mm-dd; race day. Must be a Sunday and the dates must form a
  // whole number of Mon..Sun weeks. In LEGACY mode (entries == null/undef)
  // the span must be at least MARATHON_TAIL_WEEKS so the auto-pinned tail
  // fits; in ENTRIES mode the span must equal sum(entries.weeks).
  marathonDate: string;
  // Ordered user-defined blocks (LEGACY mode). When `entries` is present,
  // `blocks` is treated as the projection of entries->blocks computed by
  // the server at write time — the validator does NOT re-check
  // sum(blocks.weeks) in entries-mode (entries ARE the source of truth).
  blocks: PhaseBlock[];
  // ENTRIES mode. Ordered list of TemplateEntry objects; each
  // entry references a template by id and specifies the runner-chosen
  // week count. When non-null, sum(entries.weeks) must equal totalWeeks
  // and there is NO auto-pinned 16-week Marathon-Specific tail —
  // templates own their own taper / race week.
  entries?: TemplateEntry[] | null;
  // Optional week-1 easy pace (sec/mi). Null → DEFAULT_STARTING_PACE_SEC.
  startingPaceSec?: number | null;
}

// The trailing Marathon-Specific block is always exactly 16 weeks. Pinned
// here so the validator, the generator, and the UI all agree on the size.
export const MARATHON_TAIL_WEEKS = 16;

// Total race day mileage (full marathon).
export const MARATHON_DISTANCE_MI = 26.2;

// Total weeks between startDate (a Monday) and marathonDate (a Sunday),
// inclusive of both ends. Week 1 starts Monday startDate; the final week's
// Sunday is marathonDate. Returns -1 when the dates don't form a valid
// Monday→Sunday week-aligned span.
export function totalWeeksFromDates(
  startDate: string,
  marathonDate: string,
): number {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const race = Date.parse(`${marathonDate}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(race)) return -1;
  const diffDays = Math.round((race - start) / 86400000);
  if (diffDays < 6) return -1;
  if ((diffDays + 1) % 7 !== 0) return -1;
  return (diffDays + 1) / 7;
}

// What the user-defined block weeks must sum to so the plan ends with the
// auto-pinned Marathon-Specific block landing on race day.
export function expectedUserBlockWeeks(
  startDate: string,
  marathonDate: string,
): number {
  const total = totalWeeksFromDates(startDate, marathonDate);
  if (total < 0) return -1;
  return total - MARATHON_TAIL_WEEKS;
}

export interface PlannerValidationIssue {
  // Dot-path identifying the problematic field. Examples:
  //   "startDate", "marathonDate", "blocks", "blocks[2].weeks",
  //   "blocks[3].customName".
  field: string;
  message: string;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isMonday(iso: string): boolean {
  if (!ISO_DATE_RE.test(iso)) return false;
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(t)) return false;
  return new Date(t).getUTCDay() === 1;
}

function isSunday(iso: string): boolean {
  if (!ISO_DATE_RE.test(iso)) return false;
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(t)) return false;
  return new Date(t).getUTCDay() === 0;
}

export interface ValidatePlannerConfigOptions {
  // When set, the marathon date must be on or after this ISO yyyy-mm-dd.
  // Used by the API route to reject configs whose race day is in the past.
  // Tests pass this explicitly so 2099-dated fixtures stay valid.
  todayISO?: string;
}

export function validatePlannerConfig(
  config: PlannerConfig,
  opts: ValidatePlannerConfigOptions = {},
): PlannerValidationIssue[] {
  const issues: PlannerValidationIssue[] = [];

  if (!ISO_DATE_RE.test(config.startDate)) {
    issues.push({ field: "startDate", message: "must be a yyyy-mm-dd date" });
  } else if (!isMonday(config.startDate)) {
    issues.push({
      field: "startDate",
      message: "must be a Monday so the Mon..Sun week pattern lines up",
    });
  }

  if (!ISO_DATE_RE.test(config.marathonDate)) {
    issues.push({
      field: "marathonDate",
      message: "must be a yyyy-mm-dd date",
    });
  } else if (!isSunday(config.marathonDate)) {
    issues.push({
      field: "marathonDate",
      message: "must be a Sunday — marathons are run on the final Sun of the plan",
    });
  } else if (opts.todayISO && config.marathonDate < opts.todayISO) {
    issues.push({
      field: "marathonDate",
      message: `must be in the future (got ${config.marathonDate}, today is ${opts.todayISO})`,
    });
  }

  if (issues.length > 0) return issues;

  const totalWeeks = totalWeeksFromDates(config.startDate, config.marathonDate);
  // entries-mode is determined by presence of the entries array, not its
  // length. An empty array is invalid (the API route rejects it before we
  // reach here), but treat it defensively as entries-mode so the validator
  // surfaces a useful "must sum to totalWeeks" error instead of silently
  // re-validating as legacy blocks-mode.
  const isEntriesMode = Array.isArray(config.entries);

  if (isEntriesMode) {
    if (totalWeeks < 1) {
      issues.push({
        field: "marathonDate",
        message: "must be at least 1 week after startDate",
      });
      return issues;
    }
    // First pass: per-entry shape + template id + weeks-in-range.
    let entriesSum = 0;
    for (let i = 0; i < config.entries!.length; i++) {
      const e = config.entries![i]!;
      const tpl = getTemplateById(e.templateId);
      if (!tpl) {
        issues.push({
          field: `entries[${i}].templateId`,
          message: `unknown template id "${e.templateId}"`,
        });
      }
      if (!Number.isInteger(e.weeks) || e.weeks < 1) {
        issues.push({
          field: `entries[${i}].weeks`,
          message: "must be a positive integer",
        });
      } else {
        if (tpl && (e.weeks < tpl.minWeeks || e.weeks > tpl.maxWeeks)) {
          issues.push({
            field: `entries[${i}].weeks`,
            message: `weeks for ${tpl.name} must be between ${tpl.minWeeks} and ${tpl.maxWeeks} (got ${e.weeks})`,
          });
        }
        entriesSum += e.weeks;
      }
    }
    // Second pass: per-entry startDate must be a Monday on or after
    // the config startDate AND a whole number of weeks after it. Task
    // #135: entries are now allowed to OVERLAP with one another so a
    // runner can stack a Tonal lifting program concurrently with a 5K
    // running program. The campaign's logical span is the latest entry
    // end minus the earliest entry start, and the campaign must end on
    // marathonDate (Sunday).
    const startMs = Date.parse(`${config.startDate}T00:00:00Z`);
    let cursorMs = startMs; // sequential cursor (used only when no entries declare overrides)
    let earliestStartMs = Number.POSITIVE_INFINITY;
    let latestEndMs = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < config.entries!.length; i++) {
      const e = config.entries![i]!;
      let entryStartMs = cursorMs;
      const overrideRaw = e.startDate;
      if (overrideRaw != null && overrideRaw !== "") {
        if (!ISO_DATE_RE.test(overrideRaw)) {
          issues.push({
            field: `entries[${i}].startDate`,
            message: "must be a yyyy-mm-dd date",
          });
          continue;
        } else if (!isMonday(overrideRaw)) {
          issues.push({
            field: `entries[${i}].startDate`,
            message: "must be a Monday so the Mon..Sun week pattern lines up",
          });
          continue;
        }
        const eMs = Date.parse(`${overrideRaw}T00:00:00Z`);
        if (eMs < startMs) {
          issues.push({
            field: `entries[${i}].startDate`,
            message: `must be on or after the config startDate (${config.startDate})`,
          });
          continue;
        }
        const daysFromStart = Math.round((eMs - startMs) / 86400000);
        if (daysFromStart % 7 !== 0) {
          issues.push({
            field: `entries[${i}].startDate`,
            message: `must be a whole number of weeks after the config startDate (${config.startDate}); got ${daysFromStart} days`,
          });
          continue;
        }
        entryStartMs = eMs;
      }
      if (Number.isInteger(e.weeks) && e.weeks >= 1) {
        const entryEndMs = entryStartMs + e.weeks * 7 * 86400000;
        if (entryStartMs < earliestStartMs) earliestStartMs = entryStartMs;
        if (entryEndMs > latestEndMs) latestEndMs = entryEndMs;
        // Sequential cursor only advances when this entry didn't set
        // an explicit override — back-compat with non-overlapping
        // chains where each entry follows the previous.
        if (overrideRaw == null || overrideRaw === "") {
          cursorMs = entryEndMs;
        }
      }
    }
    if (Number.isFinite(earliestStartMs) && earliestStartMs !== startMs) {
      issues.push({
        field: "entries[0].startDate",
        message: `the earliest entry must start on the config startDate (${config.startDate})`,
      });
    }
    if (Number.isFinite(latestEndMs)) {
      const projectedSpanWeeks = Math.round(
        (latestEndMs - startMs) / (7 * 86400000),
      );
      if (projectedSpanWeeks !== totalWeeks) {
        issues.push({
          field: "entries",
          message: `template entries span ${projectedSpanWeeks} week(s) end-to-end, but need exactly ${totalWeeks} (config startDate → marathonDate). The latest entry must end on marathonDate.`,
        });
      }
    }
    return issues;
  }

  // Legacy blocks-only mode: auto-pinned 16-week Marathon-Specific tail.
  if (totalWeeks < MARATHON_TAIL_WEEKS) {
    issues.push({
      field: "marathonDate",
      message: `must be at least ${MARATHON_TAIL_WEEKS} weeks after startDate (the trailing Marathon-Specific block is auto-pinned at ${MARATHON_TAIL_WEEKS} weeks)`,
    });
    return issues;
  }

  const expected = totalWeeks - MARATHON_TAIL_WEEKS;
  let sum = 0;
  for (let i = 0; i < config.blocks.length; i++) {
    const b = config.blocks[i]!;
    if (!FOCUS_TYPES.includes(b.focusType)) {
      issues.push({
        field: `blocks[${i}].focusType`,
        message: `must be one of: ${FOCUS_TYPES.join(", ")}`,
      });
    }
    if (!Number.isInteger(b.weeks) || b.weeks < 1) {
      issues.push({
        field: `blocks[${i}].weeks`,
        message: "must be a positive integer",
      });
    } else {
      sum += b.weeks;
    }
    if (b.focusType === "Custom") {
      const name = b.customName?.trim();
      if (!name) {
        issues.push({
          field: `blocks[${i}].customName`,
          message: "Custom blocks require a name",
        });
      }
    }
  }
  if (sum !== expected) {
    issues.push({
      field: "blocks",
      message: `block weeks must sum to ${expected} (got ${sum}); the trailing ${MARATHON_TAIL_WEEKS}-week Marathon-Specific block is auto-pinned`,
    });
  }

  return issues;
}

// Expand the user blocks into the iteration list the generator walks. In
// LEGACY mode the auto-pinned 16-week Marathon-Specific tail is appended;
// in ENTRIES mode each entry's template is expanded in declared order
// and concatenated, with NO auto-tail (templates own their own taper /
// race week). Exported so tests and the UI's timeline preview agree on
// what the runner will end up with.
export function expandPlannerBlocks(config: PlannerConfig): PhaseBlock[] {
  if (Array.isArray(config.entries)) {
    // Honor per-entry startDate gaps when projecting entries → blocks
    // so the seeded plan_weeks/plan_days reflect the chosen filler
    // rest weeks. Falls back to back-to-back stacking if startDate is
    // malformed (the validator surfaces that error separately).
    return expandEntriesToBlocksWithGaps(config.entries, config.startDate);
  }
  return [
    ...config.blocks,
    {
      focusType: "Marathon-Specific",
      weeks: MARATHON_TAIL_WEEKS,
      customName: null,
      customNotes: null,
    },
  ];
}

// ---- Per-focus recipes ---------------------------------------------------

interface FocusRecipe {
  // Phase label written into plan_weeks.phase + plan_days.phase. Falls back
  // to focusType for non-Custom blocks so the existing /plan / dashboard
  // surfaces (which key on phase) keep working without per-focus mapping.
  phaseLabel(block: PhaseBlock): string;
  // Mileage progressions. weekInBlock starts at 1.
  // `isTrailingBlock` is true when this block is the last block in the
  // campaign — it's used by the Marathon-Specific recipe to decide
  // whether the final 3 weeks should run the blocks-mode tail-taper
  // short-circuits (true) or a clean monotonic ramp into peak mileage
  // because a Taper block follows in entries-mode (false). All other
  // recipes ignore it; TypeScript contravariance permits arrow
  // functions with fewer parameters to satisfy the wider signature.
  longRunMi(
    weekInBlock: number,
    blockWeeks: number,
    isCutback: boolean,
    isTrailingBlock: boolean,
  ): number;
  easyRunMi(weekInBlock: number, blockWeeks: number, isCutback: boolean): number;
  qualityRunMi(weekInBlock: number, blockWeeks: number, isCutback: boolean): number;
  // Pace targets (mm:ss / mi).
  easyPace: string;
  longPace: string;
  tempoPace: string;
  // Run-minute multipliers (min/mile). Used to convert distance to run_min.
  easyRunMinPerMi: number;
  qualityRunMinPerMi: number;
  longRunMinPerMi: number;
  // Strength + cardio block sizing.
  heavyStrengthLoad: number; // base, gets *0.75 on cutback
  heavyTonalMin: number; // base
  shortCardioMin: number; // base
  accessoryTonalMin: number; // base
  // Friday quality recipe.
  fridayKind: "AerobicBase" | "Tempo" | "Threshold" | "RacePace" | "Sharpener";
  // Mid-week (Wed) run kind. "Easy" (default) emits the canonical
  // conversational easy aerobic run paired with the Tonal accessory
  // block. "Steady" upgrades the same slot to a steady-state aerobic
  // ("Z3 effort") run on non-cutback weeks so the Run Target chip
  // surfaces the amber-400 Zone 3 swatch on a real prescribed day
  // rather than only being reachable from a unit-test fixture
  // (Task #172). Cutback weeks always stay easy regardless so the
  // deload still functions as recovery for the long run.
  wedKind?: "Easy" | "Steady";
  // Whether this focus uses cutback weeks (every 4th week).
  useCutbacks: boolean;
  // Long-run description copy.
  longRunVerb: string;
  // Optional weight-loss biased cardio: increase Tue/Thu/Sat cardio block.
  cardioBoostMin?: number;
  // Optional taper-style ramp: when true, every value scales down weekInBlock.
  isTaper?: boolean;
  // Optional recovery: Mon and Fri become rest, no quality work.
  isRecovery?: boolean;
}

function r1(n: number): number {
  return Math.round(n * 10) / 10;
}

const RECIPES: Record<FocusType, FocusRecipe> = {
  Base: {
    phaseLabel: () => "Base",
    longRunMi: (w, _bw, isCutback) => {
      // Start 4mi, +0.5/wk, cap 10, cutback 70%.
      const base = Math.min(10, 4 + (w - 1) * 0.5);
      return r1(isCutback ? base * 0.7 : base);
    },
    easyRunMi: (_w, _bw, isCutback) => r1(isCutback ? 2.0 : 3.0),
    qualityRunMi: (_w, _bw, isCutback) => r1(isCutback ? 2.0 : 3.0),
    easyPace: "13:30",
    longPace: "14:00",
    tempoPace: "12:30",
    easyRunMinPerMi: 13,
    qualityRunMinPerMi: 13,
    longRunMinPerMi: 14,
    heavyStrengthLoad: 60,
    heavyTonalMin: 45,
    shortCardioMin: 25,
    accessoryTonalMin: 25,
    fridayKind: "AerobicBase",
    useCutbacks: true,
    longRunVerb: "Long aerobic run",
  },
  "Time on Feet": {
    phaseLabel: () => "Time on Feet",
    longRunMi: (w, _bw, isCutback) => {
      const base = Math.min(14, 6 + (w - 1) * 0.75);
      return r1(isCutback ? base * 0.7 : base);
    },
    easyRunMi: (_w, _bw, isCutback) => r1(isCutback ? 2.5 : 3.5),
    qualityRunMi: (_w, _bw, isCutback) => r1(isCutback ? 2.5 : 3.5),
    easyPace: "13:30",
    longPace: "14:30",
    tempoPace: "12:30",
    easyRunMinPerMi: 14,
    qualityRunMinPerMi: 14,
    longRunMinPerMi: 15,
    heavyStrengthLoad: 50,
    heavyTonalMin: 35,
    shortCardioMin: 25,
    accessoryTonalMin: 25,
    fridayKind: "AerobicBase",
    useCutbacks: true,
    longRunVerb: "Time-on-feet long run",
  },
  "Cardio + Weight Loss": {
    phaseLabel: () => "Cardio + Weight Loss",
    longRunMi: (w, _bw, isCutback) => {
      const base = Math.min(8, 5 + (w - 1) * 0.25);
      return r1(isCutback ? base * 0.75 : base);
    },
    easyRunMi: (_w, _bw, isCutback) => r1(isCutback ? 2.0 : 2.5),
    qualityRunMi: (_w, _bw, isCutback) => r1(isCutback ? 2.0 : 2.5),
    easyPace: "13:30",
    longPace: "14:00",
    tempoPace: "12:30",
    easyRunMinPerMi: 13,
    qualityRunMinPerMi: 13,
    longRunMinPerMi: 14,
    heavyStrengthLoad: 35,
    heavyTonalMin: 25,
    shortCardioMin: 50,
    accessoryTonalMin: 20,
    fridayKind: "AerobicBase",
    useCutbacks: true,
    longRunVerb: "Calorie-burn long run",
    cardioBoostMin: 25,
  },
  Speed: {
    phaseLabel: () => "Speed",
    longRunMi: (w, _bw, isCutback) => {
      const base = Math.min(10, 6 + (w - 1) * 0.25);
      return r1(isCutback ? base * 0.7 : base);
    },
    easyRunMi: (_w, _bw, isCutback) => r1(isCutback ? 2.5 : 3.0),
    qualityRunMi: (w, _bw, isCutback) => r1(isCutback ? 2.5 : Math.min(5, 3.5 + (w - 1) * 0.1)),
    easyPace: "12:30",
    longPace: "13:00",
    tempoPace: "11:00",
    easyRunMinPerMi: 12,
    qualityRunMinPerMi: 11,
    longRunMinPerMi: 13,
    heavyStrengthLoad: 60,
    heavyTonalMin: 40,
    shortCardioMin: 25,
    accessoryTonalMin: 25,
    fridayKind: "Threshold",
    useCutbacks: true,
    longRunVerb: "Steady long run",
  },
  "Marathon-Specific": {
    phaseLabel: () => "Marathon-Specific",
    longRunMi: (w, blockWeeks, isCutback, isTrailingBlock) => {
      // Ramp 12 -> 20+ across the block, with cutbacks every 4th week.
      //
      // BLOCKS-MODE (isTrailingBlock = true): the auto-pinned 16-week
      // Marathon-Specific tail closes the campaign and owns the race-eve
      // taper itself, so the final 3 weeks short-circuit to a
      // 16/13/8 ramp-down and the block-final week to 13 (overridden to
      // 26.2 mi by the race-day branch in `buildWeekDays` /
      // `previewWeeklyMileage` — the value returned here is dead but
      // kept symmetric).
      //
      // ENTRIES-MODE (isTrailingBlock = false): the marathon templates
      // expand to Base → Time on Feet → Marathon-Specific → Taper, so
      // the MS block is followed by a dedicated Taper block that owns
      // ALL tapering. Running the blocks-mode tail short-circuits
      // there produces a confusing non-monotonic curve right before
      // the Taper kicks in (e.g. 16 → 13 → 8 → 20 across the last 4
      // MS weeks of an 18w plan). Skip the short-circuits and let the
      // monotonic ramp run all the way to peak so the Taper block
      // owns the actual ramp-down (Task #190, building on Task #185).
      if (isTrailingBlock) {
        const tail = blockWeeks - w; // 0 = block-final week, 1 = block-eve week, etc.
        if (tail === 0) return r1(13);
        if (tail === 1) return r1(8);
        if (tail === 2) return r1(13);
        if (tail === 3) return r1(16);
      }
      const peak = 20;
      const base = Math.min(peak, 12 + (w - 1) * ((peak - 12) / Math.max(1, blockWeeks - 4)));
      return r1(isCutback ? Math.max(8, base * 0.75) : base);
    },
    easyRunMi: (_w, _bw, isCutback) => r1(isCutback ? 3.0 : 4.0),
    qualityRunMi: (_w, _bw, isCutback) => r1(isCutback ? 3.0 : 4.5),
    easyPace: "12:30",
    longPace: "13:00",
    tempoPace: "11:30",
    easyRunMinPerMi: 12,
    qualityRunMinPerMi: 11,
    longRunMinPerMi: 12,
    heavyStrengthLoad: 50,
    heavyTonalMin: 35,
    shortCardioMin: 25,
    accessoryTonalMin: 25,
    fridayKind: "RacePace",
    wedKind: "Steady",
    useCutbacks: true,
    longRunVerb: "Marathon-pace long run",
  },
  Taper: {
    phaseLabel: () => "Taper",
    longRunMi: (w, blockWeeks, _isCutback) => {
      // Drop volume across the block. Final week is half of starting.
      const t = (w - 1) / Math.max(1, blockWeeks - 1); // 0..1
      return r1(10 - t * 6);
    },
    easyRunMi: (w, blockWeeks, _isCutback) => {
      const t = (w - 1) / Math.max(1, blockWeeks - 1);
      return r1(3.0 - t * 1.0);
    },
    qualityRunMi: (w, blockWeeks, _isCutback) => {
      const t = (w - 1) / Math.max(1, blockWeeks - 1);
      return r1(3.0 - t * 1.5);
    },
    easyPace: "12:30",
    longPace: "13:00",
    tempoPace: "11:30",
    easyRunMinPerMi: 12,
    qualityRunMinPerMi: 11,
    longRunMinPerMi: 13,
    heavyStrengthLoad: 35,
    heavyTonalMin: 25,
    shortCardioMin: 15,
    accessoryTonalMin: 20,
    fridayKind: "Sharpener",
    useCutbacks: false,
    longRunVerb: "Taper long run",
    isTaper: true,
  },
  Recovery: {
    phaseLabel: () => "Recovery",
    longRunMi: (_w, _bw, _isCutback) => r1(4),
    easyRunMi: (_w, _bw, _isCutback) => r1(2),
    qualityRunMi: (_w, _bw, _isCutback) => r1(2),
    easyPace: "14:00",
    longPace: "14:30",
    tempoPace: "13:30",
    easyRunMinPerMi: 14,
    qualityRunMinPerMi: 14,
    longRunMinPerMi: 15,
    heavyStrengthLoad: 25,
    heavyTonalMin: 20,
    shortCardioMin: 15,
    accessoryTonalMin: 15,
    fridayKind: "AerobicBase",
    useCutbacks: false,
    longRunVerb: "Easy recovery long run",
    isRecovery: true,
  },
  Custom: {
    phaseLabel: (b) => {
      // Task #163: when the block carries a `[hybrid-phase:...]` sentinel
      // (custom_hybrid expansion at 12+ weeks), prefer the mesocycle
      // label so the dashboard / /plan timeline always read "Hybrid
      // Base" / "Hybrid Build" / "Hybrid Taper" — even on block 0
      // whose customName has been overridden by the entry-level label
      // in `expandEntriesToBlocks`. The runner's entry-level label is
      // still preserved on the block (and surfaced in the per-day
      // customSuffix tag) — it just doesn't masquerade as the phase.
      const hp = hybridPhase(b.customNotes);
      if (hp === "base") return "Hybrid Base";
      if (hp === "build") return "Hybrid Build";
      if (hp === "taper") return "Hybrid Taper";
      return b.customName?.trim() ? b.customName.trim() : "Custom";
    },
    longRunMi: (w, _bw, isCutback) => {
      const base = Math.min(10, 4 + (w - 1) * 0.5);
      return r1(isCutback ? base * 0.7 : base);
    },
    easyRunMi: (_w, _bw, isCutback) => r1(isCutback ? 2.0 : 3.0),
    qualityRunMi: (_w, _bw, isCutback) => r1(isCutback ? 2.0 : 3.0),
    easyPace: "13:30",
    longPace: "14:00",
    tempoPace: "12:30",
    easyRunMinPerMi: 13,
    qualityRunMinPerMi: 13,
    longRunMinPerMi: 14,
    heavyStrengthLoad: 60,
    heavyTonalMin: 45,
    shortCardioMin: 25,
    accessoryTonalMin: 25,
    fridayKind: "AerobicBase",
    useCutbacks: true,
    longRunVerb: "Long run",
  },
};

// Per-week pace override threaded into buildWeekDays / fridayContent /
// buildHybridWeekDays. walkRun=true swaps easy / Foundation-Fri / long
// run descriptions for a Peloton Tread walk-run interval prescription.
export interface PaceOverride {
  easyPace: string;
  longPace: string;
  tempoPace: string;
  walkRun: boolean;
  startingPaceSec: number;
  campaignWeek: number;
}

function buildPaceOverride(
  startingPaceSec: number,
  campaignWeek: number,
  entryLocalWeek: number,
  recipe: FocusRecipe,
): PaceOverride {
  const easyFloor = parseMmSsPace(recipe.easyPace) ?? 0;
  const longFloor = parseMmSsPace(recipe.longPace) ?? 0;
  const tempoFloor = parseMmSsPace(recipe.tempoPace) ?? 0;
  const eff = computeEffectivePace(
    startingPaceSec,
    campaignWeek,
    easyFloor,
    longFloor,
    tempoFloor,
  );
  const entryStartCampaignWeek = Math.max(1, campaignWeek - entryLocalWeek + 1);
  const entryStartEff = computeEffectivePace(
    startingPaceSec,
    entryStartCampaignWeek,
    easyFloor,
    longFloor,
    tempoFloor,
  );
  return {
    easyPace: formatMmSsPace(eff.easySec),
    longPace: formatMmSsPace(eff.longSec),
    tempoPace: formatMmSsPace(eff.tempoSec),
    walkRun:
      entryStartEff.easySec > WALK_RUN_PACE_THRESHOLD_SEC &&
      entryLocalWeek <= WALK_RUN_MAX_ENTRY_LOCAL_WEEK,
    startingPaceSec,
    campaignWeek,
  };
}

function fridayContent(
  recipe: FocusRecipe,
  block: PhaseBlock,
  weekInBlock: number,
  isCutback: boolean,
  qualityDist: number,
  paceOverride: PaceOverride | null,
  qualityRunMin: number,
): {
  type: string;
  desc: string;
  pace: string;
  liftMin: number;
  liftLoad: number;
  liftDescSuffix: string;
} {
  const easyPace = paceOverride?.easyPace ?? recipe.easyPace;
  const tempoPace = paceOverride?.tempoPace ?? recipe.tempoPace;
  const walkRunDesc =
    paceOverride?.walkRun ? walkRunDescription(qualityRunMin) : null;
  const accessory = isCutback
    ? Math.max(15, recipe.accessoryTonalMin - 5)
    : recipe.accessoryTonalMin;
  if (isCutback) {
    return {
      type: "Aerobic Base",
      desc:
        walkRunDesc ??
        `Easy recovery Tread run (${qualityDist} mi, conversational)`,
      pace: easyPace,
      liftMin: 0,
      liftLoad: 0,
      liftDescSuffix: " — no lift today, recover for the long run",
    };
  }
  switch (recipe.fridayKind) {
    case "Tempo":
      return {
        type: "Tempo Run",
        desc: `Tread tempo (${qualityDist} mi: 5 min easy, ${Math.max(10, Math.round(qualityDist * 4))} min steady tempo, 5 min cool-down)`,
        pace: tempoPace,
        liftMin: 0,
        liftLoad: 0,
        liftDescSuffix: " — no lift today, recover for the long run",
      };
    case "Threshold":
      return {
        type: "Threshold Intervals",
        desc: `Tread threshold (${qualityDist} mi: warm-up, then 4 x 800m at threshold w/ 90s jog recovery, cool-down)`,
        pace: tempoPace,
        liftMin: 0,
        liftLoad: 0,
        liftDescSuffix: " — no lift today, recover for the long run",
      };
    case "RacePace":
      return {
        type: "Race-Pace Workout",
        desc: `Tread marathon-pace (${qualityDist} mi: warm-up, ${Math.max(2, Math.round(qualityDist - 1.5))} mi at goal marathon pace, cool-down)`,
        pace: tempoPace,
        liftMin: 0,
        liftLoad: 0,
        liftDescSuffix: " — no lift today, recover for the long run",
      };
    case "Sharpener":
      return {
        type: "Sharpener",
        desc:
          walkRunDesc ??
          `Easy Tread run (${qualityDist} mi) with 4 x 30s strides in the final mile`,
        pace: easyPace,
        liftMin: 0,
        liftLoad: 0,
        liftDescSuffix: " — no lift today",
      };
    case "AerobicBase":
    default:
      return {
        type: "Aerobic Base",
        desc:
          walkRunDesc ??
          `Easy aerobic Tread run (${qualityDist} mi), build durability`,
        pace: easyPace,
        liftMin: accessory,
        liftLoad: 22,
        liftDescSuffix: ` + ${accessory} min Tonal core + mobility`,
      };
  }
}

// Build a lift-primary (Tonal-only) week: Mon/Wed/Fri/Sat are heavy
// Tonal lift sessions; Tue/Thu/Sun are full rest days. Used by the
// non-running templates (tonal_strength_upper / lower, push_pull_legs,
// tonal_conditioning) which the daily-recipes pipeline routes here via
// the `[lift-primary:<kind>]` customNotes sentinel.
function buildLiftPrimaryWeekDays(opts: {
  weekNumber: number;
  weekInBlock: number;
  liftKind: string;
  phase: string;
  isCutback: boolean;
  heavyStrengthLoad: number;
  heavyTonalMin: number;
  accessoryTonalMin: number;
  wkStart: Date;
  customSuffix: string;
}): DailyRow[] {
  const {
    weekNumber,
    weekInBlock,
    liftKind,
    phase,
    isCutback,
    heavyStrengthLoad,
    heavyTonalMin,
    accessoryTonalMin,
    wkStart,
    customSuffix,
  } = opts;

  // Per-kind labels for the four lift days (Mon, Wed, Fri, Sat). Each
  // kind has a 4-day rotation; conditioning days append a finisher
  // descriptor in place of separate cardio.
  const rotations: Record<string, [string, string, string, string]> = {
    upper: [
      "Heavy push (bench, overhead press, triceps)",
      "Heavy pull (row, pull-ups, biceps, rear-delt)",
      "Push accessory (incline press, lateral raise, dips)",
      "Pull accessory (chin-ups, face-pulls, curls) + core",
    ],
    lower: [
      "Heavy squat (back squat, split squat, quad accessory)",
      "Heavy hinge (deadlift, RDL, hamstring accessory)",
      "Lunge / unilateral (Bulgarian split squat, step-up)",
      "Posterior chain (good morning, hip thrust, calf) + core",
    ],
    ppl: [
      "Push day (bench, overhead press, triceps, lateral raise)",
      "Pull day (row, pull-ups, biceps, rear-delt)",
      "Legs day (squat, RDL, lunge, calf)",
      "Push day v2 (incline press, dips, push accessory) + core",
    ],
    conditioning: [
      "Heavy full-body (squat + bench) + 8-min Tonal finisher",
      "Heavy full-body (deadlift + row) + 8-min Tonal finisher",
      "Heavy full-body (front squat + overhead press) + 10-min finisher",
      "Heavy full-body (RDL + pull-up) + 10-min EMOM finisher + core",
    ],
  };
  const labels =
    rotations[liftKind] ??
    ([
      "Heavy full-body Tonal session",
      "Heavy full-body Tonal session",
      "Heavy full-body Tonal session",
      "Heavy full-body Tonal session",
    ] as [string, string, string, string]);

  const accessoryLoad = isCutback ? Math.round(heavyStrengthLoad * 0.55) : Math.round(heavyStrengthLoad * 0.7);
  const accessoryMin = Math.max(20, accessoryTonalMin + 5);

  function rest(dayOffset: number, day: string, copy: string): DailyRow {
    return {
      week: weekNumber,
      phase,
      date: fmt(addDays(wkStart, dayOffset)),
      day,
      strength_load: 0,
      equipment: "Off / Rest",
      equipment_list: ["Off / Rest"],
      description: copy + customSuffix,
      strength_min: 0,
      cardio_min: 0,
      run_min: 0,
      distance_mi: null,
      pace: null,
      session_type: "Rest",
      is_rest: true,
      total_load: 0,
    };
  }
  function lift(
    dayOffset: number,
    day: string,
    label: string,
    isAccessory: boolean,
  ): DailyRow {
    const load = isAccessory ? accessoryLoad : heavyStrengthLoad;
    const min = isAccessory ? accessoryMin : heavyTonalMin;
    const intensity = isCutback
      ? "deload week — keep effort to ~70%"
      : isAccessory
        ? "moderate effort, focus on quality reps"
        : "80-85% effort, leave 1-2 reps in reserve";
    return {
      week: weekNumber,
      phase,
      date: fmt(addDays(wkStart, dayOffset)),
      day,
      strength_load: load,
      equipment: "Tonal",
      equipment_list: ["Tonal"],
      description: `${label} on Tonal (${min} min, ${intensity})` + customSuffix,
      strength_min: min,
      cardio_min: 0,
      run_min: 0,
      distance_mi: null,
      pace: null,
      session_type: "Strength",
      is_rest: false,
      total_load: load,
    };
  }

  // Light cutback wave on every 4th week-in-block: trims the Saturday
  // accessory session so the runner gets a true deload day after three
  // full lift weeks.
  return [
    lift(0, "Mon", labels[0], false),
    rest(1, "Tue", `Rest day. Mobility, foam roll, hydrate. Lift block week ${weekInBlock}.`),
    lift(2, "Wed", labels[1], false),
    rest(3, "Thu", `Rest day. Optional 20-30 min easy walk, mobility, hydrate.`),
    lift(4, "Fri", labels[2], false),
    lift(5, "Sat", labels[3], true),
    rest(6, "Sun", `Rest day. Full recovery — sleep, hydrate, gentle mobility flow.`),
  ];
}

// ---------------------------------------------------------------------------
// CUSTOM HYBRID WEEK BUILDER (Task #136). Routes Custom blocks carrying
// `[hybrid-mix:<position>]` sentinels through a slot-based scheduler
// that distributes lifts and runs across Mon..Sun based on the slider
// position (Lift-Primary → Run-Primary), days/week, and fitness level.
// Out of scope for v1: nutrition annotations, AI variation, multi-
// mesocycle periodization. Preserves the standard DailyRow shape so
// pacing-mode preference and slim card UI come for free.
// ---------------------------------------------------------------------------

type HybridLiftFocus =
  | "upper"
  | "lower"
  | "full"
  | "push"
  | "pull"
  | "legs";

type HybridSlot =
  | { kind: "rest" }
  | {
      kind: "lift";
      // Movement focus stamped into the per-day description.
      focus: HybridLiftFocus;
      // Heavy = primary lift day at 80-85% effort; non-heavy = accessory
      // / maintenance lift at moderate effort with smaller load + min.
      heavy: boolean;
    }
  | {
      kind: "run";
      intensity: "easy" | "quality" | "long";
    };

const HYBRID_DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

// Canonical 7-day schedules per slider stop. Day 0 = Mon, day 6 = Sun.
// Each schedule is tuned so the canonical session count lands close to
// the runner's typical days/week (5-6); pickHybridSchedule trims or
// pads to the runner's exact pick. The Sun slot is reserved for the
// long run on positions that have one (balanced / run_leaning /
// run_primary) so the long run is never accidentally trimmed.
const HYBRID_BASE_SCHEDULES: Record<HybridMixPosition, HybridSlot[]> = {
  lift_primary: [
    { kind: "lift", focus: "upper", heavy: true },     // Mon
    { kind: "rest" },                                   // Tue
    { kind: "lift", focus: "lower", heavy: true },     // Wed
    { kind: "run", intensity: "easy" },                 // Thu
    { kind: "lift", focus: "push", heavy: true },      // Fri
    { kind: "lift", focus: "pull", heavy: false },     // Sat (accessory)
    { kind: "rest" },                                   // Sun
  ],
  lift_leaning: [
    { kind: "lift", focus: "upper", heavy: true },     // Mon
    { kind: "run", intensity: "easy" },                 // Tue
    { kind: "rest" },                                   // Wed
    { kind: "lift", focus: "lower", heavy: true },     // Thu
    { kind: "lift", focus: "full", heavy: true },      // Fri
    { kind: "run", intensity: "quality" },              // Sat
    { kind: "rest" },                                   // Sun
  ],
  balanced: [
    { kind: "rest" },                                   // Mon
    { kind: "lift", focus: "upper", heavy: true },     // Tue
    { kind: "run", intensity: "easy" },                 // Wed
    { kind: "lift", focus: "lower", heavy: true },     // Thu
    { kind: "run", intensity: "quality" },              // Fri
    { kind: "lift", focus: "full", heavy: true },      // Sat
    { kind: "run", intensity: "long" },                 // Sun
  ],
  run_leaning: [
    { kind: "rest" },                                   // Mon
    { kind: "lift", focus: "upper", heavy: true },     // Tue
    { kind: "run", intensity: "easy" },                 // Wed
    { kind: "run", intensity: "quality" },              // Thu
    { kind: "lift", focus: "lower", heavy: true },     // Fri
    { kind: "run", intensity: "easy" },                 // Sat
    { kind: "run", intensity: "long" },                 // Sun
  ],
  run_primary: [
    { kind: "lift", focus: "upper", heavy: false },    // Mon (maintenance)
    { kind: "run", intensity: "quality" },              // Tue
    { kind: "run", intensity: "easy" },                 // Wed
    { kind: "rest" },                                   // Thu
    { kind: "lift", focus: "lower", heavy: false },    // Fri (maintenance)
    { kind: "run", intensity: "easy" },                 // Sat
    { kind: "run", intensity: "long" },                 // Sun
  ],
};

// Drop-priority order used to trim sessions when the runner picks
// fewer days/week than the canonical schedule. Iterates the day
// indices LEAST important to most important: Sat, Thu, Tue, Wed,
// Mon, Fri, Sun. The long run (Sun for balanced/run_leaning/run_primary)
// is explicitly preserved in code below.
const HYBRID_DROP_PRIORITY = [5, 3, 1, 2, 0, 4, 6] as const;

// Add-priority order used to fill in extra easy runs when the runner
// picks more days/week than the canonical schedule. Prefers spreading
// into Mon → Wed → Sun so the runner gets recovery between sessions.
const HYBRID_ADD_PRIORITY = [0, 2, 6, 3, 1, 4, 5] as const;

function pickHybridSchedule(
  position: HybridMixPosition,
  daysPerWeek: number,
): HybridSlot[] {
  const base = HYBRID_BASE_SCHEDULES[position].map((s) => ({ ...s })) as HybridSlot[];
  const target = Math.min(
    7,
    Math.max(3, Number.isFinite(daysPerWeek) ? Math.floor(daysPerWeek) : 5),
  );
  const currentSessions = base.filter((s) => s.kind !== "rest").length;

  if (currentSessions === target) return base;

  if (currentSessions > target) {
    // Trim: drop sessions in priority order, but always keep the long
    // run on positions that have one so the aerobic peak is preserved.
    const keepLong =
      position === "balanced" ||
      position === "run_leaning" ||
      position === "run_primary";
    let drop = currentSessions - target;
    for (const i of HYBRID_DROP_PRIORITY) {
      if (drop <= 0) break;
      const slot = base[i]!;
      if (slot.kind === "rest") continue;
      if (slot.kind === "run" && slot.intensity === "long" && keepLong) continue;
      base[i] = { kind: "rest" };
      drop -= 1;
    }
    return base;
  }

  // Pad: convert rest days to easy runs in add-priority order. Caps at
  // 7 days/week (every day has a session).
  let add = target - currentSessions;
  for (const i of HYBRID_ADD_PRIORITY) {
    if (add <= 0) break;
    if (base[i]!.kind !== "rest") continue;
    base[i] = { kind: "run", intensity: "easy" };
    add -= 1;
  }
  return base;
}

function levelScalar(level: HybridFitnessLevel): number {
  if (level === "beginner") return 0.85;
  if (level === "advanced") return 1.15;
  return 1.0;
}

interface HybridMileage {
  easy: number;
  quality: number;
  long: number;
}

// Mileage progression per slider position. Returns the three planned
// run distances for a given week-in-block. Ramps from week 1 to the
// last week of the block; cutback weeks shave 30%. Lift-primary keeps
// runs short and aerobic (cap ~3mi); run-primary peaks ~12 mi.
function hybridMileage(
  position: HybridMixPosition,
  level: HybridFitnessLevel,
  weekInBlock: number,
  blockWeeks: number,
  isCutback: boolean,
  phase: HybridPhase | null = null,
): HybridMileage {
  const t = blockWeeks > 1 ? (weekInBlock - 1) / (blockWeeks - 1) : 0;
  const cutFactor = isCutback ? 0.7 : 1.0;
  const lvl = levelScalar(level);

  const peakEasy: Record<HybridMixPosition, number> = {
    lift_primary: 2.5,
    lift_leaning: 3.0,
    balanced: 3.5,
    run_leaning: 4.0,
    run_primary: 5.0,
  };
  const peakQuality: Record<HybridMixPosition, number> = {
    lift_primary: 2.0,
    lift_leaning: 3.0,
    balanced: 3.5,
    run_leaning: 4.0,
    run_primary: 5.0,
  };
  const peakLong: Record<HybridMixPosition, number> = {
    lift_primary: 3.0,
    lift_leaning: 5.0,
    balanced: 8.0,
    run_leaning: 10.0,
    run_primary: 12.0,
  };

  // Phase-aware ramp window (Task #154). When `phase` is null the
  // block ramps from `start` to peak across the whole block — that's
  // the v1 single-block behavior preserved for back-compat with saved
  // hybrid campaigns and short (<12w) custom_hybrid plans. When the
  // template's expand() emits phased blocks the ramp window narrows:
  //
  //   - base:  start .. 0.6 * peak     (build aerobic, stay below peak)
  //   - build: 0.6 * peak .. peak      (continue from where base ended)
  //   - taper: peak .. 0.5 * peak      (descending into race week)
  //
  // For lift-leaning positions where peak is already very low (e.g.
  // lift_primary long peak = 3.0 mi vs start 3.0 mi) we clamp so the
  // ramp never inverts (ascending in base, descending in taper).
  function rampWindow(start: number, peak: number): { lo: number; hi: number } {
    if (phase === "base") {
      const hi = Math.max(start, 0.6 * peak);
      return { lo: Math.min(start, hi), hi };
    }
    if (phase === "build") {
      const lo = Math.max(start, 0.6 * peak);
      return { lo, hi: Math.max(lo, peak) };
    }
    if (phase === "taper") {
      const hi = peak;
      const lo = Math.min(hi, Math.max(start * 0.5, 0.5 * peak));
      return { lo: hi, hi: lo };
    }
    return { lo: Math.min(start, peak), hi: Math.max(start, peak) };
  }

  const ramp = (start: number, peak: number) => {
    const { lo, hi } = rampWindow(start, peak);
    return r1((lo + t * (hi - lo)) * lvl * cutFactor);
  };

  return {
    easy: ramp(1.5, peakEasy[position]),
    quality: ramp(1.5, peakQuality[position]),
    long: ramp(3.0, peakLong[position]),
  };
}

// Counts how many easy / quality / long run sessions live in a
// hybrid weekly schedule. Used by `previewWeeklyMileage` to scale the
// per-week-per-intensity mileage by the slot count so the Phase
// Planner curve matches what the generator emits when the runner
// trims days/week (e.g. lift_primary at 4 days/week has only one
// short easy run, not two).
function countHybridRunsInSchedule(schedule: HybridSlot[]): {
  easy: number;
  quality: number;
  long: number;
} {
  let easy = 0;
  let quality = 0;
  let long = 0;
  for (const slot of schedule) {
    if (slot.kind !== "run") continue;
    if (slot.intensity === "easy") easy += 1;
    else if (slot.intensity === "quality") quality += 1;
    else if (slot.intensity === "long") long += 1;
  }
  return { easy, quality, long };
}

// One row of the structured weekly preview surfaced in the planner UI.
// Mirrors what `buildHybridWeekDays` emits at the slot level — a
// short label per day plus optional miles for run slots — so the
// builder card can show the runner exactly what they'll get without
// generating + applying a full draft. Beyond the slider blurb (which
// is qualitative), this gives a concrete "Mon: Rest, Tue: Upper Lift,
// Wed: Easy Run 3.0 mi…" rundown that updates live as inputs change.
//
// Race-week (Task #203): when `previewHybridWeek` is called with
// `isRaceWeek: true` (and the plan is marathon-classified), the
// trailing Saturday becomes a `race-prep` slot and Sunday becomes a
// `race` slot — mirroring what `buildHybridWeekDays` actually emits
// for the campaign-final week of a hybrid marathon plan (Task #192).
export type HybridPreviewSlot =
  | { day: string; kind: "rest"; label: string }
  | {
      day: string;
      kind: "lift";
      label: string;
      focus: HybridLiftFocus;
      heavy: boolean;
    }
  | {
      day: string;
      kind: "run";
      label: string;
      intensity: "easy" | "quality" | "long";
      miles: number;
    }
  | { day: string; kind: "race-prep"; label: string }
  | { day: string; kind: "race"; label: string; miles: number };

export interface HybridPreviewWeek {
  position: HybridMixPosition;
  daysPerWeek: number;
  level: HybridFitnessLevel;
  weekInBlock: number;
  blockWeeks: number;
  // Race-week branch flag (Task #203). True iff the preview was
  // generated with `isRaceWeek: true` AND a non-"none" raceKind, in
  // which case the trailing Sat/Sun slots are the race-prep / race
  // overrides instead of the schedule's normal slots.
  isRaceWeek: boolean;
  slots: HybridPreviewSlot[];
  // Aggregated totals so the UI can show a "5 sessions · 2 lifts · 3
  // runs · 11 mi" summary without re-walking the slots. Race-week
  // previews include the race-day mileage (e.g. 26.2 mi for a
  // marathon) in `miles` and count the race day as one of `runs`,
  // so the totals line stays meaningful for the campaign-final week.
  totals: {
    sessions: number;
    lifts: number;
    runs: number;
    miles: number;
  };
}

// Pure read-only preview of a single hybrid week. Defaults to week 1
// of an 8-week block so the UI can call it without context. Reuses
// `pickHybridSchedule` and `hybridMileage` so the preview can never
// drift from what the generator actually emits at runtime.
export function previewHybridWeek(
  spec: HybridMixSpec,
  opts?: {
    weekInBlock?: number;
    blockWeeks?: number;
    // Optional phase tag (Task #154). When provided, the preview's
    // mileage scales to the phase's ramp window — base finishes at
    // 60% of peak, build covers 60% → peak, taper descends from
    // peak to 50%. Defaults to null = the v1 single-block ramp,
    // which is what the planner UI uses for its "typical week"
    // preview because it doesn't carry a phase indicator.
    phase?: HybridPhase | null;
    // Race-week opt (Task #203). When true and `raceKind !== "none"`,
    // the trailing Saturday is force-overridden to a `race-prep` slot
    // (15-min mobility + 15-min easy spin) and the trailing Sunday is
    // force-overridden to a `race` slot at the matching distance —
    // mirroring `buildHybridWeekDays`'s race-week branch (Task #192).
    // Mon-Fri keep the schedule's normal lift/run/rest layout (the
    // trailing taper is owned by `phase`, not by this flag). When
    // false (default) or when `raceKind === "none"`, the preview
    // emits the canonical typical-week shape unchanged.
    isRaceWeek?: boolean;
    // Race-day kind (Task #203). Defaults to "marathon" so the planner
    // builder card can flip on the race-week preview without juggling
    // a separate raceKind input. When set to "none", `isRaceWeek` is
    // ignored — mirrors `buildHybridWeekDays`'s race-week guard.
    raceKind?: PlanRaceKind;
  },
): HybridPreviewWeek {
  const blockWeeks = Math.max(1, Math.floor(opts?.blockWeeks ?? 8));
  const raceKind: PlanRaceKind = opts?.raceKind ?? "marathon";
  const isRaceWeek = (opts?.isRaceWeek ?? false) && raceKind !== "none";
  // Race-week defaults to the trailing week of the block so the runner
  // sees the actual campaign-final week shape (taper + race-day Sun).
  // For non-race weeks the v1 default is week 1 of the block.
  const defaultWeek = isRaceWeek ? blockWeeks : 1;
  const weekInBlock = Math.max(
    1,
    Math.min(blockWeeks, Math.floor(opts?.weekInBlock ?? defaultWeek)),
  );
  const schedule = pickHybridSchedule(spec.position, spec.daysPerWeek);
  // Cutbacks land every 4th week (matches buildHybridWeekDays).
  const isCutback = weekInBlock > 0 && weekInBlock % 4 === 0;
  const mi = hybridMileage(
    spec.position,
    spec.level,
    weekInBlock,
    blockWeeks,
    isCutback,
    opts?.phase ?? null,
  );
  let lifts = 0;
  let runs = 0;
  let miles = 0;
  const slots: HybridPreviewSlot[] = schedule.map((slot, idx) => {
    const day = HYBRID_DAY_LABELS[idx]!;
    // ---------- RACE WEEK OVERRIDES (Task #203) ----------
    // Force trailing Sat → race-prep and trailing Sun → race day.
    // Mirrors `buildHybridWeekDays`'s race-week branch so the preview
    // can never drift from what the runtime generator emits for the
    // campaign-final week of a hybrid marathon plan (Task #192).
    if (isRaceWeek && idx === 5) {
      return { day, kind: "race-prep", label: "Race Prep" };
    }
    if (isRaceWeek && idx === 6) {
      const raceSpec = RACE_DAY_SPECS[raceKind];
      runs += 1;
      miles += raceSpec.distanceMi;
      return {
        day,
        kind: "race",
        miles: raceSpec.distanceMi,
        label: `RACE DAY ${raceSpec.distanceMi.toFixed(1)} mi`,
      };
    }
    if (slot.kind === "rest") {
      return { day, kind: "rest", label: "Rest" };
    }
    if (slot.kind === "lift") {
      lifts += 1;
      const focusCopy = HYBRID_LIFT_LABELS[slot.focus] ?? slot.focus;
      const headline = focusCopy.split(" Tonal")[0] ?? focusCopy;
      return {
        day,
        kind: "lift",
        focus: slot.focus,
        heavy: slot.heavy,
        label: `${headline}${slot.heavy ? "" : " (acc.)"}`,
      };
    }
    runs += 1;
    const m =
      slot.intensity === "easy"
        ? mi.easy
        : slot.intensity === "quality"
          ? mi.quality
          : mi.long;
    miles += m;
    const label =
      slot.intensity === "easy"
        ? `Easy Run ${m.toFixed(1)} mi`
        : slot.intensity === "quality"
          ? `Tempo Run ${m.toFixed(1)} mi`
          : `Long Run ${m.toFixed(1)} mi`;
    return { day, kind: "run", intensity: slot.intensity, miles: m, label };
  });
  return {
    position: spec.position,
    daysPerWeek: spec.daysPerWeek,
    level: spec.level,
    weekInBlock,
    blockWeeks,
    isRaceWeek,
    slots,
    totals: {
      sessions: lifts + runs,
      lifts,
      runs,
      miles: Math.round(miles * 10) / 10,
    },
  };
}

// Per-focus lift copy for description prose. Hybrid lift days pair the
// slot's focus tag with a short Tonal session description.
const HYBRID_LIFT_LABELS: Record<HybridLiftFocus, string> = {
  upper: "Upper-body Tonal (push, pull, core)",
  lower: "Lower-body Tonal (squat, hinge, lunge)",
  full: "Full-body Tonal (compound lifts, mixed plane)",
  push: "Push-focused Tonal (bench, overhead press, triceps)",
  pull: "Pull-focused Tonal (row, pull-ups, biceps)",
  legs: "Legs-focused Tonal (squat, RDL, lunge, calf)",
};

function buildHybridWeekDays(opts: {
  weekNumber: number;
  weekInBlock: number;
  blockWeeks: number;
  spec: HybridMixSpec;
  phase: string;
  isCutback: boolean;
  wkStart: Date;
  customSuffix: string;
  // Mesocycle phase (Task #154). When set, lift load + minutes scale
  // by phase (base 0.85x, build 1.0x, taper 0.7x) and the mileage
  // ramp narrows to the phase's window. Null = legacy single-block
  // hybrid (full load, full ramp) — preserves v1 behavior for short
  // (<12w) custom_hybrid plans and saved hybrid campaigns.
  hybridPhase: HybridPhase | null;
  paceOverride?: PaceOverride | null;
  // Campaign-final race week (Task #192 / #200). When true, the
  // trailing Saturday of this hybrid week is force-overridden to a
  // "Race Prep" shake-out (15 min Tonal mobility + 15 min easy
  // Bike/Row spin) and the trailing Sunday is force-overridden to a
  // RACE DAY at the matching `raceKind` distance (26.2 / 13.1 / 6.2
  // / 3.1 mi), regardless of what the canonical schedule slots for
  // those days. Mon-Fri are left to the schedule's normal lift/run/
  // rest layout — the trailing taper is still owned by the hybrid
  // phase scalar (base 0.85x / build 1.0x / taper 0.7x), this only
  // flips the last two days so a hybrid race plan ends on a real
  // race-day Sunday at the correct distance.
  isRaceWeek: boolean;
  // Race-day kind for the campaign-final week (Task #200). Drives
  // which `RACE_DAY_SPECS` entry the trailing Sunday pulls
  // distance / description / load from when `isRaceWeek` is true. A
  // hybrid marathon plan (`marathon_hybrid` — raceKind="marathon")
  // ends on a 26.2 mi marathon Sunday; a hybrid 10K plan
  // (`10k_hybrid_balanced` — classified "10k" via goalDistance) ends
  // on a 6.2 mi 10K; a hybrid 5K plan (`5k_hybrid_balanced` — "5k")
  // ends on a 3.1 mi 5K. Defaults to "marathon" so legacy callers
  // (and the existing #192 test) keep emitting the 26.2 mi Sunday.
  // When `isRaceWeek` is false the value is ignored. When
  // `isRaceWeek` is true and `raceKind` is "none" the override is
  // skipped — but `generatePlanFromConfig` already gates `isRaceWeek`
  // on `raceKind !== "none"` so this guard exists only for
  // defensive symmetry.
  raceKind?: PlanRaceKind;
}): DailyRow[] {
  const {
    weekNumber,
    weekInBlock,
    blockWeeks,
    spec,
    phase,
    isCutback,
    wkStart,
    customSuffix,
    hybridPhase: hPhase,
    isRaceWeek,
  } = opts;
  const raceKind: PlanRaceKind = opts.raceKind ?? "marathon";

  const schedule = pickHybridSchedule(spec.position, spec.daysPerWeek);
  const lvl = levelScalar(spec.level);
  const cutFactor = isCutback ? 0.8 : 1.0;
  // Per-phase lift-load scalar — base eases the runner into the work,
  // build runs at full intensity, taper deloads into the event. Null
  // phase keeps the v1 single-block load (multiplier 1.0).
  const phaseLoadScalar =
    hPhase === "base" ? 0.85 : hPhase === "taper" ? 0.7 : 1.0;

  // Lift sizing — heavy vs accessory. Loads / mins scale with fitness
  // level, ease off on cutback weeks, and apply the phase scalar so
  // base/build/taper progress meaningfully across the hybrid span.
  const heavyLoad = Math.round(60 * lvl * cutFactor * phaseLoadScalar);
  const heavyMin = Math.round(45 * lvl * cutFactor * phaseLoadScalar);
  const accessoryLoad = Math.round(40 * lvl * cutFactor * phaseLoadScalar);
  const accessoryMin = Math.round(30 * lvl * cutFactor * phaseLoadScalar);

  // Run sizing — distance per intensity, plus a default min/mile pace.
  // Pacing-mode preference is a downstream display concern (the
  // dashboard maps `pace` + the runner's preference to the surfaced
  // value); we emit the canonical mm:ss/mi numbers here.
  const mi = hybridMileage(
    spec.position,
    spec.level,
    weekInBlock,
    blockWeeks,
    isCutback,
    hPhase,
  );
  const easyPace = opts.paceOverride?.easyPace ?? "13:00";
  const qualityPace = opts.paceOverride?.tempoPace ?? "11:30";
  const longPace = opts.paceOverride?.longPace ?? "13:30";
  const walkRun = opts.paceOverride?.walkRun ?? false;
  const easyMinPerMi = 13;
  const qualityMinPerMi = 11;
  const longMinPerMi = 14;

  return schedule.map((slot, dayOffset) => {
    const day = HYBRID_DAY_LABELS[dayOffset]!;
    const date = fmt(addDays(wkStart, dayOffset));

    // ---------- RACE WEEK OVERRIDES (Task #192 / #198 / #200) ----------
    // Force the campaign-final week's days into the canonical
    // race-eve / race-day pattern regardless of what the schedule
    // would have emitted (lift, run, or rest).
    //
    // - Mon-Fri overrides (Task #198) are MARATHON-ONLY: pre-#198,
    //   the hybrid race week left Mon-Fri to the schedule's normal
    //   lift/run/rest layout scaled by the hybrid phase scalar
    //   (taper = 0.7x). That still left a typical hybrid marathon
    //   race week with two heavy lift days plus full-distance
    //   Wed/Fri runs — noticeably heavier than the Pfitz/Higdon
    //   marathon race week. Task #198 overrides Mon-Fri to a fixed
    //   light taper that mirrors non-hybrid marathon plans:
    //     Mon: full rest
    //     Tue: light Tonal mobility (25 min, load 25) + 15 min easy
    //          Bike spin — keep joints loose without fatiguing legs
    //     Wed: short easy aerobic run (3 mi) — no accessory work
    //     Thu: full rest (drop the heavy lift entirely)
    //     Fri: short tune-up Tread run (2 mi at quality pace + 4 x
    //          30s strides) — wake the legs up
    //   Gated on `raceKind === "marathon"` so the 5K / 10K hybrid
    //   race weeks added by Task #200 keep their existing shape
    //   (those races have their own short-distance taper logic in
    //   their schedules and don't need the marathon-style override).
    //
    // - Sat/Sun overrides (Task #192 / #200) fire for any non-"none"
    //   raceKind: Sat = "Race Prep" shake-out, Sun = race-day at the
    //   matching `RACE_DAY_SPECS[raceKind].distanceMi`.
    //
    // The Mon-Fri pattern is fixed regardless of slider position so
    // every hybrid marathon plan (lift_primary through run_primary)
    // lands on the same race week shape; the parity contract with
    // `previewWeeklyMileage` (mileage-only) holds because the preview
    // hard-codes the same Mon-Fri totals on marathon race week.
    if (isRaceWeek && dayOffset === 0 && raceKind === "marathon") {
      // Mon: full rest day. Race-week taper begins. Mon-Fri values
      // come from `HYBRID_RACE_WEEK_TAPER` (Task #206) — the single
      // source of truth shared with `previewWeeklyMileage`.
      const spec = HYBRID_RACE_WEEK_TAPER.mon;
      return {
        week: weekNumber,
        phase,
        date,
        day,
        strength_load: spec.strengthLoad,
        equipment: "Off / Rest",
        equipment_list: ["Off / Rest"],
        description:
          "Rest day. Light walk (20-30 min), foam roll, hydrate. Race-week taper begins." +
          customSuffix,
        strength_min: spec.strengthMin,
        cardio_min: spec.cardioMin,
        run_min: 0,
        distance_mi: spec.distanceMi,
        pace: null,
        session_type: "Rest",
        is_rest: true,
        total_load: spec.totalLoad ?? 0,
      };
    }
    if (isRaceWeek && dayOffset === 1 && raceKind === "marathon") {
      // Tue: light Tonal mobility + easy Peloton Bike spin.
      // Maintenance-style pairing — keep joints loose without taxing
      // the legs four days out from race day. Values from
      // `HYBRID_RACE_WEEK_TAPER.tue`.
      const spec = HYBRID_RACE_WEEK_TAPER.tue;
      return {
        week: weekNumber,
        phase,
        date,
        day,
        strength_load: spec.strengthLoad,
        equipment: "Tonal",
        equipment_list: ["Tonal", "Peloton Bike"],
        description:
          `Race-week mobility: light Tonal upper (${spec.strengthMin} min, leave 4-5 reps in reserve), then ${spec.cardioMin} min easy Peloton Bike spin. Stay loose, legs fresh.` +
          customSuffix,
        strength_min: spec.strengthMin,
        cardio_min: spec.cardioMin,
        run_min: 0,
        distance_mi: spec.distanceMi,
        pace: null,
        session_type: "Strength + Cardio",
        is_rest: false,
        total_load: spec.totalLoad ?? spec.strengthLoad + spec.cardioMin,
      };
    }
    if (isRaceWeek && dayOffset === 2 && raceKind === "marathon") {
      // Wed: short easy aerobic run at easy pace. No Tonal accessory
      // — race week is for freshness, not stimulus. Distance from
      // `HYBRID_RACE_WEEK_TAPER.wed.distanceMi`; minutes derive from
      // the runner's per-mile easy pace.
      const spec = HYBRID_RACE_WEEK_TAPER.wed;
      const wedDist = spec.distanceMi ?? 0;
      const wedMin = Math.max(20, Math.round(wedDist * easyMinPerMi));
      return {
        week: weekNumber,
        phase,
        date,
        day,
        strength_load: spec.strengthLoad,
        equipment: "Peloton Tread",
        equipment_list: ["Peloton Tread"],
        description:
          `Easy aerobic Tread run (${wedDist} mi, conversational pace). Keep it short — the race is Sunday.` +
          customSuffix,
        strength_min: spec.strengthMin,
        cardio_min: spec.cardioMin,
        run_min: wedMin,
        distance_mi: wedDist,
        pace: easyPace,
        session_type: "Aerobic Base",
        is_rest: false,
        total_load: spec.totalLoad ?? wedMin,
      };
    }
    if (isRaceWeek && dayOffset === 3 && raceKind === "marathon") {
      // Thu: full rest day. Drops the heavy lift to prioritize
      // freshness — three days out from race day is for recovery,
      // not stimulus. Values from `HYBRID_RACE_WEEK_TAPER.thu`.
      const spec = HYBRID_RACE_WEEK_TAPER.thu;
      return {
        week: weekNumber,
        phase,
        date,
        day,
        strength_load: spec.strengthLoad,
        equipment: "Off / Rest",
        equipment_list: ["Off / Rest"],
        description:
          "Rest day. No lift, no run — full recovery for race day. Mobility + hydration only." +
          customSuffix,
        strength_min: spec.strengthMin,
        cardio_min: spec.cardioMin,
        run_min: 0,
        distance_mi: spec.distanceMi,
        pace: null,
        session_type: "Rest",
        is_rest: true,
        total_load: spec.totalLoad ?? 0,
      };
    }
    if (isRaceWeek && dayOffset === 4 && raceKind === "marathon") {
      // Fri: short tune-up Tread run at quality pace with 4 x 30s
      // strides in the final mile. Mirrors the non-hybrid
      // `Sharpener` Friday — wake the legs up without taxing them.
      // Distance from `HYBRID_RACE_WEEK_TAPER.fri.distanceMi`; minutes
      // derive from the runner's per-mile quality pace.
      const spec = HYBRID_RACE_WEEK_TAPER.fri;
      const friDist = spec.distanceMi ?? 0;
      const friMin = Math.max(20, Math.round(friDist * qualityMinPerMi));
      return {
        week: weekNumber,
        phase,
        date,
        day,
        strength_load: spec.strengthLoad,
        equipment: "Peloton Tread",
        equipment_list: ["Peloton Tread"],
        description:
          `Tune-up Tread run (${friDist} mi at marathon pace) with 4 x 30s strides in the final mile. Wake the legs up, fuel + sleep tonight.` +
          customSuffix,
        strength_min: spec.strengthMin,
        cardio_min: spec.cardioMin,
        run_min: friMin,
        distance_mi: friDist,
        pace: qualityPace,
        session_type: "Sharpener",
        is_rest: false,
        total_load: spec.totalLoad ?? friMin,
      };
    }
    if (isRaceWeek && dayOffset === 5 && raceKind !== "none") {
      // Race-eve Saturday: the entire `DailyRow` is emitted by the shared
      // `buildRaceEveSatRow` helper (Task #215) so a hybrid race plan
      // emits the same race-eve protocol — minutes, cardio machine
      // alternation, description, session_type, total_load,
      // strength_load — as the other two race-week Sat branches in
      // `generatePlan` and `buildWeekDays`, regardless of race distance.
      return buildRaceEveSatRow({
        weekNumber,
        phase,
        date,
        customSuffix,
      });
    }
    if (isRaceWeek && dayOffset === 6 && raceKind !== "none") {
      // Race day Sunday: built end-to-end by the shared
      // `buildRaceDaySunRow` helper (Task #217) so every field reads
      // from the same `RACE_DAY_SPECS[raceKind]` table the canonical
      // 52-week (`generatePlan`) and recipe-driven (`buildWeekDays`)
      // race-day Sun branches consume. marathon → 26.2, half → 13.1,
      // 10K → 6.2, 5K → 3.1 — distance, description, run_min,
      // total_load, AND pace all come from the spec. Task #221
      // dropped the per-caller `pace` argument so this branch no
      // longer reads the local `qualityPace`; all three race-day Sun
      // branches now share a single per-kind pace value via the
      // helper.
      return buildRaceDaySunRow({
        weekNumber,
        phase,
        date,
        raceKind,
      });
    }

    if (slot.kind === "rest") {
      return {
        week: weekNumber,
        phase,
        date,
        day,
        strength_load: 0,
        equipment: "Off / Rest",
        equipment_list: ["Off / Rest"],
        description:
          `Rest day. Mobility, hydration, and easy walking. Hybrid block week ${weekInBlock}.` +
          customSuffix,
        strength_min: 0,
        cardio_min: 0,
        run_min: 0,
        distance_mi: null,
        pace: null,
        session_type: "Rest",
        is_rest: true,
        total_load: 0,
      };
    }

    if (slot.kind === "lift") {
      const load = slot.heavy ? heavyLoad : accessoryLoad;
      const min = slot.heavy ? heavyMin : accessoryMin;
      const intensity = isCutback
        ? "deload week — keep effort to ~70%"
        : slot.heavy
          ? "80-85% effort, leave 1-2 reps in reserve"
          : "moderate effort, focus on quality reps";
      const focusLabel = HYBRID_LIFT_LABELS[slot.focus] ?? "Tonal session";
      return {
        week: weekNumber,
        phase,
        date,
        day,
        strength_load: load,
        equipment: "Tonal",
        equipment_list: ["Tonal"],
        description:
          `${focusLabel} on Tonal (${min} min, ${intensity})` + customSuffix,
        strength_min: min,
        cardio_min: 0,
        run_min: 0,
        distance_mi: null,
        pace: null,
        session_type: slot.heavy ? "Strength" : "Strength (Accessory)",
        is_rest: false,
        total_load: load,
      };
    }

    // run slot
    if (slot.intensity === "long") {
      const distance = mi.long;
      const min = Math.max(20, Math.round(distance * longMinPerMi));
      const equipment = walkRun
        ? "Peloton Tread"
        : weekNumber % 2 === 0
          ? "Outdoor"
          : "Peloton Tread";
      return {
        week: weekNumber,
        phase,
        date,
        day,
        strength_load: 0,
        equipment,
        equipment_list: [equipment],
        description:
          (walkRun
            ? `${walkRunDescription(min)} (long-run on-ramp, ${distance} mi target). NO lift today.`
            : `Long aerobic run (${distance} mi): conversational unless noted, dial in fueling. NO lift today.`) +
          customSuffix,
        strength_min: 0,
        cardio_min: 0,
        run_min: min,
        distance_mi: distance,
        pace: longPace,
        session_type: "Long Run",
        is_rest: false,
        total_load: min + 10,
      };
    }
    if (slot.intensity === "quality") {
      const distance = mi.quality;
      const min = Math.max(20, Math.round(distance * qualityMinPerMi));
      return {
        week: weekNumber,
        phase,
        date,
        day,
        strength_load: 0,
        equipment: "Peloton Tread",
        equipment_list: ["Peloton Tread"],
        description:
          `Tread tempo run (${distance} mi: warm-up, then ${Math.max(10, Math.round(distance * 4))} min at steady tempo, cool-down)` +
          customSuffix,
        strength_min: 0,
        cardio_min: 0,
        run_min: min,
        distance_mi: distance,
        pace: qualityPace,
        session_type: "Tempo Run",
        is_rest: false,
        total_load: min,
      };
    }
    // easy run
    const distance = mi.easy;
    const min = Math.max(20, Math.round(distance * easyMinPerMi));
    return {
      week: weekNumber,
      phase,
      date,
      day,
      strength_load: 0,
      equipment: "Peloton Tread",
      equipment_list: ["Peloton Tread"],
      description:
        (walkRun
          ? `${walkRunDescription(min)} (easy on-ramp, ${distance} mi target)`
          : `Easy aerobic Tread run (${distance} mi, conversational, build durability)`) +
        customSuffix,
      strength_min: 0,
      cardio_min: 0,
      run_min: min,
      distance_mi: distance,
      pace: easyPace,
      session_type: "Aerobic Base",
      is_rest: false,
      total_load: min,
    };
  });
}

// Build the seven days of one week.
function buildWeekDays(opts: {
  weekNumber: number;
  weekInBlock: number;
  blockWeeks: number;
  block: PhaseBlock;
  recipe: FocusRecipe;
  wkStart: Date;
  isRaceWeek: boolean;
  // True when this block is the campaign-final block. The
  // Marathon-Specific recipe uses this to choose between the
  // blocks-mode tail-taper short-circuits (true) and a clean
  // monotonic ramp into peak mileage when a Taper block follows
  // in entries-mode (false). See `RECIPES["Marathon-Specific"]`.
  isTrailingBlock: boolean;
  // Race-day kind for the campaign-final week (task #191). Defaults
  // to "marathon" so legacy callers (and the blocks-mode 16w
  // Marathon-Specific tail) keep emitting the existing 26.2 mi
  // RACE DAY Sunday. When `isRaceWeek` is false the value is
  // ignored. When `isRaceWeek` is true and `raceKind` is "none" the
  // race-day branch falls back to the trailing recipe's natural
  // long-run Sunday — but `generatePlanFromConfig` already gates
  // `isRaceWeek` on `raceKind !== "none"` so this guard exists only
  // for defensive symmetry.
  raceKind?: PlanRaceKind;
  paceOverride?: PaceOverride | null;
}): DailyRow[] {
  const {
    weekNumber,
    weekInBlock,
    blockWeeks,
    block,
    recipe,
    wkStart,
    isRaceWeek,
    isTrailingBlock,
  } = opts;
  const raceKind: PlanRaceKind = opts.raceKind ?? "marathon";
  const paceOverride = opts.paceOverride ?? null;
  const effEasyPace = paceOverride?.easyPace ?? recipe.easyPace;
  const effTempoPace = paceOverride?.tempoPace ?? recipe.tempoPace;
  const effLongPace = paceOverride?.longPace ?? recipe.longPace;
  const phase = recipe.phaseLabel(block);
  const isCutback = recipe.useCutbacks
    ? blockWeeks >= 4 && weekInBlock % 4 === 0 && weekInBlock !== blockWeeks
    : false;

  const heavyStrengthLoad = isCutback
    ? Math.round(recipe.heavyStrengthLoad * 0.75)
    : recipe.heavyStrengthLoad;
  const heavyTonalMin = isCutback
    ? Math.max(20, Math.round(recipe.heavyTonalMin * 0.8))
    : recipe.heavyTonalMin;
  const shortCardioMin = isCutback
    ? Math.max(10, Math.round(recipe.shortCardioMin * 0.8))
    : recipe.shortCardioMin;
  const accessoryTonalMin = isCutback
    ? Math.max(15, recipe.accessoryTonalMin - 5)
    : recipe.accessoryTonalMin;
  const cardioBoost = recipe.cardioBoostMin ?? 0;
  const tueCardioMin = shortCardioMin + cardioBoost;
  const thuCardioMin = shortCardioMin + cardioBoost;
  const satCardioMin = shortCardioMin + cardioBoost;

  // For Custom blocks, tag every day's description with `[<Custom Name>: <notes>]`
  // (or `[<Custom Name>]` when no notes) so the runner can see at a glance
  // which custom block any given day belongs to in /plan and /today.
  const customName = block.customName?.trim();
  const customNotes = block.customNotes?.trim();
  const customSuffix =
    block.focusType === "Custom" && customName
      ? customNotes
        ? ` [${customName}: ${customNotes}]`
        : ` [${customName}]`
      : "";

  // ---------- CUSTOM HYBRID (slider-controlled lift+run mix) ----------
  // Custom blocks whose merged customNotes carry the `[hybrid-mix:...]`
  // sentinel are routed to the hybrid week builder, which lays out the
  // week's lifts and runs by slider position (lift_primary →
  // run_primary), days/week, and fitness level encoded in the same
  // sentinel string. Checked BEFORE the lift-primary branch because
  // lift_primary's sentinel never overlaps `[lift-primary:` (different
  // prefix) but checking hybrid first keeps the routing local to one
  // surface for v1.
  const hybridSpec =
    block.focusType === "Custom" ? hybridMixSpec(block.customNotes) : null;
  if (hybridSpec) {
    // Pull the mesocycle phase off the block (Task #154). The
    // template's expand() stamps `[hybrid-phase:base|build|taper]` on
    // each phased block; legacy single-block hybrid configs (and short
    // <12w plans) carry no phase tag and render with the v1 ramp.
    const blockHybridPhase = hybridPhase(block.customNotes);
    return buildHybridWeekDays({
      weekNumber,
      weekInBlock,
      blockWeeks,
      spec: hybridSpec,
      phase,
      isCutback,
      wkStart,
      customSuffix,
      hybridPhase: blockHybridPhase,
      isRaceWeek,
      paceOverride,
      // Task #200: thread the campaign-final race kind through so a
      // hybrid 5K / 10K / half / marathon plan ends on the matching
      // RACE DAY distance instead of a hardcoded 26.2 mi marathon.
      raceKind,
    });
  }

  // ---------- LIFT-PRIMARY (Tonal-only / non-running) ----------
  // Custom blocks whose customNotes carry the `[lift-primary:<kind>]`
  // sentinel render a Tonal-only week — Mon/Wed/Fri/Sat are heavy Tonal
  // sessions, Tue/Thu/Sun are full rest days. No runs, no Bike/Row/Tread
  // cardio sessions: pair with another template if cardio is needed.
  // The `<kind>` suffix (upper / lower / ppl / conditioning) tunes only
  // the per-day lift description; load/min math is shared.
  const liftKind =
    block.focusType === "Custom" ? liftPrimaryKind(block.customNotes) : null;
  if (liftKind) {
    return buildLiftPrimaryWeekDays({
      weekNumber,
      weekInBlock,
      liftKind,
      phase,
      isCutback,
      heavyStrengthLoad,
      heavyTonalMin,
      accessoryTonalMin,
      wkStart,
      customSuffix,
    });
  }

  // ---------- MON ----------
  // Recovery blocks turn Mon into a rest day with a longer optional walk;
  // the canonical pattern is already a rest day so this is a copy tweak only.
  const monDay: DailyRow = {
    week: weekNumber,
    phase,
    date: fmt(wkStart),
    day: "Mon",
    strength_load: 0,
    equipment: "Off / Rest",
    equipment_list: ["Off / Rest"],
    description: recipe.isRecovery
      ? "Rest day. Light walk (30-45 min) and full mobility flow." + customSuffix
      : "Full rest day. Optional 20 min walk, foam roll, mobility, hydrate." + customSuffix,
    strength_min: 0,
    cardio_min: 0,
    run_min: 0,
    distance_mi: null,
    pace: null,
    session_type: "Rest",
    is_rest: true,
    total_load: 0,
  };

  // ---------- TUE: HEAVY LIFT + CARDIO ----------
  const tueDay: DailyRow = {
    week: weekNumber,
    phase,
    date: fmt(addDays(wkStart, 1)),
    day: "Tue",
    strength_load: heavyStrengthLoad,
    equipment: "Tonal",
    equipment_list: ["Tonal", "Peloton Bike"],
    description:
      (isCutback
        ? `Heavy upper-body Tonal (${heavyTonalMin} min, push/pull/core), then ${tueCardioMin} min easy Peloton Bike spin`
        : `Heavy upper-body Tonal (${heavyTonalMin} min, push/pull at 80-85% effort), then ${tueCardioMin} min easy Peloton Bike spin`) +
      customSuffix,
    strength_min: heavyTonalMin,
    cardio_min: tueCardioMin,
    run_min: 0,
    distance_mi: null,
    pace: null,
    session_type: "Strength + Cardio",
    is_rest: false,
    total_load: heavyStrengthLoad + tueCardioMin,
  };

  // ---------- WED: EASY (or STEADY) RUN + ACCESSORY ----------
  // Recipes with `wedKind: "Steady"` (Marathon-Specific) upgrade the
  // mid-week aerobic run to a steady-state ("Z3 effort") session on
  // non-cutback weeks so the Run Target chip surfaces the amber-400
  // Zone 3 swatch on a real prescribed day. Cutback weeks still emit
  // the easy variant — the deload is recovery for Sun's long run, not
  // another quality day. Race week is also forced easy: the Wed
  // mid-week run 4 days out from the marathon is part of the taper, so
  // a Z3 quality stimulus there would compromise race readiness. The
  // Tonal accessory block is unchanged so weekly load math is
  // unaffected (Task #172).
  const wedDist = recipe.easyRunMi(weekInBlock, blockWeeks, isCutback);
  const wedRunMin = Math.max(20, Math.round(wedDist * recipe.easyRunMinPerMi));
  const wedAccessoryLoad = isCutback ? 20 : 25;
  const wedSteady = recipe.wedKind === "Steady" && !isCutback && !isRaceWeek;
  // Walk-run rows lead the chip rail with Peloton Tread; Steady Wed
  // (a quality stimulus) keeps the Tonal-led rail.
  const wedWalkRun = (paceOverride?.walkRun ?? false) && !wedSteady;
  const wedDay: DailyRow = {
    week: weekNumber,
    phase,
    date: fmt(addDays(wkStart, 2)),
    day: "Wed",
    strength_load: wedAccessoryLoad,
    equipment: wedWalkRun ? "Peloton Tread" : "Tonal",
    equipment_list: wedWalkRun
      ? ["Peloton Tread", "Tonal"]
      : ["Tonal", "Peloton Tread"],
    description:
      (wedSteady
        ? `Steady-state Tread run (${wedDist} mi, Z3 controlled effort — comfortably hard but conversational in short sentences), then ${accessoryTonalMin} min Tonal core + accessory work`
        : wedWalkRun
          ? `${walkRunDescription(wedRunMin)}, then ${accessoryTonalMin} min Tonal core + accessory work`
          : `Easy aerobic Tread run (${wedDist} mi, conversational), then ${accessoryTonalMin} min Tonal core + accessory work`) +
      customSuffix,
    strength_min: accessoryTonalMin,
    cardio_min: 0,
    run_min: wedRunMin,
    distance_mi: wedDist,
    pace: wedSteady ? effTempoPace : effEasyPace,
    session_type: wedSteady ? "Steady Run + Accessory" : "Run + Accessory",
    is_rest: false,
    total_load: wedRunMin + wedAccessoryLoad,
  };

  // ---------- THU: HEAVY LIFT + ROW ----------
  const thuDay: DailyRow = {
    week: weekNumber,
    phase,
    date: fmt(addDays(wkStart, 3)),
    day: "Thu",
    strength_load: heavyStrengthLoad,
    equipment: "Tonal",
    equipment_list: ["Tonal", "Peloton Row"],
    description:
      (isCutback
        ? `Heavy lower-body Tonal (${heavyTonalMin} min, squat/hinge/lunge), then ${thuCardioMin} min steady Peloton Row`
        : `Heavy lower-body Tonal (${heavyTonalMin} min, squat/hinge/lunge at 80-85% effort), then ${thuCardioMin} min steady Peloton Row`) +
      customSuffix,
    strength_min: heavyTonalMin,
    cardio_min: thuCardioMin,
    run_min: 0,
    distance_mi: null,
    pace: null,
    session_type: "Strength + Cardio",
    is_rest: false,
    total_load: heavyStrengthLoad + thuCardioMin,
  };

  // ---------- FRI: QUALITY RUN ----------
  const friDist = recipe.qualityRunMi(weekInBlock, blockWeeks, isCutback);
  const friRunMin = Math.max(20, Math.round(friDist * recipe.qualityRunMinPerMi));
  const fri = fridayContent(
    recipe,
    block,
    weekInBlock,
    isCutback,
    friDist,
    paceOverride,
    friRunMin,
  );
  // Foundation / AerobicBase / Sharpener / cutback Fridays go Tread-
  // led when walk-run is on; quality (Tempo/Threshold/RacePace) is not
  // swapped.
  const friWalkRun =
    (paceOverride?.walkRun ?? false) &&
    (recipe.fridayKind === "AerobicBase" ||
      recipe.fridayKind === "Sharpener" ||
      isCutback);
  const friDay: DailyRow = {
    week: weekNumber,
    phase,
    date: fmt(addDays(wkStart, 4)),
    day: "Fri",
    strength_load: fri.liftLoad,
    equipment:
      fri.liftMin > 0 ? (friWalkRun ? "Peloton Tread" : "Tonal") : "Peloton Tread",
    equipment_list:
      fri.liftMin > 0
        ? friWalkRun
          ? ["Peloton Tread", "Tonal"]
          : ["Tonal", "Peloton Tread"]
        : ["Peloton Tread"],
    description: fri.desc + fri.liftDescSuffix + customSuffix,
    strength_min: fri.liftMin,
    cardio_min: 0,
    run_min: friRunMin,
    distance_mi: friDist,
    pace: fri.pace,
    session_type: fri.liftLoad > 0 ? `${fri.type} + Accessory` : fri.type,
    is_rest: false,
    total_load: friRunMin + fri.liftLoad,
  };

  // ---------- SAT: HEAVY LIFT + CARDIO ----------
  // Race-eve Sat (race week) is built end-to-end by the shared
  // `buildRaceEveSatRow` helper (Task #215) so every field stays in
  // lock-step with the other two race-week Sat branches (`generatePlan`
  // line ~401 and `buildHybridWeekDays` line ~2124). Non-race weeks keep
  // the recipe-driven heavy lift + cardio finisher inline; the bike/row
  // alternation rule is the same in both modes.
  let satDay: DailyRow;
  if (isRaceWeek) {
    satDay = buildRaceEveSatRow({
      weekNumber,
      phase,
      date: fmt(addDays(wkStart, 5)),
      customSuffix,
    });
  } else {
    const satCardioName = weekNumber % 2 === 0 ? "Peloton Row" : "Peloton Bike";
    const satCardioVerb = weekNumber % 2 === 0 ? "steady row" : "steady bike";
    satDay = {
      week: weekNumber,
      phase,
      date: fmt(addDays(wkStart, 5)),
      day: "Sat",
      strength_load: heavyStrengthLoad,
      equipment: "Tonal",
      equipment_list: ["Tonal", satCardioName],
      description:
        (isCutback
          ? `Heavy full-body Tonal (${heavyTonalMin} min, mixed push/pull/squat), then ${satCardioMin} min ${satCardioVerb}`
          : `Heavy full-body Tonal (${heavyTonalMin} min, mixed push/pull/squat at 80-85% effort), then ${satCardioMin} min ${satCardioVerb} on ${satCardioName}`) +
        customSuffix,
      strength_min: heavyTonalMin,
      cardio_min: satCardioMin,
      run_min: 0,
      distance_mi: null,
      pace: null,
      session_type: "Strength + Cardio",
      is_rest: false,
      total_load: heavyStrengthLoad + satCardioMin,
    };
  }

  // ---------- PRIMARY MACHINE ROUTING (bike-only / row-only) ----------
  // Templates that pin a `[primary-machine:bike|row]` sentinel in their
  // customNotes (Peloton Bike PZ, Concept2 Row, etc.) keep the same
  // weekly skeleton but swap the three run sessions (Wed easy / Fri
  // quality / Sun long) for equivalent zone-controlled bike or row
  // sessions. The Tue/Thu/Sat heavy-lift days already pair Tonal with a
  // short bike or row, so they're left alone. Race week (when a
  // bike/row block happens to be the trailing block) keeps its
  // canonical race-day handling.
  const machine: PrimaryMachineKind | null = primaryMachineKind(block.customNotes);

  // ---------- SUN: LONG RUN or RACE ----------
  // Race-day Sun (race week, non-"none" raceKind) is built end-to-end
  // by the shared `buildRaceDaySunRow` helper (Task #217). Every field
  // — distance, description, run_min, total_load, equipment list,
  // session_type, pace — reads from the same `RACE_DAY_SPECS[raceKind]`
  // table the canonical 52-week (`generatePlan`, line ~441) and hybrid
  // (`buildHybridWeekDays`, line ~2130) race-day Sun branches consume.
  // Marathon keeps the exact numbers task #184 / earlier tests pinned
  // (distance 26.2, run_min 288, total_load 350); half / 10K / 5K each
  // pull their own distance / description / load from the spec table so
  // a Higdon Novice 5K plan ends on a real 3.1 mi race-day Sunday
  // instead of the trailing Taper recipe's natural ~4 mi long run.
  let sunDay: DailyRow;
  if (isRaceWeek && raceKind !== "none") {
    // Race day Sunday: built end-to-end by `buildRaceDaySunRow`
    // (Task #217) so every field — distance, description, run_min,
    // total_load, equipment list, session_type, AND pace — comes
    // from `RACE_DAY_SPECS[raceKind]`. Task #221 dropped the
    // per-caller `pace` argument so this branch no longer reads the
    // local `recipe.tempoPace`; the recipe / hybrid / legacy
    // race-day Sun branches now share one per-kind pace value via
    // the helper.
    sunDay = buildRaceDaySunRow({
      weekNumber,
      phase,
      date: fmt(addDays(wkStart, 6)),
      raceKind,
    });
  } else {
    const longRun = recipe.longRunMi(weekInBlock, blockWeeks, isCutback, isTrailingBlock);
    const sunWalkRun = paceOverride?.walkRun ?? false;
    const longEquipment = sunWalkRun
      ? "Peloton Tread"
      : weekNumber % 2 === 0
        ? "Outdoor"
        : "Peloton Tread";
    const longMin = Math.max(20, Math.round(longRun * recipe.longRunMinPerMi));
    sunDay = {
      week: weekNumber,
      phase,
      date: fmt(addDays(wkStart, 6)),
      day: "Sun",
      strength_load: 0,
      equipment: longEquipment,
      equipment_list: [longEquipment],
      description:
        (sunWalkRun
          ? `${walkRunDescription(longMin)} (long-run on-ramp, ${longRun} mi target). NO lift today.`
          : `${recipe.longRunVerb} (${longRun} mi): conversational unless noted, dial in fueling. NO lift today.`) +
        customSuffix,
      strength_min: 0,
      cardio_min: 0,
      run_min: longMin,
      distance_mi: longRun,
      pace: effLongPace,
      session_type: "Long Run",
      is_rest: false,
      total_load: longMin + 10,
    };
  }

  // Apply primary-machine routing: swap Wed/Fri/Sun runs for bike/row
  // sessions of equivalent duration. Mileage zeros out (distance_mi /
  // pace null, run_min 0) and the equivalent run minutes flow into
  // cardio_min instead so the weekly Cardio bucket reflects the time
  // spent on the machine. Race week is left alone (the canonical race
  // day handling already owns it).
  let resolvedWedDay = wedDay;
  let resolvedFriDay = friDay;
  let resolvedSunDay = sunDay;
  if (machine && !isRaceWeek) {
    const machineLabel = machine === "bike" ? "Peloton Bike" : "Peloton Row";
    const easyVerb =
      machine === "bike" ? "Z2 endurance ride" : "Z2 endurance row";
    const qualityVerb =
      machine === "bike"
        ? "Z3-Z4 interval ride"
        : "threshold / Z3-Z4 interval row";
    const longVerb =
      machine === "bike"
        ? "long Z2 endurance ride"
        : "long steady-state row";

    // Wed: easy run + Tonal accessory → easy bike/row + Tonal accessory.
    resolvedWedDay = {
      ...wedDay,
      equipment: "Tonal",
      equipment_list: ["Tonal", machineLabel],
      description:
        `Easy aerobic ${machineLabel} (${wedRunMin} min ${easyVerb}, conversational power), then ${accessoryTonalMin} min Tonal core + accessory work` +
        customSuffix,
      run_min: 0,
      cardio_min: wedRunMin,
      distance_mi: null,
      pace: null,
      session_type: "Cardio + Accessory",
      total_load: wedRunMin + wedAccessoryLoad,
    };

    // Fri: quality run (no lift after W6) → quality bike/row.
    resolvedFriDay = {
      ...friDay,
      equipment: fri.liftMin > 0 ? "Tonal" : machineLabel,
      equipment_list:
        fri.liftMin > 0 ? ["Tonal", machineLabel] : [machineLabel],
      description:
        `Quality ${machineLabel} (${friRunMin} min ${qualityVerb}, zone-controlled)` +
        fri.liftDescSuffix +
        customSuffix,
      run_min: 0,
      cardio_min: friRunMin,
      distance_mi: null,
      pace: null,
      session_type:
        fri.liftLoad > 0 ? "Quality Cardio + Accessory" : "Quality Cardio",
      total_load: friRunMin + fri.liftLoad,
    };

    // Sun: long run → long bike/row endurance session. Match the long
    // run's planned minutes so weekly cardio volume tracks the recipe.
    const longRunMi = recipe.longRunMi(weekInBlock, blockWeeks, isCutback, isTrailingBlock);
    const longMin = Math.max(20, Math.round(longRunMi * recipe.longRunMinPerMi));
    resolvedSunDay = {
      ...sunDay,
      equipment: machineLabel,
      equipment_list: [machineLabel],
      description: `${longVerb} (${longMin} min, conversational effort): build aerobic durability and dial in fueling. NO lift today.${customSuffix}`,
      run_min: 0,
      cardio_min: longMin,
      distance_mi: null,
      pace: null,
      session_type: "Long Cardio",
      total_load: longMin + 10,
    };
  }

  // Recovery focus drops the Friday quality (replace with rest) so the runner
  // gets two rest days during the recovery block.
  if (recipe.isRecovery) {
    return [
      monDay,
      tueDay,
      resolvedWedDay,
      thuDay,
      {
        ...resolvedFriDay,
        strength_load: 0,
        equipment: "Off / Rest",
        equipment_list: ["Off / Rest"],
        description:
          "Rest day. Walk, mobility, foam roll. Recovery block — no quality work this week." + customSuffix,
        strength_min: 0,
        cardio_min: 0,
        run_min: 0,
        distance_mi: null,
        pace: null,
        session_type: "Rest",
        is_rest: true,
        total_load: 0,
      },
      satDay,
      resolvedSunDay,
    ];
  }

  return [
    monDay,
    tueDay,
    resolvedWedDay,
    thuDay,
    resolvedFriDay,
    satDay,
    resolvedSunDay,
  ];
}

// ---------------------------------------------------------------------------
// MILEAGE PREVIEW (Task #81) — lightweight per-week mileage projection used
// by the Phase Planner UI to render sparklines per block and a full
// 52-week mileage curve before the runner clicks Apply.
//
// Unlike `generatePlanFromConfig` this helper:
//   - Does NOT validate dates (so the runner sees a live preview while still
//     editing block weeks / dates).
//   - Skips strength + cardio + day-by-day prose generation; it only computes
//     the three mileage buckets the runner cares about for shaping decisions:
//     wed easy run, fri quality run, and sun long run (or 26.2 mi marathon
//     on the trailing race week).
//   - Optionally appends the auto-pinned 16-week Marathon-Specific tail so
//     the curve lines up with what Apply will eventually produce.
// ---------------------------------------------------------------------------

export interface WeekMileagePreview {
  // 1-based plan-wide week index across all blocks (after appending the
  // optional Marathon-Specific tail).
  week: number;
  // 0-based index into the iterated block list (user blocks first, then the
  // auto-pinned Marathon-Specific tail when appendMarathonTail is true).
  blockIndex: number;
  blockLabel: string;
  focusType: FocusType;
  // 1-based week index inside the block (1..block.weeks).
  weekInBlock: number;
  isCutback: boolean;
  isRaceWeek: boolean;
  easyMi: number;
  qualityMi: number;
  longRunMi: number;
  totalMi: number;
  // True when this week's Wednesday will emit a steady-state ("Z3
  // effort") run instead of the canonical easy aerobic run. Mirrors
  // `buildWeekDays` exactly: only blocks whose recipe pins
  // `wedKind: "Steady"` (Marathon-Specific today) flip this on, and
  // even then it stays false on cutback weeks (Wed eases to keep the
  // long run recoverable) and on the trailing race week (Wed is part
  // of the taper). Lift-primary / bike-only / row-only Custom blocks
  // and hybrid-spec Custom blocks substitute the Wed run with
  // non-running work, so they always report false. Drives the amber
  // Z3 "Steady" chip on the plan calendar week strip and the matching
  // amber dots on the Phase Planner sparklines so runners can see at
  // a glance which weeks earn the Z3 stimulus before clicking Apply
  // (Task #175).
  wedSteady: boolean;
}

export interface PreviewWeeklyMileageOptions {
  // When true, the trailing 16-week Marathon-Specific block is appended so
  // the preview matches the eventual generated plan. Defaults to true.
  // Pass false in entries-mode (templates own their own taper) — the
  // entries-mode preview helpers below set this automatically.
  appendMarathonTail?: boolean;
  // Entries-mode race-day flag (Task #184). When true (and
  // `appendMarathonTail` is false — i.e. entries-mode), the trailing
  // Sunday's `longRunMi` is forced to the 26.2 mi marathon distance
  // and `isRaceWeek` flips on, mirroring `generatePlanFromConfig`'s
  // `endsOnMarathonRaceDay` gate so the Phase Planner sparkline / week
  // strip stays in lock-step with what Apply emits when the entries
  // plan ends on a marathon-classified template. Defaults to false so
  // 5K / 10K / half / hybrid / lifting entries plans still preview
  // their template's natural taper Sunday.
  //
  // Superseded by `entriesRaceKind` for callers that need to preview
  // half / 10K / 5K race-day Sundays at their correct distances (task
  // #191). Retained for backward-compat: when set without
  // `entriesRaceKind`, it's mapped to `"marathon"` / `"none"`.
  entriesEndOnMarathonRace?: boolean;
  // Entries-mode race-day kind (Task #191). When set (and
  // `appendMarathonTail` is false), the trailing Sunday's `longRunMi`
  // is forced to the matching `RACE_DAY_SPECS[raceKind].distanceMi`
  // (26.2 / 13.1 / 6.2 / 3.1) and `isRaceWeek` flips on. Mirrors
  // `generatePlanFromConfig`'s race-day gate so the Phase Planner
  // sparkline matches what Apply emits for half / 10K / 5K entries
  // plans — not just marathon. Takes precedence over the legacy
  // `entriesEndOnMarathonRace` boolean. Pass `"none"` (or leave both
  // unset) so non-race entries plans still preview their template's
  // natural taper Sunday.
  entriesRaceKind?: PlanRaceKind;
}

export function previewWeeklyMileage(
  userBlocks: PhaseBlock[],
  opts: PreviewWeeklyMileageOptions = {},
): WeekMileagePreview[] {
  const appendTail = opts.appendMarathonTail ?? true;
  // Resolve the entries-mode race-day kind. New callers pass
  // `entriesRaceKind` directly (task #191); legacy callers still pass
  // `entriesEndOnMarathonRace: true` which is mapped to "marathon".
  // When neither is set the trailing week falls through to the
  // recipe's natural taper Sunday — preserving the existing
  // 5K / 10K / half / hybrid / lifting entries-plan behavior.
  const resolvedEntriesRaceKind: PlanRaceKind =
    opts.entriesRaceKind ??
    (opts.entriesEndOnMarathonRace ? "marathon" : "none");
  // Entries-mode race-day re-enables the campaign-final race Sunday
  // (forcing the trailing long-run to the matching race distance —
  // 26.2 / 13.1 / 6.2 / 3.1) without appending the 16w
  // Marathon-Specific tail. Mirrors `generatePlanFromConfig`'s
  // race-day gate so preview and Apply agree on the final week. Has
  // no effect in blocks-mode (where the appended tail's race-week
  // handling already produces 26.2).
  const entriesRaceActive =
    !appendTail && resolvedEntriesRaceKind !== "none";
  const entriesRaceDistanceMi = entriesRaceActive
    ? RACE_DAY_SPECS[resolvedEntriesRaceKind].distanceMi
    : MARATHON_DISTANCE_MI;
  const blocks: PhaseBlock[] = appendTail
    ? [
        ...userBlocks,
        {
          focusType: "Marathon-Specific",
          weeks: MARATHON_TAIL_WEEKS,
          customName: null,
          customNotes: null,
        },
      ]
    : userBlocks;

  const totalWeeks = blocks.reduce(
    (s, b) => s + Math.max(0, b.weeks || 0),
    0,
  );
  const out: WeekMileagePreview[] = [];
  let week = 0;
  blocks.forEach((b, blockIndex) => {
    const w = b.weeks || 0;
    if (w < 1) return;
    const recipe = RECIPES[b.focusType];
    // Lift-primary blocks render as Tonal-only weeks in the daily
    // pipeline (no runs / no cardio sessions), so the mileage preview
    // must zero-out every bucket to match `planned_miles`.
    const isLiftPrimary =
      b.focusType === "Custom" && liftPrimaryKind(b.customNotes) !== null;
    // Bike-only / Row-only blocks emit zero run miles — the Wed/Fri/Sun
    // run sessions are swapped for equivalent zone-controlled bike or
    // row sessions in `buildWeekDays`, so the mileage preview must zero
    // out every run bucket to match `planned_miles`.
    const isPrimaryMachine = primaryMachineKind(b.customNotes) !== null;
    // Custom hybrid blocks compute their own per-week mileage from the
    // slider position so the Phase Planner preview matches what the
    // generator emits (lift_primary → near-zero run miles; run_primary
    // → ramping easy + quality + long mileage). Falls back to the
    // Custom recipe defaults when the sentinel isn't present.
    const hybridSpecForPreview =
      b.focusType === "Custom" ? hybridMixSpec(b.customNotes) : null;
    // Mesocycle phase for hybrid blocks (Task #154). Threaded into
    // `hybridMileage` below so the Phase Planner curve mirrors the
    // base/build/taper ramp the generator emits.
    const hybridPhaseForPreview =
      b.focusType === "Custom" ? hybridPhase(b.customNotes) : null;
    const zeroRuns = isLiftPrimary || isPrimaryMachine;
    // Number of slot-based easy/quality/long runs the schedule will
    // actually emit for the runner-picked (position, daysPerWeek). Used
    // to scale preview mileage so the runner's days/week trade-off is
    // reflected in the Phase Planner curve.
    const hybridScheduleCounts = hybridSpecForPreview
      ? countHybridRunsInSchedule(
          pickHybridSchedule(
            hybridSpecForPreview.position,
            hybridSpecForPreview.daysPerWeek,
          ),
        )
      : null;
    for (let weekInBlock = 1; weekInBlock <= w; weekInBlock++) {
      week += 1;
      // Race week: the trailing 16w Marathon-Specific tail's final
      // week (blocks-mode, always 26.2 mi) OR the campaign-final
      // week of an entries-mode plan whose trailing template
      // classifies as a real race (marathon / half / 10K / 5K — task
      // #191). Both branches force the long-run Sunday to the
      // matching race distance.
      const isRaceWeek =
        week === totalWeeks && (appendTail || entriesRaceActive);
      const isCutback = recipe.useCutbacks
        ? w >= 4 && weekInBlock % 4 === 0 && weekInBlock !== w
        : false;
      let easyMi: number;
      let qualityMi: number;
      let longMi: number;
      if (hybridSpecForPreview && hybridScheduleCounts) {
        const mi = hybridMileage(
          hybridSpecForPreview.position,
          hybridSpecForPreview.level,
          weekInBlock,
          w,
          isCutback,
          hybridPhaseForPreview,
        );
        if (isRaceWeek) {
          // Race-week override (Task #192 / #198 / #200). The hybrid
          // week builder force-overrides Sat = "Race Prep" + Sun =
          // race-day at `entriesRaceDistanceMi` for any non-"none"
          // raceKind. For MARATHON race weeks specifically (Task
          // #198), Mon-Fri are ALSO force-overridden to a fixed
          // light taper (Mon rest, light Tue mobility + 15 min bike,
          // 3 mi Wed easy, Thu rest, 2 mi Fri tune-up). Mirror that
          // split here so the Phase Planner sparkline matches what
          // the generator emits on the campaign-final week:
          //   - marathon → easy=3, quality=2, long=26.2 (fixed,
          //     independent of slider position / days/week / level)
          //   - 5K / 10K / half (Task #200) → walk the schedule for
          //     Mon-Fri, drop Sat/Sun, then add the per-kind race
          //     distance (3.1 / 6.2 / 13.1 mi) as the Sun race.
          //   - blocks-mode legacy fallback (raceKind="none") →
          //     entriesRaceDistanceMi defaults to MARATHON_DISTANCE_MI.
          if (resolvedEntriesRaceKind === "marathon") {
            // Wed easy + Fri tune-up come from the shared
            // `HYBRID_RACE_WEEK_TAPER` constant (Task #206) so
            // generator and preview cannot drift on race-week
            // mileage. Mon/Tue/Thu are non-run days
            // (`distanceMi: null`) so they don't contribute.
            easyMi = HYBRID_RACE_WEEK_TAPER.wed.distanceMi ?? 0;
            qualityMi = HYBRID_RACE_WEEK_TAPER.fri.distanceMi ?? 0;
            longMi = entriesRaceDistanceMi;
          } else {
            const schedule = pickHybridSchedule(
              hybridSpecForPreview.position,
              hybridSpecForPreview.daysPerWeek,
            );
            let e = 0;
            let q = 0;
            let l = 0;
            schedule.forEach((slot, idx) => {
              if (slot.kind !== "run") return;
              if (idx === 5 || idx === 6) return; // Sat/Sun overridden
              if (slot.intensity === "easy") e += mi.easy;
              else if (slot.intensity === "quality") q += mi.quality;
              else l += mi.long;
            });
            easyMi = e;
            qualityMi = q;
            longMi = l + entriesRaceDistanceMi;
          }
        } else {
          easyMi = mi.easy * hybridScheduleCounts.easy;
          qualityMi = mi.quality * hybridScheduleCounts.quality;
          longMi = mi.long * hybridScheduleCounts.long;
        }
      } else {
        easyMi = zeroRuns ? 0 : recipe.easyRunMi(weekInBlock, w, isCutback);
        // Recovery blocks turn Friday into a rest day in `buildWeekDays`, so
        // the actual generated weekly mileage is easy + long only. Mirror
        // that here so the preview matches `planned_miles` exactly.
        qualityMi = zeroRuns
          ? 0
          : recipe.isRecovery
            ? 0
            : recipe.qualityRunMi(weekInBlock, w, isCutback);
        longMi = zeroRuns
          ? 0
          : isRaceWeek
            ? entriesRaceActive
              ? entriesRaceDistanceMi
              : MARATHON_DISTANCE_MI
            : recipe.longRunMi(
                weekInBlock,
                w,
                isCutback,
                blockIndex === blocks.length - 1,
              );
      }
      const totalMi = r1(easyMi + qualityMi + longMi);
      // Wed steady-run gating mirrors `buildWeekDays`: the recipe must
      // opt-in via `wedKind: "Steady"`, the week must not be a cutback
      // (Wed eases so Sun's long run stays recoverable) and not the
      // trailing race week (Wed is taper). Lift-primary, primary-machine
      // and hybrid-spec Custom blocks swap the Wed run for non-running
      // work so they never surface a Steady Wed chip even if some future
      // recipe were to pin `wedKind` on the Custom focus.
      const wedSteady =
        recipe.wedKind === "Steady" &&
        !isCutback &&
        !isRaceWeek &&
        !zeroRuns &&
        !hybridSpecForPreview;
      out.push({
        week,
        blockIndex,
        blockLabel: recipe.phaseLabel(b),
        focusType: b.focusType,
        weekInBlock,
        isCutback,
        isRaceWeek,
        easyMi: r1(easyMi),
        qualityMi: r1(qualityMi),
        longRunMi: r1(longMi),
        totalMi,
        wedSteady,
      });
    }
  });
  return out;
}

// Internal generator options. Currently only used by
// `generatePlanFromConfigPerEntry` to suppress race-day on synthetic
// single-entry configs that DON'T correspond to the campaign's final
// entry — a mid-campaign marathon entry would otherwise inject a 26.2
// mi RACE DAY at its boundary because the auto-derived gate in
// `generatePlanFromConfig` can't see the surrounding campaign context.
// Not part of the public planner contract — callers outside the
// per-entry pipeline should leave the override unset.
export interface GeneratePlanOptions {
  // When set, overrides the auto-derived `endsOnMarathonRaceDay` gate.
  // `false` forces no race-day Sunday even if the config is blocks-mode
  // or its entries end on a marathon template; `true` is reserved for
  // future use. Leave `undefined` to use the default derivation.
  endsOnMarathonRaceDayOverride?: boolean;
  // Campaign-week offset for the per-week pace ramp; per-entry callers
  // pass the entry's weekOffset so stacked entries see campaign-relative
  // weeks. Defaults to 0.
  paceWeekOffset?: number;
  startingPaceSecOverride?: number | null;
}

export function generatePlanFromConfig(
  config: PlannerConfig,
  opts: GeneratePlanOptions = {},
): { daily: DailyRow[]; weekly: WeeklyRow[]; body: BodyRow[] } {
  const issues = validatePlannerConfig(config);
  if (issues.length > 0) {
    const summary = issues.map((i) => `${i.field}: ${i.message}`).join("; ");
    throw new Error(`invalid planner config: ${summary}`);
  }

  const expandedBlocks = expandPlannerBlocks(config);
  const totalWeeks = totalWeeksFromDates(config.startDate, config.marathonDate);

  const startDate = new Date(`${config.startDate}T00:00:00Z`);
  const weekly: WeeklyRow[] = [];
  const daily: DailyRow[] = [];
  const body: BodyRow[] = [];

  // Marathon-mode (blocks-mode) campaigns always end with the auto-pinned
  // 16-week Marathon-Specific tail (the validator forces user blocks to
  // sum to totalWeeks - MARATHON_TAIL_WEEKS), so the campaign-final
  // Sunday is unambiguously a 26.2 mi marathon — `buildWeekDays` takes
  // the race-day branch on that week (Sun → 26.2 mi marathon, Sat → race
  // prep).
  //
  // Entries-mode plans (config.entries is an array) DO NOT auto-pin a
  // marathon tail: each template (5K, 10K, half-marathon, marathon,
  // hybrid) owns its own taper / race week via its `expand()` blocks.
  // Forcing a 26.2 mi marathon onto the last Sunday of a Higdon Novice
  // 5K plan is wrong, and it also disagrees with the Phase Planner
  // sparkline (which calls `previewWeeklyMileage` with
  // `appendMarathonTail: false` in entries-mode and therefore never
  // substitutes the marathon). Mirror that policy here so the
  // generator matches what the preview promises (Task #182).
  //
  // BUT: an entries-mode plan whose LAST entry classifies as a real
  // race (templateRaceKind ∈ {"marathon", "half", "10k", "5k"})
  // should still end on a true RACE DAY Sunday at the matching
  // distance — otherwise a runner who picks the Pfitz 18w marathon
  // template ends their plan on the Taper recipe's final week
  // (long=4 mi) instead of running the 26.2 mi marathon they trained
  // for, AND a runner who picks the Higdon Novice 5K template ends
  // on a 4 mi long run instead of the 3.1 mi 5K event. Re-enable the
  // campaign-final race-day branch whenever the trailing template
  // classifies as a real race (task #184 originally re-enabled it
  // for marathon only; task #191 generalizes to half / 10K / 5K).
  // Non-race entries plans (Hybrid, lifting-only) still end on their
  // template's natural taper Sunday.
  //
  // `generatePlanFromConfigPerEntry` builds synthetic configs with
  // `entries: [singleEntry]` for EACH template entry — including
  // mid-campaign race entries. The auto-derived gate below would
  // fire race-day on every such synthetic race config (because it
  // can't see the surrounding campaign context), injecting a stray
  // race Sunday at the boundary of any non-final race entry. The
  // per-entry pipeline therefore passes
  // `endsOnMarathonRaceDayOverride: false` for every entry except
  // the campaign-final one, leaving auto-derivation in charge for
  // the trailing entry (which DOES correctly classify as a real
  // race iff its template's raceKind is non-"none").
  const trailingEntriesRaceKind: PlanRaceKind = Array.isArray(config.entries)
    ? entriesRaceKind(config.entries)
    : "marathon";
  const autoRaceActive = !Array.isArray(config.entries)
    ? true // blocks-mode always ends on the auto-pinned 16w Marathon-Specific tail
    : trailingEntriesRaceKind !== "none";
  const endsOnMarathonRaceDay =
    opts.endsOnMarathonRaceDayOverride ?? autoRaceActive;
  // Race kind for the campaign-final week. Blocks-mode always
  // resolves to "marathon" (matches the auto-pinned tail); entries-
  // mode honors the trailing entry's classification. When the
  // override forces race-day OFF, the kind is irrelevant — the
  // race-day branch in `buildWeekDays` won't fire.
  const campaignFinalRaceKind: PlanRaceKind = !Array.isArray(config.entries)
    ? "marathon"
    : trailingEntriesRaceKind;

  const rawStartingPaceSec =
    opts.startingPaceSecOverride !== undefined
      ? opts.startingPaceSecOverride
      : config.startingPaceSec ?? null;
  const startingPaceSec = rawStartingPaceSec ?? DEFAULT_STARTING_PACE_SEC;
  const paceWeekOffset = opts.paceWeekOffset ?? 0;

  let weekNumber = 0;
  for (const block of expandedBlocks) {
    const recipe = RECIPES[block.focusType];
    for (let weekInBlock = 1; weekInBlock <= block.weeks; weekInBlock++) {
      weekNumber += 1;
      const wkStart = addDays(startDate, (weekNumber - 1) * 7);
      const wkEnd = addDays(wkStart, 6);
      const isRaceWeek = endsOnMarathonRaceDay && weekNumber === totalWeeks;
      const campaignWeek = weekNumber + paceWeekOffset;
      const entryLocalWeek = weekNumber;
      const paceOverride = buildPaceOverride(
        startingPaceSec,
        campaignWeek,
        entryLocalWeek,
        recipe,
      );
      const days = buildWeekDays({
        weekNumber,
        weekInBlock,
        blockWeeks: block.weeks,
        block,
        recipe,
        wkStart,
        isRaceWeek,
        isTrailingBlock: block === expandedBlocks[expandedBlocks.length - 1],
        raceKind: campaignFinalRaceKind,
        paceOverride,
      });
      daily.push(...days);

      const planned_strength = days.reduce(
        (s, d) => s + (d.strength_load || 0),
        0,
      );
      const planned_cardio = days.reduce((s, d) => s + (d.cardio_min || 0), 0);
      const planned_total_load = days.reduce(
        (s, d) => s + (d.total_load || 0),
        0,
      );
      const planned_miles = r1(
        days.reduce((s, d) => s + (d.distance_mi || 0), 0),
      );
      const long_run_mi = days.reduce(
        (max, d) => Math.max(max, d.distance_mi || 0),
        0,
      );
      weekly.push({
        week: weekNumber,
        phase: recipe.phaseLabel(block),
        start: fmt(wkStart),
        end: fmt(wkEnd),
        planned_strength,
        planned_cardio,
        planned_total_load,
        planned_miles,
        long_run_mi: r1(long_run_mi),
      });

      if (weekNumber === 1) {
        body.push({
          week: 1,
          date: fmt(wkStart),
          weight: 281.6,
          l_arm: 17,
          r_arm: 17,
          l_leg: 29.5,
          r_leg: 29.5,
          belly: 53.5,
          chest: 51,
          notes: "Baseline week — enter starting measurements here.",
        });
      } else {
        body.push({
          week: weekNumber,
          date: fmt(wkStart),
          weight: null,
          l_arm: null,
          r_arm: null,
          l_leg: null,
          r_leg: null,
          belly: null,
          chest: null,
          notes: "",
        });
      }
    }
  }

  return { daily, weekly, body };
}

// ===========================================================================
// PER-ENTRY GENERATION (Task #135). Concurrent overlapping programs need
// per-template-entry plan_days so the campaign can host two simultaneous
// templates (e.g. a Tonal lifting program running in parallel with a 5K
// running program). Each TemplateEntry is expanded as its own standalone
// plan anchored at the entry's effective startDate, and rows are tagged
// with the source entry's index/label so /today and /plan/:week can show
// concurrent sessions side-by-side and removing one program leaves the
// other intact.
// ===========================================================================

export interface PerEntryPlan {
  entryIndex: number;
  // Human-readable program name (entry.customName fallback to template name).
  // For legacy blocks-only configs this is null.
  label: string | null;
  startDate: string;
  endDate: string;
  daily: DailyRow[];
  weekly: WeeklyRow[];
}

export function generatePlanFromConfigPerEntry(
  config: PlannerConfig,
): PerEntryPlan[] {
  const issues = validatePlannerConfig(config);
  if (issues.length > 0) {
    const summary = issues.map((i) => `${i.field}: ${i.message}`).join("; ");
    throw new Error(`invalid planner config: ${summary}`);
  }

  // Blocks-mode (legacy single-program campaign): one virtual entry
  // covering the whole config.
  if (!Array.isArray(config.entries)) {
    const plan = generatePlanFromConfig(config);
    return [
      {
        entryIndex: 0,
        label: null,
        startDate: config.startDate,
        endDate: config.marathonDate,
        daily: plan.daily,
        weekly: plan.weekly,
      },
    ];
  }

  const projections = projectEntries(config.entries, config.startDate);
  const out: PerEntryPlan[] = [];
  const startMs = Date.parse(`${config.startDate}T00:00:00Z`);
  for (let i = 0; i < config.entries.length; i++) {
    const e = config.entries[i]!;
    const proj = projections.find((p) => p.entryIndex === i);
    if (!proj) continue;
    const tpl = getTemplateById(e.templateId);
    if (!tpl) continue;
    const weekOffset = Math.round(
      (Date.parse(`${proj.startDateISO}T00:00:00Z`) - startMs) /
        (7 * 86400000),
    );
    // Build a single-entry synthetic config: this entry's template
    // expanded standalone, anchored at the entry's startDate. Use
    // entries-mode so the validator runs the entries-mode codepath
    // (template-owned taper, no auto-pinned 16-week tail).
    const synthetic: PlannerConfig = {
      startDate: proj.startDateISO,
      marathonDate: proj.endDateISO,
      blocks: [],
      entries: [
        {
          templateId: e.templateId,
          weeks: e.weeks,
          customName: e.customName ?? null,
          customNotes: e.customNotes ?? null,
        },
      ],
    };
    // Task #184: campaign-final entry only earns the marathon race-day
    // Sunday. For every non-final entry — including mid-campaign
    // marathon entries — force the override OFF so the synthetic
    // single-entry config (which would otherwise auto-classify itself
    // as ending on a marathon and inject a stray 26.2 mi RACE DAY at
    // the entry's boundary) falls through to the trailing recipe's
    // natural taper Sunday. The trailing entry leaves the override
    // unset so auto-derivation correctly fires race-day iff its
    // template is marathon.
    const isLastEntry = i === config.entries.length - 1;
    const sub = generatePlanFromConfig(synthetic, {
      endsOnMarathonRaceDayOverride: isLastEntry ? undefined : false,
      paceWeekOffset: weekOffset,
      startingPaceSecOverride: config.startingPaceSec ?? null,
    });
    // Remap week numbers from entry-local (1..N) to campaign-relative
    // so plan_days.week matches the position of the date in the
    // overall campaign timeline.
    const daily = sub.daily.map((d) => ({ ...d, week: d.week + weekOffset }));
    const weekly = sub.weekly.map((w) => ({ ...w, week: w.week + weekOffset }));
    out.push({
      entryIndex: i,
      label: e.customName?.trim() || tpl.name,
      startDate: proj.startDateISO,
      endDate: proj.endDateISO,
      daily,
      weekly,
    });
  }
  return out;
}

// Tagged daily row used by the apply / full-reset codepaths to attribute
// each plan_day back to a TemplateEntry. sourceEntryIndex=0 with a null
// label is used both for legacy single-program campaigns AND for synthetic
// Recovery filler rows that cover gap weeks (interior weeks no entry
// touches) so calendar continuity is preserved.
export interface TaggedDailyRow {
  sourceEntryIndex: number;
  sourceEntryLabel: string | null;
  row: DailyRow;
}

// Expand a planner config into the rows the apply / full-reset routes
// need to seed plan_weeks + plan_days for concurrent overlapping
// programs. Iterates per-entry to produce per-program tagged daily rows,
// aggregates weekly totals across overlapping entries (sum
// loads/miles/cardio, max long_run), AND gap-fills any uncovered campaign
// week with the canonical projected fallback (Recovery filler from
// expandEntriesToBlocksWithGaps) so dates between non-adjacent entries
// still get plan rows. Legacy blocks-mode configs collapse to a single
// untagged track via generatePlanFromConfigPerEntry.
export function expandConfigToPlanRows(
  config: PlannerConfig,
): { weekly: WeeklyRow[]; taggedDaily: TaggedDailyRow[] } {
  const perEntry = generatePlanFromConfigPerEntry(config);
  const weeklyByWeek = new Map<number, WeeklyRow>();
  const taggedDaily: TaggedDailyRow[] = [];
  const coveredWeeks = new Set<number>();
  for (const sub of perEntry) {
    for (const w of sub.weekly) {
      coveredWeeks.add(w.week);
      const existing = weeklyByWeek.get(w.week);
      if (!existing) {
        weeklyByWeek.set(w.week, { ...w });
      } else {
        existing.planned_strength += w.planned_strength;
        existing.planned_cardio += w.planned_cardio;
        existing.planned_total_load += w.planned_total_load;
        existing.planned_miles =
          Math.round((existing.planned_miles + w.planned_miles) * 10) / 10;
        existing.long_run_mi = Math.max(existing.long_run_mi, w.long_run_mi);
      }
    }
    for (const d of sub.daily) {
      taggedDaily.push({
        sourceEntryIndex: sub.entryIndex,
        sourceEntryLabel: sub.label,
        row: d,
      });
    }
  }
  // Gap-fill: if any campaign week is NOT covered by an entry (interior
  // gap between non-adjacent entries), pull that week's rows from the
  // projected single-track fallback so the calendar stays continuous.
  // Skip this for legacy blocks-mode configs (entries === null) — the
  // per-entry path already returns the full single-track plan there.
  if (Array.isArray(config.entries)) {
    const fallback = generatePlanFromConfig(config);
    for (const w of fallback.weekly) {
      if (!coveredWeeks.has(w.week)) {
        weeklyByWeek.set(w.week, { ...w });
      }
    }
    for (const d of fallback.daily) {
      if (!coveredWeeks.has(d.week)) {
        taggedDaily.push({
          sourceEntryIndex: 0,
          sourceEntryLabel: null,
          row: d,
        });
      }
    }
  }
  const weekly = [...weeklyByWeek.values()].sort((a, b) => a.week - b.week);
  return { weekly, taggedDaily };
}

// ===========================================================================
// Pre-built plan template library. See ./templates.ts for the
// PLAN_TEMPLATES registry, the StarterShortcut definitions, and the
// deterministic expand(weeks) -> PhaseBlock[] helpers.
// ===========================================================================
export {
  PLAN_TEMPLATES,
  ARCHIVED_PLAN_TEMPLATES,
  STARTER_SHORTCUTS,
  getTemplateById,
  isArchivedTemplateId,
  resolveTemplateId,
  TEMPLATE_ID_ALIASES,
  templateRaceKind,
  templateRaceKindById,
  entriesEndOnMarathonRace,
  entriesRaceKind,
  RACE_DAY_SPECS,
  RACE_EVE_SAT_SPEC,
  buildRaceDaySunRow,
  buildRaceEveSatRow,
  expandEntriesToBlocks,
  expandEntriesToBlocksWithGaps,
  projectEntries,
  liftPrimaryKind,
  LIFT_PRIMARY_STARTERS,
  DEFAULT_LIFT_PRIMARY_STARTER,
  getLiftPrimaryStarter,
  type LiftPrimaryStarter,
  type LiftPrimaryStarterKind,
  primaryMachineKind,
  hybridMixSpec,
  hybridPhase,
  hybridTaperWeeks,
  expandCustomHybrid,
  HYBRID_TAPER_WEEK_OPTIONS,
  HYBRID_POSITION_LABEL,
  HYBRID_POSITION_BLURB,
  HYBRID_POSITIONS_ORDERED,
  HYBRID_DEFAULT_DAYS_PER_WEEK,
  HYBRID_MIN_DAYS_PER_WEEK,
  HYBRID_MAX_DAYS_PER_WEEK,
  type PlanTemplate,
  type PlanTemplateLevel,
  type PlanTemplateMetadata,
  type StarterShortcut,
  type StarterShortcutStyle,
  type TemplateEntry,
  type EntryProjection,
  type PrimaryMachineKind,
  type HybridMixPosition,
  type HybridMixSpec,
  type HybridFitnessLevel,
  type HybridPhase,
  type PlanRaceKind,
} from "./templates.js";
export { detectRaceKind, type RaceDayKind } from "./race-day.js";

// Task #244. Default stacked planner config used by fresh installs (no
// applied config row in `planner_configs` yet). The CLI seed script and
// the in-app /plan/full-reset route both share this so a brand-new
// install AND a reset-with-no-applied-config land on the same Tonal-
// first 8-week non-running default — instead of the legacy 52-week
// canonical campaign — keeping the task #244 contract that the active
// config name drives every header.
export const DEFAULT_SEED_CONFIG_NAME = "Tonal Upper 8wk";
export const DEFAULT_SEED_CONFIG_WEEKS = 8;
export const DEFAULT_SEED_CONFIG_TEMPLATE_ID = "tonal_strength_upper";

function computeNextMondayISO(now: Date = new Date()): string {
  const utcMidnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const todayDow = new Date(utcMidnight).getUTCDay(); // 0=Sun..6=Sat
  const daysUntilMonday = todayDow === 1 ? 0 : (8 - todayDow) % 7 || 7;
  return new Date(utcMidnight + daysUntilMonday * 86400000)
    .toISOString()
    .slice(0, 10);
}

export interface DefaultSeedConfig {
  name: string;
  config: PlannerConfig;
}

// Build the default stacked planner config a fresh install lands on.
// Anchored on the next Monday so the campaign starts on the canonical
// Mon→Sun week boundary the rest of the planner assumes. The
// `entries`-mode payload deliberately avoids triggering the legacy
// MARATHON_TAIL auto-pin so the default plan stays a pure lift block.
export function buildDefaultSeedConfig(now?: Date): DefaultSeedConfig {
  const startDate = computeNextMondayISO(now);
  const startMs = Date.parse(`${startDate}T00:00:00Z`);
  const marathonDate = new Date(
    startMs + (DEFAULT_SEED_CONFIG_WEEKS * 7 - 1) * 86400000,
  )
    .toISOString()
    .slice(0, 10);
  const config: PlannerConfig = {
    startDate,
    marathonDate,
    blocks: [],
    entries: [
      { templateId: DEFAULT_SEED_CONFIG_TEMPLATE_ID, weeks: DEFAULT_SEED_CONFIG_WEEKS },
    ],
  };
  return { name: DEFAULT_SEED_CONFIG_NAME, config };
}
// Note: previewHybridWeek + HybridPreview* types are exported inline
// at their declaration site above (line ~1557). They live here in
// index.ts (not templates.ts) because they reuse pickHybridSchedule
// and hybridMileage which depend on the full DailyRow build pipeline.
