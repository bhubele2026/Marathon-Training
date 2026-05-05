import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { sql } from "drizzle-orm";
import {
  db,
  planDaysTable,
  resetUndoSnapshotsTable,
} from "@workspace/db";
import app from "../app";
import {
  cleanTestData,
  E_OUTDOOR,
  E_TREADMILL,
  insertPlanDay,
  insertWeek,
  T_RUN,
} from "../test-helpers";

// Task #68: end-to-end proof that the reset → restart → undo flow works
// across an API process restart. Unit tests in `lib/reset-undo.test.ts`
// already prove the snapshot row survives a module reload at the helper
// layer; this suite exercises the same property through the public HTTP
// surface (`/api/plan/reset` + `/api/plan/reset/undo`) and additionally
// proves a freshly-imported app instance — i.e. a brand-new module
// graph, the closest in-process analogue to a real server restart — can
// consume a token issued by the previous instance, restoring the row to
// its pre-reset state.

const WEEK = 8068;
const PHASE = "Restart Undo Phase";
const DATE = "2099-06-08";

async function clearSnapshots(): Promise<void> {
  await db.delete(resetUndoSnapshotsTable);
}

beforeEach(async () => {
  await cleanTestData();
  await clearSnapshots();
});

afterEach(async () => {
  await cleanTestData();
  await clearSnapshots();
});

// Insert one edited plan_day (seed_* != null) so /api/plan/reset has
// something to wipe and capture in an undo snapshot. Returns the row
// id and the post-edit values that the reset will overwrite.
async function seedEditedPlanDay(): Promise<{
  id: number;
  editedSessionType: string;
  editedEquipment: string;
  editedDescription: string;
  seedSessionType: string;
  seedEquipment: string;
  seedDescription: string;
}> {
  await insertWeek(WEEK, {
    startDate: "2099-06-08",
    endDate: "2099-06-14",
    phase: PHASE,
  });
  const editedSessionType = `${T_RUN}_edited`;
  const editedEquipment = `${E_TREADMILL}_edited`;
  const editedDescription = "edited tempo";
  const seedSessionType = T_RUN;
  const seedEquipment = E_OUTDOOR;
  const seedDescription = "seeded easy run";
  const { id } = await insertPlanDay(WEEK, PHASE, {
    date: DATE,
    day: "Mon",
    sessionType: editedSessionType,
    equipment: editedEquipment,
    description: editedDescription,
  });
  // Stamp the seed_* mirror columns directly so the row looks like one a
  // PATCH /api/plan/:date edit would produce, without depending on that
  // route's own behavior.
  await db
    .update(planDaysTable)
    .set({
      seedSessionType,
      seedEquipment,
      seedEquipmentList: null,
      seedDescription,
      seedDistanceMi: null,
      seedStrengthMin: null,
      seedCardioMin: null,
      seedRunMin: null,
      seedPace: null,
      seedStrengthLoad: null,
      seedTotalLoad: 0,
      seedIsRest: false,
    })
    .where(sql`${planDaysTable.id} = ${id}`);
  return {
    id,
    editedSessionType,
    editedEquipment,
    editedDescription,
    seedSessionType,
    seedEquipment,
    seedDescription,
  };
}

describe("plan reset/undo across a simulated API restart", () => {
  it("undoes through a freshly-imported app instance using the original token", async () => {
    const edited = await seedEditedPlanDay();

    // Step 1: reset this week's customizations and capture the undo
    // token via HTTP. Week-scoped reset is used (rather than the
    // entire-plan reset) so the test stays isolated from any seed_*
    // edits already present in the dev/test database from the seeded
    // 52-week campaign — we only need to prove the round-trip works.
    const resetRes = await request(app)
      .post(`/api/plan/weeks/${WEEK}/reset`)
      .send({});
    expect(resetRes.status).toBe(200);
    expect(resetRes.body.daysReset).toBe(1);
    expect(typeof resetRes.body.undoToken).toBe("string");
    const undoToken: string = resetRes.body.undoToken;

    // Sanity: row was wiped back to its seed prescription and the
    // seed_* "edited" markers were cleared.
    const afterReset = (
      await db
        .select()
        .from(planDaysTable)
        .where(sql`${planDaysTable.id} = ${edited.id}`)
    )[0];
    expect(afterReset?.sessionType).toBe(edited.seedSessionType);
    expect(afterReset?.equipment).toBe(edited.seedEquipment);
    expect(afterReset?.description).toBe(edited.seedDescription);
    expect(afterReset?.seedSessionType).toBeNull();

    // Sanity: the snapshot row is physically present in the database, so
    // it cannot be living in some per-process in-memory cache.
    const persisted = await db
      .select()
      .from(resetUndoSnapshotsTable)
      .where(sql`${resetUndoSnapshotsTable.token} = ${undoToken}`);
    expect(persisted).toHaveLength(1);

    // Step 2: simulate an API restart. vi.resetModules() drops every
    // cached module so the next dynamic `import("../app")` builds a
    // brand-new Express instance backed by a fresh `reset-undo` module
    // (and a fresh `db` pool). This is the closest in-process analogue
    // to the API process being killed and respawned between the reset
    // click and the undo click.
    const { default: restartedApp } = await freshImportApp();

    // Step 3: undo through the restarted app using the original token.
    const undoRes = await request(restartedApp)
      .post("/api/plan/reset/undo")
      .send({ undoToken });
    expect(undoRes.status).toBe(200);
    expect(undoRes.body.daysRestored).toBe(1);
    expect(undoRes.body.weeksAffected).toEqual([WEEK]);

    // The plan_day is back to its edited values, including the seed_*
    // "edited" markers, so the row's edited indicator survives undo too.
    const afterUndo = (
      await db
        .select()
        .from(planDaysTable)
        .where(sql`${planDaysTable.id} = ${edited.id}`)
    )[0];
    expect(afterUndo?.sessionType).toBe(edited.editedSessionType);
    expect(afterUndo?.equipment).toBe(edited.editedEquipment);
    expect(afterUndo?.description).toBe(edited.editedDescription);
    expect(afterUndo?.seedSessionType).toBe(edited.seedSessionType);
    expect(afterUndo?.seedEquipment).toBe(edited.seedEquipment);
    expect(afterUndo?.seedDescription).toBe(edited.seedDescription);

    // Step 4: the snapshot is single-use. A second undo (on either app
    // instance) must 404, and the snapshot row must be gone from the DB.
    const secondUndo = await request(restartedApp)
      .post("/api/plan/reset/undo")
      .send({ undoToken });
    expect(secondUndo.status).toBe(404);
    const secondUndoOriginal = await request(app)
      .post("/api/plan/reset/undo")
      .send({ undoToken });
    expect(secondUndoOriginal.status).toBe(404);
    const remaining = await db
      .select()
      .from(resetUndoSnapshotsTable)
      .where(sql`${resetUndoSnapshotsTable.token} = ${undoToken}`);
    expect(remaining).toHaveLength(0);
  });
});

// Force a fresh module graph for `../app` (and therefore for the
// `reset-undo` helper, the route handlers, and the `@workspace/db`
// singleton) so the resulting Express instance has zero shared
// in-process state with the suite-level `app` import. Wrapped in a
// helper so the test body reads as a single linear flow.
async function freshImportApp(): Promise<{ default: typeof app }> {
  vi.resetModules();
  return (await import("../app")) as { default: typeof app };
}
