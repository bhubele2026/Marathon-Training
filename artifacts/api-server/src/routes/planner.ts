import { Router, type IRouter } from "express";
import {
  db,
  planDaysTable,
  planWeeksTable,
  workoutsTable,
  plannerConfigsTable,
  type PlannerConfigRow,
} from "@workspace/db";
import { eq, sql, desc, and, ne } from "drizzle-orm";
import {
  CreatePlannerConfigBody,
  UpdatePlannerConfigBody,
  DuplicatePlannerConfigBody,
} from "@workspace/api-zod";
import {
  expandConfigToPlanRows,
  validatePlannerConfig,
  expandEntriesToBlocksWithGaps,
  PLAN_TEMPLATES,
  STARTER_SHORTCUTS,
  RACE_DATE_ISO,
  type PlannerConfig,
  type PhaseBlock,
  type FocusType,
  type TemplateEntry,
} from "@workspace/plan-generator";
import { backfillPaceTargetCards } from "@workspace/scripts/backfill-pace-target-cards";

const router: IRouter = Router();

// API-shaped PlannerConfig (the React Query hook consumes this directly).
// Drizzle gives us camelCase already; we surface timestamps as ISO strings
// and coerce the jsonb `blocks` payload back into the typed PhaseBlock[].
type ApiPlannerConfig = {
  id: number;
  name: string;
  isActive: boolean;
  startDate: string;
  marathonDate: string;
  blocks: PhaseBlock[];
  entries: TemplateEntry[] | null;
  notes: string | null;
  startWeight: number | null;
  goalWeight: number | null;
  // Runner-prescribed starting easy pace (sec/mi); null falls back
  // to DEFAULT_STARTING_PACE_SEC.
  startingPaceSec: number | null;
  // Task #373. Optional goal ending easy pace (sec/mi). When BOTH
  // this and `startingPaceSec` are set, the generator linearly
  // interpolates easy pace across the campaign instead of using the
  // fixed-rate RAMP_SEC_PER_WEEK ramp.
  goalEndingPaceSec: number | null;
  // Task #338. Optional per-runner override of the daily time-budget
  // contract. NULL means no override (defaults apply).
  dailyBudget: {
    weekdayMin?: number | null;
    weekdayMax?: number | null;
    weekendMin?: number | null;
  } | null;
  updatedAt: string;
  lastAppliedAt: string | null;
};

function toPlannerConfig(row: PlannerConfigRow): ApiPlannerConfig {
  return {
    id: row.id,
    name: row.name,
    isActive: row.isActive,
    startDate: row.startDate,
    marathonDate: row.marathonDate,
    blocks: row.blocks as PhaseBlock[],
    entries: (row.entries as TemplateEntry[] | null) ?? null,
    notes: row.notes,
    startWeight: row.startWeight ?? null,
    goalWeight: row.goalWeight ?? null,
    startingPaceSec: row.startingPaceSec ?? null,
    goalEndingPaceSec: row.goalEndingPaceSec ?? null,
    dailyBudget: row.dailyBudget ?? null,
    updatedAt: row.updatedAt.toISOString(),
    lastAppliedAt: row.lastAppliedAt ? row.lastAppliedAt.toISOString() : null,
  };
}

