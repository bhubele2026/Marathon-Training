import { Router, type IRouter, type Request } from "express";
import { db, planDaysTable, workoutsTable, type WorkoutRow } from "@workspace/db";
import { and, asc, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { CreateWorkoutBody, UpdateWorkoutBody, ListWorkoutsQueryParams } from "@workspace/api-zod";
import { LIFESTYLE_EQUIPMENT } from "@workspace/plan-generator";
import { toWorkout, type PrescribedRunTargetSource } from "../lib/transforms";
import { invalidateDayTarget } from "../lib/nutrition-day-target";

const router: IRouter = Router();

// Canonical chip-rail priority enforced server-side so every client
// (UI, scripts, third-party) persists the same order. The lead chip is
// also the scalar `equipment` for back-compat readers.
const CANONICAL_EQUIPMENT_PRIORITY = [
  "Tonal",
  "Peloton Bike",
  "Peloton Row",
  "Peloton Tread",
  "Outdoor",
  LIFESTYLE_EQUIPMENT,
  "None",
] as const;

const EQUIPMENT_RANK = new Map<string, number>(
  CANONICAL_EQUIPMENT_PRIORITY.map((name, idx) => [name, idx]),
);

function sortEquipmentByCanonicalPriority(values: string[]): string[] {
  return [...values].sort((a, b) => {
    const ra = EQUIPMENT_RANK.get(a) ?? Number.MAX_SAFE_INTEGER;
    const rb = EQUIPMENT_RANK.get(b) ?? Number.MAX_SAFE_INTEGER;
    return ra - rb;
  });
}

// Reconcile (equipment, equipmentList) so the lead chip and the legacy
// scalar can't disagree, and so the rail is always persisted in canonical
// priority order regardless of client. Returns `null` for inconsistent
// input (caller rejects with 400). Empty `{}` means "patch touches neither".
function resolveEquipment(
  body: { equipment?: string; equipmentList?: string[] | null | undefined },
): { equipment?: string; equipmentList?: string[] } | null {
  const list = body.equipmentList;
  const scalar = body.equipment;
  if (list != null) {
    if (list.length === 0) return null;
    const sorted = sortEquipmentByCanonicalPriority(list);
    const lead = sorted[0]!;
    if (scalar != null && scalar !== lead) return null;
    return { equipment: lead, equipmentList: sorted };
  }
  if (scalar != null) {
    return { equipment: scalar, equipmentList: [scalar] };
  }
  return {};
}

// Look up the matched plan day for a workout's `planDayId` so the
// canonical Workout response can include `prescribedRunTarget` (Task
// #140). Returns null when the workout has no planDayId or the
// referenced plan day no longer exists. Kept outside the route handlers
// so create / update / list all serialize the same shape.
async function fetchPrescribedRunTarget(
  planDayId: number | null,
): Promise<PrescribedRunTargetSource | null> {
  if (planDayId == null) return null;
  const rows = await db
    .select({
      sessionType: planDaysTable.sessionType,
      week: planDaysTable.week,
      runMin: planDaysTable.runMin,
      distanceMi: planDaysTable.distanceMi,
      pace: planDaysTable.pace,
    })
    .from(planDaysTable)
    .where(eq(planDaysTable.id, planDayId))
    .limit(1);
  return rows[0] ?? null;
}

// Task #294: count of legacy workouts that the Task #161 retro-link
// backfill couldn't match to a plan day (logged before the active
// config existed, or on a date with no plan_day on file). Surfaced as a
// small badge on /log so the runner can spot orphans and either
// reassign them via the existing edit form or accept they're truly
// off-plan. Re-runs of the backfill or PATCHes that set planDayId clear
// the count automatically — no extra invalidation plumbing needed
// because the badge re-fetches whenever the workouts list does.
router.get("/workouts/unlinked-count", async (_req, res): Promise<void> => {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(workoutsTable)
    .where(isNull(workoutsTable.planDayId));
  res.json({ count: rows[0]?.count ?? 0 });
});

router.get("/workouts", async (req, res): Promise<void> => {
  const parsed = ListWorkoutsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { limit, from, to, equipment, timeOfDay } = parsed.data;
  const conditions = [];
  if (from) conditions.push(gte(workoutsTable.date, from));
  if (to) conditions.push(lte(workoutsTable.date, to));
  if (equipment) conditions.push(eq(workoutsTable.equipment, equipment));
  if (timeOfDay) conditions.push(eq(workoutsTable.timeOfDay, timeOfDay));
  // Left join the matched plan day so each Workout row carries the
  // prescribed run-target snapshot (Task #140). Rows with no
  // `planDayId`, or whose referenced plan day was deleted, get a NULL
  // join and serialize `prescribedRunTarget: null` — the client treats
  // that as "no target line for this row" and renders nothing.
  const rows = await db
    .select({
      workout: workoutsTable,
      planDay: {
        sessionType: planDaysTable.sessionType,
        week: planDaysTable.week,
        runMin: planDaysTable.runMin,
        distanceMi: planDaysTable.distanceMi,
        pace: planDaysTable.pace,
      },
    })
    .from(workoutsTable)
    .leftJoin(planDaysTable, eq(workoutsTable.planDayId, planDaysTable.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(
      desc(workoutsTable.date),
      // Within a single day, surface AM tags before PM, then Other, then
      // untagged. Falls back to createdAt desc so the newest log wins ties.
      sql`CASE ${workoutsTable.timeOfDay}
        WHEN 'AM' THEN 0
        WHEN 'PM' THEN 1
        WHEN 'Other' THEN 2
        ELSE 3
      END`,
      desc(workoutsTable.createdAt),
    )
    .limit(limit ?? 500);
  res.json(
    rows.map((r) =>
      toWorkout(
        r.workout,
        // The leftJoin returns an object with all-null columns when no
        // plan day matched; use sessionType (NOT NULL on the table) as
        // the discriminator so we don't pass a half-null PlanDaySource.
        r.planDay && r.planDay.sessionType != null ? r.planDay : null,
      ),
    ),
  );
});

router.post("/workouts", async (req, res): Promise<void> => {
  const parsed = CreateWorkoutBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const equip = resolveEquipment(d);
  if (equip == null) {
    res.status(400).json({
      error: "equipmentList must be non-empty and equipmentList[0] must equal equipment when both are provided",
    });
    return;
  }
  const inserted = await db.insert(workoutsTable).values({
    planDayId: d.planDayId ?? null,
    date: d.date,
    equipment: equip.equipment ?? d.equipment,
    equipmentList: equip.equipmentList ?? [d.equipment],
    sessionType: d.sessionType,
    durationMin: d.durationMin ?? null,
    // Per-bucket actual minutes (Task #76). Nullable so existing
    // duration-only logging flows still work; the form / Crushed-It
    // shortcut populate these alongside `durationMin` when a plan day
    // breakdown is available.
    strengthMin: d.strengthMin ?? null,
    cardioMin: d.cardioMin ?? null,
    runMin: d.runMin ?? null,
    distanceMi: d.distanceMi ?? null,
    pace: d.pace ?? null,
    avgHr: d.avgHr ?? null,
    rpe: d.rpe ?? null,
    strengthLoad: d.strengthLoad ?? null,
    totalLoad: d.totalLoad ?? null,
    notes: d.notes ?? null,
    timeOfDay: d.timeOfDay ?? null,
    modality: d.modality ?? null,
  }).returning();
  // R5: logging a workout reshapes that date's reactive nutrition target
  // (planned → actual). Bust the cache so the next GET recomputes.
  await invalidateDayTarget(inserted[0]!.date);
  const prescribed = await fetchPrescribedRunTarget(inserted[0]!.planDayId);
  res.status(201).json(toWorkout(inserted[0]!, prescribed));
});

// Task #270: lazily mirror the originally-logged values into seed_* the
// first time a workout is edited. The same idea (and contract) as
// `ensureSeedSnapshot` for plan_days — once seedSessionType is set,
// every mutable column has a snapshot, so the diff helpers in
// transforms.ts can compute a well-defined before/after for every field.
function buildWorkoutSeedSnapshot(row: WorkoutRow): Record<string, unknown> | null {
  if (row.seedSessionType != null) return null;
  return {
    seedSessionType: row.sessionType,
    seedEquipment: row.equipment,
    // Normalize NULL chip rails to `[scalar]` so a later equipment-only
    // edit + diff doesn't falsely flag the rail as customized just
    // because legacy rows persisted NULL where current rows persist
    // `[equipment]`. Mirrors the same fallback `toWorkout` exposes.
    seedEquipmentList: row.equipmentList ?? [row.equipment],
    seedDurationMin: row.durationMin,
    seedStrengthMin: row.strengthMin,
    seedCardioMin: row.cardioMin,
    seedRunMin: row.runMin,
    seedDistanceMi: row.distanceMi,
    seedPace: row.pace,
    seedAvgHr: row.avgHr,
    seedRpe: row.rpe,
    seedStrengthLoad: row.strengthLoad,
    seedTotalLoad: row.totalLoad,
    seedNotes: row.notes,
    seedTimeOfDay: row.timeOfDay,
    seedModality: row.modality,
  };
}

router.patch("/workouts/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "invalid id" });
    return;
  }
  const parsed = UpdateWorkoutBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const equip = resolveEquipment(parsed.data);
  if (equip == null) {
    res.status(400).json({
      error: "equipmentList must be non-empty and equipmentList[0] must equal equipment when both are provided",
    });
    return;
  }
  const patch: Record<string, unknown> = { ...parsed.data };
  if (equip.equipment != null) {
    patch.equipment = equip.equipment;
  }
  if (equip.equipmentList != null) {
    patch.equipmentList = equip.equipmentList;
  } else {
    // An explicit `equipmentList: null` from the client is treated as
    // "not provided" rather than "clear the rail", so a subsequent PATCH
    // that only touches unrelated fields can never erase a previously
    // multi-machine rail.
    delete patch.equipmentList;
  }
  const result = await db.transaction(async (tx) => {
    const existing = (
      await tx.select().from(workoutsTable).where(eq(workoutsTable.id, id)).limit(1)
    )[0];
    if (!existing) return null;
    // Snapshot the original values (lazy) so the "Edited" badge can
    // surface a before/after diff after this PATCH lands.
    const seedPatch = buildWorkoutSeedSnapshot(existing);
    const finalPatch = seedPatch ? { ...patch, ...seedPatch } : patch;
    const next = await tx
      .update(workoutsTable)
      .set(finalPatch)
      .where(eq(workoutsTable.id, id))
      .returning();
    return { updated: next[0]!, prevDate: existing.date };
  });
  if (!result) {
    res.status(404).json({ error: "not found" });
    return;
  }
  const { updated, prevDate } = result;
  // R5: editing/skipping a workout reshapes that date's reactive nutrition
  // target. Bust both the previous and (possibly changed) new date.
  await invalidateDayTarget(prevDate);
  if (updated.date !== prevDate) await invalidateDayTarget(updated.date);
  const prescribed = await fetchPrescribedRunTarget(updated.planDayId);
  res.json(toWorkout(updated, prescribed));
});

// ---------------------------------------------------------------------------
// Apple Health import (Tonal + Peloton Bike/Row/Tread + treadmill runs)
// ---------------------------------------------------------------------------
//
// HealthKit Workouts are POSTed here so machine actuals land in the same
// workouts log + planned-vs-actual views as hand-logged sessions. Two payload
// shapes are accepted, because iOS Shortcuts has NO action that can read past
// Workouts (only quantity samples), so the real-world feed is the Health Auto
// Export app's scheduled REST export:
//   1. Simple:  { workouts: [{ type, start, durationMin, distanceMi, ... }] }
//   2. Health Auto Export: { data: { workouts: [{ name, start, duration(sec),
//        distance: {qty,units}, activeEnergyBurned: {qty}, avgHeartRate: {qty},
//        id, ... }] } }
// `coerceItem` normalizes either into the canonical ImportItem below. Gated by
// the shared NUTRITION_TOKEN ingest secret (same one the nutrition sync uses).
// Idempotent on `source_key` — re-running the export, and Health/Strava
// double-exports of the same session, collapse to one row.

type ImportItem = {
  type?: unknown;
  start?: unknown;
  end?: unknown;
  durationMin?: unknown;
  calories?: unknown;
  distanceMi?: unknown;
  avgHr?: unknown;
  indoor?: unknown;
  equipment?: unknown;
  sourceKey?: unknown;
};

// Map a HealthKit workout activity-type string to the app's fixed equipment
// vocabulary + modality + the minute-bucket the duration belongs in. Running
// defaults to the treadmill (the runner's 5Ks are Tonal-stack tread runs);
// an explicit `indoor: false` routes it to Outdoor.
function mapActivity(
  rawType: string,
  indoor: boolean | null,
): { equipment: string; modality: string; sessionType: string; bucket: "strength" | "cardio" | "run" } {
  const t = rawType.toLowerCase();
  if (/strength|functional|traditional|tonal|lifting|weight/.test(t)) {
    return { equipment: "Tonal", modality: "Strength", sessionType: "Strength", bucket: "strength" };
  }
  if (/cycl|bike|spin/.test(t)) {
    return { equipment: "Peloton Bike", modality: "Cardio", sessionType: "Ride", bucket: "cardio" };
  }
  if (/row/.test(t)) {
    return { equipment: "Peloton Row", modality: "Cardio", sessionType: "Row", bucket: "cardio" };
  }
  if (/run|jog/.test(t)) {
    return indoor === false
      ? { equipment: "Outdoor", modality: "Cardio", sessionType: "Run", bucket: "run" }
      : { equipment: "Peloton Tread", modality: "Cardio", sessionType: "Run", bucket: "run" };
  }
  if (/walk|hik/.test(t)) {
    return { equipment: LIFESTYLE_EQUIPMENT, modality: "Cardio", sessionType: "Walk", bucket: "cardio" };
  }
  return { equipment: LIFESTYLE_EQUIPMENT, modality: "Cardio", sessionType: "Cardio", bucket: "cardio" };
}

// Best-effort link an imported workout to a plan day on the same date, mirroring
// the backfill scoring (sessionType match +2, equipment present +1; ties → lowest
// id) so planned-vs-actual lights up immediately without waiting for the
// post-merge backfill script.
async function linkPlanDay(
  date: string,
  sessionType: string,
  equipment: string,
): Promise<number | null> {
  const days = await db
    .select({
      id: planDaysTable.id,
      sessionType: planDaysTable.sessionType,
      equipment: planDaysTable.equipment,
      equipmentList: planDaysTable.equipmentList,
    })
    .from(planDaysTable)
    .where(eq(planDaysTable.date, date));
  let bestId: number | null = null;
  let bestScore = -1;
  for (const d of days) {
    let score = 0;
    if (d.sessionType === sessionType) score += 2;
    const list = d.equipmentList ?? [d.equipment];
    if (list.includes(equipment)) score += 1;
    if (score > bestScore || (score === bestScore && bestId != null && d.id < bestId)) {
      bestScore = score;
      bestId = d.id;
    }
  }
  return bestId;
}

function presentedToken(req: Request): string | null {
  const auth = req.header("authorization");
  if (auth && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, "").trim();
  const body = (req.body ?? {}) as Record<string, unknown>;
  const fromBody = body.token ?? body.secret;
  return typeof fromBody === "string" ? fromBody.trim() : null;
}

function num(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

// Health Auto Export wraps each measurement as { qty, units }. Pull a scalar
// number out of either that wrapper or a bare value so the importer accepts
// both payload shapes from the same helper.
function qtyOf(value: unknown): { qty: number | null; units: string | null } {
  if (value && typeof value === "object" && "qty" in (value as Record<string, unknown>)) {
    const o = value as { qty?: unknown; units?: unknown };
    return { qty: num(o.qty), units: typeof o.units === "string" ? o.units : null };
  }
  return { qty: num(value), units: null };
}

// Parse an import item's start timestamp. Date.parse handles ISO 8601 directly;
// HAE sends "yyyy-MM-dd HH:mm:ss ±HHmm", which we normalize to canonical ISO as
// a fallback so the importer never depends on JS-engine date leniency.
function parseStartMs(raw: string): number {
  const direct = Date.parse(raw);
  if (!Number.isNaN(direct)) return direct;
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})\s*([+-]\d{2}):?(\d{2})$/);
  return m ? Date.parse(`${m[1]}T${m[2]}${m[3]}:${m[4]}`) : NaN;
}

