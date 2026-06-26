import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import request from "supertest";
import app from "../app";
import { cleanTestData } from "../test-helpers";

// Alcohol entries — in-app + Shortcut (bearer) logging, the dry mark, and the
// range read. Dates live in the 2099 test-year window cleanTestData wipes.

const D = "2099-06-10";
const D2 = "2099-06-11";

beforeAll(() => {
  process.env.ALCOHOL_TOKEN = "test-alc-token";
});
beforeEach(async () => {
  await cleanTestData();
});
afterEach(async () => {
  await cleanTestData();
});

describe("POST /api/alcohol", () => {
  it("logs a drink in-app (manual source)", async () => {
    const res = await request(app)
      .post("/api/alcohol")
      .send({ date: D, standardDrinks: 2, kind: "beer" });
    expect(res.status).toBe(201);
    expect(res.body.standardDrinks).toBe(2);
    expect(res.body.kind).toBe("beer");
    expect(res.body.source).toBe("manual");
    expect(res.body.date).toBe(D);
  });

  it("accepts the Shortcut bearer and marks source=shortcut", async () => {
    const res = await request(app)
      .post("/api/alcohol")
      .set("Authorization", "Bearer test-alc-token")
      .send({ date: D, standardDrinks: 1 });
    expect(res.status).toBe(201);
    expect(res.body.source).toBe("shortcut");
  });

  it("rejects a bad bearer with 401", async () => {
    const res = await request(app)
      .post("/api/alcohol")
      .set("Authorization", "Bearer nope")
      .send({ date: D, standardDrinks: 1 });
    expect(res.status).toBe(401);
  });

  it("rejects out-of-range drinks", async () => {
    const res = await request(app).post("/api/alcohol").send({ date: D, standardDrinks: 999 });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/alcohol/dry", () => {
  it("marks a day dry as a zero-drink entry", async () => {
    const res = await request(app).post("/api/alcohol/dry").send({ date: D2 });
    expect(res.status).toBe(201);
    expect(res.body.standardDrinks).toBe(0);
    expect(res.body.date).toBe(D2);
  });
});

describe("GET /api/alcohol/summary", () => {
  // The summary's window is the REAL local week, so we don't write real-today
  // entries here (that would race other parallel suites on the shared DB) — the
  // weekly/streak/impact math is covered exhaustively in alcohol-analytics.test.
  it("serves the deterministic read shape, inactive with no entries", async () => {
    const res = await request(app).get("/api/alcohol/summary");
    expect(res.status).toBe(200);
    expect(res.body.active).toBe(false);
    expect(res.body.dryDaysTarget).toBe(4);
    expect(res.body.drinkingBudget).toBe(3);
    expect(Array.isArray(res.body.dailyStrip)).toBe(true);
    expect(res.body.dailyStrip).toHaveLength(7);
    expect(Array.isArray(res.body.impact)).toBe(true);
  });
});

describe("GET /api/alcohol + PATCH + DELETE", () => {
  it("ranges, edits, and deletes entries", async () => {
    const created = await request(app)
      .post("/api/alcohol")
      .send({ date: D, standardDrinks: 3, kind: "wine" });
    const id = created.body.id as number;

    const list = await request(app).get(`/api/alcohol?from=${D}&to=${D2}`);
    expect(list.status).toBe(200);
    expect(list.body.length).toBe(1);
    expect(list.body[0].id).toBe(id);

    const patched = await request(app).patch(`/api/alcohol/${id}`).send({ standardDrinks: 1 });
    expect(patched.status).toBe(200);
    expect(patched.body.standardDrinks).toBe(1);

    const del = await request(app).delete(`/api/alcohol/${id}`);
    expect(del.status).toBe(204);

    const after = await request(app).get(`/api/alcohol?from=${D}&to=${D2}`);
    expect(after.body.length).toBe(0);
  });
});
