import { describe, it, expect, beforeEach, afterEach, beforeAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, nutritionDaysTable } from "@workspace/db";
import app from "../app";
import { cleanTestData } from "../test-helpers";

// Phase 13 — entries model, manual logging, water, and the Apple-Shortcut
// reconciliation. All dates live in the 2099 test-year window that
// cleanTestData wipes.

const D = "2099-06-01";
const DW = "2099-06-02";

async function dayRow(date: string) {
  const rows = await db
    .select()
    .from(nutritionDaysTable)
    .where(eq(nutritionDaysTable.date, date))
    .limit(1);
  return rows[0] ?? null;
}

beforeAll(() => {
  process.env.NUTRITION_TOKEN = "test-token";
});

beforeEach(async () => {
  await cleanTestData();
});
afterEach(async () => {
  await cleanTestData();
});

describe("POST /api/nutrition/entries (manual logging)", () => {
  it("creates a manual entry, rolls it up into nutrition_days", async () => {
    const res = await request(app)
      .post("/api/nutrition/entries")
      .send({ date: D, label: "Chicken & rice", calories: 600, proteinG: 55 });
    expect(res.status).toBe(201);
    expect(res.body.source).toBe("manual");
    expect(res.body.label).toBe("Chicken & rice");

    const list = await request(app).get(`/api/nutrition/entries?date=${D}`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);

    const day = await dayRow(D);
    expect(day?.calories).toBe(600);
    expect(day?.proteinG).toBe(55);
  });

  it("edits and deletes a manual entry, recomputing the day each time", async () => {
    const created = await request(app)
      .post("/api/nutrition/entries")
      .send({ date: D, calories: 600, proteinG: 55 });
    const id = created.body.id;

    const patched = await request(app)
      .patch(`/api/nutrition/entries/${id}`)
      .send({ calories: 700 });
    expect(patched.status).toBe(200);
    expect(patched.body.calories).toBe(700);
    expect((await dayRow(D))?.calories).toBe(700);

    const del = await request(app).delete(`/api/nutrition/entries/${id}`);
    expect(del.status).toBe(204);
    // No entries left → day rollup nulls out.
    expect((await dayRow(D))?.calories ?? null).toBeNull();
  });

  it("returns 404 patching a missing entry and 400 on a bad id", async () => {
    expect((await request(app).patch("/api/nutrition/entries/999999").send({ calories: 1 })).status).toBe(404);
    expect((await request(app).patch("/api/nutrition/entries/abc").send({ calories: 1 })).status).toBe(400);
  });
});

describe("Apple-Shortcut reconciliation (POST /api/nutrition)", () => {
  it("collapses a push into ONE health_sync entry and rolls up", async () => {
    const res = await request(app)
      .post("/api/nutrition")
      .set("Authorization", "Bearer test-token")
      .send({ date: D, calories: 2000, proteinG: 150 });
    expect(res.status).toBe(200);
    expect(res.body.calories).toBe(2000);

    const list = await request(app).get(`/api/nutrition/entries?date=${D}`);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].source).toBe("health_sync");
  });

  it("re-push REPLACES the day's sync entry (no duplicate) and MERGES partial fields", async () => {
    await request(app)
      .post("/api/nutrition")
      .set("Authorization", "Bearer test-token")
      .send({ date: D, calories: 2000, proteinG: 150 });
    // protein-only re-push must keep the earlier calories, not wipe it.
    await request(app)
      .post("/api/nutrition")
      .set("Authorization", "Bearer test-token")
      .send({ date: D, proteinG: 175 });

    const list = await request(app).get(`/api/nutrition/entries?date=${D}`);
    expect(list.body).toHaveLength(1); // still ONE sync entry
    expect(list.body[0].calories).toBe(2000); // preserved
    expect(list.body[0].proteinG).toBe(175); // updated
  });

  it("manual + synced entries SUM in the day total without double-counting", async () => {
    await request(app)
      .post("/api/nutrition")
      .set("Authorization", "Bearer test-token")
      .send({ date: D, calories: 2000, proteinG: 150 });
    await request(app)
      .post("/api/nutrition/entries")
      .send({ date: D, calories: 500, proteinG: 40 });

    const list = await request(app).get(`/api/nutrition/entries?date=${D}`);
    expect(list.body).toHaveLength(2); // one sync + one manual
    const day = await dayRow(D);
    expect(day?.calories).toBe(2500);
    expect(day?.proteinG).toBe(190);
  });
});

describe("water logs (POST/GET/PATCH/DELETE /api/water)", () => {
  it("adds water, rolls water_ml up, edits and deletes", async () => {
    const a = await request(app).post("/api/water").send({ date: DW, oz: 16 });
    expect(a.status).toBe(201);
    expect(a.body.oz).toBe(16);
    expect(a.body.source).toBe("manual");
    await request(app).post("/api/water").send({ date: DW, oz: 8 });

    const list = await request(app).get(`/api/water?date=${DW}`);
    expect(list.body).toHaveLength(2);

    // 24 oz * 29.5735 ml/oz ≈ 710 ml
    expect((await dayRow(DW))?.waterMl).toBe(Math.round(24 * 29.5735));

    const del = await request(app).delete(`/api/water/${a.body.id}`);
    expect(del.status).toBe(204);
    expect((await dayRow(DW))?.waterMl).toBe(Math.round(8 * 29.5735));
  });

  it("rejects an out-of-range oz", async () => {
    expect((await request(app).post("/api/water").send({ date: DW, oz: 99999 })).status).toBe(400);
  });
});
