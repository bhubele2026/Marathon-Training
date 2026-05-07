import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { sql } from "drizzle-orm";
import {
  db,
  measurementsTable,
  planWeeksTable,
  plannerConfigsTable,
  resetUndoSnapshotsTable,
  workoutsTable,
} from "@workspace/db";
import {
  GetPlannerConfigResponse as PlannerConfigSchema,
  ListPlannerConfigsResponse,
  ApplyPlannerConfigResponse,
  DeletePlannerConfigResponse,
} from "@workspace/api-zod";
import {
  MARATHON_TAIL_WEEKS,
  PLAN_START_ISO,
  RACE_DATE_ISO,
  TOTAL_WEEKS,
} from "@workspace/plan-generator";
import app from "../app";
import { expectMatchesSchema } from "../test-helpers";

// Re-seed the canonical baseline before and after each test so any plan
// regeneration this suite triggers can't bleed into other suites.
// Task #244: /plan/full-reset now seeds a default Tonal-first planner
// config when planner_configs is empty, which means the resulting
// plan_days carry a non-null source_entry_label like "(Archived)
// tonal_strength_upper". Other suites (dashboard.test.ts in particular)
// were written against the pre-#244 legacy baseline where the seeded
// plan_days had a NULL source_entry_label. To keep this suite's
// "no applied config" baseline AND avoid bleeding labeled rows into
// downstream suites, we (a) wipe the auto-seeded planner_configs row
// after every full-reset and (b) NULL out source_entry_label on the
// freshly seeded plan_days so they look legacy-style to other tests.
async function resetToLegacyBaseline(): Promise<void> {
  await db.delete(plannerConfigsTable);
  await request(app).post("/api/plan/full-reset");
  await db.delete(plannerConfigsTable);
  await db.execute(sql`UPDATE plan_days SET source_entry_label = NULL`);
}

beforeEach(async () => {
  await resetToLegacyBaseline();
});

afterEach(async () => {
  await resetToLegacyBaseline();
});

// A minimal block list whose weeks sum to (TOTAL_WEEKS - 16) using the
// canonical PLAN_START_ISO / RACE_DATE_ISO so we don't have to recompute
// the dates against the calendar in every test.
function canonicalBlocks() {
  const userWeeks = TOTAL_WEEKS - MARATHON_TAIL_WEEKS;
  return [
    { focusType: "Base" as const, weeks: Math.floor(userWeeks / 2) },
    {
      focusType: "Time on Feet" as const,
      weeks: userWeeks - Math.floor(userWeeks / 2),
    },
  ];
}

async function createCanonicalConfig(name = "Primary") {
  const res = await request(app)
    .post("/api/planner/configs")
    .send({
      name,
      startDate: PLAN_START_ISO,
      marathonDate: RACE_DATE_ISO,
      blocks: canonicalBlocks(),
    });
  expect(res.status).toBe(201);
  return res.body as { id: number; name: string; isActive: boolean };
}

describe("GET /api/planner/configs", () => {
  it("returns an empty list and null activeId when none have been saved", async () => {
    const res = await request(app).get("/api/planner/configs");
    expect(res.status).toBe(200);
    expectMatchesSchema(ListPlannerConfigsResponse, res.body);
    expect(res.body.configs).toEqual([]);
    expect(res.body.activeId).toBeNull();
  });

  it("auto-activates the first created config and returns its id as activeId", async () => {
    const created = await createCanonicalConfig("First");
    expect(created.isActive).toBe(true);
    const res = await request(app).get("/api/planner/configs");
    expect(res.status).toBe(200);
    expectMatchesSchema(ListPlannerConfigsResponse, res.body);
    expect(res.body.configs).toHaveLength(1);
    expect(res.body.activeId).toBe(created.id);
  });
});

