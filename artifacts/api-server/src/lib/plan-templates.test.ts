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
  type PlannerConfig,
} from "@workspace/plan-generator";

describe("PLAN_TEMPLATES", () => {
  it("registers the curated skill-level catalog (Task #132)", () => {
    const ids = PLAN_TEMPLATES.map((t) => t.id).sort();
    expect(ids).toEqual(
      [
        // Beginner
        "custom_hybrid",
        "couch_to_5k",
        "higdon_5k_novice",
        "aerobic_base",
        "recovery",
        // Intermediate
        "5k_improver",
        "half_marathon",
        "marathon_higdon_novice",
        // Advanced
        "marathon",
        "marathon_pfitz_18_70",
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
      // Beginner
      custom_hybrid: [4, 8, 24],
      couch_to_5k: [6, 9, 12],
      higdon_5k_novice: [6, 8, 10],
      aerobic_base: [4, 8, 16],
      recovery: [2, 4, 6],
      // Intermediate
      "5k_improver": [6, 8, 12],
      half_marathon: [10, 12, 16],
      marathon_higdon_novice: [16, 18, 22],
      // Advanced
      marathon: [16, 18, 24],
      marathon_pfitz_18_70: [18, 18, 24],
      ultramarathon_50k: [16, 20, 24],
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

    // "pfitzinger" only appears as a tag on the Pfitz-authored marathon.
    expect(findByTag("pfitzinger")).toContain("marathon");
    // "first-timer" tag should surface the C25K and 50K first-timer plans.
    const firstTimer = findByTag("first-timer");
    expect(firstTimer).toContain("couch_to_5k");
    expect(firstTimer).toContain("ultramarathon_50k");
    // Case-insensitive substring match works on multi-word tags too.
    expect(findByTag("LOW-MILEAGE")).toContain("recovery");
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
  it("registers the curated 4 starter shortcuts (Task #132)", () => {
    expect(STARTER_SHORTCUTS.map((s) => s.id).sort()).toEqual(
      [
        "couch_to_hm_24w",
        "get_faster_5k_14w",
        "hm_beginner_16w",
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
    // hm_pfitz, marathon_hansons, race_countdown were all in the
    // pre-curation catalog — they must still resolve.
    for (const id of ["hm_pfitz", "marathon_hansons", "race_countdown"]) {
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
          templateId: "hm_pfitz",
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
