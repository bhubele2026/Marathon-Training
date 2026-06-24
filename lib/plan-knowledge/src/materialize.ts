import { DAY_ORDER, addDaysISO, mondayOnOrBefore } from "./dates";
import { planIncludesRunning } from "./guardrails";
import { normalizeSessionBuckets } from "./buckets";
import type { AiPlan, AiStrengthBlock } from "./types";

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
  /** Ordered real strength movements for the day (Phase 1). Null when the day
   * carries no lifting (rest / pure conditioning / pure run). */
  strengthBlocks: AiStrengthBlock[] | null;
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
  /** The start actually used — snapped to the Monday on/before plan.startDate so
   * week 1 aligns to the rest day regardless of what the coach emitted. */
  startDate: string;
  totalWeeks: number;
}

export function materializeAiPlan(plan: AiPlan): MaterializedPlan {
  const days: MaterializedDay[] = [];
  const weekly: MaterializedWeek[] = [];

  // Snap to the Monday on/before so any start date works; cadence stays aligned.
  const startDate = mondayOnOrBefore(plan.startDate);

  for (const week of plan.weeks) {
    const weekStart = addDaysISO(startDate, (week.week - 1) * 7);
    let plannedStrength = 0;
    let plannedCardio = 0;
    let plannedTotalLoad = 0;
    let plannedMiles = 0;
    let longRunMi = 0;

    week.days.forEach((d, i) => {
      const dayIdx = DAY_ORDER.indexOf(d.day) === -1 ? i : DAY_ORDER.indexOf(d.day);
      const date = addDaysISO(startDate, (week.week - 1) * 7 + dayIdx);
      const distanceMi = d.distanceMi ?? null;
      // Bucket the minutes by session type so the plan lines up with how logged
      // workouts are bucketed (a Run/Strength day's minutes never get stranded
      // in cardio). Conservative: only moves minutes out of cardio for a clearly
      // run/strength session whose own bucket is empty.
      const nb = normalizeSessionBuckets(d.sessionType, {
        strengthMin: d.strengthMin,
        cardioMin: d.cardioMin,
        runMin: d.runMin,
      });
      const strengthLoad = nb.strengthMin; // minute-proxy load (AI plans)
      const totalLoad = nb.strengthMin + nb.cardioMin + nb.runMin;
      const equipment = d.equipmentList[0] ?? (d.isRest ? "Off / Rest" : "Tonal");
      const strengthBlocks =
        Array.isArray(d.strengthBlocks) && d.strengthBlocks.length > 0
          ? d.strengthBlocks
          : null;

      days.push({
        week: week.week,
        phase: week.phase,
        date,
        day: d.day,
        isRest: d.isRest,
        sessionType: d.sessionType,
        strengthMin: nb.strengthMin,
        cardioMin: nb.cardioMin,
        runMin: nb.runMin,
        distanceMi,
        pace: d.pace ?? null,
        equipment,
        equipmentList: d.equipmentList,
        description: d.description,
        strengthBlocks,
        strengthLoad,
        totalLoad,
        sourceEntryIndex: 0,
        sourceEntryLabel: null,
      });

      plannedStrength += strengthLoad;
      plannedCardio += nb.cardioMin;
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
    planIncludesRunning(plan) && lastWeek
      ? addDaysISO(startDate, (lastWeek.week - 1) * 7 + 6)
      : null;

  return { weekly, days, marathonDate, startDate, totalWeeks: plan.weeks.length };
}
