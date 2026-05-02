import type { PlanDayRow } from "@workspace/db";
import type { PlanWeekRow } from "@workspace/db";
import type { WorkoutRow } from "@workspace/db";
import type { MeasurementRow } from "@workspace/db";

// Compare each mutable field against its seed_* snapshot. The snapshot is
// only populated once a row has actually been edited (or swapped), so a row
// that has never been touched returns an empty diff and reports as
// non-customized. Once the snapshot exists, every mutable column is mirrored
// into seed_* (see ensureSeedSnapshot in routes/plan.ts), so equality
// checks below are well-defined for every field.
function planDayCustomizedFields(r: PlanDayRow): string[] {
  if (r.seedSessionType == null) return [];
  const fields: string[] = [];
  if (r.sessionType !== r.seedSessionType) fields.push("sessionType");
  if (r.equipment !== r.seedEquipment) fields.push("equipment");
  // The chip rail is generator-owned and replaced wholesale on edit, so
  // structural equality (JSON) is the right comparison here. Both sides are
  // normalized through the same `?? [scalar]` fallback the API exposes via
  // `toPlanDay` so a legacy NULL list on either the live row or the seed
  // snapshot doesn't get falsely flagged as customized just because one
  // side has been backfilled and the other hasn't.
  const liveList = r.equipmentList ?? [r.equipment];
  const seedList = r.seedEquipmentList ?? [r.seedEquipment ?? r.equipment];
  if (JSON.stringify(liveList) !== JSON.stringify(seedList)) {
    fields.push("equipmentList");
  }
  if (r.description !== r.seedDescription) fields.push("description");
  if (r.distanceMi !== r.seedDistanceMi) fields.push("distanceMi");
  if (r.strengthMin !== r.seedStrengthMin) fields.push("strengthMin");
  if (r.cardioMin !== r.seedCardioMin) fields.push("cardioMin");
  if (r.runMin !== r.seedRunMin) fields.push("runMin");
  if (r.pace !== r.seedPace) fields.push("pace");
  if (r.strengthLoad !== r.seedStrengthLoad) fields.push("strengthLoad");
  if (r.totalLoad !== r.seedTotalLoad) fields.push("totalLoad");
  if (r.isRest !== r.seedIsRest) fields.push("isRest");
  return fields;
}

// Sum the three minute buckets. Returns `null` when ALL three are null —
// that's the "ambiguous legacy row the backfill couldn't classify"
// signal, and we want the UI to render nothing rather than a misleading
// "0 min" total. As soon as ANY bucket has a concrete value (including
// 0), we sum and treat the remaining nulls as zero.
export function computeTotalMin(r: {
  strengthMin: number | null;
  cardioMin: number | null;
  runMin: number | null;
}): number | null {
  if (r.strengthMin == null && r.cardioMin == null && r.runMin == null) {
    return null;
  }
  return (r.strengthMin ?? 0) + (r.cardioMin ?? 0) + (r.runMin ?? 0);
}

export function toPlanDay(r: PlanDayRow) {
  const customizedFields = planDayCustomizedFields(r);
  return {
    id: r.id,
    week: r.week,
    phase: r.phase,
    date: r.date,
    day: r.day,
    strengthLoad: r.strengthLoad,
    equipment: r.equipment,
    // Ordered chip rail of every machine the runner will use that day.
    // Falls back to a single-element list of the scalar `equipment` so the
    // UI can always render at least one chip even on rows that predate the
    // task #77 backfill (equipment_list is nullable in the DB).
    equipmentList: r.equipmentList ?? [r.equipment],
    description: r.description,
    strengthMin: r.strengthMin,
    cardioMin: r.cardioMin,
    runMin: r.runMin,
    totalMin: computeTotalMin(r),
    distanceMi: r.distanceMi,
    pace: r.pace,
    sessionType: r.sessionType,
    isRest: r.isRest,
    totalLoad: r.totalLoad,
    isCustomized: customizedFields.length > 0,
    customizedFields,
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
    // Per-bucket actual minutes mirroring the plan day breakdown so the
    // /today and /plan/:week pages can render plan-vs-actual per bucket.
    // `totalMin` is server-computed (same helper as toPlanDay) so a row
    // where the user only filled in some buckets still gets a consistent
    // total — and a row with no breakdown at all (legacy `durationMin`-only
    // entries) returns null so the UI can fall back gracefully instead of
    // misreporting "0 min".
    strengthMin: r.strengthMin,
    cardioMin: r.cardioMin,
    runMin: r.runMin,
    totalMin: computeTotalMin(r),
    distanceMi: r.distanceMi,
    pace: r.pace,
    avgHr: r.avgHr,
    rpe: r.rpe,
    strengthLoad: r.strengthLoad,
    totalLoad: r.totalLoad,
    notes: r.notes,
    timeOfDay: r.timeOfDay,
    modality: r.modality,
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
