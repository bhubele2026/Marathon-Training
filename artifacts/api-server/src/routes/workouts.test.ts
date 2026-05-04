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
  insertPlanDay,
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
        // Per-bucket actuals weren't sent, so they remain null on the
        // wire and `totalMin` collapses to null too — the UI uses that
        // signal to fall back to the legacy Duration tile.
        strengthMin: null,
        cardioMin: null,
        runMin: null,
        totalMin: null,
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

  it("persists per-bucket actual minutes and exposes a server-computed totalMin (Task #76)", async () => {
    const res = await request(app)
      .post("/api/workouts")
      .send({
        date: "2099-04-11",
        sessionType: T_STRENGTH,
        equipment: E_GYM,
        durationMin: 100,
        strengthMin: 40,
        cardioMin: 28,
        runMin: 32,
      });
    expect(res.status).toBe(201);
    expectMatchesSchema(UpdateWorkoutResponse, res.body);
    expect(res.body).toEqual(
      expect.objectContaining({
        strengthMin: 40,
        cardioMin: 28,
        runMin: 32,
        // Server-computed sum, not the rolled-up `durationMin` (so the
        // breakdown total can never disagree with its parts).
        totalMin: 100,
      }),
    );
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

describe("GET /api/workouts (prescribed run target join, Task #140)", () => {
  // The /log Training Log table renders the user's chosen run-target
  // line (effort / intervals / HR zone / pace) next to the actuals.
  // To avoid an N+1 of plan-day fetches from the client, the server
  // joins workouts.plan_day_id against plan_days and snapshots the
  // matched day's sessionType / week / runMin / distanceMi / pace into
  // the new `prescribedRunTarget` nested object on the wire shape.
  it("populates prescribedRunTarget from the joined plan day when planDayId is set", async () => {
    // Use a week inside the cleanTestData range (TEST_WEEK_MIN..MAX,
     // 8000..8999) so the inserted plan day gets scrubbed between tests
     // and can't leak into other test files that count plan rows.
    const planDay = await insertPlanDay(8140, "Foundation Build", {
      date: "2099-06-21",
      day: "Mon",
      sessionType: "Long Run",
      equipment: E_OUTDOOR,
      runMin: 60,
      distanceMi: 6,
      pace: "10:00",
    });
    await insertWorkout({
      date: "2099-06-21",
      sessionType: T_RUN,
      equipment: E_OUTDOOR,
      planDayId: planDay.id,
      runMin: 58,
      distanceMi: 5.9,
    });

    const res = await request(app)
      .get("/api/workouts")
      .query({ from: "2099-06-21", to: "2099-06-21" });
    expect(res.status).toBe(200);
    expectMatchesSchema(ListWorkoutsResponse, res.body);
    const rows = res.body as Array<{ prescribedRunTarget: unknown }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.prescribedRunTarget).toEqual({
      sessionType: "Long Run",
      week: 8140,
      runMin: 60,
      distanceMi: 6,
      pace: "10:00",
    });
  });

  it("returns prescribedRunTarget=null for workouts with no planDayId (quick-logged Lifestyle / off-plan rows)", async () => {
    await insertWorkout({
      date: "2099-06-22",
      sessionType: T_RUN,
      equipment: E_OUTDOOR,
      // planDayId omitted — these are off-plan rows the join can't
      // resolve, so the wire payload must surface a null target rather
      // than a fabricated one.
      distanceMi: 3,
    });

    const res = await request(app)
      .get("/api/workouts")
      .query({ from: "2099-06-22", to: "2099-06-22" });
    expect(res.status).toBe(200);
    expectMatchesSchema(ListWorkoutsResponse, res.body);
    const rows = res.body as Array<{ prescribedRunTarget: unknown }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.prescribedRunTarget).toBeNull();
  });
});

