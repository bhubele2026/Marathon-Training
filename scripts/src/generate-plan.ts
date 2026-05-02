import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type DailyRow = {
  week: number;
  phase: string;
  date: string;
  day: string;
  strength_load: number | null;
  equipment: string;
  description: string;
  cardio_min: number | null;
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

    // ---------- MON: REST ----------
    const monDay: DailyRow = {
      week: w,
      phase,
      date: fmt(wkStart),
      day: "Mon",
      strength_load: 0,
      equipment: "Off / Rest",
      description: "Full rest day. Optional 20 min walk, foam roll, mobility, hydrate.",
      cardio_min: 0,
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
      description: isCutback
        ? `Heavy upper-body Tonal (${heavyTonalMin} min, push/pull/core), then ${shortCardioMin} min easy Peloton Bike spin to flush legs`
        : `Heavy upper-body Tonal (${heavyTonalMin} min, push/pull at 80-85% effort), then ${shortCardioMin} min easy Peloton Bike spin`,
      cardio_min: shortCardioMin,
      distance_mi: null,
      pace: null,
      session_type: "Strength + Cardio",
      is_rest: false,
      total_load: heavyStrengthLoad + shortCardioMin,
    };

    // ---------- WED: EASY RUN + LIGHT TONAL ACCESSORY ----------
    const wedDist = easyRunDist(w, isCutback);
    const wedRunMin = Math.max(20, Math.round(wedDist * (w <= 6 ? 16 : w <= 18 ? 13 : 12)));
    const wedAccessoryMin = isCutback ? 20 : 25;
    const wedAccessoryLoad = isCutback ? 20 : 25;
    const wedDay: DailyRow = {
      week: w,
      phase,
      date: fmt(addDays(wkStart, 2)),
      day: "Wed",
      strength_load: wedAccessoryLoad,
      equipment: "Peloton Tread",
      description: isCutback
        ? `Easy aerobic Tread run (${wedDist} mi, conversational), then ${wedAccessoryMin} min light Tonal core + mobility`
        : `Easy aerobic Tread run (${wedDist} mi, fully conversational pace), then ${wedAccessoryMin} min Tonal core + accessory work (no heavy lifting)`,
      cardio_min: wedRunMin,
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
      description: isCutback
        ? `Heavy lower-body Tonal (${heavyTonalMin} min, squat/hinge/lunge), then ${shortCardioMin} min steady Peloton Row`
        : `Heavy lower-body Tonal (${heavyTonalMin} min, squat/hinge/lunge at 80-85% effort), then ${shortCardioMin} min steady Peloton Row`,
      cardio_min: shortCardioMin,
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
    let friLiftDesc: string;

    if (w <= 6) {
      friType = "Aerobic Base";
      friDesc = `Easy aerobic Tread run (${friDist} mi), build durability`;
      friPace = easyPace;
      friLiftLoad = isCutback ? 18 : 22;
      friLiftDesc = ` + ${isCutback ? 20 : 25} min Tonal core + mobility`;
    } else if (w <= 18) {
      friType = isCutback ? "Aerobic Base" : "Tempo Run";
      friDesc = isCutback
        ? `Easy recovery Tread run (${friDist} mi)`
        : `Tread tempo (${friDist} mi: 5 min easy, ${Math.max(10, friDist * 4)} min steady tempo, 5 min cool-down)`;
      friPace = isCutback ? easyPace : tempoPace;
      friLiftLoad = 0;
      friLiftDesc = " — no lift today, recover for the long run";
    } else if (w <= 32) {
      friType = isCutback ? "Aerobic Base" : "Threshold Intervals";
      friDesc = isCutback
        ? `Easy recovery Tread run (${friDist} mi)`
        : `Tread threshold (${friDist} mi: warm-up, then 4 x 800m at threshold w/ 90s jog recovery, cool-down)`;
      friPace = isCutback ? easyPace : tempoPace;
      friLiftLoad = 0;
      friLiftDesc = " — no lift today, recover for the long run";
    } else if (w <= 46) {
      friType = isCutback ? "Aerobic Base" : "Race-Pace Workout";
      friDesc = isCutback
        ? `Easy recovery Tread run (${friDist} mi)`
        : `Tread race-pace (${friDist} mi: warm-up, 3 x 1 mi at goal half-marathon pace w/ 2 min recovery, cool-down)`;
      friPace = isCutback ? easyPace : tempoPace;
      friLiftLoad = 0;
      friLiftDesc = " — no lift today, recover for the long run";
    } else if (w <= 49) {
      friType = "Tempo Run";
      friDesc = `Tread sharpener (${friDist} mi: 10 min easy, 15-20 min steady tempo, 5 min cool-down)`;
      friPace = tempoPace;
      friLiftLoad = 0;
      friLiftDesc = " — no lift today";
    } else if (w === 50) {
      friType = "Tempo Run";
      friDesc = `Tread taper tempo (${friDist} mi: 10 min easy, 12 min tempo, 5 min cool-down)`;
      friPace = tempoPace;
      friLiftLoad = 0;
      friLiftDesc = " — no lift today";
    } else if (w === 51) {
      friType = "Sharpener";
      friDesc = `Easy Tread run (${friDist} mi) with 4 x 30s strides in the final mile`;
      friPace = easyPace;
      friLiftLoad = 0;
      friLiftDesc = " — no lift today";
    } else {
      friType = "Race Shakeout";
      friDesc = `Easy Tread shakeout (${friDist} mi) with 3 x 30s strides`;
      friPace = easyPace;
      friLiftLoad = 0;
      friLiftDesc = " — no lift today, race tomorrow";
    }
    const friRunMin = Math.max(20, Math.round(friDist * (w <= 6 ? 16 : w <= 18 ? 13 : w <= 32 ? 12 : 11.5)));
    const friDay: DailyRow = {
      week: w,
      phase,
      date: fmt(addDays(wkStart, 4)),
      day: "Fri",
      strength_load: friLiftLoad,
      equipment: "Peloton Tread",
      description: friDesc + friLiftDesc,
      cardio_min: friRunMin,
      distance_mi: friDist,
      pace: friPace,
      session_type: friLiftLoad > 0 ? `${friType} + Accessory` : friType,
      is_rest: false,
      total_load: friRunMin + friLiftLoad,
    };

    // ---------- SAT: HEAVY LIFT + SHORT BIKE/ROW (alternate) ----------
    const satCardioEquip = w % 2 === 0 ? "Peloton Row" : "Peloton Bike";
    const satCardioName = w % 2 === 0 ? "Peloton Row" : "Peloton Bike";
    const satCardioVerb = w % 2 === 0 ? "steady row" : "steady bike";
    const satDay: DailyRow = {
      week: w,
      phase,
      date: fmt(addDays(wkStart, 5)),
      day: "Sat",
      strength_load: heavyStrengthLoad,
      equipment: "Tonal",
      description: isRaceWeek
        ? `Race-eve: light Tonal mobility (15 min) + 15 min easy ${satCardioName} spin. Stay loose, hydrate, fuel well.`
        : isCutback
        ? `Heavy full-body Tonal (${heavyTonalMin} min, mixed push/pull/squat), then ${shortCardioMin} min ${satCardioVerb}`
        : `Heavy full-body Tonal (${heavyTonalMin} min, mixed push/pull/squat at 80-85% effort), then ${shortCardioMin} min ${satCardioVerb} on ${satCardioName}`,
      cardio_min: isRaceWeek ? 15 : shortCardioMin,
      distance_mi: null,
      pace: null,
      session_type: isRaceWeek ? "Race Prep" : "Strength + Cardio",
      is_rest: false,
      total_load: isRaceWeek ? 30 : heavyStrengthLoad + shortCardioMin,
    };

    // ---------- SUN: LONG RUN (no lift) or RACE ----------
    let sunDay: DailyRow;
    if (isRaceWeek) {
      sunDay = {
        week: w,
        phase,
        date: fmt(addDays(wkStart, 6)),
        day: "Sun",
        strength_load: 0,
        equipment: "Outdoor",
        description:
          "RACE DAY — Half Marathon (13.1 mi). Execute race plan, fuel every 4 mi, finish strong.",
        cardio_min: Math.round(13.1 * 12),
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
        description: longDesc,
        cardio_min: longMin,
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

export function writePlanJson(): string {
  const plan = generatePlan();
  const outPath = resolve(import.meta.dirname, "../../.local/data/plan.json");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(plan));
  return outPath;
}

const isCli = import.meta.url === `file://${process.argv[1]}`;
if (isCli) {
  const outPath = writePlanJson();
  const plan = generatePlan();
  console.log(
    `Wrote ${outPath} — race ${RACE_DATE_ISO}, ${plan.weekly.length} weeks, ${plan.daily.length} days, ${plan.body.length} body rows.`,
  );
}
