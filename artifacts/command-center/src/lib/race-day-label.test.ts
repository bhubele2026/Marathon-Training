import { describe, expect, it } from "vitest";
import { RACE_DAY_SPECS } from "@workspace/plan-generator";
import { raceDayLabel, RACE_DAY_ZONE_BUCKET } from "./race-day-label";

describe("raceDayLabel — task #201 per-kind Sunday label", () => {
  it("classifies the four real race kinds from the generator description prefix (no sessionType needed)", () => {
    // The "RACE DAY — " prefix is itself an explicit race signal, so
    // the helper resolves the kind even when the caller can't supply
    // sessionType (e.g. dashboard RaceDayHero, which reads from the
    // /race-week endpoint payload).
    // Pull each race-day prose from the same `RACE_DAY_SPECS[kind]`
    // table the canonical generator emits, so a future tweak to the
    // copy can't silently desync this fixture (Task #231; mirrors the
    // drift-proofing already applied to race-week.test.ts and
    // backfill-plan-day-equipment.test.ts).
    expect(raceDayLabel(26.2, RACE_DAY_SPECS.marathon.description)?.label).toBe("Marathon Day");
    expect(raceDayLabel(13.1, RACE_DAY_SPECS.half.description)?.label).toBe("Half Marathon Day");
    expect(raceDayLabel(6.2, RACE_DAY_SPECS["10k"].description)?.label).toBe("10K Day");
    expect(raceDayLabel(3.1, RACE_DAY_SPECS["5k"].description)?.label).toBe("5K Day");
  });

  it("falls back to distance_mi for race rows whose description was customized away from the generator prefix", () => {
    // sessionType="Race" is the second valid race signal; once it
    // gates the row, distance can resolve the kind even when the
    // runner has rewritten the description.
    expect(raceDayLabel(26.2, null, "Race")?.kind).toBe("marathon");
    expect(raceDayLabel(13.1, "Custom note", "Race")?.kind).toBe("half");
    expect(raceDayLabel(6.2, null, "Race")?.kind).toBe("10k");
    expect(raceDayLabel(3.1, "", "Race")?.kind).toBe("5k");
  });

  it("prefers description prefix over distance when they disagree (runner edited distance only)", () => {
    // Runner shortened the route to 12.4 mi but the row was seeded as
    // a half-marathon Sunday — the headline should still read
    // "Half Marathon Day" because the generator's prefix carries the
    // intent of the day.
    expect(raceDayLabel(12.4, "RACE DAY — Half (13.1 mi). ...")?.label).toBe("Half Marathon Day");
  });

  it("tolerates a regular hyphen instead of em-dash in the description prefix", () => {
    expect(raceDayLabel(3.1, "RACE DAY - 5K (3.1 mi).")?.label).toBe("5K Day");
  });

  it("returns null for non-race-day rows so callers can fall through to the generic title", () => {
    expect(raceDayLabel(8, "Long Run")).toBeNull();
    expect(raceDayLabel(null, "Easy 4 mi")).toBeNull();
    expect(raceDayLabel(null, null)).toBeNull();
    // Distances close to but not matching a real race kind should not
    // mis-classify (e.g. a 5 mi long run isn't a 5K race day).
    expect(raceDayLabel(5, null)).toBeNull();
    expect(raceDayLabel(20, null)).toBeNull();
  });

  it("does NOT mis-classify non-race rows that happen to land on a canonical race distance", () => {
    // Regression guard: distance-only fallback must never fire for a
    // row that lacks BOTH the "RACE DAY — " prefix AND
    // sessionType==="Race". A 13.1 mi long run, a 3.1 mi shakeout,
    // a 6.2 mi taper run, or a 26.2 mi anything would otherwise pick
    // up a stray "Half Marathon Day" / "5K Day" / etc. badge in the
    // calendar. Cover all four kinds across both call shapes
    // (sessionType omitted AND sessionType set to a non-race value).
    expect(raceDayLabel(13.1, "Long aerobic effort")).toBeNull();
    expect(raceDayLabel(13.1, "Long aerobic effort", "Long Run")).toBeNull();
    expect(raceDayLabel(3.1, "Easy shakeout", "Recovery Run")).toBeNull();
    expect(raceDayLabel(6.2, "Steady aerobic", "Steady Run")).toBeNull();
    expect(raceDayLabel(26.2, "Big training day", "Long Run")).toBeNull();
    // sessionType case + whitespace tolerance — "race" / " RACE "
    // still gates as a race row even if the runner saved a different
    // casing.
    expect(raceDayLabel(13.1, null, " RACE ")?.kind).toBe("half");
    expect(raceDayLabel(3.1, null, "race")?.kind).toBe("5k");
  });

  it("exposes canonical distance and short label per kind", () => {
    expect(raceDayLabel(26.2, null, "Race")).toMatchObject({ kind: "marathon", shortLabel: "Marathon", distanceMi: 26.2 });
    expect(raceDayLabel(13.1, null, "Race")).toMatchObject({ kind: "half", shortLabel: "Half", distanceMi: 13.1 });
    expect(raceDayLabel(6.2, null, "Race")).toMatchObject({ kind: "10k", shortLabel: "10K", distanceMi: 6.2 });
    expect(raceDayLabel(3.1, null, "Race")).toMatchObject({ kind: "5k", shortLabel: "5K", distanceMi: 3.1 });
  });
});

