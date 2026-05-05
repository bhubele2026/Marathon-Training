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
  buildDefaultSeedConfig,
  generatePlanFromConfig,
  type PhaseBlock,
  type PlannerConfig,
  type TemplateEntry,
} from "@workspace/plan-generator";
import { writePlanJson, type DailyRow, type WeeklyRow, type BodyRow } from "./generate-plan.js";

// If the runner has already applied a custom Planner config (Task #80),
// reseed from THAT instead of inserting a fresh default so a "campaign
// reset" via this CLI matches what they configured. When no config has
// ever been applied (fresh install / never customized) we insert the
// Task #244 default stacked config and return its generated rows.
async function loadOrSeedActivePlan(): Promise<{
  daily: DailyRow[];
  weekly: WeeklyRow[];
  body: BodyRow[];
  reused: boolean;
  configName: string;
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

  // Fresh install: insert a default planner config and use it as the
  // applied baseline so /plan/overview's `activeConfigName` reads
  // "Tonal Upper 8wk" out of the box instead of falling back to a
  // generic "Workout Plan".
  const { name, config } = buildDefaultSeedConfig();
  const entries = (config.entries ?? []) as TemplateEntry[];
  const generated = generatePlanFromConfig(config);
  // Non-destructive: preserve any saved planner drafts. Compute the
  // next available manual integer PK, deactivate the currently active
  // row (single-active invariant), then insert the default as the new
  // active applied config.
  const maxRow = await db.execute<{ max: number | null }>(
    sql`SELECT COALESCE(MAX(id), 0) AS max FROM planner_configs`,
  );
  const nextId = (maxRow.rows[0]?.max ?? 0) + 1;
  await db.execute(
    sql`UPDATE planner_configs SET is_active = false WHERE is_active = true`,
  );
  const now = new Date();
  await db.insert(plannerConfigsTable).values({
    id: nextId,
    name,
    isActive: true,
    startDate: config.startDate,
    marathonDate: config.marathonDate,
    blocks: [],
    entries,
    createdAt: now,
    updatedAt: now,
    lastAppliedAt: now,
    appliedStartDate: config.startDate,
    appliedMarathonDate: config.marathonDate,
    appliedBlocks: [],
    appliedEntries: entries,
  });
  return {
    daily: generated.daily as DailyRow[],
    weekly: generated.weekly as WeeklyRow[],
    body: generated.body as BodyRow[],
    reused: false,
    configName: name,
  };
}

async function main() {
  // Keep the on-disk plan.json fresh for any out-of-band consumer that
  // still reads it (preview tooling, debug scripts), but the actual
  // seeded campaign now comes from a planner config — either the
  // last-applied one or a freshly inserted Task #244 default.
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
  // The variable is intentionally unused in the main flow; the read is
  // kept so a malformed file is surfaced loudly during development.
  void readFileSync(planJsonPath, "utf-8");

  const { daily, weekly, body, reused, configName } =
    await loadOrSeedActivePlan();
  const data = { daily, weekly, body };
  console.log(
    reused
      ? `Using last-applied Planner config "${configName}" (${weekly.length} weeks, ${daily.length} days).`
      : `Seeded default Planner config "${configName}" (${weekly.length} weeks, ${daily.length} days).`,
  );

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
