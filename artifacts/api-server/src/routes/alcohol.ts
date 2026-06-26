import { Router, type IRouter, type Request } from "express";
import {
  db,
  alcoholEntriesTable,
  userPreferencesTable,
  type AlcoholEntryRow,
} from "@workspace/db";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { CreateAlcoholBody, UpdateAlcoholBody, ListAlcoholQueryParams } from "@workspace/api-zod";
import { localToday } from "../lib/day-state";

// Alcohol logging — timestamped, source-aware entries (standard drinks),
// mirroring the water store. In-app writes are ungated (same-origin,
// single-user). The tap-to-log Apple Shortcut authenticates with
// `Authorization: Bearer <ALCOHOL_TOKEN>` (or token/secret in the body); a
// valid bearer marks the entry source='shortcut'. A reduction tool: dry days
// are the positive metric (derived in the engine), not logged here.
const router: IRouter = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DRINKS = 50; // sanity ceiling per entry

async function localToday_(): Promise<string> {
  const rows = await db
    .select({ timezone: userPreferencesTable.timezone })
    .from(userPreferencesTable)
    .where(eq(userPreferencesTable.id, 1))
    .limit(1);
  return localToday(rows[0]?.timezone ?? null);
}

function isValidDate(d: string): boolean {
  return DATE_RE.test(d);
}

// The presented bearer secret from the Authorization header or the body.
function presentedToken(req: Request): string | null {
  const auth = req.header("authorization");
  if (auth && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, "").trim();
  const body = (req.body ?? {}) as Record<string, unknown>;
  const fromBody = body.token ?? body.secret;
  return typeof fromBody === "string" ? fromBody.trim() : null;
}

function toApi(row: AlcoholEntryRow) {
  return {
    id: row.id,
    date: row.date,
    loggedAt: row.loggedAt.toISOString(),
    standardDrinks: row.standardDrinks,
    kind: row.kind ?? undefined,
    source: row.source as "manual" | "shortcut",
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// GET /api/alcohol?from=&to= — entries for an inclusive local-day range, newest
// first; no params → most recent 200.
router.get("/alcohol", async (req, res): Promise<void> => {
  const parsed = ListAlcoholQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { from, to } = parsed.data;
  const conds = [];
  if (from && isValidDate(from)) conds.push(gte(alcoholEntriesTable.date, from));
  if (to && isValidDate(to)) conds.push(lte(alcoholEntriesTable.date, to));
  const rows = await db
    .select()
    .from(alcoholEntriesTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(alcoholEntriesTable.loggedAt))
    .limit(conds.length ? 2000 : 200);
  res.json(rows.map(toApi));
});

// POST /api/alcohol — log a drink. Ungated in-app; a bearer (when ALCOHOL_TOKEN
// is set) identifies the Shortcut and stamps source='shortcut'.
router.post("/alcohol", async (req, res): Promise<void> => {
  const parsed = CreateAlcoholBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  if (!Number.isFinite(d.standardDrinks) || d.standardDrinks < 0 || d.standardDrinks > MAX_DRINKS) {
    res.status(400).json({ error: `standardDrinks must be between 0 and ${MAX_DRINKS}.` });
    return;
  }

  // A presented bearer must match ALCOHOL_TOKEN (then it's the Shortcut);
  // absent bearer = trusted same-origin in-app write.
  const presented = presentedToken(req);
  let source: "manual" | "shortcut" = "manual";
  if (presented != null) {
    const expected = process.env["ALCOHOL_TOKEN"];
    if (!expected || presented !== expected) {
      res.status(401).json({ error: "Invalid alcohol token." });
      return;
    }
    source = "shortcut";
  }

  const date = d.date && isValidDate(d.date) ? d.date : await localToday_();
  const [row] = await db
    .insert(alcoholEntriesTable)
    .values({
      date,
      loggedAt: d.loggedAt ? new Date(d.loggedAt) : new Date(),
      standardDrinks: Math.round(d.standardDrinks * 100) / 100,
      kind: typeof d.kind === "string" && d.kind.trim() ? d.kind.trim() : null,
      source,
    })
    .returning();
  res.status(201).json(toApi(row!));
});

// POST /api/alcohol/dry — mark a day intentionally dry (a standardDrinks = 0
// entry), so TODAY counts as dry before it's past. Defaults to the local day.
router.post("/alcohol/dry", async (req, res): Promise<void> => {
  const body = (req.body ?? {}) as { date?: unknown };
  const date =
    typeof body.date === "string" && isValidDate(body.date) ? body.date : await localToday_();
  const [row] = await db
    .insert(alcoholEntriesTable)
    .values({ date, loggedAt: new Date(), standardDrinks: 0, kind: null, source: "manual" })
    .returning();
  res.status(201).json(toApi(row!));
});

// PATCH /api/alcohol/:id — edit an entry.
router.patch("/alcohol/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "invalid id" });
    return;
  }
  const parsed = UpdateAlcoholBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const existing = await db
    .select()
    .from(alcoholEntriesTable)
    .where(eq(alcoholEntriesTable.id, id))
    .limit(1);
  if (!existing[0]) {
    res.status(404).json({ error: "not found" });
    return;
  }
  const d = parsed.data;
  const set: Partial<AlcoholEntryRow> = { updatedAt: new Date() };
  if (d.standardDrinks !== undefined) {
    if (!Number.isFinite(d.standardDrinks) || d.standardDrinks < 0 || d.standardDrinks > MAX_DRINKS) {
      res.status(400).json({ error: `standardDrinks must be between 0 and ${MAX_DRINKS}.` });
      return;
    }
    set.standardDrinks = Math.round(d.standardDrinks * 100) / 100;
  }
  if (d.kind !== undefined) set.kind = typeof d.kind === "string" && d.kind.trim() ? d.kind.trim() : null;
  if (d.date !== undefined && isValidDate(d.date)) set.date = d.date;
  if (d.loggedAt !== undefined) set.loggedAt = new Date(d.loggedAt);

  const [row] = await db
    .update(alcoholEntriesTable)
    .set(set)
    .where(eq(alcoholEntriesTable.id, id))
    .returning();
  res.json(toApi(row!));
});

// DELETE /api/alcohol/:id — remove an entry.
router.delete("/alcohol/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "invalid id" });
    return;
  }
  await db.delete(alcoholEntriesTable).where(eq(alcoholEntriesTable.id, id));
  res.status(204).send();
});

export default router;
