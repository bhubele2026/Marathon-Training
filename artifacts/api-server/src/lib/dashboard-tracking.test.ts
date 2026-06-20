import { describe, it, expect } from "vitest";
import {
  verdictBucket,
  summarizeMachineMix,
  summarizeConsistency,
  summarizeRecomp,
  type TrainingRow,
} from "./dashboard-tracking";

function row(p: Partial<TrainingRow>): TrainingRow {
  return {
    date: "2099-01-01",
    equipment: null,
    sessionType: null,
    durationMin: null,
    strengthMin: null,
    cardioMin: null,
    runMin: null,
    modality: null,
    plannedMin: null,
    ...p,
  };
}

describe("verdictBucket", () => {
  it("buckets by actual/planned ratio", () => {
    expect(verdictBucket(50, 50)).toBe("complete");
    expect(verdictBucket(50, 46)).toBe("complete");
    expect(verdictBucket(50, 65)).toBe("over");
    expect(verdictBucket(50, 35)).toBe("close");
    expect(verdictBucket(50, 20)).toBe("short");
    expect(verdictBucket(50, 0)).toBe("skipped");
    expect(verdictBucket(0, 40)).toBe("bonus");
    expect(verdictBucket(0, 0)).toBeNull();
  });
});

describe("summarizeMachineMix", () => {
  it("groups minutes + session counts by equipment, sorted desc", () => {
    const mix = summarizeMachineMix([
      row({ equipment: "Tonal", durationMin: 45 }),
      row({ equipment: "Peloton Bike", durationMin: 30 }),
      row({ equipment: "Tonal", strengthMin: 50 }),
    ]);
    expect(mix[0]).toEqual({ equipment: "Tonal", minutes: 95, sessions: 2 });
    expect(mix[1]).toEqual({ equipment: "Peloton Bike", minutes: 30, sessions: 1 });
  });

  it("falls back to session type when equipment is missing", () => {
    const mix = summarizeMachineMix([row({ sessionType: "Walk", durationMin: 20 })]);
    expect(mix[0]!.equipment).toBe("Walk");
  });
});

describe("summarizeConsistency", () => {
  it("counts done sessions, days, load and verdicts (skip excluded from logged rows)", () => {
    const c = summarizeConsistency([
      row({ date: "2099-01-01", strengthMin: 45, plannedMin: 45 }), // complete
      row({ date: "2099-01-01", cardioMin: 10, plannedMin: 40 }), // short (10/40)
      row({ date: "2099-01-02", runMin: 30, plannedMin: 0 }), // bonus (off-plan)
    ]);
    expect(c.sessionsDone).toBe(3);
    expect(c.daysTrained).toBe(2);
    expect(c.verdicts.complete).toBe(1);
    expect(c.verdicts.short).toBe(1);
    expect(c.verdicts.bonus).toBe(1);
    expect(c.verdicts.skipped).toBe(0);
    expect(c.loadTotal).toBeGreaterThan(0);
  });

  it("excludes rest/skip markers from done + days", () => {
    const c = summarizeConsistency([
      row({ date: "2099-01-03", sessionType: "Rest", durationMin: 0 }),
    ]);
    expect(c.sessionsDone).toBe(0);
    expect(c.daysTrained).toBe(0);
  });
});

describe("summarizeRecomp", () => {
  it("computes window change and distance to goal", () => {
    const r = summarizeRecomp({
      currentWeightLb: 270,
      startWeightLb: 276,
      goalWeightLb: 210,
      strengthCurrent: 120,
      strengthGoal: 150,
    });
    expect(r.changeLb).toBe(-6);
    expect(r.toGoalLb).toBe(60);
  });

  it("returns nulls when weigh-ins are missing", () => {
    const r = summarizeRecomp({
      currentWeightLb: null,
      startWeightLb: null,
      goalWeightLb: 210,
      strengthCurrent: null,
      strengthGoal: null,
    });
    expect(r.changeLb).toBeNull();
    expect(r.toGoalLb).toBeNull();
  });
});
