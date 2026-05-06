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
  type TemplateEntry,
} from "@workspace/plan-generator";
import { writePlanJson, type DailyRow, type WeeklyRow, type BodyRow } from "./generate-plan.js";

// Task #307: fresh installs (and Full Reset) leave the plan TABLES EMPTY
// until the runner applies a Phase Planner config. When a last-applied
// config exists we reseed from it; otherwise we return zero rows and let
// the UI surface its "Open Phase Planner" empty state.
async function loadActivePlan(): Promise<{
  daily: DailyRow[];
  weekly: WeeklyRow[];
  body: BodyRow[];
  reused: boolean;
  configName: string | null;
}> {
  const rows = await db
    .select()
    .from(plannerConfigsTable)
    .where(sql`${plannerConfigsTable.lastAppliedAt} IS NOT NULL`)
    .orderBy(sql`${plannerConfigsTable.lastAppliedAt} DESC`)
    .limit(1);
  const row = rows[0];
  if (
    row &&
    row.appliedStartDate &&
    row.appliedMarathonDate &&
    row.appliedBlocks
  ) {
    const config: PlannerConfig = {
      startDate: row.appliedStartDate,
      marathonDate: row.appliedMarathonDate,
      blocks: row.appliedBlocks as PhaseBlock[],
      entries: (row.appliedEntries as TemplateEntry[] | null) ?? null,
    };
    const generated = generatePlanFromConfig(config);
    return {
      daily: generated.daily as DailyRow[],
      weekly: generated.weekly as WeeklyRow[],
      body: generated.body as BodyRow[],
      reused: true,
      configName: row.name,
    };
  }
  return { daily: [], weekly: [], body: [], reused: false, configName: null };
}

async function main() {
  // Keep the on-disk plan.json fresh for any out-of-band consumer that
  // still reads it (preview tooling, debug scripts).
  const planJsonPath = resolve(
    import.meta.dirname,
    "../../.local/data/plan.json",
  );
  if (!existsSync(planJsonPath)) {
    console.log(
      `No plan.json at ${planJsonPath} — generating one for out-of-band tooling`,
    );
    writePlanJson();
  }
  void readFileSync(planJsonPath, "utf-8");

  const { daily, weekly, body, reused, configName } = await loadActivePlan();
  if (reused) {
    console.log(
      `Using last-applied Planner config "${configName}" (${weekly.length} weeks, ${daily.length} days).`,
    );
  } else {
    console.log(
      "No applied Planner config found — leaving plan tables empty (Task #307). Apply a config from /planner to populate the plan.",
    );
  }

  // Campaign reset: wipe plan_weeks, plan_days, AND workouts so the regenerated
  // plan rows don't leave orphaned plan_day_id references behind in workouts.
  // body_measurements and reset_undo_snapshots are intentionally preserved.
  await db.execute(sql`TRUNCATE TABLE workouts, plan_days, plan_weeks RESTART IDENTITY CASCADE`);

  if (weekly.length > 0) {
    await db.insert(planWeeksTable).values(
      weekly.map((w) => ({
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
    for (let i = 0; i < daily.length; i += chunk) {
      const slice = daily.slice(i, i + chunk);
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
    console.log(
      `Seeded ${weekly.length} weeks, ${daily.length} days from "${configName}".`,
    );
  }

  // Insert baseline body measurements only on a fresh database (don't overwrite user-entered measurements).
  const existingMeasurements = await db.select().from(measurementsTable).limit(1);
  if (existingMeasurements.length === 0 && body.length > 0) {
    await db.insert(measurementsTable).values(
      body.map((b) => ({
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
    console.log(`Inserted ${body.length} baseline measurement rows (table was empty).`);
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
