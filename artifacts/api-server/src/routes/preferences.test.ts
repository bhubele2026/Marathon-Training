import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { GetSuggestedRestingHrResponse } from "@workspace/api-zod";
import app from "../app";
import {
  cleanTestData,
  expectMatchesSchema,
  insertWorkout,
  T_RUN,
  E_TREADMILL,
} from "../test-helpers";

beforeEach(async () => {
  await cleanTestData();
});

afterEach(async () => {
  await cleanTestData();
});

function recentDate(daysAgo: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

describe("GET /api/preferences/suggested-resting-hr", () => {
  it("returns null when there isn't enough HR data", async () => {
    // Three workouts with HR data, below the 5-sample threshold.
    for (let i = 0; i < 3; i++) {
      await insertWorkout({
        date: recentDate(i + 1),
        sessionType: T_RUN,
        equipment: E_TREADMILL,
        avgHr: 120,
      });
    }

    const res = await request(app).get(
      "/api/preferences/suggested-resting-hr",
    );
    expect(res.status).toBe(200);
    expectMatchesSchema(GetSuggestedRestingHrResponse, res.body);
    expect(res.body.value).toBeNull();
    expect(res.body.sampleCount).toBe(3);
    expect(res.body.windowDays).toBe(90);
  });

  it("derives a suggestion from the lowest steady-state avg HR", async () => {
    // Mix of HR values across recent workouts; lowest is 95 → 95 - 35 = 60.
    const hrs = [142, 158, 95, 110, 128, 165];
    for (let i = 0; i < hrs.length; i++) {
      await insertWorkout({
        date: recentDate(i + 1),
        sessionType: T_RUN,
        equipment: E_TREADMILL,
        avgHr: hrs[i],
      });
    }

    const res = await request(app).get(
      "/api/preferences/suggested-resting-hr",
    );
    expect(res.status).toBe(200);
    expectMatchesSchema(GetSuggestedRestingHrResponse, res.body);
    expect(res.body.value).toBe(60);
    expect(res.body.sampleCount).toBe(hrs.length);
  });

  it("ignores workouts without an avg_hr value", async () => {
    // 4 workouts with HR (one sample short of the 5-sample threshold)
    // plus several without — confirms we don't count NULLs.
    for (let i = 0; i < 4; i++) {
      await insertWorkout({
        date: recentDate(i + 1),
        sessionType: T_RUN,
        equipment: E_TREADMILL,
        avgHr: 100,
      });
    }
    for (let i = 0; i < 5; i++) {
      await insertWorkout({
        date: recentDate(i + 5),
        sessionType: T_RUN,
        equipment: E_TREADMILL,
        avgHr: null,
      });
    }

    const res = await request(app).get(
      "/api/preferences/suggested-resting-hr",
    );
    expect(res.status).toBe(200);
    expect(res.body.sampleCount).toBe(4);
    expect(res.body.value).toBeNull();
  });

  it("clamps the suggestion into the [30, 110] input range", async () => {
    // Lowest avg HR of 50 would suggest 15 bpm; clamp floor at 30.
    const hrs = [50, 60, 70, 80, 90];
    for (let i = 0; i < hrs.length; i++) {
      await insertWorkout({
        date: recentDate(i + 1),
        sessionType: T_RUN,
        equipment: E_TREADMILL,
        avgHr: hrs[i],
      });
    }

    const res = await request(app).get(
      "/api/preferences/suggested-resting-hr",
    );
    expect(res.status).toBe(200);
    expect(res.body.value).toBe(30);
  });
});
