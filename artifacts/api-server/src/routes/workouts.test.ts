import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import {
  ErrorResponse,
  ListWorkoutsResponse,
  UpdateWorkoutResponse,
  ValidationErrorResponse,
} from "@workspace/api-zod";
import app from "../app";
import {
  cleanTestData,
  expectMatchesSchema,
  insertWorkout,
  E_OUTDOOR,
  E_TREADMILL,
  E_GYM,
  T_RUN,
  T_STRENGTH,
} from "../test-helpers";

beforeEach(async () => {
  await cleanTestData();
});

afterEach(async () => {
  await cleanTestData();
});

describe("POST /api/workouts", () => {
  it("creates a workout and returns 201 with the canonical shape", async () => {
    const res = await request(app)
      .post("/api/workouts")
      .send({
        date: "2099-04-10",
        sessionType: T_RUN,
        equipment: E_OUTDOOR,
        durationMin: 45,
        distanceMi: 5.2,
        pace: "8:39",
        avgHr: 152,
        rpe: 7,
        totalLoad: 250,
        notes: "easy long",
      });

    expect(res.status).toBe(201);
    // Create returns the canonical Workout shape (same as Update/List items).
    expectMatchesSchema(UpdateWorkoutResponse, res.body);
    expect(res.body).toEqual(
      expect.objectContaining({
        id: expect.any(Number),
        planDayId: null,
        date: "2099-04-10",
        sessionType: T_RUN,
        equipment: E_OUTDOOR,
        durationMin: 45,
        distanceMi: 5.2,
        pace: "8:39",
        avgHr: 152,
        rpe: 7,
        strengthLoad: null,
        totalLoad: 250,
        notes: "easy long",
        createdAt: expect.any(String),
      }),
    );
    // createdAt is serialized to an ISO string in the wire format.
    expect(() => new Date(res.body.createdAt as string).toISOString()).not.toThrow();
  });

  it("returns 400 when the body fails validation", async () => {
    const res = await request(app)
      .post("/api/workouts")
      // Missing required `date`, `sessionType`, `equipment` fields.
      .send({ rpe: 7 });
    expect(res.status).toBe(400);
    expectMatchesSchema(ValidationErrorResponse, res.body);
  });
});

describe("GET /api/workouts", () => {
  it("returns workouts ordered by date desc within from/to filter", async () => {
    await insertWorkout({ date: "2099-04-01", sessionType: T_RUN, equipment: E_OUTDOOR, distanceMi: 3 });
    await insertWorkout({ date: "2099-04-03", sessionType: T_RUN, equipment: E_TREADMILL, distanceMi: 4 });
    await insertWorkout({ date: "2099-04-02", sessionType: T_STRENGTH, equipment: E_GYM, distanceMi: null });

    const res = await request(app)
      .get("/api/workouts")
      .query({ from: "2099-01-01", to: "2099-12-31" });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expectMatchesSchema(ListWorkoutsResponse, res.body);
    const dates = (res.body as Array<{ date: string }>).map((w) => w.date);
    expect(dates).toEqual(["2099-04-03", "2099-04-02", "2099-04-01"]);
  });

  it("filters by equipment", async () => {
    await insertWorkout({ date: "2099-04-04", sessionType: T_RUN, equipment: E_OUTDOOR, distanceMi: 5 });
    await insertWorkout({ date: "2099-04-05", sessionType: T_RUN, equipment: E_TREADMILL, distanceMi: 6 });

    const res = await request(app)
      .get("/api/workouts")
      .query({ from: "2099-01-01", to: "2099-12-31", equipment: E_TREADMILL });

    expect(res.status).toBe(200);
    expectMatchesSchema(ListWorkoutsResponse, res.body);
    const rows = res.body as Array<{ equipment: string; distanceMi: number }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.equipment).toBe(E_TREADMILL);
    expect(rows[0]!.distanceMi).toBe(6);
  });

  it("respects the limit parameter", async () => {
    for (let i = 1; i <= 5; i += 1) {
      const day = String(i).padStart(2, "0");
      await insertWorkout({
        date: `2099-05-${day}`,
        sessionType: T_RUN,
        equipment: E_OUTDOOR,
        distanceMi: i,
      });
    }

    const res = await request(app)
      .get("/api/workouts")
      .query({ from: "2099-05-01", to: "2099-05-31", limit: 2 });
    expect(res.status).toBe(200);
    expectMatchesSchema(ListWorkoutsResponse, res.body);
    const rows = res.body as Array<{ date: string }>;
    expect(rows).toHaveLength(2);
    // Limit is applied after the desc-by-date ordering, so we get the two newest.
    expect(rows.map((r) => r.date)).toEqual(["2099-05-05", "2099-05-04"]);
  });

  it("returns 400 when the query fails validation", async () => {
    const res = await request(app).get("/api/workouts").query({ limit: "not-a-number" });
    expect(res.status).toBe(400);
    expectMatchesSchema(ValidationErrorResponse, res.body);
  });
});

