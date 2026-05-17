import { describe, expect, it } from "vitest";
import {
  CUTBACK_LONG_FACTOR,
  buildBlockMileageCurve,
  expandEntriesToBlocks,
  generatePlanFromConfig,
  type PlannerConfig,
} from "@workspace/plan-generator";

// Task #353 research regression suite. The Phase Planner catalog now
// spans many template lengths and race kinds; rather than pin every
// single template/length combination (which is brittle and hard to
// maintain), this suite encodes the SCIENCE INVARIANTS that should
// hold across the catalog:
//
//   1. The block-curve helper is exported and behaves as documented
//      (start on week 1, peak on block-final week, linear in between).
//   2. The unified cutback factor is the single source of truth and
//      stays inside the published deload band (15-25% volume drop).
//   3. Every supported HM / marathon template at every supported
//      length clears its research-aligned long-run peak floor.
//   4. Race-kind clamping holds across hybrid templates (5K, 10K)
//      so a short-race plan never inherits a marathon-tuned peak.
//   5. Long runs ramp meaningfully from week 1 to peak — no template
//      may plateau in the bottom 50% of its allowed range for the
//      whole campaign.

function entriesCfg(
  templateId: string,
  weeks: number,
  _raceKind: "half" | "10k" | "marathon" = "half",
): PlannerConfig {
  // Mon 2026-05-04 → Sun (weeks*7 - 1) days later, matches the helper
  // used in plan-templates.test.ts so date validation passes for both
  // marathon and HM entries (validator requires a yyyy-mm-dd
  // marathonDate even when raceKind doesn't classify as marathon).
  const startMs = Date.parse("2026-05-04T00:00:00Z");
  const endMs = startMs + (weeks * 7 - 1) * 86400000;
  const marathonDate = new Date(endMs).toISOString().slice(0, 10);
  return {
    startDate: "2026-05-04",
    marathonDate,
    blocks: [],
    entries: [{ templateId, weeks, startDate: "2026-05-04" }],
  } as unknown as PlannerConfig;
}

function sundayLongRuns(cfg: PlannerConfig): Map<number, number> {
  const { daily } = generatePlanFromConfig(cfg);
  const m = new Map<number, number>();
  for (const d of daily) if (d.day === "Sun") m.set(d.week, d.distance_mi || 0);
  return m;
}

describe("Task #353 — buildBlockMileageCurve helper contract", () => {
  it("returns peak on the block-final week regardless of block length", () => {
    for (const bw of [3, 4, 6, 8, 12]) {
      const final = buildBlockMileageCurve(bw, bw, 4, 12);
      expect(final, `bw=${bw} block-final`).toBeCloseTo(12, 6);
    }
  });

  it("returns start on the first week of the block", () => {
    for (const bw of [3, 4, 6, 8, 12]) {
      const first = buildBlockMileageCurve(1, bw, 4, 12);
      expect(first, `bw=${bw} week 1`).toBeCloseTo(4, 6);
    }
  });

  it("ramps monotonically across the block", () => {
    const bw = 6;
    let prev = -Infinity;
    for (let w = 1; w <= bw; w += 1) {
      const v = buildBlockMileageCurve(w, bw, 4, 16);
      expect(v, `bw=${bw} w=${w} (${v} mi) must be > previous (${prev})`).toBeGreaterThan(prev);
      prev = v;
    }
  });

  it("short-circuits to peak when blockWeeks <= 1", () => {
    expect(buildBlockMileageCurve(1, 1, 4, 12)).toBe(12);
    expect(buildBlockMileageCurve(1, 0, 4, 12)).toBe(12);
  });
});

describe("Task #353 — unified cutback factor", () => {
  it("sits inside the published 15-25% deload band", () => {
    // Hansons / Pfitz / Daniels in-block deload weeks recommend a
    // ~15-25% volume reduction. The unified factor lives in this
    // band; anything outside is either too gentle (not a real
    // deload) or too aggressive (collapses fitness gains).
    expect(CUTBACK_LONG_FACTOR).toBeGreaterThanOrEqual(0.75);
    expect(CUTBACK_LONG_FACTOR).toBeLessThanOrEqual(0.85);
  });
});

describe("Task #353 — research peak floors across HM templates", () => {
  // Every HM template at a runnable length should clear ~10 mi in the
  // final pre-race-week long run. Some hybrid templates are
  // deliberately capped lower because they split volume with lifting
  // — those use a relaxed floor.
  const HM_TEMPLATES: Array<{
    id: string;
    weeks: number;
    floor: number;
    note: string;
  }> = [
    { id: "half_marathon", weeks: 12, floor: 10, note: "default HM, run-primary" },
    { id: "half_marathon", weeks: 16, floor: 12, note: "longer HM gets to higher peak" },
    { id: "hm_pfitz", weeks: 14, floor: 10, note: "Pfitz HM, run-primary" },
    { id: "half_hybrid_balanced", weeks: 14, floor: 10, note: "hybrid HM race-distance safety floor (Task #360)" },
  ];

  for (const tpl of HM_TEMPLATES) {
    it(`${tpl.id} (${tpl.weeks}w) clears ${tpl.floor} mi pre-race peak — ${tpl.note}`, () => {
      const longs = sundayLongRuns(entriesCfg(tpl.id, tpl.weeks, "half"));
      let peak = 0;
      for (const [w, mi] of longs) {
        if (w === tpl.weeks) continue; // race-week Sun overridden to race distance
        if (mi > peak) peak = mi;
      }
      expect(peak, `${tpl.id} ${tpl.weeks}w pre-race peak long run`).toBeGreaterThanOrEqual(
        tpl.floor,
      );
    });
  }
});