// Normalize one raw import item — simple Shortcut shape OR Health Auto Export
// shape — into the canonical ImportItem the import loop consumes. Every field
// prefers the simple/explicit form and falls back to the HAE equivalent.
// Parse a workout duration into MINUTES from the several shapes Health Auto
// Export (and the simple payload) use: a bare number of SECONDS, a
// { qty, units } object (s|min|hr), or an "HH:MM:SS" / "MM:SS" string.
function parseDurationMin(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  // Bare number (or numeric string) → HAE convention is seconds.
  const bare = num(raw);
  if (bare != null) return Math.round((bare / 60) * 10) / 10;
  // { qty, units } → convert by unit (default seconds).
  if (raw && typeof raw === "object") {
    const { qty, units } = qtyOf(raw);
    if (qty != null) {
      const u = (units ?? "s").toLowerCase();
      const min = u.startsWith("min") ? qty : u.startsWith("h") ? qty * 60 : qty / 60;
      return Math.round(min * 10) / 10;
    }
  }
  // "HH:MM:SS" / "MM:SS" clock string.
  if (typeof raw === "string" && raw.includes(":")) {
    const parts = raw.split(":").map((p) => Number(p));
    if (parts.length >= 2 && parts.every((p) => Number.isFinite(p))) {
      const secs =
        parts.length === 3
          ? parts[0]! * 3600 + parts[1]! * 60 + parts[2]!
          : parts[0]! * 60 + parts[1]!;
      return Math.round((secs / 60) * 10) / 10;
    }
  }
  return null;
}

