// Pure plan-generation logic. Shared between the seeding CLI
// (`@workspace/scripts`) and the API server's "Full Reset" endpoint
// (`@workspace/api-server`). Must stay free of node-only side effects (no
// fs / process / dirname) so it can be imported by browser-adjacent
// bundlers if needed and so the api-server test suite can call it
// directly without spinning up a CLI.

import {
  expandEntriesToBlocksWithGaps,
  getTemplateById,
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

    // ---------- WED: EASY RUN + LIGHT TONAL ACCESSORY ----------
    const wedDist = easyRunDist(w, isCutback);
    const wedRunMin = Math.max(20, Math.round(wedDist * (w <= 6 ? 16 : w <= 18 ? 13 : 12)));
    const wedAccessoryLoad = isCutback ? 20 : 25;
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
      description: isCutback
        ? `Easy aerobic Tread run (${wedDist} mi, conversational), then ${accessoryTonalMin} min light Tonal core + mobility`
        : `Easy aerobic Tread run (${wedDist} mi, fully conversational pace), then ${accessoryTonalMin} min Tonal core + accessory work (no heavy lifting)`,
      strength_min: accessoryTonalMin,
      cardio_min: 0,
      run_min: wedRunMin,
      distance_mi: wedDist,
      pace: easyPace,
      session_type: "Run + Accessory",
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
    const satCardioName = w % 2 === 0 ? "Peloton Row" : "Peloton Bike";
    const satCardioVerb = w % 2 === 0 ? "steady row" : "steady bike";
    // Race week swaps the heavy lift for a 15 min Tonal mobility flush plus a
    // 15 min easy spin; the three-bucket minute breakdown reflects that.
    const satStrengthMin = isRaceWeek ? 15 : heavyTonalMin;
    const satCardioMin = isRaceWeek ? 15 : shortCardioMin;
    const satDay: DailyRow = {
      week: w,
      phase,
      date: fmt(addDays(wkStart, 5)),
      day: "Sat",
      strength_load: heavyStrengthLoad,
      equipment: "Tonal",
      equipment_list: ["Tonal", satCardioName],
      description: isRaceWeek
        ? `Race-eve: light Tonal mobility (${satStrengthMin} min) + ${satCardioMin} min easy ${satCardioName} spin. Stay loose, hydrate, fuel well.`
        : isCutback
        ? `Heavy full-body Tonal (${heavyTonalMin} min, mixed push/pull/squat), then ${shortCardioMin} min ${satCardioVerb}`
        : `Heavy full-body Tonal (${heavyTonalMin} min, mixed push/pull/squat at 80-85% effort), then ${shortCardioMin} min ${satCardioVerb} on ${satCardioName}`,
      strength_min: satStrengthMin,
      cardio_min: satCardioMin,
      run_min: 0,
      distance_mi: null,
      pace: null,
      session_type: isRaceWeek ? "Race Prep" : "Strength + Cardio",
      is_rest: false,
      total_load: isRaceWeek ? 30 : heavyStrengthLoad + shortCardioMin,
    };

    // ---------- SUN: LONG RUN (no lift) or RACE ----------
    let sunDay: DailyRow;
    if (isRaceWeek) {
      const raceMin = Math.round(13.1 * 12);
      sunDay = {
        week: w,
        phase,
        date: fmt(addDays(wkStart, 6)),
        day: "Sun",
        strength_load: 0,
        equipment: "Outdoor",
        equipment_list: ["Outdoor"],
        description:
          "RACE DAY — Half Marathon (13.1 mi). Execute race plan, fuel every 4 mi, finish strong.",
        strength_min: 0,
        cardio_min: 0,
        run_min: raceMin,
        distance_mi: 13.1,
        pace: "12:00",
        session_type: "Race",
        is_rest: false,
        total_load: 260,
      };
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
    // Second pass: per-entry startDate must be a Monday, on or after
    // the running cursor, and (for the first entry) equal to the
    // config startDate. The cursor advances by the entry's weeks; if
    // a later entry sets startDate beyond the cursor that gap is
    // counted as filler weeks toward the totalWeeks invariant.
    const startMs = Date.parse(`${config.startDate}T00:00:00Z`);
    let cursorMs = startMs;
    let gapWeeks = 0;
    for (let i = 0; i < config.entries!.length; i++) {
      const e = config.entries![i]!;
      const overrideRaw = e.startDate;
      if (overrideRaw != null && overrideRaw !== "") {
        if (!ISO_DATE_RE.test(overrideRaw)) {
          issues.push({
            field: `entries[${i}].startDate`,
            message: "must be a yyyy-mm-dd date",
          });
        } else if (!isMonday(overrideRaw)) {
          issues.push({
            field: `entries[${i}].startDate`,
            message: "must be a Monday so the Mon..Sun week pattern lines up",
          });
        } else {
          const eMs = Date.parse(`${overrideRaw}T00:00:00Z`);
          const cursorISO = new Date(cursorMs).toISOString().slice(0, 10);
          if (i === 0 && eMs !== startMs) {
            issues.push({
              field: `entries[0].startDate`,
              message: `first entry's startDate must equal the config startDate (${config.startDate})`,
            });
          } else if (eMs < cursorMs) {
            issues.push({
              field: `entries[${i}].startDate`,
              message: `must be on or after ${cursorISO} (the end of the previous entry); overlapping templates are not allowed`,
            });
          } else {
            const days = Math.round((eMs - cursorMs) / 86400000);
            if (days % 7 !== 0) {
              issues.push({
                field: `entries[${i}].startDate`,
                message: `must be a whole number of weeks (got ${days} days) after ${cursorISO}`,
              });
            } else {
              gapWeeks += days / 7;
              cursorMs = eMs;
            }
          }
        }
      }
      if (Number.isInteger(e.weeks) && e.weeks >= 1) {
        cursorMs += e.weeks * 7 * 86400000;
      }
    }
    const projectedWeeks = entriesSum + gapWeeks;
    if (projectedWeeks !== totalWeeks) {
      issues.push({
        field: "entries",
        message: `template entry weeks (${entriesSum}) plus ${gapWeeks} gap week(s) total ${projectedWeeks}, but need exactly ${totalWeeks}; each template owns its own taper, so entries (with any gaps) must cover the full plan span — no auto-pinned tail`,
      });
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
  longRunMi(weekInBlock: number, blockWeeks: number, isCutback: boolean): number;
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
    longRunMi: (w, blockWeeks, isCutback) => {
      // Ramp 12 -> 20+ across the block, with cutbacks every 4th week and a
      // 3-week taper at the end (volume drops sharply in the final 3
      // weeks). Last week of the block is race week (handled by caller as
      // 26.2 mi marathon — this fn is not called for the race week).
      const tail = blockWeeks - w; // 0 = race week, 1 = race-eve week, etc.
      if (tail === 0) return MARATHON_DISTANCE_MI;
      if (tail === 1) return r1(8);
      if (tail === 2) return r1(13);
      if (tail === 3) return r1(16);
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
    phaseLabel: (b) => (b.customName?.trim() ? b.customName.trim() : "Custom"),
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

function fridayContent(
  recipe: FocusRecipe,
  block: PhaseBlock,
  weekInBlock: number,
  isCutback: boolean,
  qualityDist: number,
): {
  type: string;
  desc: string;
  pace: string;
  liftMin: number;
  liftLoad: number;
  liftDescSuffix: string;
} {
  const accessory = isCutback
    ? Math.max(15, recipe.accessoryTonalMin - 5)
    : recipe.accessoryTonalMin;
  if (isCutback) {
    return {
      type: "Aerobic Base",
      desc: `Easy recovery Tread run (${qualityDist} mi, conversational)`,
      pace: recipe.easyPace,
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
        pace: recipe.tempoPace,
        liftMin: 0,
        liftLoad: 0,
        liftDescSuffix: " — no lift today, recover for the long run",
      };
    case "Threshold":
      return {
        type: "Threshold Intervals",
        desc: `Tread threshold (${qualityDist} mi: warm-up, then 4 x 800m at threshold w/ 90s jog recovery, cool-down)`,
        pace: recipe.tempoPace,
        liftMin: 0,
        liftLoad: 0,
        liftDescSuffix: " — no lift today, recover for the long run",
      };
    case "RacePace":
      return {
        type: "Race-Pace Workout",
        desc: `Tread marathon-pace (${qualityDist} mi: warm-up, ${Math.max(2, Math.round(qualityDist - 1.5))} mi at goal marathon pace, cool-down)`,
        pace: recipe.tempoPace,
        liftMin: 0,
        liftLoad: 0,
        liftDescSuffix: " — no lift today, recover for the long run",
      };
    case "Sharpener":
      return {
        type: "Sharpener",
        desc: `Easy Tread run (${qualityDist} mi) with 4 x 30s strides in the final mile`,
        pace: recipe.easyPace,
        liftMin: 0,
        liftLoad: 0,
        liftDescSuffix: " — no lift today",
      };
    case "AerobicBase":
    default:
      return {
        type: "Aerobic Base",
        desc: `Easy aerobic Tread run (${qualityDist} mi), build durability`,
        pace: recipe.easyPace,
        liftMin: accessory,
        liftLoad: 22,
        liftDescSuffix: ` + ${accessory} min Tonal core + mobility`,
      };
  }
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
}): DailyRow[] {
  const { weekNumber, weekInBlock, blockWeeks, block, recipe, wkStart, isRaceWeek } = opts;
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

  // ---------- WED: EASY RUN + ACCESSORY ----------
  const wedDist = recipe.easyRunMi(weekInBlock, blockWeeks, isCutback);
  const wedRunMin = Math.max(20, Math.round(wedDist * recipe.easyRunMinPerMi));
  const wedAccessoryLoad = isCutback ? 20 : 25;
  const wedDay: DailyRow = {
    week: weekNumber,
    phase,
    date: fmt(addDays(wkStart, 2)),
    day: "Wed",
    strength_load: wedAccessoryLoad,
    equipment: "Tonal",
    equipment_list: ["Tonal", "Peloton Tread"],
    description:
      `Easy aerobic Tread run (${wedDist} mi, conversational), then ${accessoryTonalMin} min Tonal core + accessory work` +
      customSuffix,
    strength_min: accessoryTonalMin,
    cardio_min: 0,
    run_min: wedRunMin,
    distance_mi: wedDist,
    pace: recipe.easyPace,
    session_type: "Run + Accessory",
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
  const fri = fridayContent(recipe, block, weekInBlock, isCutback, friDist);
  const friRunMin = Math.max(20, Math.round(friDist * recipe.qualityRunMinPerMi));
  const friDay: DailyRow = {
    week: weekNumber,
    phase,
    date: fmt(addDays(wkStart, 4)),
    day: "Fri",
    strength_load: fri.liftLoad,
    equipment: fri.liftMin > 0 ? "Tonal" : "Peloton Tread",
    equipment_list:
      fri.liftMin > 0 ? ["Tonal", "Peloton Tread"] : ["Peloton Tread"],
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
  const satCardioName = weekNumber % 2 === 0 ? "Peloton Row" : "Peloton Bike";
  const satCardioVerb = weekNumber % 2 === 0 ? "steady row" : "steady bike";
  // Race week swaps the heavy lift for a 15-min mobility flush + 15-min spin
  // (mirrors the canonical race-eve pattern).
  const satStrengthMin = isRaceWeek ? 15 : heavyTonalMin;
  const satFinalCardioMin = isRaceWeek ? 15 : satCardioMin;
  const satDay: DailyRow = {
    week: weekNumber,
    phase,
    date: fmt(addDays(wkStart, 5)),
    day: "Sat",
    strength_load: isRaceWeek ? 0 : heavyStrengthLoad,
    equipment: "Tonal",
    equipment_list: ["Tonal", satCardioName],
    description:
      (isRaceWeek
        ? `Race-eve: light Tonal mobility (${satStrengthMin} min) + ${satFinalCardioMin} min easy ${satCardioName} spin. Stay loose, hydrate, fuel well.`
        : isCutback
        ? `Heavy full-body Tonal (${heavyTonalMin} min, mixed push/pull/squat), then ${satCardioMin} min ${satCardioVerb}`
        : `Heavy full-body Tonal (${heavyTonalMin} min, mixed push/pull/squat at 80-85% effort), then ${satCardioMin} min ${satCardioVerb} on ${satCardioName}`) +
      customSuffix,
    strength_min: satStrengthMin,
    cardio_min: satFinalCardioMin,
    run_min: 0,
    distance_mi: null,
    pace: null,
    session_type: isRaceWeek ? "Race Prep" : "Strength + Cardio",
    is_rest: false,
    total_load: isRaceWeek ? 30 : heavyStrengthLoad + satCardioMin,
  };

  // ---------- SUN: LONG RUN or RACE ----------
  let sunDay: DailyRow;
  if (isRaceWeek) {
    const raceMin = Math.round(MARATHON_DISTANCE_MI * 11);
    sunDay = {
      week: weekNumber,
      phase,
      date: fmt(addDays(wkStart, 6)),
      day: "Sun",
      strength_load: 0,
      equipment: "Outdoor",
      equipment_list: ["Outdoor"],
      description:
        "RACE DAY — Marathon (26.2 mi). Execute race plan, fuel every 4 mi, finish strong.",
      strength_min: 0,
      cardio_min: 0,
      run_min: raceMin,
      distance_mi: MARATHON_DISTANCE_MI,
      pace: recipe.tempoPace,
      session_type: "Race",
      is_rest: false,
      total_load: 350,
    };
  } else {
    const longRun = recipe.longRunMi(weekInBlock, blockWeeks, isCutback);
    const longEquipment = weekNumber % 2 === 0 ? "Outdoor" : "Peloton Tread";
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
        `${recipe.longRunVerb} (${longRun} mi): conversational unless noted, dial in fueling. NO lift today.` +
        customSuffix,
      strength_min: 0,
      cardio_min: 0,
      run_min: longMin,
      distance_mi: longRun,
      pace: recipe.longPace,
      session_type: "Long Run",
      is_rest: false,
      total_load: longMin + 10,
    };
  }

  // Recovery focus drops the Friday quality (replace with rest) so the runner
  // gets two rest days during the recovery block.
  if (recipe.isRecovery) {
    return [
      monDay,
      tueDay,
      wedDay,
      thuDay,
      {
        ...friDay,
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
      sunDay,
    ];
  }

  return [monDay, tueDay, wedDay, thuDay, friDay, satDay, sunDay];
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
}

export interface PreviewWeeklyMileageOptions {
  // When true, the trailing 16-week Marathon-Specific block is appended so
  // the preview matches the eventual generated plan. Defaults to true.
  // Pass false in entries-mode (templates own their own taper) — the
  // entries-mode preview helpers below set this automatically.
  appendMarathonTail?: boolean;
}

export function previewWeeklyMileage(
  userBlocks: PhaseBlock[],
  opts: PreviewWeeklyMileageOptions = {},
): WeekMileagePreview[] {
  const appendTail = opts.appendMarathonTail ?? true;
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
    for (let weekInBlock = 1; weekInBlock <= w; weekInBlock++) {
      week += 1;
      const isRaceWeek = week === totalWeeks && appendTail;
      const isCutback = recipe.useCutbacks
        ? w >= 4 && weekInBlock % 4 === 0 && weekInBlock !== w
        : false;
      const easyMi = recipe.easyRunMi(weekInBlock, w, isCutback);
      // Recovery blocks turn Friday into a rest day in `buildWeekDays`, so
      // the actual generated weekly mileage is easy + long only. Mirror
      // that here so the preview matches `planned_miles` exactly.
      const qualityMi = recipe.isRecovery
        ? 0
        : recipe.qualityRunMi(weekInBlock, w, isCutback);
      const longMi = isRaceWeek
        ? MARATHON_DISTANCE_MI
        : recipe.longRunMi(weekInBlock, w, isCutback);
      const totalMi = r1(easyMi + qualityMi + longMi);
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
      });
    }
  });
  return out;
}

export function generatePlanFromConfig(
  config: PlannerConfig,
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

  let weekNumber = 0;
  for (const block of expandedBlocks) {
    const recipe = RECIPES[block.focusType];
    for (let weekInBlock = 1; weekInBlock <= block.weeks; weekInBlock++) {
      weekNumber += 1;
      const wkStart = addDays(startDate, (weekNumber - 1) * 7);
      const wkEnd = addDays(wkStart, 6);
      const isRaceWeek = weekNumber === totalWeeks;
      const days = buildWeekDays({
        weekNumber,
        weekInBlock,
        blockWeeks: block.weeks,
        block,
        recipe,
        wkStart,
        isRaceWeek,
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
// Pre-built plan template library. See ./templates.ts for the
// PLAN_TEMPLATES registry, the StarterShortcut definitions, and the
// deterministic expand(weeks) -> PhaseBlock[] helpers.
// ===========================================================================
export {
  PLAN_TEMPLATES,
  STARTER_SHORTCUTS,
  getTemplateById,
  expandEntriesToBlocks,
  expandEntriesToBlocksWithGaps,
  projectEntries,
  type PlanTemplate,
  type PlanTemplateMetadata,
  type StarterShortcut,
  type TemplateEntry,
  type EntryProjection,
} from "./templates.js";