function toSummary(row: PlannerConfigRow) {
  return {
    id: row.id,
    name: row.name,
    isActive: row.isActive,
    startDate: row.startDate,
    marathonDate: row.marathonDate,
    updatedAt: row.updatedAt.toISOString(),
    lastAppliedAt: row.lastAppliedAt ? row.lastAppliedAt.toISOString() : null,
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

// Task #244. Display name of the currently-active planner config (the
// row with the most recent last_applied_at). Falls back to "Workout
// Plan" when no config has ever been applied so fresh installs / legacy
// campaigns keep a sensible generic header instead of a hardcoded
// "Half Marathon Campaign".
export async function readActiveConfigName(): Promise<string> {
  const rows = await db
    .select({ name: plannerConfigsTable.name })
    .from(plannerConfigsTable)
    .where(sql`${plannerConfigsTable.lastAppliedAt} IS NOT NULL`)
    .orderBy(desc(plannerConfigsTable.lastAppliedAt))
    .limit(1);
  return rows[0]?.name ?? "Workout Plan";
}

// Most-recently-APPLIED planner config across ALL saved configs — read from
// the immutable applied_* snapshot columns. We pick the row with the
// largest last_applied_at so activating-but-not-applying a different
// config does NOT silently re-anchor Full Reset / dashboard / race-week.
// Returns null if no config has ever been applied.
export async function readLastAppliedPlannerConfig(): Promise<PlannerConfig | null> {
  const rows = await db
    .select()
    .from(plannerConfigsTable)
    .where(sql`${plannerConfigsTable.lastAppliedAt} IS NOT NULL`)
    .orderBy(desc(plannerConfigsTable.lastAppliedAt))
    .limit(1);
  const row = rows[0];
  if (
    !row ||
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
    // Surface the snapshotted entries so consumers (e.g. /plan/full-reset's
    // generatePlanFromConfig call) re-run the generator in entries-mode.
    // Without this an applied entries-mode plan would be re-validated as
    // legacy (auto-pinned 16w tail expected) and immediately fail.
    entries: (row.appliedEntries as TemplateEntry[] | null) ?? null,
    // Task #338. Surface the snapshotted daily-budget override so a
    // /plan/full-reset re-runs the generator with the SAME budget the
    // runner originally applied.
    dailyBudget: row.appliedDailyBudget ?? null,
    // Task #370. Surface the snapshotted starting-pace override so
    // `/plan/overview` can pre-fill the Update Starting Pace dialog
    // and the in-place re-pace endpoint reads the current applied
    // value (not the source row's draft startingPaceSec).
    startingPaceSec: row.appliedStartingPaceSec ?? null,
    // Task #373. Surface the snapshotted goal-ending pace so the
    // generator's linear-interp ramp re-runs on full reset / repace
    // with the same anchors the runner originally applied.
    goalEndingPaceSec: row.appliedGoalEndingPaceSec ?? null,
  };
}

// Task #330. Body-mass targets snapshotted on the most-recently-applied
// planner config. Returns nulls when no config has ever been applied OR
// when the applied config didn't carry weight targets — callers fall
// back to derived signals (earliest measurement) or null sentinels so
// the UI doesn't render stale hardcoded constants.
export async function readActiveBodyTargets(): Promise<{
  startWeight: number | null;
  goalWeight: number | null;
}> {
  const rows = await db
    .select({
      startWeight: plannerConfigsTable.appliedStartWeight,
      goalWeight: plannerConfigsTable.appliedGoalWeight,
    })
    .from(plannerConfigsTable)
    .where(sql`${plannerConfigsTable.lastAppliedAt} IS NOT NULL`)
    .orderBy(desc(plannerConfigsTable.lastAppliedAt))
    .limit(1);
  const row = rows[0];
  return {
    startWeight: row?.startWeight ?? null,
    goalWeight: row?.goalWeight ?? null,
  };
}

// Compute the next available primary key. Manual id assignment lets us
// keep the schema as a plain integer PK (no identity / serial migration
// needed for the existing single-row table) and lets tests insert with
// explicit ids if they want.
async function nextConfigId(
  tx: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0],
): Promise<number> {
  const rows = await tx.execute<{ max: number | null }>(
    sql`SELECT COALESCE(MAX(id), 0) AS max FROM planner_configs`,
  );
  return (rows.rows[0]?.max ?? 0) + 1;
}

// Lazy upgrade helper: the pre-Task-#82 single row had isActive=false
// (the column was added with a default of false on push). On the first
// list / read after migration, promote the most-recently-updated row to
// active so existing consumers (Apply, Full Reset) keep working without
// manual intervention.
async function ensureSomeActive(): Promise<void> {
  const activeRows = await db
    .select({ id: plannerConfigsTable.id })
    .from(plannerConfigsTable)
    .where(eq(plannerConfigsTable.isActive, true))
    .limit(1);
  if (activeRows.length > 0) return;
  const candidate = await db
    .select({ id: plannerConfigsTable.id })
    .from(plannerConfigsTable)
    .orderBy(desc(plannerConfigsTable.updatedAt))
    .limit(1);
  if (candidate.length === 0) return;
  await db
    .update(plannerConfigsTable)
    .set({ isActive: true })
    .where(eq(plannerConfigsTable.id, candidate[0]!.id));
}

// Validate a Planner config payload. Returns a 400-shaped error envelope
// or `{ ok: true, blocks, entries }` when valid. In ENTRIES mode
// the server projects entries → blocks via expandEntriesToBlocks before
// storing, so downstream generator paths can stay blocks-based while the
// editor's source of truth is the entries array. In LEGACY mode (entries
// null/empty) the body's `blocks` are used as-is and the auto-pinned
// 16-week Marathon-Specific tail is appended at generation time.
// Task #340. Daily-budget contract bounds. Per-field upper bound is
// 180 min (3 h) — anything beyond that produces nonsense weeks because
// the generator can't pad a single non-rest day past a sane training
// session. Cross-field rule weekdayMin <= weekdayMax keeps the floor
// from sitting above the cap (which would force the enforcer into an
// infinite pad/trim loop). Both checks are zod-level on the OpenAPI
// schema (per-field min/max) AND route-level here (cross-field).
const DAILY_BUDGET_MAX_MIN = 180;

function validateDailyBudget(
  budget:
    | {
        weekdayMin?: number | null;
        weekdayMax?: number | null;
        weekendMin?: number | null;
      }
    | null
    | undefined,
): Record<string, string[]> | null {
  if (!budget) return null;
  const fieldErrors: Record<string, string[]> = {};
  const wmin = budget.weekdayMin ?? null;
  const wmax = budget.weekdayMax ?? null;
  const emin = budget.weekendMin ?? null;
  for (const [key, val] of [
    ["weekdayMin", wmin],
    ["weekdayMax", wmax],
    ["weekendMin", emin],
  ] as const) {
    if (val !== null && val > DAILY_BUDGET_MAX_MIN) {
      (fieldErrors[`dailyBudget.${key}`] ??= []).push(
        `must be at most ${DAILY_BUDGET_MAX_MIN} min (got ${val})`,
      );
    }
  }
  if (wmin !== null && wmax !== null && wmin > wmax) {
    (fieldErrors[`dailyBudget.weekdayMin`] ??= []).push(
      `weekday floor (${wmin}) must be ≤ weekday cap (${wmax})`,
    );
  }
  return Object.keys(fieldErrors).length === 0 ? null : fieldErrors;
}

function validateBody(body: {
  startDate: string;
  marathonDate: string;
  blocks: Array<{
    focusType: string;
    weeks: number;
    customName?: string | null;
    customNotes?: string | null;
  }>;
  entries?:
    | Array<{
        templateId: string;
        weeks: number;
        customName?: string | null;
        customNotes?: string | null;
        startDate?: string | null;
      }>
    | null;
  dailyBudget?: {
    weekdayMin?: number | null;
    weekdayMax?: number | null;
    weekendMin?: number | null;
  } | null;
}):
  | { ok: true; blocks: PhaseBlock[]; entries: TemplateEntry[] | null }
  | { ok: false; status: 400; error: unknown } {
  // Task #340. Cross-field daily-budget validation — zod handles the
  // per-field min/max, this catches floor-above-cap.
  const budgetErrors = validateDailyBudget(body.dailyBudget);
  if (budgetErrors) {
    return {
      ok: false,
      status: 400,
      error: { formErrors: [], fieldErrors: budgetErrors },
    };
  }
  // entries-mode is determined by entries being PRESENT (non-null/undefined),
  // not by length. An explicit empty array is rejected here so the editor
  // can't silently fall back to legacy blocks-mode after the runner cleared
  // every composition entry.
  const entriesProvided =
    body.entries !== null && body.entries !== undefined;
  if (entriesProvided && body.entries!.length === 0) {
    return {
      ok: false,
      status: 400,
      error: {
        formErrors: [],
        fieldErrors: {
          entries: [
            "entries-mode requires at least one template entry; pass null to switch back to legacy blocks-mode",
          ],
        },
      },
    };
  }
  const isEntriesMode = entriesProvided;
  const entries: TemplateEntry[] | null = isEntriesMode
    ? body.entries!.map((e) => ({
        templateId: e.templateId,
        weeks: e.weeks,
        customName: e.customName ?? null,
        customNotes: e.customNotes ?? null,
        startDate: e.startDate ?? null,
      }))
    : null;
  // Project entries → blocks at write time so consumers (Apply, Full
  // Reset, dashboard, race-week lookup) can keep reading `blocks`. In
  // entries-mode the body's `blocks` payload is intentionally ignored —
  // entries are the editor's source of truth. Gap-aware expansion
  // honors per-entry startDate overrides by inserting Recovery filler
  // blocks between non-adjacent entries.
  const blocks: PhaseBlock[] = isEntriesMode
    ? expandEntriesToBlocksWithGaps(entries!, body.startDate)
    : body.blocks.map((b) => ({
        focusType: b.focusType as FocusType,
        weeks: b.weeks,
        customName: b.customName ?? null,
        customNotes: b.customNotes ?? null,
      }));
  const config: PlannerConfig = {
    startDate: body.startDate,
    marathonDate: body.marathonDate,
    blocks,
    entries,
  };
  // todayISO is computed server-side so the runner can't bypass the
  // marathonDate-must-be-future check by spoofing their clock.
  const todayISO = new Date().toISOString().slice(0, 10);
  const issues = validatePlannerConfig(config, { todayISO });
  if (issues.length === 0) return { ok: true, blocks, entries };
  const fieldErrors: Record<string, string[]> = {};
  const formErrors: string[] = [];
  for (const issue of issues) {
    if (issue.field === "blocks" || !issue.field) {
      formErrors.push(issue.message);
    } else {
      (fieldErrors[issue.field] ??= []).push(issue.message);
    }
  }
  return { ok: false, status: 400, error: { formErrors, fieldErrors } };
}

// ---- Routes -----------------------------------------------------------

// Static catalog handler. Returns the in-process PLAN_TEMPLATES + the
// three opinionated STARTER_SHORTCUTS shipped from @workspace/plan-generator.
// No DB read, no per-runner state — safe to cache aggressively in the UI.
router.get("/planner/templates", async (_req, res): Promise<void> => {
  res.json({
    templates: PLAN_TEMPLATES.map((t) => ({
      id: t.id,
      name: t.name,
      level: t.level,
      goalDistance: t.goalDistance,
      source: t.source,
      citation: t.citation,
      shortDescription: t.shortDescription,
      longDescription: t.longDescription,
      minWeeks: t.minWeeks,
      maxWeeks: t.maxWeeks,
      defaultWeeks: t.defaultWeeks,
      metadata: t.metadata,
      tags: t.tags,
    })),
    starters: STARTER_SHORTCUTS,
  });
});

router.get("/planner/configs", async (_req, res): Promise<void> => {
  await ensureSomeActive();
  const rows = await db
    .select()
    .from(plannerConfigsTable)
    .orderBy(desc(plannerConfigsTable.isActive), desc(plannerConfigsTable.updatedAt));
  const active = rows.find((r) => r.isActive) ?? null;
  res.json({
    configs: rows.map(toSummary),
    activeId: active ? active.id : null,
  });
});

router.post("/planner/configs", async (req, res): Promise<void> => {
  const parsed = CreatePlannerConfigBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const validated = validateBody(parsed.data);
  if (!validated.ok) {
    res.status(validated.status).json({ error: validated.error });
    return;
  }
  const now = new Date();
  const inserted = await db.transaction(async (tx) => {
    const id = await nextConfigId(tx);
    const existing = await tx
      .select({ id: plannerConfigsTable.id })
      .from(plannerConfigsTable)
      .limit(1);
    // Default activation rule: first ever config is auto-active; otherwise
    // honor an explicit setActive flag (defaulting to false).
    const setActive =
      parsed.data.setActive ?? existing.length === 0;
    if (setActive) {
      await tx
        .update(plannerConfigsTable)
        .set({ isActive: false })
        .where(eq(plannerConfigsTable.isActive, true));
    }
    await tx.insert(plannerConfigsTable).values({
      id,
      name: parsed.data.name,
      isActive: setActive,
      startDate: parsed.data.startDate,
      marathonDate: parsed.data.marathonDate,
      blocks: validated.blocks,
      entries: validated.entries,
      notes: parsed.data.notes ?? null,
      startWeight: parsed.data.startWeight ?? null,
      goalWeight: parsed.data.goalWeight ?? null,
      startingPaceSec: parsed.data.startingPaceSec ?? null,
      goalEndingPaceSec: parsed.data.goalEndingPaceSec ?? null,
      dailyBudget: parsed.data.dailyBudget ?? null,
      createdAt: now,
      updatedAt: now,
    });
    const rows = await tx
      .select()
      .from(plannerConfigsTable)
      .where(eq(plannerConfigsTable.id, id))
      .limit(1);
    return rows[0]!;
  });
  req.log.info(
    { id: inserted.id, name: inserted.name, isActive: inserted.isActive },
    "planner config created",
  );
  res.status(201).json(toPlannerConfig(inserted));
});

router.get("/planner/configs/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const rows = await db
    .select()
    .from(plannerConfigsTable)
    .where(eq(plannerConfigsTable.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) {
    res.status(404).json({ error: "Config not found" });
    return;
  }
  res.json(toPlannerConfig(row));
});

router.put("/planner/configs/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = UpdatePlannerConfigBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const validated = validateBody(parsed.data);
  if (!validated.ok) {
    res.status(validated.status).json({ error: validated.error });
    return;
  }
  const existing = await db
    .select({ id: plannerConfigsTable.id })
    .from(plannerConfigsTable)
    .where(eq(plannerConfigsTable.id, id))
    .limit(1);
  if (existing.length === 0) {
    res.status(404).json({ error: "Config not found" });
    return;
  }
  await db
    .update(plannerConfigsTable)
    .set({
      name: parsed.data.name,
      startDate: parsed.data.startDate,
      marathonDate: parsed.data.marathonDate,
      blocks: validated.blocks,
      entries: validated.entries,
      notes: parsed.data.notes ?? null,
      startWeight: parsed.data.startWeight ?? null,
      goalWeight: parsed.data.goalWeight ?? null,
      startingPaceSec: parsed.data.startingPaceSec ?? null,
      goalEndingPaceSec: parsed.data.goalEndingPaceSec ?? null,
      dailyBudget: parsed.data.dailyBudget ?? null,
      updatedAt: new Date(),
    })
    .where(eq(plannerConfigsTable.id, id));
  const row = (
    await db
      .select()
      .from(plannerConfigsTable)
      .where(eq(plannerConfigsTable.id, id))
      .limit(1)
  )[0]!;
  req.log.info({ id, name: row.name }, "planner config updated");
  res.json(toPlannerConfig(row));
});

