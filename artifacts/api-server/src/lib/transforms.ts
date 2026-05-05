import type { PlanDayRow } from "@workspace/db";
import type { PlanWeekRow } from "@workspace/db";
import type { WorkoutRow } from "@workspace/db";
import type { MeasurementRow } from "@workspace/db";
import type { PersonalizedRacePace } from "./personalized-race-pace";

// Normalize a possibly-NULL or possibly-empty equipment_list to a
// guaranteed non-empty `[scalar]` fallback. Both NULL (the column was
// never backfilled) and `[]` (a degenerate write that somehow slipped
// past validation) need the same treatment so the chip rail always has at
// least one element to render.
export function normalizeEquipmentList(
  list: string[] | null | undefined,
  scalar: string,
): string[] {
  return list && list.length > 0 ? list : [scalar];
}

// Compare each mutable field against its seed_* snapshot. The snapshot is
// only populated once a row has actually been edited (or swapped), so a row
// that has never been touched returns an empty diff and reports as
// non-customized. Once the snapshot exists, every mutable column is mirrored
// into seed_* (see ensureSeedSnapshot in routes/plan.ts), so equality
// checks below are well-defined for every field.
// Public diff entry for the "Edited" badge popover. `before` is the seeded
// value at the time the row was first edited; `after` is the current value.
// Both are stringified so the wire format is uniform across mixed types
// (numbers, strings, booleans, arrays). The UI applies its own formatting
// per field name.
export type PlanDayDiffEntry = {
  field: string;
  before: string | null;
  after: string | null;
};

