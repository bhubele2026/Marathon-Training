import { describe, it, expect } from "vitest";
import {
  TONAL_PROGRAMS,
  listPrograms,
  getProgramById,
  findProgramByName,
  recommendForRecomp,
  programCatalogForPrompt,
} from "@workspace/plan-knowledge";

describe("Tonal program library (Phase 2)", () => {
  it("has real, sourced, structurally-complete entries", () => {
    expect(TONAL_PROGRAMS.length).toBeGreaterThanOrEqual(10);
    for (const p of TONAL_PROGRAMS) {
      expect(p.id).toBeTruthy();
      expect(p.name).toBeTruthy();
      expect(p.daysPerWeek).toBeGreaterThan(0);
      expect(p.weeklySkeleton.length).toBeGreaterThan(0);
      expect(["exact", "approx"]).toContain(p.confidence);
      // Honesty: every entry is sourced.
      expect(p.sources && p.sources.length).toBeTruthy();
      // The skeleton uses real movement patterns.
      for (const d of p.weeklySkeleton) expect(d.patterns.length).toBeGreaterThan(0);
    }
  });

  it("ids are unique", () => {
    const ids = TONAL_PROGRAMS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("resolves a program by loose name", () => {
    expect(findProgramByName("House of Volume")?.id).toBe("house-of-volume");
    expect(findProgramByName("making muscle")?.id).toMatch(/^making-muscle/);
    expect(findProgramByName("nonexistent program xyz")).toBeUndefined();
  });

  it("getProgramById + emphasis filter work", () => {
    expect(getProgramById("off-season-strength")?.emphasis).toBe("strength");
    expect(listPrograms("recomp").every((p) => p.emphasis === "recomp")).toBe(true);
    expect(listPrograms("recomp").length).toBeGreaterThan(0);
  });

  it("recommendForRecomp ranks recomp/hypertrophy first", () => {
    const ranked = recommendForRecomp();
    expect(ranked[0].emphasis).toBe("recomp");
  });

  it("catalog prompt text names programs + their progression", () => {
    const txt = programCatalogForPrompt();
    expect(txt).toContain("House of Volume");
    expect(txt).toContain("progression:");
    expect(txt).toContain("week:");
  });
});