router.delete("/planner/configs/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const result = await db.transaction(async (tx) => {
    const target = (
      await tx
        .select()
        .from(plannerConfigsTable)
        .where(eq(plannerConfigsTable.id, id))
        .limit(1)
    )[0];
    if (!target) return { kind: "not_found" as const };
    await tx
      .delete(plannerConfigsTable)
      .where(eq(plannerConfigsTable.id, id));
    // If the deleted config was active, promote the most-recently
    // updated remaining config to active. If no rows remain, the
    // planner falls back to its empty "create your first config"
    // state and newActiveId stays null.
    let newActiveId: number | null = null;
    if (target.isActive) {
      const promote = await tx
        .select({ id: plannerConfigsTable.id })
        .from(plannerConfigsTable)
        .orderBy(desc(plannerConfigsTable.updatedAt))
        .limit(1);
      if (promote[0]) {
        newActiveId = promote[0].id;
        await tx
          .update(plannerConfigsTable)
          .set({ isActive: true })
          .where(eq(plannerConfigsTable.id, newActiveId));
      }
    }
    return { kind: "ok" as const, newActiveId };
  });
  if (result.kind === "not_found") {
    res.status(404).json({ error: "Config not found" });
    return;
  }
  req.log.info(
    { deletedId: id, newActiveId: result.newActiveId },
    "planner config deleted",
  );
  res.json({ deletedId: id, newActiveId: result.newActiveId });
});

