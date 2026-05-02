import { Router, type IRouter } from "express";
import {
  db,
  planDaysTable,
  planWeeksTable,
  workoutsTable,
  plannerConfigsTable,
  type PlannerConfigRow,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { PutPlannerConfigBody } from "@workspace/api-zod";
import {
  generatePlanFromConfig,
  validatePlannerConfig,
  RACE_DATE_ISO,
  type PlannerConfig,
  type PhaseBlock,
  type FocusType,
} from "@workspace/plan-generator";

const router: IRouter = Router();

// Single-row table; we always read/write id = 1.
const PLANNER_CONFIG_ID = 1;

// Convert a DB row into the API-shaped PlannerConfig that the React Query
// hook (`getPlannerConfig`) consumes. Drizzle gives us camelCase already; we
// just need to surface `updatedAt` as an ISO string and coerce the jsonb
// `blocks` payload back into the typed PhaseBlock[] (the column is typed
// loosely as `Array<{focusType: string; ...}>` so that drizzle migrations
// don't pin us to the FocusType enum at the schema layer).
function toPlannerConfig(
  row: PlannerConfigRow,
): PlannerConfig & { notes: string | null; updatedAt: string } {
  return {
    startDate: row.startDate,
    marathonDate: row.marathonDate,
    blocks: row.blocks as PhaseBlock[],
    notes: row.notes,
    updatedAt: row.updatedAt.toISOString(),
  };
}

// The marathon date the rest of the app anchors on: the most recently
// APPLIED Planner config's marathonDate, or RACE_DATE_ISO when nothing has
// ever been applied. Used by dashboard (countdown) and race-week (race-day
// plan row lookup) so a custom Planner apply re-points every consumer.
export async function readActiveRaceDate(): Promise<string> {
  const cfg = await readLastAppliedPlannerConfig();
  return cfg?.marathonDate ?? RACE_DATE_ISO;
}

// Most-recently-APPLIED planner config — read from the immutable
// applied_* snapshot columns so a draft saved AFTER an apply (without a
// follow-up apply) does not silently re-anchor Full Reset / dashboard /
// race-week. Returns null if no config has ever been applied.
export async function readLastAppliedPlannerConfig(): Promise<PlannerConfig | null> {
  const rows = await db
    .select()
    .from(plannerConfigsTable)
    .where(eq(plannerConfigsTable.id, PLANNER_CONFIG_ID))
    .limit(1);
  const row = rows[0];
  if (
    !row ||
    row.lastAppliedAt === null ||
    row.appliedStartDate === null ||
    row.appliedMarathonDate === null ||
    row.appliedBlocks === null
  ) {
    return null;
  }
  return {
    startDate: row.appliedStartDate,
    marathonDate: row.appliedMarathonDate,
    blocks: row.appliedBlocks as PhaseBlock[],
  };
}

router.get("/planner/config", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(plannerConfigsTable)
    .where(eq(plannerConfigsTable.id, PLANNER_CONFIG_ID))
    .limit(1);
  const row = rows[0];
  res.json({ config: row ? toPlannerConfig(row) : null });
});

router.put("/planner/config", async (req, res): Promise<void> => {
  // Step 1: surface-level zod validation (shape + required fields). The
  // generated schema is permissive on focusType (it's a string enum on the
  // wire), so we still need to call validatePlannerConfig below for the
  // semantic checks (Monday start, Sunday marathon, block weeks sum, etc.).
  const parsed = PutPlannerConfigBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  // Normalize the blocks into PhaseBlock shape. The wire type allows
  // optional customName/customNotes; we coerce undefined → null so the
  // jsonb column round-trips cleanly.
  const blocks: PhaseBlock[] = parsed.data.blocks.map((b) => ({
    focusType: b.focusType as FocusType,
    weeks: b.weeks,
    customName: b.customName ?? null,
    customNotes: b.customNotes ?? null,
  }));
  const config: PlannerConfig = {
    startDate: parsed.data.startDate,
    marathonDate: parsed.data.marathonDate,
    blocks,
  };

  // Step 2: semantic validation, including marathonDate-must-be-future.
  // todayISO is computed server-side so the runner can't bypass the check
  // by spoofing their clock.
  const todayISO = new Date().toISOString().slice(0, 10);
  const issues = validatePlannerConfig(config, { todayISO });
  if (issues.length > 0) {
    const fieldErrors: Record<string, string[]> = {};
    const formErrors: string[] = [];
    for (const issue of issues) {
      if (issue.field === "blocks" || !issue.field) {
        formErrors.push(issue.message);
      } else {
        (fieldErrors[issue.field] ??= []).push(issue.message);
      }
    }
    res.status(400).json({ error: { formErrors, fieldErrors } });
    return;
  }

  // Step 3: upsert. The single-row keying lets us use ON CONFLICT on the
  // primary key without a separate select+update branch.
  const now = new Date();
  await db
    .insert(plannerConfigsTable)
    .values({
      id: PLANNER_CONFIG_ID,
      startDate: config.startDate,
      marathonDate: config.marathonDate,
      blocks,
      notes: parsed.data.notes ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: plannerConfigsTable.id,
      set: {
        startDate: config.startDate,
        marathonDate: config.marathonDate,
        blocks,
        notes: parsed.data.notes ?? null,
        updatedAt: now,
      },
    });

  const row = (
    await db
      .select()
      .from(plannerConfigsTable)
      .where(eq(plannerConfigsTable.id, PLANNER_CONFIG_ID))
      .limit(1)
  )[0]!;

  req.log.info(
    {
      startDate: row.startDate,
      marathonDate: row.marathonDate,
      blockCount: blocks.length,
    },
    "planner config saved",
  );
  res.json(toPlannerConfig(row));
});

