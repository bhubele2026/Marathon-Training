import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import {
  ListMeasurementsResponse,
  UpdateMeasurementResponse,
} from "@workspace/api-zod";
import app from "../app";
import {
  cleanTestData,
  expectMatchesSchema,
  insertMeasurement,
} from "../test-helpers";

beforeEach(async () => {
  await cleanTestData();
});

afterEach(async () => {
  await cleanTestData();
});

describe("POST /api/measurements", () => {
  it("creates a measurement and returns 201 with the canonical shape", async () => {
    const res = await request(app).post("/api/measurements").send({
      date: "2099-03-15",
      weight: 240.4,
      lArm: 14.5,
      rArm: 14.7,
      lLeg: 22.1,
      rLeg: 22.3,
      belly: 42.0,
      chest: 47.0,
      notes: "morning measurement",
    });

    expect(res.status).toBe(201);
    // Create returns the canonical Measurement shape (same as Update/List items).
    expectMatchesSchema(UpdateMeasurementResponse, res.body);
    expect(res.body).toEqual(
      expect.objectContaining({
        id: expect.any(Number),
        date: "2099-03-15",
        weight: 240.4,
        lArm: 14.5,
        rArm: 14.7,
        lLeg: 22.1,
        rLeg: 22.3,
        belly: 42.0,
        chest: 47.0,
        notes: "morning measurement",
        createdAt: expect.any(String),
      }),
    );
    expect(() => new Date(res.body.createdAt as string).toISOString()).not.toThrow();
  });

  it("accepts a measurement with only required fields", async () => {
    const res = await request(app).post("/api/measurements").send({ date: "2099-03-16" });
    expect(res.status).toBe(201);
    expectMatchesSchema(UpdateMeasurementResponse, res.body);
    expect(res.body).toEqual(
      expect.objectContaining({
        date: "2099-03-16",
        weight: null,
        lArm: null,
        rArm: null,
        lLeg: null,
        rLeg: null,
        belly: null,
        chest: null,
        notes: null,
      }),
    );
  });

  it("returns 400 when the body is missing required fields", async () => {
    const res = await request(app).post("/api/measurements").send({ weight: 220 });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });
});

describe("GET /api/measurements", () => {
  it("returns measurements ordered by date desc", async () => {
    await insertMeasurement({ date: "2099-03-10", weight: 245 });
    await insertMeasurement({ date: "2099-03-12", weight: 244 });
    await insertMeasurement({ date: "2099-03-11", weight: 244.5 });

    const res = await request(app).get("/api/measurements");
    expect(res.status).toBe(200);
    expectMatchesSchema(ListMeasurementsResponse, res.body);
    const rows = res.body as Array<{ date: string; weight: number | null }>;
    // Filter to the test band so we don't depend on real data.
    const ours = rows.filter((r) => r.date.startsWith("2099-"));
    expect(ours.map((r) => r.date)).toEqual(["2099-03-12", "2099-03-11", "2099-03-10"]);
    expect(ours.map((r) => r.weight)).toEqual([244, 244.5, 245]);
  });
});

describe("PATCH /api/measurements/:id", () => {
  it("updates fields and returns the updated row", async () => {
    const { id } = await insertMeasurement({ date: "2099-03-20", weight: 240, notes: "before" });

    const res = await request(app)
      .patch(`/api/measurements/${id}`)
      .send({ weight: 238.5, notes: "after" });

    expect(res.status).toBe(200);
    expectMatchesSchema(UpdateMeasurementResponse, res.body);
    expect(res.body).toEqual(
      expect.objectContaining({
        id,
        date: "2099-03-20",
        weight: 238.5,
        notes: "after",
      }),
    );
  });

  it("returns 400 for an invalid id", async () => {
    const res = await request(app).patch("/api/measurements/0").send({ weight: 220 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid id" });
  });

  it("returns 400 when the body fails validation", async () => {
    const { id } = await insertMeasurement({ date: "2099-03-21" });
    const res = await request(app)
      .patch(`/api/measurements/${id}`)
      .send({ weight: "not-a-number" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 404 when the measurement does not exist", async () => {
    const res = await request(app)
      .patch("/api/measurements/999999999")
      .send({ weight: 220 });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "not found" });
  });
});

describe("DELETE /api/measurements/:id", () => {
  it("deletes the measurement and returns 204", async () => {
    const { id } = await insertMeasurement({ date: "2099-03-25", weight: 235 });

    const del = await request(app).delete(`/api/measurements/${id}`);
    expect(del.status).toBe(204);
    expect(del.body).toEqual({});

    const list = await request(app).get("/api/measurements");
    expectMatchesSchema(ListMeasurementsResponse, list.body);
    const ours = (list.body as Array<{ id: number }>).filter((m) => m.id === id);
    expect(ours).toHaveLength(0);
  });

  it("returns 400 for an invalid id", async () => {
    const res = await request(app).delete("/api/measurements/abc");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid id" });
  });
});