router.post("/planner/configs/:id/duplicate", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  // Body is optional: an empty body is allowed (defaults the name).
  const bodyToParse = req.body ?? {};
  const parsed = DuplicatePlannerConfigBody.safeParse(bodyToParse);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const inserted = await db.transaction(async (tx) => {
    const src = (
      await tx
        .select()
        .from(plannerConfigsTable)
        .where(eq(plannerConfigsTable.id, id))
        .limit(1)
    )[0];
    if (!src) return null;
    const newId = await nextConfigId(tx);
    const now = new Date();
    const name = parsed.data.name?.trim() || `${src.name} (copy)`;
    await tx.insert(plannerConfigsTable).values({
      id: newId,
      name,
      // Duplicates never inherit active status — runner must explicitly
      // activate before applying.
      isActive: false,
      startDate: src.startDate,
      marathonDate: src.marathonDate,
      blocks: src.blocks,
      entries: src.entries,
      notes: src.notes,
      startWeight: src.startWeight,
      goalWeight: src.goalWeight,
      startingPaceSec: src.startingPaceSec,
      goalEndingPaceSec: src.goalEndingPaceSec,
      dailyBudget: src.dailyBudget,
      createdAt: now,
      updatedAt: now,
      // Apply lineage is intentionally NOT copied — applied_* and
      // last_applied_at only get populated by an actual Apply call.
    });
    const row = (
      await tx
        .select()
        .from(plannerConfigsTable)
        .where(eq(plannerConfigsTable.id, newId))
        .limit(1)
    )[0]!;
    return row;
  });
  if (!inserted) {
    res.status(404).json({ error: "Config not found" });
    return;
  }
  req.log.info(
    { sourceId: id, newId: inserted.id, name: inserted.name },
    "planner config duplicated",
  );
  res.status(201).json(toPlannerConfig(inserted));
});