// Apply the saved Planner config: regenerate plan_weeks/plan_days,
// preserving logged workouts and measurements. Reset-undo snapshots are
// dropped because their plan_day ids no longer match. Workout
// plan_day_id FKs are best-effort rebound by date.
router.post("/planner/apply", async (req, res): Promise<void> => {
  // Apply uses the most recently SAVED config (whether or not it has been
  // applied before). The frontend always PUTs the current draft just
  // before calling Apply so this stays in sync with what the runner sees.
  const rows = await db
    .select()
    .from(plannerConfigsTable)
    .where(eq(plannerConfigsTable.id, PLANNER_CONFIG_ID))
    .limit(1);
  const row = rows[0];
  if (!row) {
    res.status(400).json({
      error: "No saved Planner config to apply. PUT /planner/config first.",
    });
    return;
  }
  const config: PlannerConfig = {
    startDate: row.startDate,
    marathonDate: row.marathonDate,
    blocks: row.blocks as PhaseBlock[],
  };

  // Generate OUTSIDE the transaction so a generator bug (e.g. validation
  // mismatch) can't leave us with truncated plan tables.
  const plan = generatePlanFromConfig(config);

  const result = await db.transaction(async (tx) => {
    // Lock the tables we're about to mutate so a concurrent write can't
    // commit between the count and the truncate. We are intentionally NOT
    // locking workouts / measurements — those are preserved across the
    // apply and stay readable to other transactions.
    await tx.execute(
      sql`LOCK TABLE plan_days, plan_weeks, reset_undo_snapshots IN ACCESS EXCLUSIVE MODE`,
    );

    // Capture pre-apply counts for the response.
    const [{ count: workoutsBefore } = { count: 0 }] = (
      await tx.execute<{ count: number }>(
        sql`SELECT COUNT(*)::int AS count FROM workouts`,
      )
    ).rows;
    const [{ count: measurementsBefore } = { count: 0 }] = (
      await tx.execute<{ count: number }>(
        sql`SELECT COUNT(*)::int AS count FROM measurements`,
      )
    ).rows;
    const [{ count: snapshotsBefore } = { count: 0 }] = (
      await tx.execute<{ count: number }>(
        sql`SELECT COUNT(*)::int AS count FROM reset_undo_snapshots`,
      )
    ).rows;

    // Detach workout FKs FIRST so the plan_days TRUNCATE doesn't cascade
    // into them. The post-insert rebind step below will re-point them by
    // date where possible.
    await tx
      .update(workoutsTable)
      .set({ planDayId: null })
      .where(sql`${workoutsTable.planDayId} IS NOT NULL`);

    // Now wipe plan tables + drop any pending undo snapshots (their
    // plan_day ids no longer exist in the regenerated plan).
    await tx.execute(
      sql`TRUNCATE TABLE plan_days, plan_weeks, reset_undo_snapshots RESTART IDENTITY CASCADE`,
    );

    // Reseed plan_weeks first so the plan_days FK targets exist.
    await tx.insert(planWeeksTable).values(
      plan.weekly.map((w) => ({
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

    // Chunk the plan_days inserts to stay well under postgres's bind
    // parameter limit; mirror the seed CLI's chunk size.
    const chunk = 100;
    for (let i = 0; i < plan.daily.length; i += chunk) {
      const slice = plan.daily.slice(i, i + chunk);
      await tx.insert(planDaysTable).values(
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
            // Mirror the prescribed values into seed_* so a subsequent
            // /reset has a clean snapshot to restore from after the runner
            // edits this freshly-seeded row.
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

    // Best-effort rebind: for each workout date that matches a freshly
    // inserted plan_day date, set the FK so the /today and /log views can
    // still pair the logged session with its prescribed plan day. Workouts
    // whose date no longer falls within the regenerated plan keep
    // plan_day_id = NULL — they're preserved as historical entries.
    await tx.execute(sql`
      UPDATE workouts w
      SET plan_day_id = pd.id
      FROM plan_days pd
      WHERE pd.date = w.date AND w.plan_day_id IS NULL
    `);

    // Snapshot the just-applied config into applied_* columns so future
    // /plan/full-reset, dashboard, and race-week reads use this exact
    // config — not whatever draft the runner subsequently saves without
    // applying. The mutable startDate/marathonDate/blocks above keep
    // tracking the latest editable draft.
    await tx
      .update(plannerConfigsTable)
      .set({
        lastAppliedAt: new Date(),
        appliedStartDate: config.startDate,
        appliedMarathonDate: config.marathonDate,
        appliedBlocks: config.blocks,
      })
      .where(eq(plannerConfigsTable.id, PLANNER_CONFIG_ID));

    return {
      weeksSeeded: plan.weekly.length,
      daysSeeded: plan.daily.length,
      workoutsPreserved: workoutsBefore,
      measurementsPreserved: measurementsBefore,
      undoSnapshotsWiped: snapshotsBefore,
      totalWeeks: plan.weekly.length,
    };
  });

  req.log.warn(
    {
      weeksSeeded: result.weeksSeeded,
      daysSeeded: result.daysSeeded,
      workoutsPreserved: result.workoutsPreserved,
      measurementsPreserved: result.measurementsPreserved,
      undoSnapshotsWiped: result.undoSnapshotsWiped,
    },
    "planner config applied — plan_weeks/plan_days regenerated",
  );
  res.json(result);
});

export default router;
