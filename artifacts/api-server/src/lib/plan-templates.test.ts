import { describe, it, expect } from "vitest";
import {
  PLAN_TEMPLATES,
  ARCHIVED_PLAN_TEMPLATES,
  STARTER_SHORTCUTS,
  generatePlanFromConfig,
  getTemplateById,
  isArchivedTemplateId,
  validatePlannerConfig,
  expandEntriesToBlocks,
  expandEntriesToBlocksWithGaps,
  previewWeeklyMileage,
  primaryMachineKind,
  projectEntries,
  RACE_EVE_SAT_SPEC,
  buildRaceEveSatRow,
  type PlannerConfig,
} from "@workspace/plan-generator";

describe("PLAN_TEMPLATES", () => {
  it("registers the curated skill-level catalog (Task #169 + Task #219 — 16 templates after the half-marathon hybrid was added)", () => {
    const ids = PLAN_TEMPLATES.map((t) => t.id).sort();
    expect(ids).toEqual(
      [
        // Beginner — 5K race focus, run-only → heavier hybrid.
        "custom_hybrid",
        "couch_to_5k",
        "higdon_5k_novice",
        "5k_strength_lite",
        "5k_hybrid_balanced",
        // Intermediate — 10K race focus + half-marathon hybrid, run-only → heavier hybrid.
        "10k_higdon_int",
        "10k_daniels",
        "10k_pfitz",
        "10k_strength_lite",
        "10k_hybrid_balanced",
        // Task #219: half-marathon hybrid sits at Intermediate alongside
        // the 10K hybrid (`10k_hybrid_balanced`); the recipe-driven
        // `half_marathon` and `hm_pfitz` stay at Advanced.
        "half_marathon_hybrid",
        // Advanced — half-marathon and marathon, run-only → heavier hybrid.
        "half_marathon",
        "hm_pfitz",
        "marathon",
        "marathon_pfitz_18_70",
        "marathon_hybrid",
      ].sort(),
    );
  });

  it("ships 16 templates split 5 / 6 / 5 across the three levels (Task #169 + Task #219)", () => {
    // Task #219 added `half_marathon_hybrid` at the Intermediate level
    // (sitting alongside `10k_hybrid_balanced`), bumping the Intermediate
    // bucket from 5 → 6 and the total from 15 → 16. Beginner and Advanced
    // are unchanged.
    expect(PLAN_TEMPLATES).toHaveLength(16);
    const counts = PLAN_TEMPLATES.reduce<Record<string, number>>(
      (acc, t) => ({ ...acc, [t.level]: (acc[t.level] ?? 0) + 1 }),
      {},
    );
    expect(counts).toEqual({
      Beginner: 5,
      Intermediate: 6,
      Advanced: 5,
    });
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
      // Beginner — 5K race focus, run-only → heavier hybrid.
      custom_hybrid: [4, 8, 24],
      couch_to_5k: [6, 9, 12],
      higdon_5k_novice: [6, 8, 10],
      "5k_strength_lite": [6, 8, 12],
      "5k_hybrid_balanced": [6, 8, 12],
      // Intermediate — 10K race focus, run-only → heavier hybrid.
      "10k_higdon_int": [8, 10, 12],
      "10k_daniels": [8, 10, 12],
      "10k_pfitz": [8, 10, 12],
      "10k_strength_lite": [8, 10, 12],
      "10k_hybrid_balanced": [8, 10, 12],
      // Task #219 — Intermediate half-marathon hybrid mirrors the
      // recipe-driven half_marathon week range so the runner gets the
      // same min/default/max picker behavior whether they choose run-
      // only or the hybrid variant.
      half_marathon_hybrid: [10, 12, 16],
      // Advanced — half-marathon and marathon, run-only → heavier hybrid.
      half_marathon: [10, 12, 16],
      hm_pfitz: [10, 12, 16],
      marathon: [16, 18, 24],
      marathon_pfitz_18_70: [18, 18, 24],
      marathon_hybrid: [16, 18, 24],
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

describe("PLAN_TEMPLATES tags", () => {
  it("every template has at least one tag", () => {
    for (const t of PLAN_TEMPLATES) {
      expect(Array.isArray(t.tags), `${t.id} tags must be an array`).toBe(true);
      expect(t.tags.length, `${t.id} must declare at least one tag`).toBeGreaterThan(0);
    }
  });

  it("every tag is a short, lowercase, non-empty string", () => {
    for (const t of PLAN_TEMPLATES) {
      for (const tag of t.tags) {
        expect(typeof tag, `${t.id} tag type`).toBe("string");
        expect(tag.length, `${t.id} tag "${tag}" non-empty`).toBeGreaterThan(0);
        expect(tag.trim(), `${t.id} tag "${tag}" trimmed`).toBe(tag);
        expect(tag, `${t.id} tag "${tag}" lowercase`).toBe(tag.toLowerCase());
        // "Short" — keep tags chip-sized so they fit on a card.
        expect(tag.length, `${t.id} tag "${tag}" short`).toBeLessThanOrEqual(32);
      }
    }
  });

  it("a tag substring match returns the expected template (search-helper contract)", () => {
    // Mirrors the SEARCHABLE_FIELDS join in
    // artifacts/command-center/src/lib/planner-templates.ts (tags joined
    // by spaces, substring-matched case-insensitively). Locks in the
    // contract that adding a recognizable tag makes the template
    // findable via the planner's free-text filter.
    const findByTag = (q: string) =>
      PLAN_TEMPLATES.filter((t) =>
        t.tags.join(" ").toLowerCase().includes(q.toLowerCase()),
      ).map((t) => t.id);

    // "pfitzinger" appears on every Pfitz-authored plan (10k_pfitz,
    // hm_pfitz, marathon, marathon_pfitz_18_70).
    expect(findByTag("pfitzinger")).toContain("marathon");
    expect(findByTag("pfitzinger")).toContain("hm_pfitz");
    // "first-timer" tag should surface the C25K starter plan.
    const firstTimer = findByTag("first-timer");
    expect(firstTimer).toContain("couch_to_5k");
    // Case-insensitive substring match works on multi-word tags too.
    expect(findByTag("LOW-MILEAGE")).toContain("couch_to_5k");
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
  it("registers the curated 5 starter shortcuts (Task #132 + Task #222 — hybrid HM starter added)", () => {
    expect(STARTER_SHORTCUTS.map((s) => s.id).sort()).toEqual(
      [
        "couch_to_hm_24w",
        "get_faster_5k_14w",
        "hm_beginner_16w",
        "hm_hybrid_18w",
        "marathon_first_timer_24w",
      ].sort(),
    );
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

  it("HM Beginner = 6w Higdon Novice 5K + 10w Half Marathon (16w total)", () => {
    const s = STARTER_SHORTCUTS.find((x) => x.id === "hm_beginner_16w")!;
    expect(s.entries.map((e) => [e.templateId, e.weeks])).toEqual([
      ["higdon_5k_novice", 6],
      ["half_marathon", 10],
    ]);
  });

  it("Marathon First-Timer = 6w Higdon Novice 5K + 18w Marathon (24w total)", () => {
    const s = STARTER_SHORTCUTS.find(
      (x) => x.id === "marathon_first_timer_24w",
    )!;
    expect(s.entries.map((e) => [e.templateId, e.weeks])).toEqual([
      ["higdon_5k_novice", 6],
      ["marathon", 18],
    ]);
  });

  it("Get Faster 5K = 6w Couch to 5K + 8w 5K-with-strength-accessory (14w total)", () => {
    const s = STARTER_SHORTCUTS.find((x) => x.id === "get_faster_5k_14w")!;
    expect(s.entries.map((e) => [e.templateId, e.weeks])).toEqual([
      ["couch_to_5k", 6],
      ["5k_strength_lite", 8],
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

  // Task #224 — end-to-end race-day verification for the HM starters.
  //
  // The catalog tests above only check "id is present" and "entries fit
  // each template's min/max"; they never actually expand a starter
  // through `expandEntriesToBlocks` + `generatePlanFromConfig` to verify
  // the runner gets a real RACE DAY Sunday. Without these regressions
  // a future refactor of `expandEntriesToBlocks` / `buildHybridWeekDays`
  // could silently break the one-click HM onboarding flow for either
  // the run-only (`hm_beginner_16w`) or hybrid (`hm_hybrid_18w`) starter
  // — the runner would still get a 16/18-week plan, but the trailing
  // Sunday would fall back to the recipe's natural Taper long run
  // (~4 mi) instead of the 13.1 mi half-marathon they trained for.
  describe("HM starters generate a true 13.1 mi RACE DAY Sunday (Task #224)", () => {
    // 2026-01-05 is a Monday. Pair each starter with the marathonDate
    // that yields exactly the starter's declared total span (Mon..Sun
    // weeks, race day = startDate + totalWeeks*7 - 1 days).
    const startDate = "2026-01-05";

    function buildConfig(
      starterId: "hm_beginner_16w" | "hm_hybrid_18w",
    ): { config: PlannerConfig; totalWeeks: number; raceDateISO: string } {
      const starter = STARTER_SHORTCUTS.find((s) => s.id === starterId)!;
      const totalWeeks = starter.entries.reduce((s, e) => s + e.weeks, 0);
      const startMs = Date.parse(`${startDate}T00:00:00Z`);
      const raceMs = startMs + (totalWeeks * 7 - 1) * 86_400_000;
      const raceDateISO = new Date(raceMs).toISOString().slice(0, 10);
      const entries = starter.entries.map((e) => ({
        templateId: e.templateId,
        weeks: e.weeks,
      }));
      // Mirror what the API does on the apply path: stash the projected
      // PhaseBlock[] in `blocks` so the saved config round-trips, then
      // hand the full config to the generator.
      const blocks = expandEntriesToBlocks(entries);
      const config: PlannerConfig = {
        startDate,
        marathonDate: raceDateISO,
        blocks,
        entries,
      };
      return { config, totalWeeks, raceDateISO };
    }

    it("hm_beginner_16w lays down a 16-week plan ending on a 13.1 mi race-day Sunday", () => {
      const { config, totalWeeks, raceDateISO } = buildConfig("hm_beginner_16w");
      expect(totalWeeks).toBe(16);

      const { daily, weekly } = generatePlanFromConfig(config);

      // Span lock — exactly 16 Mon..Sun weeks, 16 * 7 = 112 daily rows.
      expect(weekly).toHaveLength(16);
      expect(daily).toHaveLength(16 * 7);
      expect(weekly[weekly.length - 1]!.week).toBe(16);

      // Final Sunday is the canonical race-day row, sourced from
      // `RACE_DAY_SPECS.half` via `buildRaceDaySunRow` (Task #217).
      const finalSun = daily[daily.length - 1]!;
      expect(finalSun.day).toBe("Sun");
      expect(finalSun.date).toBe(raceDateISO);
      expect(finalSun.session_type).toBe("Race");
      expect(finalSun.distance_mi).toBe(13.1);
      expect(finalSun.description).toMatch(/RACE DAY .*Half \(13\.1 mi\)/);
    });

    it("hm_hybrid_18w lays down an 18-week plan ending on race-eve Sat + 13.1 mi race-day Sun", () => {
      const { config, totalWeeks, raceDateISO } = buildConfig("hm_hybrid_18w");
      expect(totalWeeks).toBe(18);

      const { daily, weekly } = generatePlanFromConfig(config);

      // Span lock — exactly 18 Mon..Sun weeks, 18 * 7 = 126 daily rows.
      expect(weekly).toHaveLength(18);
      expect(daily).toHaveLength(18 * 7);
      expect(weekly[weekly.length - 1]!.week).toBe(18);

      // Final Sunday is the half-marathon race-day row from
      // `RACE_DAY_SPECS.half` — `half_marathon_hybrid` declares
      // `raceKind: "half"` and the hybrid pipeline force-overrides the
      // trailing Sunday via `buildRaceDaySunRow` (Task #200 / #217).
      const finalSun = daily[daily.length - 1]!;
      expect(finalSun.day).toBe("Sun");
      expect(finalSun.date).toBe(raceDateISO);
      expect(finalSun.session_type).toBe("Race");
      expect(finalSun.distance_mi).toBe(13.1);
      expect(finalSun.description).toMatch(/RACE DAY .*Half \(13\.1 mi\)/);

      // Final Saturday is the shared race-eve protocol from
      // `buildRaceEveSatRow` — strength_min / cardio_min / total_load
      // / session_type all read from `RACE_EVE_SAT_SPEC` (Task #215).
      // Compare field-by-field against the helper's output for the
      // matching week so a future bump to either spec propagates here
      // automatically.
      const finalSat = daily[daily.length - 2]!;
      expect(finalSat.day).toBe("Sat");
      expect(finalSat.session_type).toBe(RACE_EVE_SAT_SPEC.sessionType);
      expect(finalSat.strength_min).toBe(RACE_EVE_SAT_SPEC.strengthMin);
      expect(finalSat.cardio_min).toBe(RACE_EVE_SAT_SPEC.cardioMin);
      expect(finalSat.total_load).toBe(RACE_EVE_SAT_SPEC.totalLoad);

      const expectedSat = buildRaceEveSatRow({
        weekNumber: 18,
        phase: finalSat.phase,
        date: finalSat.date,
      });
      // Lock in every race-eve field that comes from the shared spec
      // (Task #215: minutes, load, equipment, description, session_type)
      // so the hybrid pipeline's race-eve Saturday cannot drift away
      // from `buildRaceEveSatRow`'s output.
      expect(finalSat.strength_load).toBe(expectedSat.strength_load);
      expect(finalSat.equipment).toBe(expectedSat.equipment);
      expect(finalSat.equipment_list).toEqual(expectedSat.equipment_list);
      // The hybrid pipeline appends the block's customNotes as a
      // trailing suffix on the description; the leading prose still
      // comes verbatim from `RACE_EVE_SAT_SPEC.describe(...)`.
      expect(finalSat.description.startsWith(expectedSat.description)).toBe(
        true,
      );
      expect(finalSat.run_min).toBe(expectedSat.run_min);
      expect(finalSat.distance_mi).toBe(expectedSat.distance_mi);
      expect(finalSat.is_rest).toBe(expectedSat.is_rest);
    });
  });
});

describe("primaryMachineKind sentinel parser", () => {
  it("returns 'bike' for [primary-machine:bike] notes", () => {
    expect(primaryMachineKind("[primary-machine:bike] PZ Beginner")).toBe(
      "bike",
    );
  });
  it("returns 'row' for [primary-machine:row] notes", () => {
    expect(primaryMachineKind("[primary-machine:row] DPZ-Row Z2")).toBe("row");
  });
  it("returns null for other / missing sentinels", () => {
    expect(primaryMachineKind(null)).toBeNull();
    expect(primaryMachineKind("")).toBeNull();
    expect(primaryMachineKind("[lift-primary:upper] foo")).toBeNull();
    expect(primaryMachineKind("[primary-machine:tread] foo")).toBeNull();
  });
});

describe("primary-machine routing in generatePlanFromConfig", () => {
  // 2026-01-05 is a Monday. Use blocks-mode (legacy) so the auto-pinned
  // 16-week Marathon-Specific tail owns the race week — that lets us
  // assert that the leading bike/row block emits zero run miles
  // without bumping into the canonical race-day marathon override.
  function bikeRowBlockConfig(
    machine: "bike" | "row",
    blockWeeks: number,
  ): PlannerConfig {
    // Total weeks = blockWeeks + 16 (auto-pinned tail).
    const total = blockWeeks + 16;
    const startMs = Date.parse("2026-01-05T00:00:00Z");
    const endMs = startMs + (total * 7 - 1) * 86400000;
    const marathonDate = new Date(endMs).toISOString().slice(0, 10);
    const machineLabel = machine === "bike" ? "Peloton Bike" : "Peloton Row";
    return {
      startDate: "2026-01-05",
      marathonDate,
      blocks: [
        {
          focusType: "Custom",
          weeks: blockWeeks,
          customName: `${machineLabel} Block`,
          customNotes: `[primary-machine:${machine}] ${machineLabel} block`,
        },
      ],
    };
  }

  it("Bike-primary Custom block emits zero run miles and bike sessions on Wed/Fri/Sun", () => {
    const cfg = bikeRowBlockConfig("bike", 8);
    const { daily, weekly } = generatePlanFromConfig(cfg);
    const bikeWeekly = weekly.filter((w) => w.week <= 8);
    const bikeDaily = daily.filter((d) => d.week <= 8);

    // Every weekly summary in the bike block reports zero planned_miles.
    for (const wk of bikeWeekly) {
      expect(wk.planned_miles, `week ${wk.week}`).toBe(0);
    }
    // Total run miles across the entire bike block is zero.
    const totalRunMi = bikeDaily.reduce(
      (s, d) => s + (d.distance_mi || 0),
      0,
    );
    expect(totalRunMi).toBe(0);
    // Wed/Fri/Sun never carry run_min or distance and always lead with
    // a bike chip (not Tread / Outdoor) for the cardio session.
    for (const d of bikeDaily) {
      if (d.day === "Wed" || d.day === "Fri" || d.day === "Sun") {
        expect(d.run_min, `${d.day} w${d.week} run_min`).toBe(0);
        expect(d.distance_mi, `${d.day} w${d.week} distance`).toBeNull();
        expect(d.pace, `${d.day} w${d.week} pace`).toBeNull();
        expect(
          d.equipment_list.includes("Peloton Bike"),
          `${d.day} w${d.week} equipment_list ${JSON.stringify(d.equipment_list)}`,
        ).toBe(true);
        // Cardio bucket should hold the equivalent minutes the run
        // would have consumed.
        expect(d.cardio_min, `${d.day} w${d.week} cardio_min`).toBeGreaterThan(
          0,
        );
      }
    }
  });

  it("Row-primary Custom block emits zero run miles and row sessions on Wed/Fri/Sun", () => {
    const cfg = bikeRowBlockConfig("row", 8);
    const { daily, weekly } = generatePlanFromConfig(cfg);
    const rowWeekly = weekly.filter((w) => w.week <= 8);
    const rowDaily = daily.filter((d) => d.week <= 8);

    for (const wk of rowWeekly) {
      expect(wk.planned_miles, `week ${wk.week}`).toBe(0);
    }
    const totalRunMi = rowDaily.reduce(
      (s, d) => s + (d.distance_mi || 0),
      0,
    );
    expect(totalRunMi).toBe(0);
    for (const d of rowDaily) {
      if (d.day === "Wed" || d.day === "Fri" || d.day === "Sun") {
        expect(d.run_min).toBe(0);
        expect(d.distance_mi).toBeNull();
        expect(
          d.equipment_list.includes("Peloton Row"),
          `${d.day} w${d.week} equipment_list ${JSON.stringify(d.equipment_list)}`,
        ).toBe(true);
      }
    }
  });

  it("a run-based block in the same plan is unaffected (still emits Wed/Fri/Sun runs)", () => {
    // Plain Custom block with NO sentinel — should produce the canonical
    // run-biased week.
    const cfg: PlannerConfig = {
      startDate: "2026-01-05",
      marathonDate: new Date(
        Date.parse("2026-01-05T00:00:00Z") + (24 * 7 - 1) * 86400000,
      )
        .toISOString()
        .slice(0, 10),
      blocks: [
        {
          focusType: "Custom",
          weeks: 8,
          customName: "Plain Custom Block",
          customNotes: "no sentinel here",
        },
      ],
    };
    const { daily, weekly } = generatePlanFromConfig(cfg);
    const customWeekly = weekly.filter((w) => w.week <= 8);
    const customDaily = daily.filter((d) => d.week <= 8);
    expect(customWeekly.some((w) => w.planned_miles > 0)).toBe(true);
    const sundays = customDaily.filter((d) => d.day === "Sun");
    expect(sundays.some((d) => (d.distance_mi || 0) > 0)).toBe(true);
  });

  it("previewWeeklyMileage zeros every bucket for bike/row blocks", () => {
    // Sanity: a vanilla Custom block produces SOME miles.
    const vanilla = previewWeeklyMileage(
      [{ focusType: "Custom", weeks: 8, customName: null, customNotes: null }],
      { appendMarathonTail: false },
    );
    expect(vanilla.some((w) => w.totalMi > 0)).toBe(true);

    // Now flip the same block to bike-primary via the sentinel and
    // confirm every bucket flows zero.
    const machinePreview = previewWeeklyMileage(
      [
        {
          focusType: "Custom",
          weeks: 8,
          customName: "Bike Block",
          customNotes: "[primary-machine:bike] PZ Beginner",
        },
      ],
      { appendMarathonTail: false },
    );
    expect(machinePreview.length).toBe(8);
    for (const wk of machinePreview) {
      expect(wk.easyMi).toBe(0);
      expect(wk.qualityMi).toBe(0);
      expect(wk.longRunMi).toBe(0);
      expect(wk.totalMi).toBe(0);
    }

    // And the same for row.
    const rowPreview = previewWeeklyMileage(
      [
        {
          focusType: "Custom",
          weeks: 6,
          customName: "Row Block",
          customNotes: "[primary-machine:row] DPZ-Row Z2",
        },
      ],
      { appendMarathonTail: false },
    );
    for (const wk of rowPreview) {
      expect(wk.totalMi).toBe(0);
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
      { templateId: "higdon_5k_novice", weeks: 6 },
    ]);
    // higdon_5k_novice 6w → 5w Base + 1w Taper.
    const totalWeeks = blocks.reduce((s, b) => s + b.weeks, 0);
    expect(totalWeeks).toBe(6);
    expect(blocks[0]!.focusType).toBe("Base");
    expect(blocks[blocks.length - 1]!.focusType).toBe("Taper");
  });

  it("merges per-entry customNotes into every expanded block", () => {
    const blocks = expandEntriesToBlocks([
      { templateId: "higdon_5k_novice", weeks: 6, customNotes: "Heat block" },
    ]);
    expect(blocks.length).toBeGreaterThan(0);
    for (const b of blocks) {
      expect(b.customNotes).toBe("Heat block");
    }
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

describe("archived template registry (legacy-campaign migration safety)", () => {
  it("registers archived stub IDs that never appear in PLAN_TEMPLATES", () => {
    expect(ARCHIVED_PLAN_TEMPLATES.length).toBeGreaterThan(0);
    const liveIds = new Set(PLAN_TEMPLATES.map((t) => t.id));
    for (const a of ARCHIVED_PLAN_TEMPLATES) {
      expect(liveIds.has(a.id)).toBe(false);
      expect(isArchivedTemplateId(a.id)).toBe(true);
    }
  });

  it("getTemplateById resolves archived IDs so legacy entries don't appear unknown", () => {
    // aerobic_base, marathon_hansons, race_countdown were all in the
    // pre-curation catalog — they must still resolve.
    for (const id of ["aerobic_base", "marathon_hansons", "race_countdown"]) {
      const tpl = getTemplateById(id);
      expect(tpl).not.toBeNull();
      expect(tpl!.id).toBe(id);
    }
  });

  it("validatePlannerConfig accepts a config containing archived template IDs", () => {
    const cfg = {
      startDate: "2026-01-05", // Monday
      marathonDate: "2026-03-01", // Sunday at end of 8th Mon..Sun week
      blocks: [],
      entries: [
        {
          templateId: "marathon_hansons",
          weeks: 8,
          startDate: "2026-01-05",
        },
      ],
    } as unknown as PlannerConfig;
    const issues = validatePlannerConfig(cfg);
    const unknown = issues.find((i) => /unknown template id/.test(i.message));
    expect(unknown).toBeUndefined();
  });

  it("generatePlanFromConfig regenerates a plan whose only entry is archived", () => {
    const cfg = {
      startDate: "2026-01-05",
      marathonDate: "2026-03-01", // Sunday at end of 8th Mon..Sun week
      blocks: [],
      entries: [
        {
          templateId: "aerobic_base",
          weeks: 8,
          startDate: "2026-01-05",
        },
      ],
    } as unknown as PlannerConfig;
    const { weekly, daily } = generatePlanFromConfig(cfg);
    expect(weekly.length).toBe(8);
    expect(daily.length).toBe(8 * 7);
  });

  it("isArchivedTemplateId returns false for live catalog IDs and unknown IDs", () => {
    for (const t of PLAN_TEMPLATES) {
      expect(isArchivedTemplateId(t.id)).toBe(false);
    }
    expect(isArchivedTemplateId("does_not_exist_anywhere")).toBe(false);
  });
});

// Task #172 — the Marathon-Specific recipe upgrades the mid-week Wed
// run to a steady-state ("Z3 effort") session on non-cutback weeks so a
// runner viewing their auto-pinned trailing block actually sees the
// amber-400 Zone 3 swatch on a real prescribed day. Locked in here so a
// future recipe tweak that drops `wedKind: "Steady"` would surface as a
// failing test rather than silently regressing the Run Target chip back
// to bucket 2.
describe("Marathon-Specific recipe — Wed Steady Run (Task #172)", () => {
  // Build an entries-mode config that exercises the Pfitzinger
  // "marathon" template — the only catalog template that includes a
  // Marathon-Specific focus block in its expand() distribution. The
  // 18-week default (4 Base + 4 Time-on-Feet + 7 Marathon-Specific +
  // 3 Taper) puts the steady-Wed branch into the trailing tail.
  function pfitzMarathon(): PlannerConfig {
    // 18-week block. Mon 2026-05-04 → Sun 2026-09-06.
    return {
      startDate: "2026-05-04",
      marathonDate: "2026-09-06",
      blocks: [],
      entries: [
        {
          templateId: "marathon",
          weeks: 18,
          startDate: "2026-05-04",
        },
      ],
    } as unknown as PlannerConfig;
  }

  // The 16-week Marathon-Specific tail is auto-pinned by the
  // generator: user blocks must sum to (totalWeeks - 16). With a
  // 16-week window and blocks=[] the entire plan is the auto-pinned
  // tail — exactly what we need to exercise the new steady-Wed branch.
  function marathonTailOnly(): PlannerConfig {
    return {
      startDate: "2026-05-04",
      marathonDate: "2026-08-23", // Mon → 16 weeks later Sun
      blocks: [],
    };
  }

  it("non-cutback Wed days emit 'Steady Run + Accessory' (intensityBucket → 3)", () => {
    const cfg = marathonTailOnly();
    const { daily } = generatePlanFromConfig(cfg);
    const wedRows = daily.filter((d) => d.day === "Wed");
    expect(wedRows.length).toBeGreaterThan(0);

    // At least one Wed in the block prescribes a Steady Run so the
    // amber-400 Zone 3 swatch is reachable from a real plan day.
    const steadyDays = wedRows.filter(
      (d) => d.session_type === "Steady Run + Accessory",
    );
    expect(steadyDays.length).toBeGreaterThan(0);

    // Every Steady Wed still has the Tonal accessory block intact, has
    // a real prescribed run distance, and uses a non-easy pace target.
    for (const d of steadyDays) {
      expect(d.run_min, `${d.date} run_min`).toBeGreaterThan(0);
      expect(d.distance_mi, `${d.date} distance_mi`).toBeGreaterThan(0);
      expect(d.strength_min, `${d.date} strength_min`).toBeGreaterThan(0);
      expect(d.cardio_min, `${d.date} cardio_min`).toBe(0);
      expect(d.equipment).toBe("Tonal");
      expect(d.equipment_list).toEqual(["Tonal", "Peloton Tread"]);
      // Description carries the Z3 effort cue so runners see WHY their
      // chip turned amber.
      expect(d.description.toLowerCase()).toContain("steady");
      expect(d.description.toLowerCase()).toContain("z3");
    }
  });

  it("cutback Wed days inside Marathon-Specific stay easy ('Run + Accessory')", () => {
    // Auto-pinned 16w Marathon-Specific tail. Cutback weeks
    // (1-indexed in-block) for a 16w block: 4, 8, 12.
    const cfg = marathonTailOnly();
    const { daily } = generatePlanFromConfig(cfg);

    for (const w of [4, 8, 12]) {
      const wed = daily.find((d) => d.week === w && d.day === "Wed");
      expect(wed, `w${w} Wed row`).toBeDefined();
      expect(wed!.session_type, `w${w}`).toBe("Run + Accessory");
    }
  });

  it("race-week Wed (final week of the tail) stays easy as part of the taper", () => {
    // Race week (weekInBlock=16) is 4 days out from the Sun marathon.
    // A Z3 quality stimulus that close to race day would compromise
    // race readiness, so wedSteady is gated on !isRaceWeek.
    const cfg = marathonTailOnly();
    const { daily, weekly } = generatePlanFromConfig(cfg);
    const raceWeekNumber = weekly.length; // Final generated week.
    const wed = daily.find(
      (d) => d.week === raceWeekNumber && d.day === "Wed",
    );
    expect(wed, "race-week Wed row").toBeDefined();
    expect(wed!.session_type).toBe("Run + Accessory");
    // Sun of the same week is the actual marathon — sanity-check we
    // really did land on race week so this assertion isn't tautological.
    const sun = daily.find(
      (d) => d.week === raceWeekNumber && d.day === "Sun",
    );
    expect(sun!.session_type).toBe("Race");
  });

  // Sanity: composing a real marathon template entry that ends with
  // the Marathon-Specific tail surfaces the steady run too — proves
  // the upgrade flows through the entries-mode pipeline (not just a
  // raw `Marathon-Specific` block built in isolation).
  it("entries-mode marathon templates also surface a Steady Wed in the trailing tail", () => {
    const cfg = pfitzMarathon();
    const { daily } = generatePlanFromConfig(cfg);
    const steadyWeds = daily.filter(
      (d) => d.day === "Wed" && d.session_type === "Steady Run + Accessory",
    );
    expect(steadyWeds.length).toBeGreaterThan(0);
  });
});

// Task #185 — the `Marathon-Specific` recipe used to short-circuit the
// LAST week of the block to MARATHON_DISTANCE_MI (26.2 mi) on the
// theory that the MS block was always the trailing block (true in
// blocks-mode where the auto-pinned 16-week tail closes the campaign).
// In entries-mode the marathon templates expand to
// Base → Time on Feet → Marathon-Specific → Taper, so the MS block's
// final week is NOT race week — and the recipe was emitting a phantom
// 26.2 mi long run mid-plan, three weeks before race day. The fix
// drops that branch so the MS block's final week reads as a normal
// late-MS long run instead.
//
// Task #184 — entries-mode marathon plans whose LAST entry is a
// marathon template MUST still end on a real RACE DAY Sunday
// (26.2 mi). The contract therefore split into "no 26.2 mid-plan"
// (Task #185) AND "26.2 on the campaign-final Sunday iff the trailing
// entry is marathon-classified" (Task #184). The assertions below
// pin both pieces in lock-step: weeks 1..raceWeek-1 must be < 26.2
// (no phantom mid-plan spike), and the campaign-final week (raceWeek)
// MUST be 26.2 because the trailing entry is a marathon template.
describe("Marathon-Specific recipe — no phantom 26.2 mi long run mid-plan (Task #185)", () => {
  function entriesMarathon(templateId: string, weeks: number): PlannerConfig {
    // Mon 2026-05-04 → Sun (weeks*7 - 1) days later.
    const startMs = Date.parse("2026-05-04T00:00:00Z");
    const endMs = startMs + (weeks * 7 - 1) * 86400000;
    const marathonDate = new Date(endMs).toISOString().slice(0, 10);
    return {
      startDate: "2026-05-04",
      marathonDate,
      blocks: [],
      entries: [
        {
          templateId,
          weeks,
          startDate: "2026-05-04",
        },
      ],
    } as unknown as PlannerConfig;
  }

  it("18w entries-mode 'marathon' plan only emits 26.2 mi on the campaign-final Sunday (Task #184)", () => {
    const cfg = entriesMarathon("marathon", 18);
    const { daily, weekly } = generatePlanFromConfig(cfg);
    const raceWeek = weekly.length; // Final generated week.
    expect(raceWeek).toBe(18);

    // Pin per-week long-run mileage so a future regression here is
    // visible at a glance.
    const longRunByWeek = new Map<number, number>();
    for (const d of daily) {
      if (d.day === "Sun") {
        longRunByWeek.set(d.week, d.distance_mi || 0);
      }
    }

    // Task #185: NO mid-plan 26.2 mi spike. The pre-fix bug surfaced
    // as 26.2 on week 15 (last week of the 7-week MS block in an
    // 18-week 4+4+7+3 plan), three weeks before race day — that
    // short-circuit was removed.
    // Task #184: the campaign-final Sunday MUST be 26.2 mi because
    // the trailing entry is a marathon template — runners need a
    // real RACE DAY Sunday, not the Taper recipe's natural ~4 mi
    // long. The race-day branch in `buildWeekDays` re-fires for
    // entries-mode plans whose last entry classifies as marathon.
    for (let w = 1; w < raceWeek; w += 1) {
      const mi = longRunByWeek.get(w);
      expect(mi, `week ${w} long run mi`).toBeDefined();
      expect(mi, `week ${w} long run mi`).toBeLessThan(26.2);
    }
    expect(longRunByWeek.get(raceWeek), `race week ${raceWeek} long run mi`)
      .toBe(26.2);

    // Pin the full late-MS long-run sequence (weeks 12-15, the last
    // four Marathon-Specific weeks) to the smoothed monotonic ramp the
    // entries-mode recipe is supposed to produce after Task #190.
    // Task #185 added tail-taper short-circuits (16/13/8/13) for the
    // last 4 weeks; Task #190 gates those on `isTrailingBlock` so they
    // only fire in blocks-mode (where the auto-pinned 16-week MS tail
    // owns the race-eve taper). In entries-mode the dedicated Taper
    // block that follows the MS block now owns ALL tapering, so the
    // MS block ramps cleanly to peak.
    //
    // Block layout for 18w "marathon": 4 Base + 5 ToF + 6 MS + 3 Taper.
    // MS weeks are plan weeks 10-15 with blockWeeks=6.
    // Recipe ramp: base = min(20, 12 + (w-1) * (8/2)); cutback every 4w.
    //   plan w12 = MS w3:           20 mi (peak)
    //   plan w13 = MS w4 (cutback): max(8, 20*0.75) = 15 mi
    //   plan w14 = MS w5:           20 mi (peak)
    //   plan w15 = MS w6:           20 mi (peak — Taper block follows)
    // Pre-Task #190 these read 16 → 13 → 8 → 13 mi (the blocks-mode
    // tail-taper short-circuits firing in entries-mode).
    expect(longRunByWeek.get(12), "week 12 long run mi").toBe(20);
    expect(longRunByWeek.get(13), "week 13 long run mi").toBe(15);
    expect(longRunByWeek.get(14), "week 14 long run mi").toBe(20);
    expect(longRunByWeek.get(15), "week 15 long run mi").toBe(20);
    // Belt-and-suspenders: week 15 (the block-final week) must be at
    // or near peak (the Taper block owns ramp-down), NOT a tapered
    // value in the 8-13 mi range that the pre-Task #190 short-circuits
    // would have produced.
    expect(longRunByWeek.get(15)!).toBeGreaterThanOrEqual(18);
  });

  it("18w entries-mode 'marathon_pfitz_18_70' plan only emits 26.2 mi on the campaign-final Sunday (Task #184)", () => {
    const cfg = entriesMarathon("marathon_pfitz_18_70", 18);
    const { daily, weekly } = generatePlanFromConfig(cfg);
    const raceWeek = weekly.length;
    expect(raceWeek).toBe(18);

    const longRunByWeek = new Map<number, number>();
    for (const d of daily) {
      if (d.day === "Sun") {
        longRunByWeek.set(d.week, d.distance_mi || 0);
      }
    }

    // Task #185 + Task #184: no mid-plan 26.2, but the trailing
    // Sunday MUST be 26.2 because the entries-mode last entry is a
    // marathon template.
    for (let w = 1; w < raceWeek; w += 1) {
      const mi = longRunByWeek.get(w);
      expect(mi, `week ${w} long run mi`).toBeDefined();
      expect(mi, `week ${w} long run mi`).toBeLessThan(26.2);
    }
    expect(longRunByWeek.get(raceWeek), `race week ${raceWeek} long run mi`)
      .toBe(26.2);
  });

  it("blocks-mode marathon plans still emit a 26.2 mi marathon on the final Sunday", () => {
    // Auto-pinned 16-week Marathon-Specific tail. With blocks=[] and a
    // 16-week window the entire plan IS the trailing tail, so the
    // final Sun must be race day.
    const cfg: PlannerConfig = {
      startDate: "2026-05-04",
      marathonDate: "2026-08-23", // 16 weeks later.
      blocks: [],
    };
    const { daily, weekly } = generatePlanFromConfig(cfg);
    const raceWeek = weekly.length;
    expect(raceWeek).toBe(16);

    const longRunByWeek = new Map<number, number>();
    for (const d of daily) {
      if (d.day === "Sun") {
        longRunByWeek.set(d.week, d.distance_mi || 0);
      }
    }

    // Race day still reads 26.2 mi (race-day branch in
    // `buildWeekDays` overrides the recipe value).
    expect(longRunByWeek.get(raceWeek)).toBe(26.2);
    // And no week before race day is 26.2 mi either.
    for (let w = 1; w < raceWeek; w += 1) {
      const mi = longRunByWeek.get(w);
      expect(mi, `week ${w} long run mi`).toBeLessThan(26.2);
    }
  });

  it("previewWeeklyMileage agrees with the generator: no 26.2 mi pre-race-week in entries-mode", () => {
    // The Phase Planner sparkline calls `previewWeeklyMileage` directly
    // (not the full generator). Mirror the same plan shape and assert
    // the preview also no longer leaks a phantom 26.2 mi mid-plan.
    const blocks = expandEntriesToBlocks([
      { templateId: "marathon", weeks: 18 },
    ]);
    const preview = previewWeeklyMileage(blocks, {
      appendMarathonTail: false,
    });
    expect(preview.length).toBe(18);
    for (let i = 0; i < preview.length - 1; i += 1) {
      expect(
        preview[i]!.longRunMi,
        `preview week ${preview[i]!.week} long run mi`,
      ).toBeLessThan(26.2);
    }
  });
});

// Task #190 — the Marathon-Specific recipe used to short-circuit the
// last 4 weeks of any MS block to a 16/13/8/13 ramp-down on the
// theory that the MS block always owns the race-eve taper. That's
// only true in blocks-mode (the auto-pinned 16-week MS tail closes
// the campaign). In entries-mode the marathon templates expand to
// Base → Time on Feet → Marathon-Specific → Taper, so the MS block
// is followed by a dedicated Taper that owns ALL tapering. Running
// the blocks-mode short-circuits there produces a confusing
// non-monotonic curve right before the Taper kicks in (e.g. plan
// weeks 12-15 of an 18w `marathon` plan read 15 → 20 → 20 → 20 with
// the fix; pre-fix they read 16 → 13 → 8 → 13 mi).
//
// The fix gates the tail short-circuits on whether the MS block is
// the trailing block of the campaign — blocks-mode keeps the
// taper-eve ramp-down; entries-mode runs a clean monotonic ramp to
// peak and lets the Taper block own the ramp-down.
describe("Marathon-Specific recipe — entries-mode smoothed late-MS ramp (Task #190)", () => {
  function entriesMarathon(templateId: string, weeks: number): PlannerConfig {
    const startMs = Date.parse("2026-05-04T00:00:00Z");
    const endMs = startMs + (weeks * 7 - 1) * 86400000;
    const marathonDate = new Date(endMs).toISOString().slice(0, 10);
    return {
      startDate: "2026-05-04",
      marathonDate,
      blocks: [],
      entries: [
        {
          templateId,
          weeks,
          startDate: "2026-05-04",
        },
      ],
    } as unknown as PlannerConfig;
  }

  it("18w entries-mode 'marathon' — late-MS Sundays are a clean monotonic ramp to peak (no taper-eve trough)", () => {
    // distribute(18, [Base w3 min4, ToF w4 min4, MS w4 min5, Taper w2 min3])
    // → 4 Base + 5 ToF + 6 Marathon-Specific + 3 Taper.
    // MS weeks are plan weeks 10-15 (blockWeeks=6). Pin the WHOLE MS
    // Sunday sequence so a future regression that re-enables the
    // blocks-mode tail short-circuits anywhere in entries-mode is
    // caught loudly.
    const cfg = entriesMarathon("marathon", 18);
    const { daily } = generatePlanFromConfig(cfg);
    const longRunByWeek = new Map<number, number>();
    for (const d of daily) {
      if (d.day === "Sun") {
        longRunByWeek.set(d.week, d.distance_mi || 0);
      }
    }

    // Recipe ramp: base = min(20, 12 + (w-1) * (8/2)); cutback every
    // 4w. blockWeeks=6 so MS w4 is a cutback (15 mi after 0.75
    // multiplier on the 20 mi peak).
    //   MS w1 (plan w10): 12 mi
    //   MS w2 (plan w11): 16 mi
    //   MS w3 (plan w12): 20 mi (peak)
    //   MS w4 (plan w13): cutback → 15 mi
    //   MS w5 (plan w14): 20 mi
    //   MS w6 (plan w15): 20 mi (block-final, Taper follows)
    expect(longRunByWeek.get(10), "MS w1 (plan w10)").toBe(12);
    expect(longRunByWeek.get(11), "MS w2 (plan w11)").toBe(16);
    expect(longRunByWeek.get(12), "MS w3 (plan w12)").toBe(20);
    expect(longRunByWeek.get(13), "MS w4 cutback (plan w13)").toBe(15);
    expect(longRunByWeek.get(14), "MS w5 (plan w14)").toBe(20);
    expect(longRunByWeek.get(15), "MS w6 block-final (plan w15)").toBe(20);

    // Across non-cutback MS weeks the long run must monotonically
    // ramp (or hold at peak); no late-MS week may dip below the
    // previous non-cutback week.
    const nonCutbackMs = [10, 11, 12, 14, 15];
    for (let i = 1; i < nonCutbackMs.length; i += 1) {
      const cur = longRunByWeek.get(nonCutbackMs[i]!)!;
      const prev = longRunByWeek.get(nonCutbackMs[i - 1]!)!;
      expect(
        cur,
        `non-cutback MS week ${nonCutbackMs[i]} (${cur} mi) must be >= week ${nonCutbackMs[i - 1]} (${prev} mi)`,
      ).toBeGreaterThanOrEqual(prev);
    }
  });

  it("18w entries-mode 'marathon_pfitz_18_70' — late-MS Sundays are a clean monotonic ramp to peak", () => {
    // Same expand shape as 'marathon': 4 Base + 5 ToF + 6 MS + 3 Taper.
    // MS weeks are plan weeks 10-15.
    const cfg = entriesMarathon("marathon_pfitz_18_70", 18);
    const { daily } = generatePlanFromConfig(cfg);
    const longRunByWeek = new Map<number, number>();
    for (const d of daily) {
      if (d.day === "Sun") {
        longRunByWeek.set(d.week, d.distance_mi || 0);
      }
    }

    // The block-final MS Sunday MUST be at peak (20 mi), NOT the
    // pre-fix 13 mi tapered value. This is the canary for the bug.
    expect(longRunByWeek.get(15), "MS block-final (plan w15)").toBe(20);
    // And the three weeks immediately before the Taper must NOT dip
    // into the 8 mi taper-eve trough that the pre-fix short-circuits
    // would have produced.
    expect(longRunByWeek.get(13)!).toBeGreaterThanOrEqual(15);
    expect(longRunByWeek.get(14)!).toBeGreaterThanOrEqual(15);
    expect(longRunByWeek.get(15)!).toBeGreaterThanOrEqual(15);
  });

  it("blocks-mode marathon plans still get the auto-pinned 16-week tail's race-eve taper (16/13/8 in last 3 weeks)", () => {
    // Auto-pinned 16-week Marathon-Specific tail. With blocks=[] and
    // a 16-week window the entire plan IS the trailing tail, so the
    // recipe's tail short-circuits MUST still fire on weeks 13-15 of
    // the tail (tail===3/2/1) — proving Task #190 didn't accidentally
    // disable the blocks-mode behavior.
    const cfg: PlannerConfig = {
      startDate: "2026-05-04",
      marathonDate: "2026-08-23", // 16 weeks later.
      blocks: [],
    };
    const { daily, weekly } = generatePlanFromConfig(cfg);
    const raceWeek = weekly.length;
    expect(raceWeek).toBe(16);

    const longRunByWeek = new Map<number, number>();
    for (const d of daily) {
      if (d.day === "Sun") {
        longRunByWeek.set(d.week, d.distance_mi || 0);
      }
    }

    // tail===3 (plan w13): 16 mi
    // tail===2 (plan w14): 13 mi
    // tail===1 (plan w15): 8 mi
    // tail===0 (plan w16): 26.2 mi (race-day branch override)
    expect(longRunByWeek.get(13), "tail-3 week").toBe(16);
    expect(longRunByWeek.get(14), "tail-2 week").toBe(13);
    expect(longRunByWeek.get(15), "tail-1 week").toBe(8);
    expect(longRunByWeek.get(16), "race day").toBe(26.2);
  });

  it("previewWeeklyMileage matches the generator: entries-mode MS block ramps to peak in the preview too", () => {
    // The Phase Planner sparkline reads `previewWeeklyMileage` for
    // its mileage curve — mirror the same shape and verify the
    // preview also no longer drops into the 8 mi taper-eve trough on
    // late-MS weeks of an entries-mode plan.
    const blocks = expandEntriesToBlocks([
      { templateId: "marathon", weeks: 18 },
    ]);
    const preview = previewWeeklyMileage(blocks, {
      appendMarathonTail: false,
    });
    expect(preview.length).toBe(18);
    // MS plan weeks 10-15 — same pinning as the generator test above.
    expect(preview[9]!.longRunMi, "preview MS w1 (plan w10)").toBe(12);
    expect(preview[10]!.longRunMi, "preview MS w2 (plan w11)").toBe(16);
    expect(preview[11]!.longRunMi, "preview MS w3 (plan w12)").toBe(20);
    expect(preview[12]!.longRunMi, "preview MS w4 cutback (plan w13)").toBe(15);
    expect(preview[13]!.longRunMi, "preview MS w5 (plan w14)").toBe(20);
    expect(preview[14]!.longRunMi, "preview MS w6 block-final (plan w15)").toBe(20);
  });
});

// Task #195 — entries-mode marathon plans must mark race day on the
// final Sunday with the canonical "RACE DAY — Marathon (26.2 mi)"
// label, race-prep Saturday, and "Race" session_type — exactly what
// the blocks-mode auto-pinned 16-week tail produces. Task #184 wired
// the `endsOnMarathonRaceDay` gate to fire for entries-mode plans
// whose trailing entry classifies as a marathon template; the
// existing Task #184/#185/#190 tests pin `distance_mi == 26.2` on the
// race-week Sunday. This describe block locks in the FULL race-day
// contract — description text, session_type, and the race-eve Sat
// shape — so a regression that silently drops the canonical label
// (e.g. by skipping the `isRaceWeek` branch for entries-mode) is
// caught loudly. It also guards that non-marathon entries-mode
// templates (half-marathon, 5K, hybrid) keep their template's natural
// taper Sunday and never get the marathon race-day override.
describe("Race-day marking on entries-mode marathon plans (Task #195)", () => {
  function entriesPlan(templateId: string, weeks: number): PlannerConfig {
    const startMs = Date.parse("2026-05-04T00:00:00Z");
    const endMs = startMs + (weeks * 7 - 1) * 86400000;
    const marathonDate = new Date(endMs).toISOString().slice(0, 10);
    return {
      startDate: "2026-05-04",
      marathonDate,
      blocks: [],
      entries: [
        {
          templateId,
          weeks,
          startDate: "2026-05-04",
        },
      ],
    } as unknown as PlannerConfig;
  }

  function finalSunAndSat(cfg: PlannerConfig): {
    sun: ReturnType<typeof generatePlanFromConfig>["daily"][number];
    sat: ReturnType<typeof generatePlanFromConfig>["daily"][number];
  } {
    const { daily, weekly } = generatePlanFromConfig(cfg);
    const raceWeek = weekly.length;
    const finalSun = daily.find((d) => d.week === raceWeek && d.day === "Sun");
    const finalSat = daily.find((d) => d.week === raceWeek && d.day === "Sat");
    if (!finalSun) throw new Error("missing final Sun");
    if (!finalSat) throw new Error("missing final Sat");
    return { sun: finalSun, sat: finalSat };
  }

  for (const templateId of ["marathon", "marathon_pfitz_18_70"] as const) {
    it(`18w entries-mode '${templateId}' — final Sunday reads "RACE DAY — Marathon (26.2 mi)"`, () => {
      const { sun, sat } = finalSunAndSat(entriesPlan(templateId, 18));

      // Distance pinned at the canonical marathon distance — NOT the
      // Taper recipe's natural ~4 mi taper Sunday that would
      // otherwise close the plan.
      expect(sun.distance_mi).toBe(26.2);
      // Canonical race-day prose surfaced verbatim by the runner-
      // facing dashboard / today / plan views. Drives the "RACE DAY"
      // banner copy, so a regression that dropped this string would
      // silently strip the headline label even if mileage stayed
      // correct.
      expect(sun.description).toBe(
        "RACE DAY — Marathon (26.2 mi). Execute race plan, fuel every 4 mi, finish strong.",
      );
      expect(sun.session_type).toBe("Race");
      expect(sun.equipment).toBe("Outdoor");
      expect(sun.equipment_list).toEqual(["Outdoor"]);
      expect(sun.is_rest).toBe(false);

      // The Sat companion must flip to the race-eve mobility flush
      // pattern (light Tonal + short spin), not the heavy lift the
      // recipe would otherwise emit on the Taper block's final Sat.
      expect(sat.session_type).toBe("Race Prep");
      expect(sat.strength_load).toBe(0);
      expect(sat.description).toContain("Race-eve");
    });
  }

  it("12w entries-mode 'half_marathon' — final Sunday is a 13.1 mi RACE DAY (Task #191)", () => {
    // Half-marathon templates classify as raceKind === "half". Task
    // #191 extended the trailing-Sunday race-day override from
    // marathon-only to per-kind, so a half-marathon entry now ends
    // on a 13.1 mi RACE DAY Sunday (NOT the recipe's natural ~10
    // mi taper long run, and NOT a 26.2 mi marathon).
    const { sun } = finalSunAndSat(entriesPlan("half_marathon", 12));
    expect(sun.distance_mi).toBe(13.1);
    expect(sun.description).toContain("RACE DAY — Half (13.1 mi)");
    expect(sun.session_type).toBe("Race");
    // Marathon distance / prose must NOT leak into a half race day.
    expect(sun.distance_mi).not.toBe(26.2);
    expect(sun.description).not.toContain("RACE DAY — Marathon");
  });

  it("8w entries-mode 'higdon_5k_novice' — final Sunday is a 3.1 mi RACE DAY (Task #191)", () => {
    // 5K templates classify as raceKind === "5k" — same per-kind
    // override fires, ending the plan on a 3.1 mi RACE DAY Sunday.
    const { sun } = finalSunAndSat(entriesPlan("higdon_5k_novice", 8));
    expect(sun.distance_mi).toBe(3.1);
    expect(sun.description).toContain("RACE DAY — 5K (3.1 mi)");
    expect(sun.session_type).toBe("Race");
    expect(sun.distance_mi).not.toBe(26.2);
    expect(sun.description).not.toContain("RACE DAY — Marathon");
  });

  it("18w entries-mode 'marathon_hybrid' — final Sunday reads \"RACE DAY — Marathon (26.2 mi)\" (Task #192 / #198)", () => {
    // Task #192 flipped marathon_hybrid's raceKind from "none" to
    // "marathon" and taught `buildHybridWeekDays` to honor isRaceWeek
    // by force-overriding the trailing Sat (Race Prep) and Sun
    // (26.2 mi marathon). Task #198 extended the override to Mon-Fri
    // with a fixed light taper pattern (Mon rest, light Tue mobility
    // + bike, 3 mi Wed easy, Thu rest, 2 mi Fri tune-up). Task #200
    // then generalized the Sun race-day to per-kind so 5K / 10K
    // hybrid plans end on the matching distance — see the dedicated
    // hybrid race-kind cases in plan-generator-preview.test.ts.
    //
    // The campaign-final Sunday therefore mirrors what every other
    // marathon-classified template (Pfitz, Higdon, etc.) emits —
    // same RACE DAY copy, 26.2 mi distance, and "Race" session_type
    // — regardless of what the hybrid schedule's natural Sun slot
    // would have been.
    const { sun, sat } = finalSunAndSat(entriesPlan("marathon_hybrid", 18));
    expect(sun.distance_mi).toBe(26.2);
    expect(sun.description).toBe(
      "RACE DAY — Marathon (26.2 mi). Execute race plan, fuel every 4 mi, finish strong.",
    );
    expect(sun.session_type).toBe("Race");
    expect(sun.equipment).toBe("Outdoor");
    expect(sun.equipment_list).toEqual(["Outdoor"]);
    expect(sun.is_rest).toBe(false);
    // Race-eve Sat must be the canonical mobility flush + spin
    // pattern, not the hybrid schedule's natural Sat slot (which
    // would be a heavy lift for the balanced position).
    expect(sat.session_type).toBe("Race Prep");
    expect(sat.strength_load).toBe(0);
    expect(sat.description).toContain("Race-eve");
  });
});
