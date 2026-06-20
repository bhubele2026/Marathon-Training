import { Router, type IRouter } from "express";
import {
  db,
  workoutsTable,
  planDaysTable,
  measurementsTable,
  nutritionDaysTable,
  userPreferencesTable,
} from "@workspace/db";
import { and, asc, desc, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import {
  summarizeConsistency,
  summarizeMachineMix,
  summarizeRecomp,
  type TrainingRow,
} from "../lib/dashboard-tracking";
import { summarizeFood, type FoodDay } from "../lib/week-review";

const router: IRouter = Router();

// GET /api/dashboard/tracking?days=28 — the dashboard "keep track" hub:
// recomp progress, training consistency, nutrition adherence, machine mix over
// a rolling window. Hand-fetched on the client (not in openapi.yaml), matching
// the nutrition / coach / week-review convention.

function windowDates(days: number): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  const from = new Date(now.getTime() - days * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return { from, to };
}

router.get("/dashboard/tracking", async (req, res): Promise<void> => {
  const rawDays = Number(req.query.days);
  const days = Number.isFinite(rawDays)
    ? Math.min(180, Math.max(7, Math.round(rawDays)))
    : 28;
  const { from, to } = windowDates(days);

  // Preferences: goals + nutrition targets.
  const prefsRows = await db
    .select({
      goalWeightLb: userPreferencesTable.goalWeightLb,
      strengthCurrent: userPreferencesTable.strengthScoreCurrent,
      strengthGoal: userPreferencesTable.strengthScoreGoal,
      calorieTarget: userPreferencesTable.calorieTarget,
      proteinTargetG: userPreferencesTable.proteinTargetG,
      carbsTargetG: userPreferencesTable.carbsTargetG,
      fatTargetG: userPreferencesTable.fatTargetG,
    })
    .from(userPreferencesTable)
    .where(eq(userPreferencesTable.id, 1))
    .limit(1);
  const prefs = prefsRows[0];

  // Weight: latest overall = "current"; earliest in window = "start".
  const latestWeight = await db
    .select({ weight: measurementsTable.weight })
    .from(measurementsTable)
    .where(isNotNull(measurementsTable.weight))
    .orderBy(desc(measurementsTable.date))
    .limit(1);
  const startWeight = await db
    .select({ weight: measurementsTable.weight })
    .from(measurementsTable)
    .where(
      and(isNotNull(measurementsTable.weight), gte(measurementsTable.date, from)),
    )
    .orderBy(asc(measurementsTable.date))
    .limit(1);

  const recomp = summarizeRecomp({
    currentWeightLb: latestWeight[0]?.weight ?? null,
    startWeightLb: startWeight[0]?.weight ?? null,
    goalWeightLb: prefs?.goalWeightLb ?? null,
    strengthCurrent: prefs?.strengthCurrent ?? null,
    strengthGoal: prefs?.strengthGoal ?? null,
  });

  // Logged workouts in the window, with the planned minutes of any plan day
  // they link to (for the verdict counts + machine mix + load).
  const workoutRows = await db
    .select({
      date: workoutsTable.date,
      equipment: workoutsTable.equipment,
      sessionType: workoutsTable.sessionType,
      durationMin: workoutsTable.durationMin,
      strengthMin: workoutsTable.strengthMin,
      cardioMin: workoutsTable.cardioMin,
      runMin: workoutsTable.runMin,
      modality: workoutsTable.modality,
      planId: planDaysTable.id,
      pStrength: planDaysTable.strengthMin,
      pCardio: planDaysTable.cardioMin,
      pRun: planDaysTable.runMin,
    })
    .from(workoutsTable)
    .leftJoin(planDaysTable, eq(workoutsTable.planDayId, planDaysTable.id))
    .where(and(gte(workoutsTable.date, from), lte(workoutsTable.date, to)));

  const training: TrainingRow[] = workoutRows.map((r) => ({
    date: r.date,
    equipment: r.equipment,
    sessionType: r.sessionType,
    durationMin: r.durationMin,
    strengthMin: r.strengthMin,
    cardioMin: r.cardioMin,
    runMin: r.runMin,
    modality: r.modality,
    plannedMin:
      r.planId != null
        ? (r.pStrength ?? 0) + (r.pCardio ?? 0) + (r.pRun ?? 0)
        : null,
  }));

  const consistency = summarizeConsistency(training);
  const machineMix = summarizeMachineMix(training);

  // Planned (non-rest) sessions in the window → real skips = planned - done.
  const plannedCountRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(planDaysTable)
    .where(
      and(
        gte(planDaysTable.date, from),
        lte(planDaysTable.date, to),
        eq(planDaysTable.isRest, false),
      ),
    );
  const plannedSessions = plannedCountRows[0]?.count ?? 0;
  consistency.verdicts.skipped = Math.max(
    0,
    plannedSessions - consistency.sessionsDone,
  );

  // Nutrition adherence over the window.
  const nutRows = await db
    .select({
      calories: nutritionDaysTable.calories,
      proteinG: nutritionDaysTable.proteinG,
      carbsG: nutritionDaysTable.carbsG,
      fatG: nutritionDaysTable.fatG,
    })
    .from(nutritionDaysTable)
    .where(
      and(
        gte(nutritionDaysTable.date, from),
        lte(nutritionDaysTable.date, to),
      ),
    );
  const food = summarizeFood(nutRows as FoodDay[], {
    calories: prefs?.calorieTarget ?? null,
    protein: prefs?.proteinTargetG ?? null,
    carbs: prefs?.carbsTargetG ?? null,
    fat: prefs?.fatTargetG ?? null,
  });

  res.json({
    window: { from, to, days },
    recomp,
    consistency: { ...consistency, plannedSessions },
    nutrition: food,
    machineMix,
  });
});

export default router;