function coerceItem(raw: Record<string, unknown>): ImportItem {
  // Activity label: simple payload uses `type`, HAE uses `name`.
  const type =
    (typeof raw.type === "string" && raw.type) ||
    (typeof raw.name === "string" ? raw.name : "");

  // Duration: simple payload sends minutes; HAE sends `duration` as seconds /
  // { qty, units } / "HH:MM:SS". An end-vs-start fallback is applied in the
  // route when this still comes up empty (HAE always sends start + end).
  let durationMin = num(raw.durationMin);
  if (durationMin == null) durationMin = parseDurationMin(raw.duration);

  // Distance: bare miles, or HAE's { qty, units } (mi|km → mi).
  let distanceMi = num(raw.distanceMi);
  if (distanceMi == null) {
    const d = qtyOf(raw.distance);
    if (d.qty != null) {
      distanceMi = d.units === "km" ? Math.round(d.qty * 0.621371 * 100) / 100 : d.qty;
    }
  }

  // Calories: bare number, or HAE active/total energy { qty, units }.
  let calories = num(raw.calories);
  if (calories == null) {
    calories = qtyOf(raw.activeEnergyBurned).qty ?? qtyOf(raw.totalEnergy).qty ?? null;
  }

  // Average HR: bare number, HAE's avgHeartRate { qty }, or heartRate.avg { qty }.
  let avgHr = num(raw.avgHr);
  if (avgHr == null) {
    avgHr = qtyOf(raw.avgHeartRate).qty;
    if (avgHr == null && raw.heartRate && typeof raw.heartRate === "object") {
      avgHr = qtyOf((raw.heartRate as Record<string, unknown>).avg).qty;
    }
  }

  // Indoor/outdoor: simple payload sends a boolean. Apple Health records both
  // indoor and outdoor runs as plain "Running", so the activity name can't
  // distinguish them — but HAE exposes a `location` of "Indoor"/"Outdoor"
  // (derived from HealthKit's indoor-workout metadata). Read that first, then
  // fall back to any indoor/outdoor hint in the name. Only used to route runs
  // between the treadmill (default) and Outdoor.
  let indoor: boolean | undefined =
    typeof raw.indoor === "boolean" ? (raw.indoor as boolean) : undefined;
  if (indoor === undefined) {
    const hints = `${typeof raw.location === "string" ? raw.location : ""} ${type}`.toLowerCase();
    if (hints.includes("outdoor")) indoor = false;
    else if (hints.includes("indoor")) indoor = true;
  }

  // Dedup key: prefer HAE's stable workout `id` so re-exports of the same
  // session collapse; otherwise honor an explicit sourceKey.
  const sourceKey =
    (typeof raw.sourceKey === "string" && raw.sourceKey) ||
    (typeof raw.id === "string" ? raw.id : undefined);

  return {
    type,
    start: typeof raw.start === "string" ? raw.start : undefined,
    end: typeof raw.end === "string" ? raw.end : undefined,
    durationMin: durationMin ?? undefined,
    distanceMi: distanceMi ?? undefined,
    calories: calories ?? undefined,
    avgHr: avgHr ?? undefined,
    indoor,
    equipment: typeof raw.equipment === "string" ? raw.equipment : undefined,
    sourceKey,
  };
}