router.post("/planner/configs/:id/activate", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const updated = await db.transaction(async (tx) => {
    const target = (
      await tx
        .select({ id: plannerConfigsTable.id })
        .from(plannerConfigsTable)
        .where(eq(plannerConfigsTable.id, id))
        .limit(1)
    )[0];
    if (!target) return null;
    // Single-active invariant maintained transactionally: clear every
    // OTHER row's flag, then set this one. Done in two statements so
    // there's no instant where >1 row has isActive=true.
    await tx
      .update(plannerConfigsTable)
      .set({ isActive: false })
      .where(and(eq(plannerConfigsTable.isActive, true), ne(plannerConfigsTable.id, id)));
    await tx
      .update(plannerConfigsTable)
      .set({ isActive: true })
      .where(eq(plannerConfigsTable.id, id));
    return (
      await tx
        .select()
        .from(plannerConfigsTable)
        .where(eq(plannerConfigsTable.id, id))
        .limit(1)
    )[0]!;
  });
  if (!updated) {
    res.status(404).json({ error: "Config not found" });
    return;
  }
  req.log.info({ id, name: updated.name }, "planner config activated");
  res.json(toPlannerConfig(updated));
});

// Task #370: in-place re-pace of the already-applied campaign.
// Updates `applied_starting_pace_sec` on the most-recently-applied
// planner_configs row AND mirrors the new value back into the source
// `starting_pace_sec` column so the next /planner/apply (or a Full
// Reset + re-apply) re-uses it. Then runs the pace-target backfill
// to regenerate uncustomized run cards in place. Workouts,
// measurements, race results, race-week checklist, and ANY /plan-
// edited day cards are preserved.
router.post("/planner/applied/starting-pace", async (req, res): Promise<void> => {
  const body = (req.body ?? {}) as {
    startingPaceSec?: unknown;
    goalEndingPaceSec?: unknown;
  };
  // Task #373 (review fix). Both anchors are independently optional:
  // absent key leaves the applied value untouched (so a runner can
  // patch ONLY the goal without clobbering their starting pace, and
  // vice versa); explicit null clears the override; a valid integer
  // writes it.
  const startProvided = Object.prototype.hasOwnProperty.call(
    body,
    "startingPaceSec",
  );
  const raw = body.startingPaceSec;
  let startingPaceSec: number | null | undefined;
  if (!startProvided) {
    startingPaceSec = undefined;
  } else if (raw === null || raw === undefined) {
    startingPaceSec = null;
  } else if (
    typeof raw === "number" &&
    Number.isInteger(raw) &&
    raw >= 360 &&
    raw <= 1500
  ) {
    startingPaceSec = raw;
  } else {
    res.status(400).json({
      error:
        "startingPaceSec must be an integer between 360 and 1500 seconds/mi, or null.",
    });
    return;
  }

  // Task #373. Optional goal ending pace anchor. Absent key → leave the
  // applied row's existing value alone (legacy single-field callers).
  // Present key with null → clear the override. Present key with number
  // → validate + write.
  const goalProvided = Object.prototype.hasOwnProperty.call(
    body,
    "goalEndingPaceSec",
  );
  const rawGoal = body.goalEndingPaceSec;
  let goalEndingPaceSec: number | null | undefined;
  if (!goalProvided) {
    goalEndingPaceSec = undefined;
  } else if (rawGoal === null || rawGoal === undefined) {
    goalEndingPaceSec = null;
  } else if (
    typeof rawGoal === "number" &&
    Number.isInteger(rawGoal) &&
    rawGoal >= 360 &&
    rawGoal <= 1500
  ) {
    goalEndingPaceSec = rawGoal;
  } else {
    res.status(400).json({
      error:
        "goalEndingPaceSec must be an integer between 360 and 1500 seconds/mi, or null.",
    });
    return;
  }

  const cfgRows = await db
    .select()
    .from(plannerConfigsTable)
    .where(sql`${plannerConfigsTable.lastAppliedAt} IS NOT NULL`)
    .orderBy(desc(plannerConfigsTable.lastAppliedAt))
    .limit(1);
  const cfg = cfgRows[0];
  if (!cfg) {
    res.status(404).json({
      error: "No applied planner config to re-pace. Apply a config first.",
    });
    return;
  }

  // Short-circuit when the caller sent neither key — nothing to write,
  // but still safe to run the backfill (it's idempotent and helps when
  // an upstream config change needs the run cards re-paced).
  const updateSet: Record<string, number | null> = {};
  if (startingPaceSec !== undefined) {
    updateSet.startingPaceSec = startingPaceSec;
    updateSet.appliedStartingPaceSec = startingPaceSec;
  }
  if (goalEndingPaceSec !== undefined) {
    updateSet.goalEndingPaceSec = goalEndingPaceSec;
    updateSet.appliedGoalEndingPaceSec = goalEndingPaceSec;
  }
  if (Object.keys(updateSet).length > 0) {
    await db
      .update(plannerConfigsTable)
      .set(updateSet)
      .where(eq(plannerConfigsTable.id, cfg.id));
  }

  const result = await backfillPaceTargetCards();

  // Echo the effective values in the response: the newly-written value
  // when the runner sent it, otherwise the existing applied snapshot
  // so the client always sees the current truth in one round-trip.
  const effectiveStart =
    startingPaceSec !== undefined
      ? startingPaceSec
      : cfg.appliedStartingPaceSec ?? null;
  const effectiveGoal =
    goalEndingPaceSec !== undefined
      ? goalEndingPaceSec
      : cfg.appliedGoalEndingPaceSec ?? null;

  req.log.warn(
    {
      configId: cfg.id,
      configName: cfg.name,
      startingPaceSec: effectiveStart,
      goalEndingPaceSec: effectiveGoal,
      ...result,
    },
    "planner starting pace updated in place — pace-target backfill applied",
  );

  res.json({
    startingPaceSec: effectiveStart,
    goalEndingPaceSec: effectiveGoal,
    ...result,
  });
});

