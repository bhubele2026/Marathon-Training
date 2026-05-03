import { describe, it, expect } from "vitest";
import {
  PLAN_TEMPLATES,
  STARTER_SHORTCUTS,
  getTemplateById,
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
        "hansons_marathon",
        "hybrid_strength",
        "maintenance",
        "marathon",
        "recovery",
        "speed_block",
      ].sort(),
    );
  });

  it("every template has a citation, source, and description", () => {
    for (const t of PLAN_TEMPLATES) {
      expect(t.source.length, `${t.id} source`).toBeGreaterThan(0);
      expect(t.citation.length, `${t.id} citation`).toBeGreaterThan(5);
      expect(t.shortDescription.length, `${t.id} short`).toBeGreaterThan(10);
      expect(t.longDescription.length, `${t.id} long`).toBeGreaterThan(20);
    }
  });

  it("min <= default <= max for every template", () => {
    for (const t of PLAN_TEMPLATES) {
      expect(t.minUserWeeks, t.id).toBeGreaterThan(0);
      expect(t.defaultUserWeeks, t.id).toBeGreaterThanOrEqual(t.minUserWeeks);
      expect(t.maxUserWeeks, t.id).toBeGreaterThanOrEqual(t.defaultUserWeeks);
    }
  });

  it("expand(n) produces blocks summing to exactly n at min/default/max", () => {
    for (const t of PLAN_TEMPLATES) {
      for (const n of [t.minUserWeeks, t.defaultUserWeeks, t.maxUserWeeks]) {
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
      for (let n = t.minUserWeeks; n <= t.maxUserWeeks; n++) {
        const sum = t.expand(n).reduce((s, b) => s + b.weeks, 0);
        expect(sum, `${t.id} @ ${n}w`).toBe(n);
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

  it("each starter references a real template and has total > 16 weeks", () => {
    for (const s of STARTER_SHORTCUTS) {
      expect(getTemplateById(s.templateId), s.id).not.toBeNull();
      expect(s.totalWeeks, s.id).toBeGreaterThan(16);
    }
  });

  it("each starter's user-block portion expands to (totalWeeks - 16)", () => {
    for (const s of STARTER_SHORTCUTS) {
      const tpl = getTemplateById(s.templateId)!;
      const userWeeks = s.totalWeeks - 16;
      const sum = tpl.expand(userWeeks).reduce((sx, b) => sx + b.weeks, 0);
      expect(sum, s.id).toBe(userWeeks);
    }
  });
});
