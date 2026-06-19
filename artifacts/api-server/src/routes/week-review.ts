import { Router, type IRouter } from "express";
import {
  db,
  nutritionDaysTable,
  userPreferencesTable,
} from "@workspace/db";
import { and, gte, lte, eq, sql } from "drizzle-orm";
import { addDaysISO } from "@workspace/plan-knowledge";
import {
  summarizeFood,
  summarizeWeight,
  type FoodSummary,
  type WeightSummary,
} from "../lib/week-review";

const router: IRouter = Router();

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type WeekReview = {
  weekStart: string;
  weekEnd: string;
  food: FoodSummary;
  workouts: {
    planned: number;
    done: number;
    skipped: number;
    minutesPlanned: number;
    minutesDone: number;
    missedDays: string[];
    liftingPlanned: number;
    liftingDone: number;
  };
  weight: WeightSummary;
};

// Assemble the numbers-only weekly rollup the coach voice reads. Pure
// summarization is delegated to lib/week-review; the DB aggregation lives here.
export async function buildWeekReview(weekStart: string): Promise<WeekReview> {
  const weekEnd = addDaysISO(weekStart, 6);

  // --- Food: nutrition_days in range + the persisted targets ----------------
  const foodRows = await db
    .select({
      calories: nutritionDaysTable.calories,
      proteinG: nutritionDaysTable.proteinG,
      carbsG: nutritionDaysTable.carbsG,
      fatG: nutritionDaysTable.fatG,
    })
    .from(nutritionDaysTable)
    .where(
      and(
        gte(nutritionDaysTable.date, weekStart),
        lte(nutritionDaysTable.date, weekEnd),
      ),
    );

  const prefsRows = await db
    .select({
      calorieTarget: userPreferencesTable.calorieTarget,
      proteinTargetG: userPreferencesTable.proteinTargetG,
      carbsTargetG: userPreferencesTable.carbsTargetG,
      fatTargetG: userPreferencesTable.fatTargetG,
      weeklyRateLb: userPreferencesTable.weeklyRateLb,
    })
    .from(userPreferencesTable)
    .where(eq(userPreferencesTable.id, 1))
    .limit(1);
  const prefs = prefsRows[0];

  const food = summarizeFood(foodRows, {
    calories: prefs?.calorieTarget ?? null,
    protein: prefs?.proteinTargetG ?? null,
    carbs: prefs?.carbsTargetG ?? null,
    fat: prefs?.fatTargetG ?? null,
  });

  // --- Workouts: planned vs done over the week ------------------------------
  // planned / done / lifting counts in one pass over non-rest plan_days.
  const wkAgg = await db.execute<{
    planned: number;
    done: number;
    lifting_planned: number;
    lifting_done: number;
  }>(sql`
    SELECT
      COUNT(*)::int AS planned,
      COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM workouts w WHERE w.plan_day_id = pd.id
      ))::int AS done,
      COUNT(*) FILTER (WHERE COALESCE(pd.strength_min, 0) > 0)::int AS lifting_planned,
      COUNT(*) FILTER (WHERE COALESCE(pd.strength_min, 0) > 0 AND EXISTS (
        SELECT 1 FROM workouts w WHERE w.plan_day_id = pd.id
      ))::int AS lifting_done
    FROM plan_days pd
    WHERE pd.date >= ${weekStart} AND pd.date <= ${weekEnd} AND pd.is_rest = false
  `);
  const wk = wkAgg.rows[0] ?? { planned: 0, done: 0, lifting_planned: 0, lifting_done: 0 };

  const minutesPlannedAgg = await db.execute<{ mins: number }>(sql`
    SELECT COALESCE(SUM(
      COALESCE(strength_min,0) + COALESCE(cardio_min,0) + COALESCE(run_min,0)
    ), 0)::int AS mins
    FROM plan_days
    WHERE date >= ${weekStart} AND date <= ${weekEnd} AND is_rest = false
  `);
  const minutesDoneAgg = await db.execute<{ mins: number }>(sql`
    SELECT COALESCE(SUM(
      COALESCE(duration_min, COALESCE(strength_min,0) + COALESCE(cardio_min,0) + COALESCE(run_min,0))
    ), 0)::int AS mins
    FROM workouts
    WHERE date >= ${weekStart} AND date <= ${weekEnd}
  `);

  const missedAgg = await db.execute<{ date: string }>(sql`
    SELECT pd.date::text AS date
    FROM plan_days pd
    WHERE pd.date >= ${weekStart} AND pd.date <= ${weekEnd} AND pd.is_rest = false
      AND NOT EXISTS (SELECT 1 FROM workouts w WHERE w.plan_day_id = pd.id)
    ORDER BY pd.date
  `);

  const planned = wk.planned;
  const done = wk.done;

  // --- Weight: start (≤ weekStart) and end (≤ weekEnd) carry-forward --------
  const startW = await db.execute<{ weight: number }>(sql`
    SELECT weight FROM measurements
    WHERE date <= ${weekStart} AND weight IS NOT NULL
    ORDER BY date DESC LIMIT 1
  `);
  const endW = await db.execute<{ weight: number }>(sql`
    SELECT weight FROM measurements
    WHERE date <= ${weekEnd} AND weight IS NOT NULL
    ORDER BY date DESC LIMIT 1
  `);
  const weight = summarizeWeight(
    startW.rows[0]?.weight ?? null,
    endW.rows[0]?.weight ?? null,
    prefs?.weeklyRateLb ?? null,
  );

  return {
    weekStart,
    weekEnd,
    food,
    workouts: {
      planned,
      done,
      skipped: Math.max(0, planned - done),
      minutesPlanned: minutesPlannedAgg.rows[0]?.mins ?? 0,
      minutesDone: minutesDoneAgg.rows[0]?.mins ?? 0,
      missedDays: missedAgg.rows.map((r) => r.date),
      liftingPlanned: wk.lifting_planned,
      liftingDone: wk.lifting_done,
    },
    weight,
  };
}

// GET /api/week-review/:weekStart — numbers-only planned-vs-actual rollup.
router.get("/week-review/:weekStart", async (req, res): Promise<void> => {
  const weekStart = req.params.weekStart;
  if (!ISO_DATE.test(weekStart)) {
    res.status(400).json({ error: "weekStart must be an ISO date (YYYY-MM-DD)." });
    return;
  }
  const review = await buildWeekReview(weekStart);
  res.json(review);
});

export default router;