// Apply the active Planner config: regenerate plan_weeks/plan_days,
// preserving logged workouts and measurements. Reset-undo snapshots are
// dropped because their plan_day ids no longer match. Workout
// plan_day_id FKs are best-effort rebound by date.
router.post("/planner/apply", async (req, res): Promise<void> => {
  await ensureSomeActive();
  const rows = await db
    .select()
    .from(plannerConfigsTable)
    .where(eq(plannerConfigsTable.isActive, true))
    .limit(1);
  const row = rows[0];
  if (!row) {
    res.status(400).json({
      error: "No active Planner config to apply. Create one and activate it first.",
    });
    return;
  }
  // Surface entries so the generator picks the entries-mode codepath
  // (template-owned taper, no auto-pinned 16w tail). Without this an
  // entries-composed config would be re-validated as legacy and fail
  // because stored projected blocks sum to the FULL totalWeeks.
  const config: PlannerConfig = {
    startDate: row.startDate,
    marathonDate: row.marathonDate,
    blocks: row.blocks as PhaseBlock[],
    entries: (row.entries as TemplateEntry[] | null) ?? null,
    startingPaceSec: row.startingPaceSec ?? null,
    goalEndingPaceSec: row.goalEndingPaceSec ?? null,
    // Task #338: thread the runner's daily-budget override through so
    // every builder path inside the generator widens / tightens
    // accordingly.
    dailyBudget: row.dailyBudget ?? null,
  };

  // Generate OUTSIDE the transaction so a generator bug (e.g. validation
  // mismatch) can't leave us with truncated plan tables. Task #135:
  // expandConfigToPlanRows runs the per-entry generator (so each
  // TemplateEntry produces its own tagged plan_days), aggregates weekly
  // totals across overlapping entries, AND gap-fills any uncovered
  // campaign week with synthetic Recovery rows from the projected
  // single-track fallback so the calendar stays continuous between
  // non-adjacent entries.
  const { weekly: aggregatedWeekly, taggedDaily } =
    expandConfigToPlanRows(config);

  const result = await db.transaction(async (tx) => {
    await tx.execute(
      sql`LOCK TABLE plan_days, plan_weeks, reset_undo_snapshots IN ACCESS EXCLUSIVE MODE`,
    );

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

    await tx.execute(
      sql`TRUNCATE TABLE plan_days, plan_weeks, reset_undo_snapshots RESTART IDENTITY CASCADE`,
    );

    await tx.insert(planWeeksTable).values(
      aggregatedWeekly.map((w) => ({
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
    for (let i = 0; i < taggedDaily.length; i += chunk) {
      const slice = taggedDaily.slice(i, i + chunk);
      await tx.insert(planDaysTable).values(
        slice.map(({ row: d, sourceEntryIndex, sourceEntryLabel }) => {
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
            sourceEntryIndex,
            sourceEntryLabel,
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

    await tx.execute(sql`
      UPDATE workouts w
      SET plan_day_id = pd.id
      FROM plan_days pd
      WHERE pd.date = w.date AND w.plan_day_id IS NULL
    `);

    // Snapshot the just-applied config into applied_* columns on the
    // active row so future /plan/full-reset, dashboard, and race-week
    // reads pivot off this exact config.
    await tx
      .update(plannerConfigsTable)
      .set({
        lastAppliedAt: new Date(),
        appliedStartDate: config.startDate,
        appliedMarathonDate: config.marathonDate,
        appliedBlocks: config.blocks,
        // Snapshot entries (or NULL for legacy mode) so a later
        // /plan/full-reset re-runs the generator in the SAME mode the
        // runner originally applied, not silently downgraded to legacy.
        appliedEntries: config.entries ?? null,
        // Task #330. Body-mass targets snapshot — frozen at apply
        // time so toggling a different config active later doesn't
        // silently re-anchor the dashboard / plan header until that
        // OTHER config is itself applied.
        appliedStartWeight: row.startWeight ?? null,
        appliedGoalWeight: row.goalWeight ?? null,
        appliedStartingPaceSec: row.startingPaceSec ?? null,
        // Task #373. Snapshot the goal ending pace alongside the
        // starting pace so the linear-interp ramp anchors are
        // preserved across full reset / undo.
        appliedGoalEndingPaceSec: row.goalEndingPaceSec ?? null,
        // Task #338. Snapshot the daily-budget override so a later
        // /plan/full-reset re-runs the generator with the SAME override
        // the runner applied here.
        appliedDailyBudget: row.dailyBudget ?? null,
      })
      .where(eq(plannerConfigsTable.id, row.id));

    return {
      weeksSeeded: aggregatedWeekly.length,
      daysSeeded: taggedDaily.length,
      workoutsPreserved: workoutsBefore,
      measurementsPreserved: measurementsBefore,
      undoSnapshotsWiped: snapshotsBefore,
      totalWeeks: aggregatedWeekly.length,
    };
  });

  req.log.warn(
    {
      configId: row.id,
      configName: row.name,
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