// POST /api/workouts/import — body: { workouts: [...] } OR Health Auto
// Export's { data: { workouts: [...] } }; bearer/`token` auth.
router.post("/workouts/import", async (req, res): Promise<void> => {
  const required = process.env.NUTRITION_TOKEN;
  if (!required) {
    res.status(503).json({
      error:
        "Import is not configured. Set the NUTRITION_TOKEN secret on the server.",
    });
    return;
  }
  if (presentedToken(req) !== required) {
    res.status(401).json({ error: "Invalid or missing import token." });
    return;
  }

  // Accept the simple { workouts: [...] } shape and Health Auto Export's
  // nested { data: { workouts: [...] } } shape, then normalize each item.
  const body = (req.body ?? {}) as {
    workouts?: unknown;
    data?: { workouts?: unknown };
  };
  const rawArray = Array.isArray(body.workouts)
    ? body.workouts
    : Array.isArray(body.data?.workouts)
      ? (body.data as { workouts: unknown[] }).workouts
      : null;
  if (!rawArray) {
    res.status(400).json({
      error:
        "Send a workouts[] array (or Health Auto Export's { data: { workouts: [...] } }).",
    });
    return;
  }
  const items: ImportItem[] = rawArray.map((it) =>
    coerceItem((it ?? {}) as Record<string, unknown>),
  );

  let imported = 0;
  let skipped = 0;
  // R5: dates touched by this import whose reactive nutrition target must be
  // recomputed (a logged actual changed the day's training signal).
  const touchedDates = new Set<string>();
  for (const item of items) {
    const rawType = typeof item.type === "string" ? item.type : "";
    const startRaw = typeof item.start === "string" ? item.start : "";
    const startMs = parseStartMs(startRaw);
    if (!rawType || Number.isNaN(startMs)) {
      skipped++;
      continue;
    }
    const date = new Date(startMs).toISOString().slice(0, 10);
    const indoor =
      item.indoor === true ? true : item.indoor === false ? false : null;
    const mapped = mapActivity(rawType, indoor);
    // Allow the payload to override the inferred equipment with an explicit
    // canonical name (e.g. distinguishing an iFit tread from Peloton).
    const equipment =
      typeof item.equipment === "string" &&
      EQUIPMENT_RANK.has(item.equipment)
        ? item.equipment
        : mapped.equipment;

    // Duration in minutes. PREFER end − start: HAE always sends both, and the
    // elapsed span is unit-independent — immune to the `duration` field being
    // missing OR in unexpected units (HAE has been sending minutes where the
    // code expected seconds, collapsing a 10-min workout to ~0.17 → "0 min").
    // Only fall back to the payload's parsed duration when there's no usable
    // start/end span.
    let durationMin: number | null = null;
    const endMs = typeof item.end === "string" ? parseStartMs(item.end) : NaN;
    if (!Number.isNaN(endMs) && endMs > startMs) {
      durationMin = Math.round(((endMs - startMs) / 60000) * 10) / 10;
    }
    if (durationMin == null || durationMin === 0) {
      durationMin = num(item.durationMin);
    }
    const distanceMi = num(item.distanceMi);
    const avgHrRaw = num(item.avgHr);
    const avgHr = avgHrRaw != null ? Math.round(avgHrRaw) : null;
    const calories = num(item.calories);

    const sourceKey =
      (typeof item.sourceKey === "string" && item.sourceKey.trim()) ||
      `${new Date(startMs).toISOString()}::${mapped.sessionType}`;

    const planDayId = await linkPlanDay(date, mapped.sessionType, equipment);

    const notes =
      `Imported from Apple Health` +
      (calories != null ? ` · ${Math.round(calories)} kcal` : "");

    const buckets = {
      strengthMin: mapped.bucket === "strength" ? durationMin : null,
      cardioMin: mapped.bucket === "cardio" ? durationMin : null,
      runMin: mapped.bucket === "run" ? durationMin : null,
    };

    await db
      .insert(workoutsTable)
      .values({
        planDayId,
        date,
        equipment,
        equipmentList: [equipment],
        sessionType: mapped.sessionType,
        durationMin,
        ...buckets,
        distanceMi,
        avgHr,
        notes,
        modality: mapped.modality,
        sourceKey,
      })
      .onConflictDoUpdate({
        target: workoutsTable.sourceKey,
        set: {
          planDayId,
          date,
          equipment,
          equipmentList: [equipment],
          sessionType: mapped.sessionType,
          durationMin,
          ...buckets,
          distanceMi,
          avgHr,
          notes,
          modality: mapped.modality,
        },
      });
    imported++;
    touchedDates.add(date);
  }

  // Bust the reactive nutrition target cache for every date this import wrote.
  for (const d of touchedDates) await invalidateDayTarget(d);

  res.json({ imported, skipped });
});

router.delete("/workouts/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "invalid id" });
    return;
  }
  const existing = (
    await db
      .select({ date: workoutsTable.date })
      .from(workoutsTable)
      .where(eq(workoutsTable.id, id))
      .limit(1)
  )[0];
  await db.delete(workoutsTable).where(eq(workoutsTable.id, id));
  // R5: removing a logged workout reverts that date toward its planned
  // target — bust the cache so the next GET recomputes.
  if (existing) await invalidateDayTarget(existing.date);
  res.status(204).send();
});

export default router;
