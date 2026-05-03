import { describe, it, expect } from "vitest";
import {
  PLAN_TEMPLATES,
  STARTER_SHORTCUTS,
  generatePlanFromConfig,
  getTemplateById,
  expandEntriesToBlocks,
  expandEntriesToBlocksWithGaps,
  previewWeeklyMileage,
  primaryMachineKind,
  projectEntries,
  type PlannerConfig,
} from "@workspace/plan-generator";

describe("PLAN_TEMPLATES", () => {
  it("registers the full launch catalog (originals + Task #97 picks)", () => {
    const ids = PLAN_TEMPLATES.map((t) => t.id).sort();
    expect(ids).toEqual(
      [
        // Originals
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
        // Task #97 picks — running
        "couch_to_5k_alt",
        "higdon_5k_novice",
        "higdon_5k_intermediate",
        "higdon_5k_advanced",
        "higdon_10k_advanced",
        "hm_higdon_novice2",
        "hm_pfitz",
        "hm_hansons",
        "marathon_pfitz_12_55",
        "marathon_pfitz_18_70",
        "marathon_hansons",
        "marathon_8020",
        "marathon_higdon_novice",
        "marathon_higdon_advanced",
        "ultra_50_mile",
        "ultra_100k",
        "norwegian_singles",
        // Bike
        "pelo_bike_you_can_ride",
        "pelo_bike_pz_beginner",
        "pelo_bike_pz_intermediate",
        "pelo_bike_pz_advanced",
        "pelo_bike_strength_for_cyclists",
        // Row
        "pelo_row_dpz",
        "c2_row_30day",
        "c2_row_5k",
        "c2_row_2k",
        // Strength
        "tonal_full_body_5x",
        "starting_strength",
        "stronglifts_5x5",
        "wendler_531_bbb",
        "phul",
        "ppl_6day",
        "simple_and_sinister",
        // Hybrid + cross-modal
        "nick_bare_1_0",
        "pelo_x_hyrox",
        // Conditioning
        "maf_180",
        "bike_bootcamp_builder",
        "ywa_30day",
        // Customizable scaffolds
        "run_custom",
        "bike_custom",
        "row_custom",
        "strength_custom",
        "hybrid_custom",
        "race_countdown",
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
      // Task #97 picks
      couch_to_5k_alt: [8, 8, 12],
      higdon_5k_novice: [6, 8, 10],
      higdon_5k_intermediate: [6, 8, 10],
      higdon_5k_advanced: [6, 8, 10],
      higdon_10k_advanced: [8, 10, 14],
      hm_higdon_novice2: [12, 12, 16],
      hm_pfitz: [12, 12, 16],
      hm_hansons: [14, 14, 16],
      marathon_pfitz_12_55: [12, 12, 14],
      marathon_pfitz_18_70: [18, 18, 24],
      marathon_hansons: [16, 18, 20],
      marathon_8020: [16, 18, 24],
      marathon_higdon_novice: [16, 18, 22],
      marathon_higdon_advanced: [18, 18, 24],
      ultra_50_mile: [20, 24, 30],
      ultra_100k: [20, 24, 32],
      norwegian_singles: [12, 16, 24],
      pelo_bike_you_can_ride: [4, 4, 6],
      pelo_bike_pz_beginner: [6, 8, 12],
      pelo_bike_pz_intermediate: [6, 8, 12],
      pelo_bike_pz_advanced: [8, 10, 12],
      pelo_bike_strength_for_cyclists: [4, 6, 8],
      pelo_row_dpz: [6, 8, 12],
      c2_row_30day: [4, 4, 6],
      c2_row_5k: [6, 8, 10],
      c2_row_2k: [6, 8, 12],
      tonal_full_body_5x: [4, 8, 16],
      starting_strength: [8, 12, 24],
      stronglifts_5x5: [8, 12, 24],
      wendler_531_bbb: [12, 12, 16],
      phul: [8, 12, 16],
      ppl_6day: [6, 8, 12],
      simple_and_sinister: [8, 12, 24],
      nick_bare_1_0: [8, 12, 16],
      pelo_x_hyrox: [8, 12, 16],
      maf_180: [8, 12, 16],
      bike_bootcamp_builder: [4, 6, 8],
      ywa_30day: [4, 4, 6],
      run_custom: [1, 8, 52],
      bike_custom: [1, 8, 52],
      row_custom: [1, 8, 52],
      strength_custom: [1, 8, 52],
      hybrid_custom: [1, 8, 52],
      race_countdown: [4, 8, 52],
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
  it("registers the originals + Task #97 picked starter shortcuts", () => {
    expect(STARTER_SHORTCUTS.map((s) => s.id).sort()).toEqual(
      [
        // Originals
        "get_faster_5k_14w",
        "hm_beginner_16w",
        "marathon_first_timer_24w",
        // Task #97 picks
        "marathon_pfitz_70_24w",
        "marathon_hansons_22w",
        "ultra_50m_30w",
        "bike_pz_ladder_24w",
        "tonal_recomp_16w",
        "strength_then_hm_20w",
        "hyrox_prep_20w",
        "couch_to_hm_24w",
        "nick_bare_hybrid_16w",
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
  it("every Peloton Bike / Concept2 Row / Peloton Row template tags every block with the sentinel", () => {
    const machineTemplateIds = [
      ["pelo_bike_you_can_ride", "bike"],
      ["pelo_bike_pz_beginner", "bike"],
      ["pelo_bike_pz_intermediate", "bike"],
      ["pelo_bike_pz_advanced", "bike"],
      ["pelo_row_dpz", "row"],
      ["c2_row_30day", "row"],
      ["c2_row_5k", "row"],
      ["c2_row_2k", "row"],
    ] as const;
    for (const [id, expected] of machineTemplateIds) {
      const tpl = getTemplateById(id)!;
      const blocks = tpl.expand(tpl.defaultWeeks);
      for (const b of blocks) {
        expect(primaryMachineKind(b.customNotes), `${id} block`).toBe(expected);
      }
    }
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
