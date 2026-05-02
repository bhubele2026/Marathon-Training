import { sql } from "drizzle-orm";
import { expect } from "vitest";
import {
  db,
  measurementsTable,
  planDaysTable,
  planWeeksTable,
  workoutsTable,
} from "@workspace/db";

// Structural type for the generated `@workspace/api-zod` schemas so this
// helper can stay schema-library-agnostic and the api-server package does
// not need a direct zod dependency just for testing.
interface SchemaLike<T> {
  parse(data: unknown): T;
}

interface ZodIssue {
  path: Array<string | number>;
  message: string;
  code?: string;
}

function isZodError(err: unknown): err is { issues: ZodIssue[] } {
  return (
    typeof err === "object" &&
    err !== null &&
    Array.isArray((err as { issues?: unknown }).issues)
  );
}

/**
 * Parse `body` through the matching generated `@workspace/api-zod` schema
 * and fail the current test with a readable diff if validation fails.
 *
 * This catches drift between the OpenAPI contract (the source of truth the
 * React client and Zod validators are generated from) and what the Express
 * routes actually return on the wire. Use this in every integration test
 * that hits a real endpoint:
 *
 *   const res = await request(app).get("/api/dashboard/summary");
 *   expect(res.status).toBe(200);
 *   expectMatchesSchema(GetDashboardSummaryResponse, res.body);
 *
 * Returns the parsed value so callers can chain on a typed result if they
 * want to, but the original `body` is never mutated.
 */
export function expectMatchesSchema<T>(
  schema: SchemaLike<T>,
  body: unknown,
): T {
  try {
    return schema.parse(body);
  } catch (err) {
    if (isZodError(err)) {
      const formatted = err.issues
        .map((i) => {
          const path = i.path.length > 0 ? i.path.join(".") : "<root>";
          return `  - ${path}: ${i.message}${i.code ? ` (${i.code})` : ""}`;
        })
        .join("\n");
      expect.fail(
        `Response body did not match the generated OpenAPI schema:\n${formatted}\n\nReceived body:\n${JSON.stringify(body, null, 2)}`,
      );
    }
    throw err;
  }
}

// Test fixtures live in clearly-namespaced ranges so cleanup can never delete
// real data and pre-existing real data can never contaminate test averages.
// This module mirrors (and extends) the inline pattern established in
// routes/plan.test.ts so every API test file can stay scoped to a far-future
// date band and a dedicated week-id range.
export const TEST_WEEK_MIN = 8000;
export const TEST_WEEK_MAX = 8999;
export const TEST_YEAR_START = "2099-01-01";
export const TEST_YEAR_END = "2100-01-01";

// Every session_type and equipment value used by tests starts with this prefix.
// We delete by prefix in cleanup so even if a stray row escapes the 2099 date
// band (e.g. via an inserted clock-shifted created_at) it still gets scrubbed.
// The dashboard "arsenal" list keys on canonical equipment names, so prefixed
// values can never collide with production names either.
export const TEST_TAG = "__test__";
export const T_RUN = `${TEST_TAG}run`;
export const T_BIKE = `${TEST_TAG}bike`;
export const T_STRENGTH = `${TEST_TAG}strength`;
export const T_REST = `${TEST_TAG}rest`;
export const T_LONG_RUN = `${TEST_TAG}long_run`;
export const E_OUTDOOR = `${TEST_TAG}outdoor`;
export const E_TREADMILL = `${TEST_TAG}treadmill`;
export const E_SPIN = `${TEST_TAG}spin`;
export const E_GYM = `${TEST_TAG}gym`;
export const E_NONE = `${TEST_TAG}none`;

export async function cleanTestData(): Promise<void> {
  await db.execute(
    sql`DELETE FROM workouts
        WHERE session_type LIKE ${`${TEST_TAG}%`}
           OR equipment LIKE ${`${TEST_TAG}%`}
           OR (date >= ${TEST_YEAR_START} AND date < ${TEST_YEAR_END})`,
  );
  await db.execute(
    sql`DELETE FROM measurements
        WHERE date >= ${TEST_YEAR_START} AND date < ${TEST_YEAR_END}`,
  );
  await db.execute(
    sql`DELETE FROM plan_days WHERE week >= ${TEST_WEEK_MIN} AND week <= ${TEST_WEEK_MAX}`,
  );
  await db.execute(
    sql`DELETE FROM plan_weeks WHERE week >= ${TEST_WEEK_MIN} AND week <= ${TEST_WEEK_MAX}`,
  );
}

export interface PlanWeekInput {
  startDate: string;
  endDate: string;
  phase?: string;
  plannedMiles?: number;
  longRunMi?: number;
  plannedTotalLoad?: number;
}

