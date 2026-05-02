import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  db,
  planDaysTable,
  planWeeksTable,
  measurementsTable,
  plannerConfigsTable,
} from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  generatePlanFromConfig,
  type PhaseBlock,
  type PlannerConfig,
} from "@workspace/plan-generator";
import { generatePlan, writePlanJson, type DailyRow, type WeeklyRow, type BodyRow } from "./generate-plan.js";

function loadPlanData(): { daily: DailyRow[]; weekly: WeeklyRow[]; body: BodyRow[] } {
  const file = resolve(import.meta.dirname, "../../.local/data/plan.json");
  if (!existsSync(file)) {
    console.log(`No plan.json at ${file} — generating fresh from generate-plan.ts`);
    writePlanJson();
  }
  const data = JSON.parse(readFileSync(file, "utf-8")) as {
    daily: DailyRow[];
    weekly: WeeklyRow[];
    body: BodyRow[];
  };
  // Defensive fallback: if the on-disk file is somehow malformed/empty, fall back to in-memory generation.
  if (!data.weekly?.length || !data.daily?.length) {
    console.log("plan.json was empty or malformed — regenerating in memory");
    return generatePlan();
  }
  return data;
}

// If the runner has already applied a custom Planner config (Task #80),
// reseed from THAT instead of the canonical hard-coded plan so a "campaign
// reset" via this CLI matches what they configured. Returns null when no
// config has ever been applied (i.e. fresh installs / never customized).
async function loadLastAppliedPlan(): Promise<
  { daily: DailyRow[]; weekly: WeeklyRow[]; body: BodyRow[] } | null
> {
  const rows = await db.select().from(plannerConfigsTable).limit(1);
  const row = rows[0];
  if (
    !row ||
    row.lastAppliedAt === null ||
    !row.appliedStartDate ||
    !row.appliedMarathonDate ||
    !row.appliedBlocks
  ) {
    return null;
  }
  const config: PlannerConfig = {
    startDate: row.appliedStartDate,
    marathonDate: row.appliedMarathonDate,
    blocks: row.appliedBlocks as PhaseBlock[],
  };
  const generated = generatePlanFromConfig(config);
  return {
    daily: generated.daily as DailyRow[],
    weekly: generated.weekly as WeeklyRow[],
    body: generated.body as BodyRow[],
  };
}

async function main() {
  const fileData = loadPlanData();
  const applied = await loadLastAppliedPlan();
  const data = applied ?? fileData;
  if (applied) {
    console.log(
      `Using last-applied Planner config (${applied.weekly.length} weeks, ${applied.daily.length} days).`,
    );
  }

  console.log(
    `Seeding ${data.weekly.length} weeks, ${data.daily.length} days, ${data.body.length} body rows`,
  );

  // Campaign reset: wipe plan_weeks, plan_days, AND workouts so the regenerated
  // plan rows don't leave orphaned plan_day_id references behind in workouts.
  // body_measurements and reset_undo_snapshots are intentionally preserved.
  await db.execute(sql`TRUNCATE TABLE workouts, plan_days, plan_weeks RESTART IDENTITY CASCADE`);

  await db.insert(planWeeksTable).values(
    data.weekly.map((w) => ({
      week: w.week,
      phase: w.phase,
      startDate: w.start,
      endDate: w.end,
      plannedStrength: w.planned_strength,
      plannedCardio: w.planned_cardio,
      plannedTotalLoad: w.planned_total_load,
      plannedMiles: w.planned_miles,
      longRunMi: w.long_run_mi,
    })),
  );

  const chunk = 100;
  for (let i = 0; i < data.daily.length; i += chunk) {
    const slice = data.daily.slice(i, i + chunk);
    await db.insert(planDaysTable).values(
      slice.map((d) => {
        const equipment = d.equipment ?? "Rest";
        const equipmentList = d.equipment_list ?? [equipment];
        const description = d.description ?? "";
        const sessionType = d.session_type ?? "Rest";
        const isRest = !!d.is_rest;
        const totalLoad = d.total_load ?? 0;
        return {
          week: d.week,
          phase: d.phase,
          date: d.date,
          day: d.day,
          strengthLoad: d.strength_load,
          equipment,
          equipmentList,
          description,
          strengthMin: d.strength_min,
          cardioMin: d.cardio_min,
          runMin: d.run_min,
          distanceMi: d.distance_mi,
          pace: d.pace,
          sessionType,
          isRest,
          totalLoad,
          // Mirror the prescribed values into the seed_* columns so the
          // "Reset to original" plan-day action has a clean snapshot of the
          // seeded prescription to restore from after edits or swaps.
          seedSessionType: sessionType,
          seedEquipment: equipment,
          seedEquipmentList: equipmentList,
          seedDescription: description,
          seedDistanceMi: d.distance_mi,
          seedStrengthMin: d.strength_min,
          seedCardioMin: d.cardio_min,
          seedRunMin: d.run_min,
          seedPace: d.pace,
          seedStrengthLoad: d.strength_load,
          seedTotalLoad: totalLoad,
          seedIsRest: isRest,
        };
      }),
    );
  }

  // Insert baseline body measurements only on a fresh database (don't overwrite user-entered measurements).
  const existingMeasurements = await db.select().from(measurementsTable).limit(1);
  if (existingMeasurements.length === 0 && data.body.length > 0) {
    await db.insert(measurementsTable).values(
      data.body.map((b) => ({
        date: b.date,
        weight: b.weight,
        lArm: b.l_arm,
        rArm: b.r_arm,
        lLeg: b.l_leg,
        rLeg: b.r_leg,
        belly: b.belly,
        chest: b.chest,
        notes: b.notes,
      })),
    );
    console.log(`Inserted ${data.body.length} baseline measurement rows (table was empty).`);
  } else {
    console.log(
      `Preserved existing measurements (${existingMeasurements.length > 0 ? "table not empty" : "no body data"}).`,
    );
  }

  console.log("Seed complete.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
