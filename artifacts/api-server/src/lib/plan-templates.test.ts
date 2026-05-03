import { describe, it, expect } from "vitest";
import {
  PLAN_TEMPLATES,
  STARTER_SHORTCUTS,
  getTemplateById,
  expandEntriesToBlocks,
  expandEntriesToBlocksWithGaps,
  projectEntries,
} from "@workspace/plan-generator";

describe("PLAN_TEMPLATES", () => {
  it("registers all 16 research-backed templates", () => {
    const ids = PLAN_TEMPLATES.map((t) => t.id).sort();
    expect(ids).toEqual(
      [
        "5k_improver",
        "10k_builder",
        "aerobic_base",
        "cardio_weight_loss",
        "couch_to_5k",
        "half_marathon",
        "hybrid_strength",
        "maintenance",
        "marathon",
        "push_pull_legs",
        "recovery",
        "speed_block",
        "tonal_conditioning",
        "tonal_strength_lower",
        "tonal_strength_upper",
        "ultramarathon_50k",
      ].sort(),
    );
  });

  it("every template has a citation, source, descriptions, and full metadata", () => {
    for (const t of PLAN_TEMPLATES) {
      expect(t.source.length, `${t.id} source`).toBeGreaterThan(0);
      expect(t.citation.length, `${t.id} citation`).toBeGreaterThan(5);
      expect(t.shortDescription.length, `${t.id} short`).toBeGreaterThan(10);
      expect(t.longDescription.length, `${t.id} long`).toBeGreaterThan(20);
      expect(t.metadata.intensityDistribution, `${t.id} intensity`).toBeTruthy();
      expect(t.metadata.peakLongRun, `${t.id} long run`).toBeTruthy();
      expect(t.metadata.peakWeeklyVolume, `${t.id} volume`).toBeTruthy();
      expect(t.metadata.taperLength, `${t.id} taper`).toBeTruthy();
      expect(t.metadata.cutbackCadence, `${t.id} cutback`).toBeTruthy();
      expect(t.metadata.equipmentMixHint, `${t.id} equipment`).toBeTruthy();
      expect(t.metadata.mandatoryRestDays, `${t.id} rest`).toBeGreaterThan(0);
    }
  });

  it("min <= default <= max for every template", () => {
    for (const t of PLAN_TEMPLATES) {
      expect(t.minWeeks, t.id).toBeGreaterThan(0);
      expect(t.defaultWeeks, t.id).toBeGreaterThanOrEqual(t.minWeeks);
      expect(t.maxWeeks, t.id).toBeGreaterThanOrEqual(t.defaultWeeks);
    }
  });

  it("ships exact launch-catalog week ranges per template", () => {
    const expected: Record<string, [number, number, number]> = {
      // [min, default, max]
      couch_to_5k: [6, 9, 12],
      "5k_improver": [6, 8, 12],
      "10k_builder": [8, 10, 14],
      half_marathon: [10, 12, 16],
      marathon: [16, 18, 24],
      ultramarathon_50k: [16, 20, 24],
      aerobic_base: [4, 8, 16],
      speed_block: [4, 6, 8],
      hybrid_strength: [6, 8, 12],
      cardio_weight_loss: [6, 10, 16],
      recovery: [2, 4, 6],
      maintenance: [4, 6, 12],
      tonal_strength_upper: [4, 8, 16],
      tonal_strength_lower: [4, 8, 16],
      push_pull_legs: [4, 8, 16],
      tonal_conditioning: [4, 8, 16],
    };
    for (const t of PLAN_TEMPLATES) {
      const want = expected[t.id];
      expect(want, `missing expectation for ${t.id}`).toBeTruthy();
      expect([t.minWeeks, t.defaultWeeks, t.maxWeeks], t.id).toEqual(want);
    }
  });

  it("expand(n) produces blocks summing to exactly n across the full range", () => {
    for (const t of PLAN_TEMPLATES) {
      for (let n = t.minWeeks; n <= t.maxWeeks; n++) {
        const sum = t.expand(n).reduce((s, b) => s + b.weeks, 0);
        expect(sum, `${t.id} @ ${n}w`).toBe(n);
      }
    }
  });

  it("templates with a published taper end on a Taper or Recovery block", () => {
    for (const t of PLAN_TEMPLATES) {
      if (!/none|n\/a/i.test(t.metadata.taperLength)) {
        const blocks = t.expand(t.defaultWeeks);
        const last = blocks[blocks.length - 1]!;
        expect(
          ["Taper", "Recovery"].includes(last.focusType),
          `${t.id} should end on Taper/Recovery (got ${last.focusType})`,
        ).toBe(true);
      }
    }
  });
});

