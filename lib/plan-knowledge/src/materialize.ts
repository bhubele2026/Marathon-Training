import { DAY_ORDER, addDaysISO } from "./dates";
import type { AiPlan } from "./types";

// Turn an AiPlan into rows shaped for plan_weeks / plan_days. The server maps
// these straight onto Drizzle columns in the Apply path, so AI-authored plans
// flow through the exact same seeding machinery as engine-generated ones.

export interface MaterializedDay {
  week: number;
  phase: string;
  date: string; // ISO yyyy-mm-dd, computed from startDate
  day: string;
  isRest: boolean;
  sessionType: string;
  strengthMin: number;
  cardioMin: number;
  runMin: number;
  distanceMi: number | null;
  pace: string | null;
  equipment: string; // scalar == equipmentList[0] (the plan_days contract)
  equipmentList: string[];
  description: string;
  strengthLoad: number;
  totalLoad: number;
  sourceEntryIndex: number;
  sourceEntryLabel: string | null;
}

export interface MaterializedWeek {
  week: number;
  phase: string;
  startDate: string;
  endDate: string;
  plannedStrength: number;
  plannedCardio: number;
  plannedTotalLoad: number;
  plannedMiles: number;
  longRunMi: number;
}

export interface MaterializedPlan {
  weekly: MaterializedWeek[];
  days: MaterializedDay[];
  marathonDate: string | null;
  totalWeeks: number;
}

export function materializeAiPlan(plan: AiPlan): MaterializedPlan {
  const days: MaterializedDay[] = [];
  const weekly: MaterializedWeek[] = [];

  for (const week of plan.weeks) {
    const weekStart = addDaysISO(plan.startDate, (week.week - 1) * 7);
    let plannedStrength = 0;
    let plannedCardio = 0;
    let plannedTotalLoad = 0;
    let plannedMiles = 0;
    let longRunMi = 0;

    week.days.forEach((d, i) => {
      const dayIdx = DAY_ORDER.indexOf(d.day) === -1 ? i : DAY_ORDER.indexOf(d.day);
      const date = addDaysISO(plan.startDate, (week.week - 1) * 7 + dayIdx);
      const distanceMi = d.distanceMi ?? null;
      const strengthLoad = d.strengthMin; // minute-proxy load (AI plans)
      const totalLoad = d.strengthMin + d.cardioMin + d.runMin;
      const equipment = d.equipmentList[0] ?? (d.isRest ? "Off / Rest" : "Tonal");

      days.push({
        week: week.week,
        phase: week.phase,
        date,
        day: d.day,
        isRest: d.isRest,
        sessionType: d.sessionType,
        strengthMin: d.strengthMin,
        cardioMin: d.cardioMin,
        runMin: d.runMin,
        distanceMi,
        pace: d.pace ?? null,
        equipment,
        equipmentList: d.equipmentList,
        description: d.description,
        strengthLoad,
        totalLoad,
        sourceEntryIndex: 0,
        sourceEntryLabel: null,
      });

      plannedStrength += strengthLoad;
      plannedCardio += d.cardioMin;
      plannedTotalLoad += totalLoad;
      if (distanceMi) {
        plannedMiles += distanceMi;
        if (distanceMi > longRunMi) longRunMi = distanceMi;
      }
    });

    weekly.push({
      week: week.week,
      phase: week.phase,
      startDate: weekStart,
      endDate: addDaysISO(weekStart, 6),
      plannedStrength,
      plannedCardio,
      plannedTotalLoad,
      plannedMiles,
      longRunMi,
    });
  }

  const lastWeek = plan.weeks[plan.weeks.length - 1];
  const marathonDate =
    plan.raceKind !== "none" && lastWeek
      ? addDaysISO(plan.startDate, (lastWeek.week - 1) * 7 + 6)
      : null;

  return { weekly, days, marathonDate, totalWeeks: plan.weeks.length };
}
