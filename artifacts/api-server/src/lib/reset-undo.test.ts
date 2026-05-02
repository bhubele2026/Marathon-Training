import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _clearResetSnapshotsForTesting,
  consumeResetSnapshot,
  type PlanDaySnapshot,
  storeResetSnapshot,
} from "./reset-undo";

const sampleDay: PlanDaySnapshot = {
  id: 1,
  week: 1,
  sessionType: "Run",
  equipment: "Outdoor",
  description: "easy",
  distanceMi: 5,
  cardioMin: 50,
  pace: null,
  strengthLoad: null,
  totalLoad: 50,
  isRest: false,
  seedSessionType: "Run",
  seedEquipment: "Outdoor",
  seedDescription: "easy",
  seedDistanceMi: 5,
  seedCardioMin: 50,
  seedPace: null,
  seedStrengthLoad: null,
  seedTotalLoad: 50,
  seedIsRest: false,
};

describe("reset-undo TTL expiration", () => {
  beforeEach(() => {
    _clearResetSnapshotsForTesting();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    _clearResetSnapshotsForTesting();
  });

  it("returns the snapshot inside the window and rejects it after the TTL elapses", () => {
    vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
    const ttl = 30_000;
    const { token, expiresInSeconds } = storeResetSnapshot(
      [sampleDay],
      [sampleDay.week],
      ttl,
    );
    expect(expiresInSeconds).toBe(30);

    // Just before the window closes the snapshot is still consumable, but
    // because consume is single-use we need a fresh token to test the
    // expiry path itself.
    vi.advanceTimersByTime(ttl - 1);
    expect(consumeResetSnapshot(token)).not.toBeNull();

    const { token: token2 } = storeResetSnapshot(
      [sampleDay],
      [sampleDay.week],
      ttl,
    );
    // Step past the TTL boundary; the snapshot must now be unrecoverable.
    vi.advanceTimersByTime(ttl + 1);
    expect(consumeResetSnapshot(token2)).toBeNull();
  });

  it("treats unknown tokens as expired/missing", () => {
    expect(consumeResetSnapshot("never-issued")).toBeNull();
  });

  it("only allows a single successful consume per token", () => {
    const { token } = storeResetSnapshot([sampleDay], [sampleDay.week]);
    expect(consumeResetSnapshot(token)).not.toBeNull();
    expect(consumeResetSnapshot(token)).toBeNull();
  });
});