function stringifyDiffValue(v: unknown): string | null {
  if (v == null) return null;
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

function planDayCustomizedFields(r: PlanDayRow): string[] {
  if (r.seedSessionType == null) return [];
  const fields: string[] = [];
  if (r.sessionType !== r.seedSessionType) fields.push("sessionType");
  if (r.equipment !== r.seedEquipment) fields.push("equipment");
  // The chip rail is generator-owned and replaced wholesale on edit, so
  // structural equality (JSON) is the right comparison here. Both sides are
  // normalized through the same `[scalar]` fallback the API exposes via
  // `toPlanDay` (treating NULL *and* empty arrays as "no rail recorded
  // yet") so a legacy NULL list on either the live row or the seed
  // snapshot doesn't get falsely flagged as customized just because one
  // side has been backfilled and the other hasn't.
  const liveList = normalizeEquipmentList(r.equipmentList, r.equipment);
  const seedList = normalizeEquipmentList(
    r.seedEquipmentList,
    r.seedEquipment ?? r.equipment,
  );
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

// Build the before/after diff array consumed by the "Edited" badge popover
// in week-detail.tsx. Mirrors planDayCustomizedFields above and stays in
// lock-step with it: every field that shows up in `customizedFields` also
// has an entry here with its seeded `before` and current `after` value.
function planDayCustomizedDiff(r: PlanDayRow): PlanDayDiffEntry[] {
  const fields = planDayCustomizedFields(r);
  if (fields.length === 0) return [];
  const liveList = normalizeEquipmentList(r.equipmentList, r.equipment);
  const seedList = normalizeEquipmentList(
    r.seedEquipmentList,
    r.seedEquipment ?? r.equipment,
  );
  const lookup: Record<string, { before: unknown; after: unknown }> = {
    sessionType: { before: r.seedSessionType, after: r.sessionType },
    equipment: { before: r.seedEquipment, after: r.equipment },
    equipmentList: { before: seedList, after: liveList },
    description: { before: r.seedDescription, after: r.description },
    distanceMi: { before: r.seedDistanceMi, after: r.distanceMi },
    strengthMin: { before: r.seedStrengthMin, after: r.strengthMin },
    cardioMin: { before: r.seedCardioMin, after: r.cardioMin },
    runMin: { before: r.seedRunMin, after: r.runMin },
    pace: { before: r.seedPace, after: r.pace },
    strengthLoad: { before: r.seedStrengthLoad, after: r.strengthLoad },
    totalLoad: { before: r.seedTotalLoad, after: r.totalLoad },
    isRest: { before: r.seedIsRest, after: r.isRest },
  };
  return fields.map((field) => {
    const pair = lookup[field];
    return {
      field,
      before: stringifyDiffValue(pair?.before),
      after: stringifyDiffValue(pair?.after),
    };
  });
}

export function toPlanDay(
  r: PlanDayRow,
  extras?: { personalizedRacePace?: PersonalizedRacePace | null },
) {
  const customizedFields = planDayCustomizedFields(r);
  const customizedDiff = planDayCustomizedDiff(r);
  return {
    id: r.id,
    week: r.week,
    phase: r.phase,
    date: r.date,
    day: r.day,
    strengthLoad: r.strengthLoad,
    equipment: r.equipment,
    // Ordered chip rail of every machine the runner will use that day.
    // Falls back to a single-element list of the scalar `equipment` for
    // both NULL and empty arrays so the UI can always render at least one
    // chip even on rows that predate the task #77 backfill or that
    // somehow ended up with an empty array in the DB.
    equipmentList: normalizeEquipmentList(r.equipmentList, r.equipment),
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
    customizedDiff,
    // Task #135: program attribution. `sourceEntryIndex` identifies
    // which TemplateEntry within the active planner config produced
    // this row (0 for legacy single-program campaigns); `sourceEntryLabel`
    // is the human-readable program name shown as a badge in /today and
    // /plan when concurrent programs are running.
    sourceEntryIndex: r.sourceEntryIndex,
    sourceEntryLabel: r.sourceEntryLabel,
    // Task #228: personalized race-day pace. Populated only on race-day
    // Sun rows that the route layer recognised as a real race
    // (`detectRaceKind` returned a non-null kind); null on every other
    // day so the UI can render the explainer chip exclusively on the
    // race-day card. The route layer is responsible for computing this
    // — `toPlanDay` is intentionally row-pure and just passes through
    // the value its caller hands in.
    personalizedRacePace: extras?.personalizedRacePace ?? null,
  };
}

export function toPlanWeek(
  r: PlanWeekRow,
  extras?: {
    actualMiles?: number;
    actualCardio?: number;
    completedSessions?: number;
    totalSessions?: number;
    missedSessions?: number;
    customizedDays?: number;
    dominantCardioEquipment?: string | null;
    // Task #175: true when the Wednesday plan_day for this week is a
    // Steady (Z3) Run + Accessory session. Sourced from plan_days
    // server-side so customizations that swap Wed away from steady are
    // reflected on the calendar chip. Null when no Wed plan_day exists
    // yet (legacy / freshly seeded weeks).
    wedSteady?: boolean | null;
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
    actualCardio: extras?.actualCardio ?? null,
    completedSessions: extras?.completedSessions ?? null,
    totalSessions: extras?.totalSessions ?? null,
    missedSessions: extras?.missedSessions ?? null,
    customizedDays: extras?.customizedDays ?? null,
    dominantCardioEquipment: extras?.dominantCardioEquipment ?? null,
    wedSteady: extras?.wedSteady ?? null,
  };
}

// Subset of the matched plan day used to render the Training Log's
// prescribed run target line (Task #140). The /workouts list route does
// the join so the per-row UI doesn't need to refetch each plan day; on
// rows with no `planDayId` (quick-logged Lifestyle activities, off-plan
// runs) or where the referenced plan day no longer exists, the caller
// passes `undefined` and we serialize `prescribedRunTarget: null`.
export interface PrescribedRunTargetSource {
  sessionType: string;
  week: number;
  runMin: number | null;
  distanceMi: number | null;
  pace: string | null;
}

export function toWorkout(
  r: WorkoutRow,
  prescribed?: PrescribedRunTargetSource | null,
) {
  return {
    id: r.id,
    planDayId: r.planDayId,
    date: r.date,
    equipment: r.equipment,
    // Ordered chip rail of every machine the runner actually used in this
    // logged session (task #78). Mirrors the same NULL/empty -> [scalar]
    // fallback `toPlanDay` uses for the prescribed plan day so the
    // logged-session UI (today.tsx "Mission Accomplished" card and
    // log.tsx per-row chip column) can always render at least one chip
    // even on rows logged before the equipment_list column existed (or
    // before the post-merge backfill ran). The lead chip is guaranteed to
    // equal the scalar `equipment` above by the POST/PATCH validation in
    // routes/workouts.ts, so any back-compat code path that still reads
    // the scalar agrees with the rail's first chip.
    equipmentList: normalizeEquipmentList(r.equipmentList, r.equipment),
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
    // Task #140: snapshot of the matched plan day's prescribed run
    // target so the /log table can render the user's chosen target line
    // (effort / intervals / HR zone / pace) next to the actual results.
    // Null when the workout has no plan day join (quick-logged Lifestyle
    // activity, off-plan run) or when the referenced plan day is gone.
    prescribedRunTarget: prescribed
      ? {
          sessionType: prescribed.sessionType,
          week: prescribed.week,
          runMin: prescribed.runMin,
          distanceMi: prescribed.distanceMi,
          pace: prescribed.pace,
        }
      : null,
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
