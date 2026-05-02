import type { PlanDayRow } from "@workspace/db";
import type { PlanWeekRow } from "@workspace/db";
import type { WorkoutRow } from "@workspace/db";
import type { MeasurementRow } from "@workspace/db";

export function toPlanDay(r: PlanDayRow) {
  return {
    id: r.id,
    week: r.week,
    phase: r.phase,
    date: r.date,
    day: r.day,
    strengthLoad: r.strengthLoad,
    equipment: r.equipment,
    description: r.description,
    cardioMin: r.cardioMin,
    distanceMi: r.distanceMi,
    pace: r.pace,
    sessionType: r.sessionType,
    isRest: r.isRest,
    totalLoad: r.totalLoad,
  };
}

export function toPlanWeek(
  r: PlanWeekRow,
  extras?: {
    actualMiles?: number;
    completedSessions?: number;
    totalSessions?: number;
    missedSessions?: number;
  },
) {
  return {
    week: r.week,
    phase: r.phase,
    startDate: r.startDate,
    endDate: r.endDate,
    plannedStrength: r.plannedStrength,
    plannedCardio: r.plannedCardio,
    plannedTotalLoad: r.plannedTotalLoad,
    plannedMiles: r.plannedMiles,
    longRunMi: r.longRunMi,
    actualMiles: extras?.actualMiles ?? null,
    completedSessions: extras?.completedSessions ?? null,
    totalSessions: extras?.totalSessions ?? null,
    missedSessions: extras?.missedSessions ?? null,
  };
}

export function toWorkout(r: WorkoutRow) {
  return {
    id: r.id,
    planDayId: r.planDayId,
    date: r.date,
    equipment: r.equipment,
    sessionType: r.sessionType,
    durationMin: r.durationMin,
    distanceMi: r.distanceMi,
    pace: r.pace,
    avgHr: r.avgHr,
    rpe: r.rpe,
    strengthLoad: r.strengthLoad,
    totalLoad: r.totalLoad,
    notes: r.notes,
    timeOfDay: r.timeOfDay,
    createdAt: r.createdAt.toISOString(),
  };
}

export function toMeasurement(r: MeasurementRow) {
  return {
    id: r.id,
    date: r.date,
    weight: r.weight,
    lArm: r.lArm,
    rArm: r.rArm,
    lLeg: r.lLeg,
    rLeg: r.rLeg,
    belly: r.belly,
    chest: r.chest,
    notes: r.notes,
    createdAt: r.createdAt.toISOString(),
  };
}
