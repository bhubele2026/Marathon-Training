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
export const RACE_DATE_ISO = "2027-05-01";
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

    let tueDist: number;
    let thuDist: number;
    if (w <= 2) {
      tueDist = 1.5;
      thuDist = 1.5;
    } else if (w <= 6) {
      tueDist = 2.0;
      thuDist = 2.0;
    } else if (w <= 18) {
      tueDist = 3.0;
      thuDist = 3.0;
    } else if (w <= 32) {
      tueDist = 4.0;
      thuDist = 3.5;
    } else if (w <= 46) {
      tueDist = 4.5;
      thuDist = 4.0;
    } else if (w <= 49) {
      tueDist = 4.0;
      thuDist = 3.5;
    } else if (w === 50) {
      tueDist = 3.0;
      thuDist = 2.5;
    } else if (w === 51) {
      tueDist = 2.5;
      thuDist = 2.0;
    } else {
      tueDist = 2.0;
      thuDist = 2.0;
    }

    if (isCutback) {
      tueDist = Math.round(tueDist * 0.7 * 10) / 10;
      thuDist = Math.round(thuDist * 0.7 * 10) / 10;
    }

    let tueType: string;
    let tueDesc: string;
    if (w <= 6) {
      tueType = "Aerobic Base";
      tueDesc = "Tread: easy continuous run, conversational effort, build aerobic base";
    } else if (w <= 18) {
      tueType = isCutback ? "Aerobic Base" : "Tempo Run";
      tueDesc = isCutback
        ? "Tread: easy recovery run, very conversational"
        : "Tread tempo: 5 min easy, 15 min steady tempo, 5 min cool-down";
    } else if (w <= 32) {
      tueType = isCutback ? "Aerobic Base" : "Threshold Intervals";
      tueDesc = isCutback
        ? "Tread: easy continuous run, recovery focus"
        : "Tread threshold: warm-up, then 4 x 800m at threshold w/ 90s jog recovery, cool-down";
    } else if (w <= 46) {
      tueType = isCutback ? "Aerobic Base" : "Race-Pace Workout";
      tueDesc = isCutback
        ? "Tread: easy continuous run, recovery focus"
        : "Tread: warm-up, then 3 x 1 mi at goal half-marathon pace w/ 2 min recovery, cool-down";
    } else if (w <= 49) {
      tueType = "Tempo Run";
      tueDesc = "Tread sharpener: 10 min easy, 20 min steady tempo, 5 min cool-down";
    } else if (w === 50) {
      tueType = "Tempo Run";
      tueDesc = "Tread taper tempo: 10 min easy, 12 min tempo, 5 min cool-down";
    } else if (w === 51) {
      tueType = "Sharpener";
      tueDesc = "Tread: easy run with 4 x 30s strides in the final mile";
    } else {
      tueType = "Race Shakeout";
      tueDesc = "Tread: easy shakeout run with 3 x 30s strides to keep legs sharp";
    }

    const thuType = "Aerobic Base";
    const thuDesc =
      w <= 6
        ? "Tread: walk/jog intervals, gentle aerobic effort, build durability"
        : "Tread: easy continuous run, hold a fully conversational pace";

    const monMin = isCutback ? 25 : 30;
    const monStrength = isCutback ? 25 : 30;
    const monDay: DailyRow = {
      week: w,
      phase,
      date: fmt(wkStart),
      day: "Mon",
      strength_load: monStrength,
      equipment: "Peloton Bike",
      description: isCutback
        ? "Bike: easy recovery spin, low resistance + 10 min mobility"
        : "Bike: easy recovery spin, low resistance, then 10 min core circuit",
      cardio_min: monMin,
      distance_mi: null,
      pace: null,
      session_type: "Active Recovery",
      is_rest: false,
      total_load: monMin + monStrength,
    };

    const tueMin = Math.max(
      20,
      Math.round(tueDist * (w <= 6 ? 16 : w <= 18 ? 13 : w <= 32 ? 12 : 11.5)),
    );
    const tueLoad =
      tueMin +
      (tueType === "Aerobic Base"
        ? 10
        : tueType === "Sharpener" || tueType === "Race Shakeout"
        ? 12
        : 25);
    const tueDay: DailyRow = {
      week: w,
      phase,
      date: fmt(addDays(wkStart, 1)),
      day: "Tue",
      strength_load: 0,
      equipment: "Peloton Tread",
      description: tueDesc,
      cardio_min: tueMin,
      distance_mi: tueDist,
      pace:
        tueType === "Aerobic Base" || tueType === "Sharpener" || tueType === "Race Shakeout"
          ? easyPace
          : tempoPace,
      session_type: tueType,
      is_rest: false,
      total_load: tueLoad,
    };

    const wedMin = isCutback ? 20 : w <= 18 ? 25 : 30;
    const wedStrength = isCutback ? 20 : w <= 18 ? 25 : 30;
    const wedDay: DailyRow = {
      week: w,
      phase,
      date: fmt(addDays(wkStart, 2)),
      day: "Wed",
      strength_load: wedStrength,
      equipment: "Peloton Row",
      description: isCutback
        ? "Row: steady easy aerobic row + 10 min light upper-body mobility"
        : "Row: steady aerobic row + 10 min upper-body strength circuit (push/pull)",
      cardio_min: wedMin,
      distance_mi: null,
      pace: null,
      session_type: "Cross-Train",
      is_rest: false,
      total_load: wedMin + wedStrength,
    };

    const thuMin = Math.max(15, Math.round(thuDist * (w <= 6 ? 16 : w <= 18 ? 13 : 12)));
    const thuDay: DailyRow = {
      week: w,
      phase,
      date: fmt(addDays(wkStart, 3)),
      day: "Thu",
      strength_load: 0,
      equipment: "Peloton Tread",
      description: thuDesc,
      cardio_min: thuMin,
      distance_mi: thuDist,
      pace: easyPace,
      session_type: thuType,
      is_rest: false,
      total_load: thuMin + 5,
    };

    let friDay: DailyRow;
    const friRest = isCutback || isRaceWeek || w % 3 === 0;
    if (friRest) {
      friDay = {
        week: w,
        phase,
        date: fmt(addDays(wkStart, 4)),
        day: "Fri",
        strength_load: 15,
        equipment: "Off / Mobility",
        description: "Mobility: 20 min foam roll + light stretching, optional easy walk",
        cardio_min: 20,
        distance_mi: null,
        pace: null,
        session_type: "Mobility",
        is_rest: true,
        total_load: 25,
      };
    } else {
      const friMin = w <= 18 ? 30 : 35;
      friDay = {
        week: w,
        phase,
        date: fmt(addDays(wkStart, 4)),
        day: "Fri",
        strength_load: 20,
        equipment: "Peloton Bike",
        description: "Bike: steady endurance ride, moderate resistance, smooth cadence",
        cardio_min: friMin,
        distance_mi: null,
        pace: null,
        session_type: "Cross-Train",
        is_rest: false,
        total_load: friMin + 20,
      };
    }

    let satDay: DailyRow;
    if (isRaceWeek) {
      satDay = {
        week: w,
        phase,
        date: fmt(addDays(wkStart, 5)),
        day: "Sat",
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
      const longEquipment = w % 2 === 0 ? "Tread / Outdoor" : "Peloton Tread";
      const longDesc =
        w <= 6
          ? "Time-on-feet long: easy walk-run intervals, build aerobic durability"
          : w <= 18
          ? "Long aerobic run: conversational pace, focus on time on feet and rhythm"
          : w <= 32
          ? "Steady long run: build endurance, dial in fueling and hydration strategy"
          : w <= 46
          ? "Goal-pace long: 2 mi easy warm-up, then progressive miles at race pace, 1 mi cool-down"
          : w <= 49
          ? "Final long efforts: steady aerobic, dress-rehearse race kit and fueling"
          : w === 50
          ? "Reduced long run: easy controlled effort, no surges, build freshness"
          : "Short taper long: easy effort, focus on feeling fresh for race day";
      const longMin = Math.round(longRun * (w <= 6 ? 16 : w <= 18 ? 14 : w <= 32 ? 13 : 12.5));
      satDay = {
        week: w,
        phase,
        date: fmt(addDays(wkStart, 5)),
        day: "Sat",
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

    const sunDay: DailyRow = {
      week: w,
      phase,
      date: fmt(addDays(wkStart, 6)),
      day: "Sun",
      strength_load: 0,
      equipment: "Off / Mobility",
      description: isRaceWeek
        ? "Post-race recovery: easy walk, hydrate, celebrate the finish"
        : "Rest day: mobility, sleep, optional 20 min easy walk",
      cardio_min: 20,
      distance_mi: null,
      pace: null,
      session_type: "Recovery",
      is_rest: true,
      total_load: 20,
    };

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
