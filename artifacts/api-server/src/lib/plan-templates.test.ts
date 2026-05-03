import { describe, it, expect } from "vitest";
import {
  PLAN_TEMPLATES,
  STARTER_SHORTCUTS,
  getTemplateById,
  expandEntriesToBlocks,
} from "@workspace/plan-generator";

describe("PLAN_TEMPLATES", () => {
  it("registers all 12 research-backed templates", () => {
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
        "recovery",
        "speed_block",
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

  it("expand(n) produces blocks summing to exactly n at min/default/max", () => {
    for (const t of PLAN_TEMPLATES) {
      for (const n of [t.minWeeks, t.defaultWeeks, t.maxWeeks]) {
        const blocks = t.expand(n);
        const sum = blocks.reduce((s, b) => s + b.weeks, 0);
        expect(sum, `${t.id} @ ${n}w`).toBe(n);
        for (const b of blocks) {
          expect(b.weeks, `${t.id} block ${b.focusType} weeks`).toBeGreaterThan(0);
          if (b.focusType === "Custom") {
            expect(b.customName, `${t.id} custom name`).toBeTruthy();
          } else {
            expect(b.customName, `${t.id} non-custom name should be null`).toBeNull();
          }
        }
      }
    }
  });

  it("expand(n) produces blocks summing to exactly n across full range", () => {
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
  it("registers exactly the three Task #84 starter shortcuts", () => {
    expect(STARTER_SHORTCUTS.map((s) => s.id).sort()).toEqual([
      "get_faster_5k_14w",
      "hm_beginner_16w",
      "marathon_first_timer_24w",
    ]);
  });

  it("each starter references a real template", () => {
    for (const s of STARTER_SHORTCUTS) {
      expect(getTemplateById(s.templateId), s.id).not.toBeNull();
      expect(s.weeks, s.id).toBeGreaterThan(0);
    }
  });

  it("HM Beginner is 16 weeks of half_marathon (no auto-tail)", () => {
    const s = STARTER_SHORTCUTS.find((x) => x.id === "hm_beginner_16w")!;
    expect(s.templateId).toBe("half_marathon");
    expect(s.weeks).toBe(16);
  });

  it("Marathon First-Timer is 24 weeks of marathon (no auto-tail)", () => {
    const s = STARTER_SHORTCUTS.find(
      (x) => x.id === "marathon_first_timer_24w",
    )!;
    expect(s.templateId).toBe("marathon");
    expect(s.weeks).toBe(24);
  });

  it("Get Faster 5K is 14 weeks of 5k_improver (no auto-tail)", () => {
    const s = STARTER_SHORTCUTS.find((x) => x.id === "get_faster_5k_14w")!;
    expect(s.templateId).toBe("5k_improver");
    expect(s.weeks).toBe(14);
  });

  it("expanding starter as a single TemplateEntry sums to s.weeks", () => {
    for (const s of STARTER_SHORTCUTS) {
      const blocks = expandEntriesToBlocks([
        { templateId: s.templateId, weeks: s.weeks },
      ]);
      const sum = blocks.reduce((acc, b) => acc + b.weeks, 0);
      expect(sum, s.id).toBe(s.weeks);
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
    // Aerobic base entry expands to a single Base block (8w), then HM
    // expands to its own Base/Speed/Taper segments.
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