describe("PATCH /api/workouts/:id", () => {
  it("updates fields and returns the updated row", async () => {
    const { id } = await insertWorkout({
      date: "2099-06-10",
      sessionType: T_RUN,
      equipment: E_OUTDOOR,
      distanceMi: 4,
      rpe: 5,
    });

    const res = await request(app)
      .patch(`/api/workouts/${id}`)
      .send({ rpe: 8, distanceMi: 5.5, notes: "felt strong" });

    expect(res.status).toBe(200);
    expectMatchesSchema(UpdateWorkoutResponse, res.body);
    expect(res.body).toEqual(
      expect.objectContaining({
        id,
        rpe: 8,
        distanceMi: 5.5,
        notes: "felt strong",
        // Untouched fields remain unchanged.
        date: "2099-06-10",
        sessionType: T_RUN,
        equipment: E_OUTDOOR,
      }),
    );
  });

  it("returns 400 for an invalid id", async () => {
    const res = await request(app).patch("/api/workouts/0").send({ rpe: 5 });
    expect(res.status).toBe(400);
    expectMatchesSchema(ErrorResponse, res.body);
    expect(res.body).toEqual({ error: "invalid id" });
  });

  it("returns 400 when the body fails validation", async () => {
    const { id } = await insertWorkout({
      date: "2099-06-11",
      sessionType: T_RUN,
      equipment: E_OUTDOOR,
    });
    const res = await request(app)
      .patch(`/api/workouts/${id}`)
      .send({ rpe: "not-a-number" });
    expect(res.status).toBe(400);
    expectMatchesSchema(ValidationErrorResponse, res.body);
  });

  it("returns 404 when the workout does not exist", async () => {
    const res = await request(app)
      .patch("/api/workouts/999999999")
      .send({ rpe: 5 });
    expect(res.status).toBe(404);
    expectMatchesSchema(ErrorResponse, res.body);
    expect(res.body).toEqual({ error: "not found" });
  });
});

describe("DELETE /api/workouts/:id", () => {
  it("deletes the workout and returns 204", async () => {
    const { id } = await insertWorkout({
      date: "2099-07-01",
      sessionType: T_RUN,
      equipment: E_OUTDOOR,
      distanceMi: 3,
    });

    const del = await request(app).delete(`/api/workouts/${id}`);
    expect(del.status).toBe(204);
    expect(del.body).toEqual({});

    const list = await request(app)
      .get("/api/workouts")
      .query({ from: "2099-07-01", to: "2099-07-31" });
    expect(list.status).toBe(200);
    expectMatchesSchema(ListWorkoutsResponse, list.body);
    expect((list.body as unknown[])).toHaveLength(0);
  });

  it("returns 400 for an invalid id", async () => {
    const res = await request(app).delete("/api/workouts/abc");
    expect(res.status).toBe(400);
    expectMatchesSchema(ErrorResponse, res.body);
    expect(res.body).toEqual({ error: "invalid id" });
  });
});