describe("getTemplateById", () => {
  it("returns the matching template", () => {
    expect(getTemplateById("half_marathon")?.name).toBe("Half Marathon");
  });
  it("returns null for unknown ids", () => {
    expect(getTemplateById("not_real")).toBeNull();
  });
});

describe("STARTER_SHORTCUTS", () => {
  it("registers exactly the three starter shortcuts", () => {
    expect(STARTER_SHORTCUTS.map((s) => s.id).sort()).toEqual([
      "get_faster_5k_14w",
      "hm_beginner_16w",
      "marathon_first_timer_24w",
    ]);
  });

  it("every starter is a multi-entry composition referencing real templates", () => {
    for (const s of STARTER_SHORTCUTS) {
      expect(s.entries.length, s.id).toBeGreaterThanOrEqual(1);
      for (const e of s.entries) {
        expect(getTemplateById(e.templateId), `${s.id}/${e.templateId}`).not.toBeNull();
        expect(e.weeks, `${s.id}/${e.templateId} weeks`).toBeGreaterThan(0);
      }
    }
  });

  it("HM Beginner = 4w Aerobic Base + 12w Half Marathon (16w total)", () => {
    const s = STARTER_SHORTCUTS.find((x) => x.id === "hm_beginner_16w")!;
    expect(s.entries.map((e) => [e.templateId, e.weeks])).toEqual([
      ["aerobic_base", 4],
      ["half_marathon", 12],
    ]);
  });

  it("Marathon First-Timer = 6w Aerobic Base + 18w Marathon (24w total)", () => {
    const s = STARTER_SHORTCUTS.find(
      (x) => x.id === "marathon_first_timer_24w",
    )!;
    expect(s.entries.map((e) => [e.templateId, e.weeks])).toEqual([
      ["aerobic_base", 6],
      ["marathon", 18],
    ]);
  });

  it("Get Faster 5K = 6w Aerobic Base + 8w 5K Improver (14w total)", () => {
    const s = STARTER_SHORTCUTS.find((x) => x.id === "get_faster_5k_14w")!;
    expect(s.entries.map((e) => [e.templateId, e.weeks])).toEqual([
      ["aerobic_base", 6],
      ["5k_improver", 8],
    ]);
  });

  it("expanding a starter sums to its declared total weeks", () => {
    for (const s of STARTER_SHORTCUTS) {
      const total = s.entries.reduce((acc, e) => acc + e.weeks, 0);
      const blocks = expandEntriesToBlocks(
        s.entries.map((e) => ({ templateId: e.templateId, weeks: e.weeks })),
      );
      const sum = blocks.reduce((acc, b) => acc + b.weeks, 0);
      expect(sum, s.id).toBe(total);
    }
  });

  it("every starter entry's weeks fall within the template's published min/max range", () => {
    for (const s of STARTER_SHORTCUTS) {
      for (const e of s.entries) {
        const tpl = getTemplateById(e.templateId)!;
        expect(e.weeks, `${s.id}/${e.templateId}`).toBeGreaterThanOrEqual(
          tpl.minWeeks,
        );
        expect(e.weeks, `${s.id}/${e.templateId}`).toBeLessThanOrEqual(
          tpl.maxWeeks,
        );
      }
    }
  });
});

