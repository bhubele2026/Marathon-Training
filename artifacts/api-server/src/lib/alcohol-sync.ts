import { db, alcoholEntriesTable, type AlcoholEntryRow } from "@workspace/db";
import { and, eq } from "drizzle-orm";

// Idempotent daily alcohol total from the Apple Health sync (the Shortcut posts
// a day's RUNNING TOTAL, often on a recurring automation). Keep exactly ONE
// source='shortcut' row per local day and overwrite it, so re-running never
// stacks duplicates. standardDrinks = 0 logs an explicit dry day. Manual in-app
// drinks are separate rows and are left untouched. Shared by the /api/alcohol
// route and the /api/nutrition Shortcut ingest (which carries an alcoholDrinks
// field) so both behave identically.
export async function upsertShortcutAlcohol(
  date: string,
  standardDrinks: number,
  kind?: string | null,
): Promise<{ row: AlcoholEntryRow; created: boolean }> {
  const drinks = Math.round(standardDrinks * 100) / 100;
  const cleanKind = typeof kind === "string" && kind.trim() ? kind.trim() : null;
  const existing = await db
    .select({ id: alcoholEntriesTable.id })
    .from(alcoholEntriesTable)
    .where(and(eq(alcoholEntriesTable.date, date), eq(alcoholEntriesTable.source, "shortcut")))
    .limit(1);
  if (existing[0]) {
    const [row] = await db
      .update(alcoholEntriesTable)
      .set({ standardDrinks: drinks, kind: cleanKind, loggedAt: new Date(), updatedAt: new Date() })
      .where(eq(alcoholEntriesTable.id, existing[0].id))
      .returning();
    return { row: row!, created: false };
  }
  const [row] = await db
    .insert(alcoholEntriesTable)
    .values({ date, loggedAt: new Date(), standardDrinks: drinks, kind: cleanKind, source: "shortcut" })
    .returning();
  return { row: row!, created: true };
}