// Task #227: pin the race-kind → 5-zone bucket mapping. The race-week
// pace chip on dashboard / Today / week-detail dresses itself in the
// HR_ZONE_TONES tone for this bucket so the runner sees the intended
// effort at a glance — VO2 red for 5K, threshold orange for 10K /
// half, steady amber for marathon pace. Pinning the table here means
// a future change to RACE_DAY_SPECS pace ladder must also revisit
// these buckets (or this snapshot fails) so the visual cue stays in
// lockstep with the actual prescribed pace.
describe("RACE_DAY_ZONE_BUCKET — task #227 single source of truth", () => {
  it("maps each race kind to its training-zone bucket", () => {
    expect(RACE_DAY_ZONE_BUCKET).toEqual({
      marathon: 3, // amber — steady marathon-pace effort
      half: 3, // amber — paired with marathon as "race-pace" tone
      "10k": 4, // orange — lactate threshold
      "5k": 5, // red — VO2max
    });
  });

  it("pairs marathon and half on the same race-pace tone (per task #227 brief)", () => {
    expect(RACE_DAY_ZONE_BUCKET.half).toBe(RACE_DAY_ZONE_BUCKET.marathon);
  });

  it("is exposed on the per-kind RaceDayLabelInfo so callers with only the row in hand can look the bucket up", () => {
    expect(raceDayLabel(26.2, null, "Race")?.zoneBucket).toBe(3);
    expect(raceDayLabel(13.1, null, "Race")?.zoneBucket).toBe(3);
    expect(raceDayLabel(6.2, null, "Race")?.zoneBucket).toBe(4);
    expect(raceDayLabel(3.1, null, "Race")?.zoneBucket).toBe(5);
  });

  it("does not return a zoneBucket on non-race rows (raceDayLabel returns null first)", () => {
    // Distance-only fallback is gated on a race signal — a 13.1 mi
    // long run, 3.1 mi shakeout, etc. should NOT pick up a zoneBucket
    // off the distance alone.
    expect(raceDayLabel(13.1, "Long aerobic effort")).toBeNull();
    expect(raceDayLabel(3.1, "Easy shakeout", "Recovery Run")).toBeNull();
  });

  it("orders the buckets so 5K is the hottest tone and marathon/half is the coolest", () => {
    // Sanity guard: the bucket ordering encodes the relative effort
    // ramp across race kinds. A future tweak that swaps marathon and
    // 5K (or drops 10K below the marathon/half race-pace tier) would
    // silently mis-color the chip, so assert the strict ordering
    // directly. Marathon and half share a tone (race-pace), so the
    // 10K tier sits strictly above both.
    expect(RACE_DAY_ZONE_BUCKET["5k"]).toBeGreaterThan(RACE_DAY_ZONE_BUCKET["10k"]);
    expect(RACE_DAY_ZONE_BUCKET["10k"]).toBeGreaterThan(RACE_DAY_ZONE_BUCKET.half);
    expect(RACE_DAY_ZONE_BUCKET["10k"]).toBeGreaterThan(RACE_DAY_ZONE_BUCKET.marathon);
  });
});