describe("expandEntriesToBlocks", () => {
  it("composes ordered template entries into a flat block list", () => {
    const blocks = expandEntriesToBlocks([
      { templateId: "aerobic_base", weeks: 8 },
      { templateId: "half_marathon", weeks: 12 },
    ]);
    const sum = blocks.reduce((s, b) => s + b.weeks, 0);
    expect(sum).toBe(20);
    expect(blocks[0]!.focusType).toBe("Base");
    expect(blocks[0]!.weeks).toBe(8);
    expect(blocks[blocks.length - 1]!.focusType).toBe("Taper");
  });

  it("skips entries referencing unknown template ids", () => {
    const blocks = expandEntriesToBlocks([
      { templateId: "does_not_exist", weeks: 5 },
      { templateId: "recovery", weeks: 3 },
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.focusType).toBe("Recovery");
    expect(blocks[0]!.weeks).toBe(3);
  });

  it("merges per-entry customNotes into every expanded block", () => {
    const blocks = expandEntriesToBlocks([
      { templateId: "aerobic_base", weeks: 4, customNotes: "Heat block" },
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.customNotes).toBe("Heat block");
  });
});

describe("projectEntries (gap-aware)", () => {
  // 2026-01-05 is a Monday. Aerobic Base 4w → ends 2026-02-01 (Sunday).
  // Next stack-cursor Monday is 2026-02-02.
  it("stacks entries back-to-back when no startDate overrides are set", () => {
    const out = projectEntries(
      [
        { templateId: "aerobic_base", weeks: 4 },
        { templateId: "half_marathon", weeks: 12 },
      ],
      "2026-01-05",
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      entryIndex: 0,
      gapWeeksBefore: 0,
      startDateISO: "2026-01-05",
      endDateISO: "2026-02-01",
    });
    expect(out[1]).toMatchObject({
      entryIndex: 1,
      gapWeeksBefore: 0,
      startDateISO: "2026-02-02",
    });
  });

  it("inserts a leading gap when a non-first entry's startDate skips Mondays", () => {
    // Push the half marathon 2 weeks past the back-to-back cursor.
    const out = projectEntries(
      [
        { templateId: "aerobic_base", weeks: 4 },
        {
          templateId: "half_marathon",
          weeks: 12,
          startDate: "2026-02-16",
        },
      ],
      "2026-01-05",
    );
    expect(out[1]!.gapWeeksBefore).toBe(2);
    expect(out[1]!.startDateISO).toBe("2026-02-16");
  });
});

describe("expandEntriesToBlocksWithGaps", () => {
  it("inserts Recovery filler blocks for gap weeks between entries", () => {
    const blocks = expandEntriesToBlocksWithGaps(
      [
        { templateId: "aerobic_base", weeks: 4 },
        {
          templateId: "half_marathon",
          weeks: 12,
          startDate: "2026-02-16",
        },
      ],
      "2026-01-05",
    );
    // 4w aerobic → 1+ blocks, 2w gap (Recovery filler), then 12w HM blocks.
    const total = blocks.reduce((s, b) => s + b.weeks, 0);
    expect(total).toBe(4 + 2 + 12);
    const gap = blocks.find(
      (b) => b.focusType === "Recovery" && b.customNotes === "Gap between templates",
    );
    expect(gap, "expected Recovery filler block").toBeTruthy();
    expect(gap!.weeks).toBe(2);
  });

  it("matches plain expandEntriesToBlocks when no gaps are present", () => {
    const a = expandEntriesToBlocks([
      { templateId: "aerobic_base", weeks: 8 },
      { templateId: "half_marathon", weeks: 12 },
    ]);
    const b = expandEntriesToBlocksWithGaps(
      [
        { templateId: "aerobic_base", weeks: 8 },
        { templateId: "half_marathon", weeks: 12 },
      ],
      "2026-01-05",
    );
    const sumA = a.reduce((s, x) => s + x.weeks, 0);
    const sumB = b.reduce((s, x) => s + x.weeks, 0);
    expect(sumB).toBe(sumA);
    expect(b.some((x) => x.customNotes === "Gap between templates")).toBe(false);
  });
});