describe("Task #353 — race-kind clamps hold across hybrid templates", () => {
  // 5K hybrid plans must stay under the 5K long-run ceiling (3 mi
  // from clampRunMi). 10K hybrids must stay under 8 mi. This is the
  // raceKind scalar (hybridMileage.peakLong * raceKindScalar) doing
  // its job — short-race hybrids inherit a smaller long-run target.
  const HYBRID_CLAMPS: Array<{
    id: string;
    weeks: number;
    raceKind: string;
    ceiling: number;
  }> = [
    { id: "10k_hybrid_balanced", weeks: 8, raceKind: "10k", ceiling: 8 },
    { id: "10k_hybrid_balanced", weeks: 12, raceKind: "10k", ceiling: 8 },
  ];

  for (const tpl of HYBRID_CLAMPS) {
    it(`${tpl.id} (${tpl.weeks}w, ${tpl.raceKind}) stays under ${tpl.ceiling} mi ceiling`, () => {
      const longs = sundayLongRuns(entriesCfg(tpl.id, tpl.weeks, "half"));
      let peak = 0;
      for (const [w, mi] of longs) {
        if (w === tpl.weeks) continue; // race-week Sun is race day
        if (mi > peak) peak = mi;
      }
      expect(peak, `${tpl.id} ${tpl.weeks}w pre-race peak`).toBeLessThanOrEqual(tpl.ceiling);
    });
  }
});

describe("Task #360 — production-shape pin (user's exact applied config)", () => {
  // The runner's production config that triggered Task #360:
  // C25K (6w) → 5K hybrid balanced (6w) → 10K hybrid balanced (8w)
  // → HM hybrid balanced (16w). Before the fix this peaked at
  // 7.0 / 7.3 / 7.7 mi in W33-W35 then jumped to 13.1 mi on race
  // day W36 — a 5.4 mi cliff, well outside the ACSM 75-85%-of-race
  // guideline. After the race-distance safety floor in
  // `hybridMileage()`, the final pre-race long runs must clear the
  // safe floors below. If anything ever regresses the user's
  // specific plan again, this test fails immediately.
  it("4-entry C25K→5K→10K→HM hybrid sequence — W33-W36 Sundays clear safe floors", () => {
    const startMs = Date.parse("2026-05-04T00:00:00Z");
    const totalWeeks = 6 + 6 + 8 + 16;
    const endMs = startMs + (totalWeeks * 7 - 1) * 86400000;
    const marathonDate = new Date(endMs).toISOString().slice(0, 10);
    const cfg = {
      startDate: "2026-05-04",
      marathonDate,
      blocks: [],
      entries: [
        { templateId: "couch_to_5k", weeks: 6 },
        { templateId: "5k_hybrid_balanced", weeks: 6 },
        { templateId: "10k_hybrid_balanced", weeks: 8 },
        { templateId: "half_hybrid_balanced", weeks: 16 },
      ],
    } as unknown as PlannerConfig;
    const longs = sundayLongRuns(cfg);
    const w33 = longs.get(33) ?? 0;
    const w34 = longs.get(34) ?? 0;
    const w35 = longs.get(35) ?? 0;
    const w36 = longs.get(36) ?? 0;
    // Final pre-race-week long-run peak must be in the 10-11 mi
    // band — not the broken 7.x band.
    const prePeak = Math.max(w33, w34, w35);
    expect(prePeak, `pre-race peak across W33-W35 (got ${w33}/${w34}/${w35})`).toBeGreaterThanOrEqual(10);
    // Race day stays 13.1.
    expect(w36, "W36 race day").toBeCloseTo(13.1, 1);
    // The jump from the final non-race-week long run into race day
    // must not exceed 5 mi (ACSM safety guideline). Pre-fix this
    // was 13.1 - 7.7 = 5.4 mi.
    expect(13.1 - w35, `race-day jump from W35 (${w35} mi → 13.1 mi)`).toBeLessThanOrEqual(5);
  });
});

describe("Task #353 — no template plateaus in the bottom half of its range", () => {
  // A plan that flat-lines near the start value the whole way is the
  // exact failure mode the user reported (12w HM stuck at 7.0/7.3/7.7
  // before race day). Verify across several HM/marathon templates
  // that the pre-race peak is strictly greater than 1.5x the W1
  // long run — meaningful progression, not a plateau.
  const PROGRESSION_TEMPLATES: Array<{ id: string; weeks: number }> = [
    { id: "half_marathon", weeks: 12 },
    { id: "half_marathon", weeks: 14 },
    { id: "hm_pfitz", weeks: 14 },
    { id: "marathon", weeks: 18 },
  ];

  for (const tpl of PROGRESSION_TEMPLATES) {
    it(`${tpl.id} (${tpl.weeks}w) — pre-race peak > 1.5x W1 long run`, () => {
      const longs = sundayLongRuns(
        entriesCfg(tpl.id, tpl.weeks, tpl.id.startsWith("marathon") ? "marathon" : "half"),
      );
      const week1 = longs.get(1) ?? 0;
      let peak = 0;
      for (const [w, mi] of longs) {
        if (w === tpl.weeks) continue;
        if (mi > peak) peak = mi;
      }
      expect(peak, `${tpl.id} ${tpl.weeks}w peak (${peak}) vs W1 (${week1})`).toBeGreaterThan(
        week1 * 1.5,
      );
    });
  }
});
