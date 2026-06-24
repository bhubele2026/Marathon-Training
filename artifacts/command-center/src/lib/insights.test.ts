import { describe, expect, it } from "vitest";
import { computeInsights, type InsightInputs } from "./insights";

// Deterministic "now" so streak math is stable.
const NOW = new Date("2026-06-24T18:00:00Z");

function days(n: number, from = "2026-06-10"): string[] {
  const out: string[] = [];
  const base = new Date(`${from}T12:00:00Z`);
  for (let i = 0; i < n; i++) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

const base: InsightInputs = {
  entries: [],
  waters: [],
  workouts: [],
  measurements: [],
  targets: { calorieTarget: 2150, proteinTargetG: 185 },
  goalKind: "fat_loss",
  windowDays: 14,
  now: NOW,
};

describe("computeInsights", () => {
  it("returns no findings + hasEnoughData=false when nothing is logged", () => {
    const r = computeInsights(base);
    expect(r.findings).toHaveLength(0);
    expect(r.hasEnoughData).toBe(false);
  });

  it("flags short protein with the real average and target, ranked as a fix", () => {
    const ds = days(5);
    const r = computeInsights({
      ...base,
      entries: ds.map((date) => ({ date, calories: 2000, proteinG: 120 })),
    });
    const protein = r.findings.find((f) => f.id === "protein-adherence");
    expect(protein).toBeDefined();
    expect(protein!.tone).toBe("sassy");
    // Cites the real numbers.
    expect(protein!.detail).toContain("120");
    expect(protein!.detail).toContain("185");
    // A "fix this" finding outranks a mere positive — rank 1 is actionable.
    expect(r.findings[0]!.tone === "sassy" || r.findings[0]!.tone === "supportive").toBe(
      true,
    );
    // Ranks are dense 1..n.
    expect(r.findings.map((f) => f.rank)).toEqual(
      r.findings.map((_, i) => i + 1),
    );
  });

  it("reads a cut as working when weight drops on-target", () => {
    const r = computeInsights({
      ...base,
      measurements: [
        { date: "2026-06-11", weight: 196 },
        { date: "2026-06-23", weight: 193 },
      ],
    });
    const w = r.findings.find((f) => f.id === "weight-trend");
    expect(w).toBeDefined();
    expect(w!.tone).toBe("positive");
    expect(w!.title).toMatch(/cut is working/i);
    expect(w!.detail).toMatch(/lb\/wk/);
    expect(w!.detail).toContain("196");
  });

  it("calls out a gaining scale on a cut as the wrong way", () => {
    const r = computeInsights({
      ...base,
      measurements: [
        { date: "2026-06-11", weight: 193 },
        { date: "2026-06-23", weight: 196 },
      ],
    });
    const w = r.findings.find((f) => f.id === "weight-trend");
    expect(w!.tone).toBe("sassy");
    expect(w!.title).toMatch(/wrong way/i);
  });

  it("computes training cadence per-week from the window", () => {
    const ds = days(4);
    const r = computeInsights({
      ...base,
      workouts: ds.map((date) => ({ date, totalMin: 45 })),
      windowDays: 14,
    });
    const t = r.findings.find((f) => f.id === "training-load");
    expect(t).toBeDefined();
    expect(t!.detail).toContain("4 sessions");
    expect(t!.detail).toMatch(/\/wk/);
    // 4 sessions over 14 days = 2.0/wk < 2.5 → sparse → sassy.
    expect(t!.tone).toBe("sassy");
  });

  it("rewards a consistent logging streak", () => {
    // 6 consecutive days ending today (2026-06-24).
    const streakDays = days(6, "2026-06-19");
    const r = computeInsights({
      ...base,
      entries: streakDays.map((date) => ({ date, calories: 2100, proteinG: 190 })),
    });
    const s = r.findings.find((f) => f.id === "logging-streak");
    expect(s).toBeDefined();
    expect(s!.tone).toBe("positive");
    expect(s!.detail).toContain("6-day");
  });
});