describe("POST /api/planner/configs", () => {
  it("creates a new config and the validation rejects invalid block weeks", async () => {
    await createCanonicalConfig("A");

    const bad = await request(app)
      .post("/api/planner/configs")
      .send({
        name: "Bad",
        startDate: PLAN_START_ISO,
        marathonDate: RACE_DATE_ISO,
        // Sums to 1, far short of the required (TOTAL_WEEKS - 16).
        blocks: [{ focusType: "Base", weeks: 1 }],
      });
    expect(bad.status).toBe(400);
  });

  it("does NOT auto-activate the second config (only first config is auto-active)", async () => {
    const a = await createCanonicalConfig("A");
    const b = await createCanonicalConfig("B");
    expect(b.isActive).toBe(false);
    const list = await request(app).get("/api/planner/configs");
    expect(list.body.activeId).toBe(a.id);
  });

  it("rejects when startDate is not a Monday", async () => {
    const res = await request(app)
      .post("/api/planner/configs")
      .send({
        name: "Tuesday start",
        // 2026-05-05 is a Tuesday.
        startDate: "2026-05-05",
        marathonDate: RACE_DATE_ISO,
        blocks: canonicalBlocks(),
      });
    expect(res.status).toBe(400);
  });
});

describe("PUT /api/planner/configs/:id", () => {
  it("updates an existing config in place and returns the new shape", async () => {
    const a = await createCanonicalConfig("A");
    const res = await request(app)
      .put(`/api/planner/configs/${a.id}`)
      .send({
        name: "A renamed",
        startDate: PLAN_START_ISO,
        marathonDate: RACE_DATE_ISO,
        blocks: canonicalBlocks(),
        notes: "renamed",
      });
    expect(res.status).toBe(200);
    expectMatchesSchema(PlannerConfigSchema, res.body);
    expect(res.body.name).toBe("A renamed");
    expect(res.body.notes).toBe("renamed");
  });

  it("404s on an unknown id", async () => {
    const res = await request(app)
      .put(`/api/planner/configs/9999`)
      .send({
        name: "x",
        startDate: PLAN_START_ISO,
        marathonDate: RACE_DATE_ISO,
        blocks: canonicalBlocks(),
      });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/planner/configs/:id/duplicate", () => {
  it("creates a copy with a defaulted name that is not active and not applied", async () => {
    const a = await createCanonicalConfig("Original");
    const res = await request(app)
      .post(`/api/planner/configs/${a.id}/duplicate`)
      .send({});
    expect(res.status).toBe(201);
    expectMatchesSchema(PlannerConfigSchema, res.body);
    expect(res.body.name).toBe("Original (copy)");
    expect(res.body.isActive).toBe(false);
    expect(res.body.lastAppliedAt).toBeNull();
  });

  it("honors a user-provided name", async () => {
    const a = await createCanonicalConfig("Original");
    const res = await request(app)
      .post(`/api/planner/configs/${a.id}/duplicate`)
      .send({ name: "My branch" });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("My branch");
  });
});

describe("POST /api/planner/configs/:id/activate", () => {
  it("flips the active flag and clears it on every other row", async () => {
    const a = await createCanonicalConfig("A");
    const b = await createCanonicalConfig("B");
    expect(a.isActive).toBe(true);
    expect(b.isActive).toBe(false);

    const res = await request(app).post(`/api/planner/configs/${b.id}/activate`);
    expect(res.status).toBe(200);
    expect(res.body.isActive).toBe(true);

    const list = await request(app).get("/api/planner/configs");
    expect(list.body.activeId).toBe(b.id);
    const aRow = list.body.configs.find((c: { id: number }) => c.id === a.id);
    expect(aRow.isActive).toBe(false);
  });
});

describe("DELETE /api/planner/configs/:id", () => {
  it("refuses to delete the only remaining config", async () => {
    const a = await createCanonicalConfig("Solo");
    const res = await request(app).delete(`/api/planner/configs/${a.id}`);
    expect(res.status).toBe(400);
  });

  it("deletes a non-active config without promoting anyone", async () => {
    const a = await createCanonicalConfig("A");
    const b = await createCanonicalConfig("B");
    const res = await request(app).delete(`/api/planner/configs/${b.id}`);
    expect(res.status).toBe(200);
    expectMatchesSchema(DeletePlannerConfigResponse, res.body);
    expect(res.body.deletedId).toBe(b.id);
    expect(res.body.newActiveId).toBeNull();
    const list = await request(app).get("/api/planner/configs");
    expect(list.body.activeId).toBe(a.id);
  });

  it("promotes the most-recently-updated remaining config when the active one is deleted", async () => {
    const a = await createCanonicalConfig("A"); // auto-active
    const b = await createCanonicalConfig("B");
    // Touch B so it's the most recently updated remaining row.
    await request(app)
      .put(`/api/planner/configs/${b.id}`)
      .send({
        name: "B touched",
        startDate: PLAN_START_ISO,
        marathonDate: RACE_DATE_ISO,
        blocks: canonicalBlocks(),
      });

    const res = await request(app).delete(`/api/planner/configs/${a.id}`);
    expect(res.status).toBe(200);
    expect(res.body.newActiveId).toBe(b.id);
  });
});

describe("POST /api/planner/apply", () => {
  it("400s when no active planner config exists", async () => {
    const res = await request(app).post("/api/planner/apply");
    expect(res.status).toBe(400);
  });

  it("regenerates plan_weeks/plan_days, preserves workouts + measurements, and drops undo snapshots", async () => {
    // Insert one of each "preserved across apply" row plus a snapshot
    // that should be dropped.
    await db.insert(workoutsTable).values({
      date: PLAN_START_ISO,
      equipment: "Outdoor",
      sessionType: "Run",
      durationMin: 30,
      distanceMi: 3.1,
    });
    await db.insert(measurementsTable).values({
      date: PLAN_START_ISO,
      weight: 250,
      notes: "pre-apply",
    });
    await db.insert(resetUndoSnapshotsTable).values({
      token: `planner-test-${Date.now()}`,
      snapshot: [],
      weeksAffected: [],
      expiresAt: new Date(Date.now() + 30_000),
    });

    await createCanonicalConfig("Apply target");

    const res = await request(app).post("/api/planner/apply");
    expect(res.status).toBe(200);
    expectMatchesSchema(ApplyPlannerConfigResponse, res.body);

    expect(res.body.weeksSeeded).toBe(TOTAL_WEEKS);
    expect(res.body.daysSeeded).toBe(TOTAL_WEEKS * 7);
    expect(res.body.workoutsPreserved).toBeGreaterThanOrEqual(1);
    expect(res.body.measurementsPreserved).toBeGreaterThanOrEqual(1);
    expect(res.body.undoSnapshotsWiped).toBeGreaterThanOrEqual(1);
    expect(res.body.totalWeeks).toBe(TOTAL_WEEKS);

    // Workout + measurement survive; snapshot was dropped.
    const wcount = await db.execute<{ count: number }>(
      sql`SELECT COUNT(*)::int AS count FROM workouts WHERE date = ${PLAN_START_ISO}`,
    );
    expect(wcount.rows[0]?.count ?? 0).toBeGreaterThanOrEqual(1);
    const mcount = await db.execute<{ count: number }>(
      sql`SELECT COUNT(*)::int AS count FROM measurements WHERE date = ${PLAN_START_ISO}`,
    );
    expect(mcount.rows[0]?.count ?? 0).toBeGreaterThanOrEqual(1);
    const scount = await db.execute<{ count: number }>(
      sql`SELECT COUNT(*)::int AS count FROM reset_undo_snapshots`,
    );
    expect(scount.rows[0]?.count ?? 0).toBe(0);

    // Workout was rebound to the new plan_day with the same date.
    const wrows = await db
      .select()
      .from(workoutsTable)
      .where(sql`${workoutsTable.date} = ${PLAN_START_ISO}`);
    expect(wrows[0]?.planDayId).not.toBeNull();
  });

  it("treats a saved-but-not-applied SECOND config as not the active applied config", async () => {
    // Create + apply config A.
    await createCanonicalConfig("A");
    await request(app).post("/api/planner/apply").expect(200);

    // Create config B at a DIFFERENT marathon date, but DON'T apply.
    // Pick another valid Mon→Sun window of the same length so validation
    // passes.
    const altStart = "2026-05-11"; // Monday
    const altRace = "2027-05-09"; // Sunday, also 52 weeks out
    const b = await request(app)
      .post("/api/planner/configs")
      .send({
        name: "B",
        startDate: altStart,
        marathonDate: altRace,
        blocks: canonicalBlocks(),
      });
    expect(b.status).toBe(201);
    expect(b.body.isActive).toBe(false);

    // /api/race-week.raceDate must STILL anchor on config A (the applied
    // marathon date), proving the saved-but-not-applied draft did not
    // silently re-anchor.
    const rw = await request(app).get("/api/race-week");
    expect(rw.status).toBe(200);
    expect(rw.body.raceDate).toBe(RACE_DATE_ISO);
  });

  it("entries-mode apply snapshots appliedEntries so the config can be re-applied after Full Reset (Task #326)", async () => {
    // 16-week Mon→Sun span; pick entries whose summed weeks equal that span.
    // Verifies: (a) entries-mode config saves with customName preserved,
    // (b) Apply snapshots appliedEntries (not just appliedBlocks) so the
    // config row keeps its entries shape after Full Reset clears the
    // applied_* columns and the runner re-applies it from /planner.
    const startDate = "2026-05-11"; // Monday
    const marathonDate = "2026-08-30"; // Sunday, exactly 16 weeks out
    const create = await request(app)
      .post("/api/planner/configs")
      .send({
        name: "Entries-mode round-trip",
        startDate,
        marathonDate,
        blocks: [],
        entries: [
          { templateId: "aerobic_base", weeks: 4, customName: "Spring base" },
          { templateId: "half_marathon", weeks: 12, customName: "HM build" },
        ],
      });
    expect(create.status).toBe(201);
    expect(create.body.entries).toEqual([
      { templateId: "aerobic_base", weeks: 4, customName: "Spring base", customNotes: null, startDate: null },
      { templateId: "half_marathon", weeks: 12, customName: "HM build", customNotes: null, startDate: null },
    ]);

    const apply = await request(app).post("/api/planner/apply");
    expect(apply.status).toBe(200);
    expect(apply.body.totalWeeks).toBe(16);

    // Snapshot was written with entries (not just blocks).
    const rows = await db.select().from(plannerConfigsTable);
    expect(rows[0]?.appliedEntries).toEqual([
      { templateId: "aerobic_base", weeks: 4, customName: "Spring base", customNotes: null, startDate: null },
      { templateId: "half_marathon", weeks: 12, customName: "HM build", customNotes: null, startDate: null },
    ]);

    // Task #326: Full Reset wipes plan_weeks/plan_days and demotes the
    // config back to draft (clears applied_* columns). The non-applied
    // top-level entries shape stays intact so the runner can re-apply
    // it from /planner without rebuilding the config.
    const reset = await request(app).post("/api/plan/full-reset");
    expect(reset.status).toBe(200);
    expect(reset.body.weeksSeeded).toBe(0);
    expect(reset.body.daysSeeded).toBe(0);

    const after = await db.select().from(plannerConfigsTable);
    expect(after).toHaveLength(1);
    expect(after[0]!.lastAppliedAt).toBeNull();
    expect(after[0]!.appliedEntries).toBeNull();
    expect(after[0]!.entries).toEqual([
      { templateId: "aerobic_base", weeks: 4, customName: "Spring base", customNotes: null, startDate: null },
      { templateId: "half_marathon", weeks: 12, customName: "HM build", customNotes: null, startDate: null },
    ]);

    // Re-applying the still-active entries-mode config repopulates the
    // 16-week plan rows — so Full Reset is fully recoverable from the
    // saved entries shape, no manual rebuild required.
    const reapply = await request(app).post("/api/planner/apply");
    expect(reapply.status).toBe(200);
    expect(reapply.body.totalWeeks).toBe(16);
    expect(reapply.body.weeksSeeded).toBe(16);
    expect(reapply.body.daysSeeded).toBe(16 * 7);
  });

  it("rejects an empty entries array (mode is determined by presence, not length)", async () => {
    const res = await request(app)
      .post("/api/planner/configs")
      .send({
        name: "Empty entries",
        startDate: PLAN_START_ISO,
        marathonDate: RACE_DATE_ISO,
        blocks: canonicalBlocks(),
        entries: [],
      });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/at least one template entry/);
  });

  it("Marathon First-Timer 24w starter ends on the template's Taper, not an auto-pinned Marathon-Specific tail", async () => {
    // Composed entries: 6w Aerobic Base + 18w Pfitzinger marathon. The
    // marathon template's expand() places Taper as the LAST block, so the
    // final plan_weeks row's phase MUST be "Taper". If the legacy
    // auto-pinned 16w Marathon-Specific tail leaked through, the final
    // week would be tagged "Marathon-Specific" instead.
    const startDate = "2026-05-04"; // Monday
    const marathonDate = "2026-10-18"; // Sunday, exactly 24 weeks out
    const create = await request(app)
      .post("/api/planner/configs")
      .send({
        name: "Marathon First-Timer 24w",
        startDate,
        marathonDate,
        blocks: [],
        entries: [
          { templateId: "aerobic_base", weeks: 6 },
          { templateId: "marathon", weeks: 18 },
        ],
      });
    expect(create.status).toBe(201);

    const apply = await request(app).post("/api/planner/apply");
    expect(apply.status).toBe(200);
    expect(apply.body.totalWeeks).toBe(24);
    expect(apply.body.weeksSeeded).toBe(24);

    const weeks = await db
      .select()
      .from(planWeeksTable)
      .orderBy(planWeeksTable.week);
    expect(weeks).toHaveLength(24);
    const finalWeek = weeks[weeks.length - 1]!;
    expect(finalWeek.week).toBe(24);
    expect(finalWeek.phase).toBe("Taper");
    expect(finalWeek.phase).not.toBe("Marathon-Specific");
  });

  it("mixing two templates via entries produces plan_weeks summing to entries.weeks (no auto-pinned tail)", async () => {
    // 8w Aerobic Base + 12w Half Marathon = 20-week composed plan. The
    // total plan_weeks count must equal sum(entries.weeks), proving no
    // 16-week Marathon-Specific tail was silently appended.
    const startDate = "2026-05-04"; // Monday
    const marathonDate = "2026-09-20"; // Sunday, exactly 20 weeks out
    const entries = [
      { templateId: "aerobic_base", weeks: 8 },
      { templateId: "half_marathon", weeks: 12 },
    ];
    const entriesSum = entries.reduce((s, e) => s + e.weeks, 0);

    const create = await request(app)
      .post("/api/planner/configs")
      .send({
        name: "Mixed entries 20w",
        startDate,
        marathonDate,
        blocks: [],
        entries,
      });
    expect(create.status).toBe(201);

    const apply = await request(app).post("/api/planner/apply");
    expect(apply.status).toBe(200);
    expect(apply.body.totalWeeks).toBe(entriesSum);
    expect(apply.body.weeksSeeded).toBe(entriesSum);
    expect(apply.body.daysSeeded).toBe(entriesSum * 7);

    const weeks = await db
      .select()
      .from(planWeeksTable)
      .orderBy(planWeeksTable.week);
    expect(weeks).toHaveLength(entriesSum);
    // Final week is owned by the half_marathon template's Taper block,
    // NOT by an auto-pinned Marathon-Specific tail.
    expect(weeks[weeks.length - 1]!.phase).toBe("Taper");
    // No Marathon-Specific phase anywhere — neither template emits it.
    const phases = weeks.map((w) => w.phase);
    expect(phases).not.toContain("Marathon-Specific");
  });

  it("activating a different config without applying does NOT shift the race anchor", async () => {
    // Apply A.
    const a = await createCanonicalConfig("A");
    await request(app).post("/api/planner/apply").expect(200);

    // Create B and ACTIVATE it (still no apply).
    const altStart = "2026-05-11";
    const altRace = "2027-05-09";
    const bRes = await request(app)
      .post("/api/planner/configs")
      .send({
        name: "B",
        startDate: altStart,
        marathonDate: altRace,
        blocks: canonicalBlocks(),
      });
    const b = bRes.body as { id: number };
    await request(app).post(`/api/planner/configs/${b.id}/activate`).expect(200);

    // Anchor still points at A's applied marathon date.
    const rw = await request(app).get("/api/race-week");
    expect(rw.status).toBe(200);
    expect(rw.body.raceDate).toBe(RACE_DATE_ISO);

    // Cleanup: re-activate A so subsequent suites have a sane state.
    await request(app).post(`/api/planner/configs/${a.id}/activate`);
  });
});

// Task #244. /plan/overview and /dashboard/summary surface the active
// planner config's display name so the UI can label the /plan header,
// /dashboard header, and sidebar nav with whatever the runner named
// their plan instead of a hardcoded "Half Marathon Campaign".
describe("activeConfigName surfacing (task #244)", () => {
  it("returns the most-recently-applied planner config's name on /plan/overview", async () => {
    await createCanonicalConfig("Spring Build");
    await request(app).post("/api/planner/apply").expect(200);
    const ov = await request(app).get("/api/plan/overview");
    expect(ov.status).toBe(200);
    expect(ov.body.activeConfigName).toBe("Spring Build");
  });

  it("returns the most-recently-applied planner config's name on /dashboard/summary", async () => {
    await createCanonicalConfig("Spring Build");
    await request(app).post("/api/planner/apply").expect(200);
    const sum = await request(app).get("/api/dashboard/summary");
    expect(sum.status).toBe(200);
    expect(sum.body.activeConfigName).toBe("Spring Build");
  });

  it("falls back to 'Workout Plan' when no planner config has ever been applied", async () => {
    // Wipe everything: no applied row in planner_configs so the helper
    // must hit the generic fallback. The plan_days are still populated
    // from the canonical /plan/full-reset path, but the overview's
    // activeConfigName must read "Workout Plan" because no row carries
    // a last_applied_at timestamp.
    await db.delete(plannerConfigsTable);
    await request(app).post("/api/plan/full-reset");
    await db.delete(plannerConfigsTable);

    const ov = await request(app).get("/api/plan/overview");
    expect(ov.status).toBe(200);
    expect(ov.body.activeConfigName).toBe("Workout Plan");

    const sum = await request(app).get("/api/dashboard/summary");
    expect(sum.status).toBe(200);
    expect(sum.body.activeConfigName).toBe("Workout Plan");
  });

  it("follows the most-recent last_applied_at when a different config gets applied", async () => {
    await createCanonicalConfig("Alpha");
    await request(app).post("/api/planner/apply").expect(200);

    const b = await createCanonicalConfig("Bravo");
    await request(app).post(`/api/planner/configs/${b.id}/activate`).expect(200);
    await request(app).post("/api/planner/apply").expect(200);

    const ov = await request(app).get("/api/plan/overview");
    expect(ov.body.activeConfigName).toBe("Bravo");
  });
});