export async function insertWeek(week: number, opts: PlanWeekInput): Promise<void> {
  await db.insert(planWeeksTable).values({
    week,
    phase: opts.phase ?? "Test Phase",
    startDate: opts.startDate,
    endDate: opts.endDate,
    plannedTotalLoad: opts.plannedTotalLoad ?? 0,
    plannedMiles: opts.plannedMiles ?? 0,
    longRunMi: opts.longRunMi ?? 0,
  });
}

export interface PlanDayInput {
  date: string;
  day: string;
  sessionType: string;
  equipment: string;
  description?: string;
  isRest?: boolean;
  pace?: string | null;
  strengthMin?: number | null;
  cardioMin?: number | null;
  runMin?: number | null;
  distanceMi?: number | null;
  strengthLoad?: number | null;
  totalLoad?: number;
  // Optional task #77 chip rail. When omitted the row's equipment_list
  // column is left NULL, which simulates a pre-task-#77 legacy row and
  // exercises the API's `[equipment]` fallback path.
  equipmentList?: string[] | null;
}

export async function insertPlanDay(
  week: number,
  phase: string,
  d: PlanDayInput,
): Promise<{ id: number }> {
  const inserted = await db
    .insert(planDaysTable)
    .values({
      week,
      phase,
      date: d.date,
      day: d.day,
      sessionType: d.sessionType,
      equipment: d.equipment,
      equipmentList: d.equipmentList ?? null,
      description: d.description ?? "",
      isRest: d.isRest ?? false,
      pace: d.pace ?? null,
      strengthMin: d.strengthMin ?? null,
      cardioMin: d.cardioMin ?? null,
      runMin: d.runMin ?? null,
      distanceMi: d.distanceMi ?? null,
      strengthLoad: d.strengthLoad ?? null,
      totalLoad: d.totalLoad ?? 0,
    })
    .returning({ id: planDaysTable.id });
  return { id: inserted[0]!.id };
}

export interface WorkoutInput {
  date: string;
  sessionType: string;
  equipment: string;
  rpe?: number | null;
  avgHr?: number | null;
  pace?: string | null;
  distanceMi?: number | null;
  durationMin?: number | null;
  // Per-bucket actual minutes (Task #76). Optional so existing tests that
  // only care about totals keep working; new tests can pass these to
  // exercise the plan-vs-actual breakdown UI / aggregations.
  strengthMin?: number | null;
  cardioMin?: number | null;
  runMin?: number | null;
  totalLoad?: number | null;
  strengthLoad?: number | null;
  planDayId?: number | null;
  notes?: string | null;
  // Optional task #78 chip rail. When omitted the row's equipment_list
  // column is left NULL, which simulates a pre-task-#78 legacy row and
  // exercises the API's `[equipment]` fallback path through `toWorkout`.
  equipmentList?: string[] | null;
}

export async function insertWorkout(w: WorkoutInput): Promise<{ id: number }> {
  const inserted = await db
    .insert(workoutsTable)
    .values({
      date: w.date,
      sessionType: w.sessionType,
      equipment: w.equipment,
      equipmentList: w.equipmentList ?? null,
      rpe: w.rpe ?? null,
      avgHr: w.avgHr ?? null,
      pace: w.pace ?? null,
      distanceMi: w.distanceMi ?? null,
      durationMin: w.durationMin ?? null,
      strengthMin: w.strengthMin ?? null,
      cardioMin: w.cardioMin ?? null,
      runMin: w.runMin ?? null,
      totalLoad: w.totalLoad ?? null,
      strengthLoad: w.strengthLoad ?? null,
      planDayId: w.planDayId ?? null,
      notes: w.notes ?? null,
    })
    .returning({ id: workoutsTable.id });
  return { id: inserted[0]!.id };
}

export interface MeasurementInput {
  date: string;
  weight?: number | null;
  lArm?: number | null;
  rArm?: number | null;
  lLeg?: number | null;
  rLeg?: number | null;
  belly?: number | null;
  chest?: number | null;
  notes?: string | null;
}

export async function insertMeasurement(
  m: MeasurementInput,
): Promise<{ id: number }> {
  const inserted = await db
    .insert(measurementsTable)
    .values({
      date: m.date,
      weight: m.weight ?? null,
      lArm: m.lArm ?? null,
      rArm: m.rArm ?? null,
      lLeg: m.lLeg ?? null,
      rLeg: m.rLeg ?? null,
      belly: m.belly ?? null,
      chest: m.chest ?? null,
      notes: m.notes ?? null,
    })
    .returning({ id: measurementsTable.id });
  return { id: inserted[0]!.id };
}