describe("GET /api/workouts (per-bucket actuals)", () => {
  it("round-trips strength/cardio/run minutes and computes totalMin per row", async () => {
    // Two rows: one with a partial breakdown (only lift+cardio), one
    // with no breakdown at all. The list endpoint must report each
    // row's actuals + a totalMin that's null only when ALL three buckets
    // are null — partial-fill rows still get a real total.
    await insertWorkout({
      date: "2099-08-01",
      sessionType: T_STRENGTH,
      equipment: E_GYM,
      durationMin: 70,
      strengthMin: 45,
      cardioMin: 25,
    });
    await insertWorkout({
      date: "2099-08-02",
      sessionType: T_RUN,
      equipment: E_OUTDOOR,
      durationMin: 30,
      // No per-bucket actuals — legacy duration-only row.
    });

    const res = await request(app)
      .get("/api/workouts")
      .query({ from: "2099-08-01", to: "2099-08-31" });
    expect(res.status).toBe(200);
    expectMatchesSchema(ListWorkoutsResponse, res.body);
    const rows = res.body as Array<{
      date: string;
      strengthMin: number | null;
      cardioMin: number | null;
      runMin: number | null;
      totalMin: number | null;
    }>;
    // Sorted by date desc — legacy row first, partial-fill row second.
    expect(rows.map((r) => r.date)).toEqual(["2099-08-02", "2099-08-01"]);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        strengthMin: null,
        cardioMin: null,
        runMin: null,
        totalMin: null,
      }),
    );
    expect(rows[1]).toEqual(
      expect.objectContaining({
        strengthMin: 45,
        cardioMin: 25,
        runMin: null,
        // 45 + 25 + 0 (null run treated as 0 in the sum, but at least
        // one bucket was populated so totalMin is non-null).
        totalMin: 70,
      }),
    );
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

  it("updates per-bucket actual minutes and recomputes totalMin (Task #76)", async () => {
    const { id } = await insertWorkout({
      date: "2099-06-15",
      sessionType: T_STRENGTH,
      equipment: E_GYM,
      durationMin: 70,
      strengthMin: 45,
      cardioMin: 25,
      runMin: null,
    });
    const res = await request(app)
      .patch(`/api/workouts/${id}`)
      .send({ strengthMin: 50, runMin: 10 });
    expect(res.status).toBe(200);
    expectMatchesSchema(UpdateWorkoutResponse, res.body);
    expect(res.body).toEqual(
      expect.objectContaining({
        strengthMin: 50,
        // Untouched bucket stays put.
        cardioMin: 25,
        runMin: 10,
        // Recomputed: 50 + 25 + 10. Note that legacy `durationMin` is
        // intentionally untouched here because the UI surfaces totalMin
        // for the breakdown view.
        totalMin: 85,
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

describe("workouts equipmentList contract", () => {
  it("POST persists the full equipmentList rail and rounds-trips it on GET", async () => {
    const create = await request(app)
      .post("/api/workouts")
      .send({
        date: "2099-08-01",
        sessionType: T_STRENGTH,
        equipment: "Tonal",
        equipmentList: ["Tonal", "Peloton Bike"],
        durationMin: 60,
      });
    expect(create.status).toBe(201);
    expect(create.body).toEqual(
      expect.objectContaining({
        equipment: "Tonal",
        equipmentList: ["Tonal", "Peloton Bike"],
      }),
    );

    const list = await request(app)
      .get("/api/workouts")
      .query({ from: "2099-08-01", to: "2099-08-01" });
    expect(list.status).toBe(200);
    expect((list.body as Array<{ equipmentList: string[] | null }>)[0]).toEqual(
      expect.objectContaining({
        equipment: "Tonal",
        equipmentList: ["Tonal", "Peloton Bike"],
      }),
    );
  });

  it("POST without equipmentList synthesizes a single-chip rail from the scalar", async () => {
    const create = await request(app)
      .post("/api/workouts")
      .send({
        date: "2099-08-02",
        sessionType: T_RUN,
        equipment: E_OUTDOOR,
        distanceMi: 4,
      });
    expect(create.status).toBe(201);
    expect(create.body).toEqual(
      expect.objectContaining({
        equipment: E_OUTDOOR,
        equipmentList: [E_OUTDOOR],
      }),
    );
  });

  it("POST returns 400 when equipmentList lead chip (after canonical sort) disagrees with the scalar equipment", async () => {
    const res = await request(app)
      .post("/api/workouts")
      .send({
        date: "2099-08-03",
        sessionType: T_STRENGTH,
        equipment: "Peloton Bike",
        equipmentList: ["Peloton Bike", "Tonal"],
      });
    expect(res.status).toBe(400);
    expect(res.body).toEqual(
      expect.objectContaining({
        error:
          "equipmentList must be non-empty and equipmentList[0] must equal equipment when both are provided",
      }),
    );
  });

  it("POST canonically sorts a non-canonical equipmentList from a non-UI client", async () => {
    const create = await request(app)
      .post("/api/workouts")
      .send({
        date: "2099-08-04",
        sessionType: T_STRENGTH,
        equipment: "Tonal",
        equipmentList: ["Peloton Bike", "Tonal"],
      });
    expect(create.status).toBe(201);
    expect(create.body).toEqual(
      expect.objectContaining({
        equipment: "Tonal",
        equipmentList: ["Tonal", "Peloton Bike"],
      }),
    );
  });

  it("PATCH updates the rail and canonically sorts it when only the rail is sent", async () => {
    const { id } = await insertWorkout({
      date: "2099-08-10",
      sessionType: T_STRENGTH,
      equipment: "Tonal",
    });
    const res = await request(app)
      .patch(`/api/workouts/${id}`)
      .send({ equipmentList: ["Peloton Bike", "Tonal"] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        equipment: "Tonal",
        equipmentList: ["Tonal", "Peloton Bike"],
      }),
    );
  });

  it("PATCH with explicit equipmentList: null preserves the existing rail (treated as 'not provided')", async () => {
    const { id } = await insertWorkout({
      date: "2099-08-13",
      sessionType: T_STRENGTH,
      equipment: "Tonal",
      equipmentList: ["Tonal", "Peloton Bike"],
    });
    const res = await request(app)
      .patch(`/api/workouts/${id}`)
      .send({ equipmentList: null, rpe: 6 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        rpe: 6,
        equipment: "Tonal",
        equipmentList: ["Tonal", "Peloton Bike"],
      }),
    );
  });

  it("PATCH preserves the rail when only unrelated fields change", async () => {
    const { id } = await insertWorkout({
      date: "2099-08-11",
      sessionType: T_STRENGTH,
      equipment: "Tonal",
      equipmentList: ["Tonal", "Peloton Bike"],
    });
    const res = await request(app)
      .patch(`/api/workouts/${id}`)
      .send({ rpe: 7, notes: "edit pass" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        rpe: 7,
        notes: "edit pass",
        equipment: "Tonal",
        equipmentList: ["Tonal", "Peloton Bike"],
      }),
    );
  });

  it("PATCH returns 400 when an explicit (equipment, equipmentList) pair disagrees on the lead chip", async () => {
    const { id } = await insertWorkout({
      date: "2099-08-12",
      sessionType: T_STRENGTH,
      equipment: "Tonal",
    });
    const res = await request(app)
      .patch(`/api/workouts/${id}`)
      .send({ equipment: "Tonal", equipmentList: ["Peloton Bike"] });
    expect(res.status).toBe(400);
    expect(res.body).toEqual(
      expect.objectContaining({
        error:
          "equipmentList must be non-empty and equipmentList[0] must equal equipment when both are provided",
      }),
    );
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
