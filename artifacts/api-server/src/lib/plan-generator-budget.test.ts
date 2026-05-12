// Generator-level enforcement of the daily time budget contract
// (Task #336, expanded 2026-05-12). Locks in five invariants across
// every generator path — legacy `generatePlan`, recipe-driven
// `buildWeekDays`, hybrid `buildHybridWeekDays`, and lift-primary
// `buildLiftPrimaryWeekDays`:
//
//   1. Mon is always a hard rest day (strength_min + cardio_min +
//      run_min === 0). No template can slot a session there.
//   2. Tue-Sat non-rest days have totalMin ∈ [45, 75] inclusive. No
//      day blows past 75 (unsustainable on a workday) or under-delivers
//      below 45 (not worth the warmup).
//   3. Sun (long-run day) non-rest has totalMin ≥ 60, no upper cap.
//   4. Strength floor: every Tue-Sun non-rest day has strength_min
//      ≥ 30 minutes — six lifting sessions per week.
//   5. Long runs (`session_type === "Long Run"`) are only ever
//      emitted on Sat or Sun — Fri never holds the long run.
//
// Race-week rows + race-eve Sat / race-day Sun helpers stay exempt
// (intentionally light/heavy for race-day freshness).

import { describe, expect, it } from "vitest";
import {
  DAILY_STRENGTH_FLOOR_MIN,
  WEEKDAY_MAX_TOTAL_MIN,
  WEEKDAY_MIN_TOTAL_MIN,
  WEEKEND_MIN_TOTAL_MIN,
  HYBRID_POSITIONS_ORDERED,
  generatePlan,
  generatePlanFromConfig,
  type DailyRow,
  type HybridFitnessLevel,
  type HybridMixPosition,
  type PlannerConfig,
} from "@workspace/plan-generator";

const RACE_EXEMPT_SESSION_TYPES = new Set<string>([
  "Race Prep",
  "Race",
  "Race Shakeout",
]);

function totalMin(row: DailyRow): number {
  return (row.strength_min ?? 0) + (row.cardio_min ?? 0) + (row.run_min ?? 0);
}

function isRaceWeekRow(row: DailyRow, raceWeek: number): boolean {
  return row.week === raceWeek;
}

// Contract assertions in one place so per-template loops below stay
// short. `raceWeek` is the campaign-final week index (1-based) — rows
// in that week are exempt from the floor/cap because the race-week
// taper is intentionally light.
function assertBudgetContract(
  rows: DailyRow[],
  opts: { raceWeek: number | null; label: string },
): void {
  for (const row of rows) {
    const ctx = `${opts.label} w${row.week} ${row.day} (${row.session_type})`;

    // (1) Mon is always full rest, every template, every week.
    if (row.day === "Mon") {
      expect(row.strength_min, `${ctx} strength_min`).toBe(0);
      expect(row.cardio_min, `${ctx} cardio_min`).toBe(0);
      expect(row.run_min, `${ctx} run_min`).toBe(0);
      continue;
    }

    // (4) Long runs only on Sat/Sun.
    if (row.session_type === "Long Run") {
      expect(["Sat", "Sun"], `${ctx} long-run day`).toContain(row.day);
    }

    // Race-week rows + race-eve / race-day helpers are exempt.
    if (opts.raceWeek != null && isRaceWeekRow(row, opts.raceWeek)) continue;
    if (RACE_EXEMPT_SESSION_TYPES.has(row.session_type)) continue;
    if (row.description.startsWith("RACE DAY")) continue;
    if (row.is_rest) continue;

    const min = totalMin(row);
    if (row.day === "Sun") {
      // (3) Sun long-run floor (no upper cap).
      expect(min, `${ctx} Sun floor (${WEEKEND_MIN_TOTAL_MIN})`).toBeGreaterThanOrEqual(
        WEEKEND_MIN_TOTAL_MIN,
      );
    } else {
      // (2) Tue-Sat capped weekday window.
      expect(min, `${ctx} weekday floor (${WEEKDAY_MIN_TOTAL_MIN})`).toBeGreaterThanOrEqual(
        WEEKDAY_MIN_TOTAL_MIN,
      );
      expect(min, `${ctx} weekday cap (${WEEKDAY_MAX_TOTAL_MIN})`).toBeLessThanOrEqual(
        WEEKDAY_MAX_TOTAL_MIN,
      );
    }

    // (4) Strength floor: every non-rest Tue-Sun day has ≥ 30 min lift.
    expect(
      row.strength_min ?? 0,
      `${ctx} strength floor (${DAILY_STRENGTH_FLOOR_MIN})`,
    ).toBeGreaterThanOrEqual(DAILY_STRENGTH_FLOOR_MIN);
  }
}

// ----- Canonical 52-week half-marathon plan -------------------------

describe("daily time budget contract — canonical generatePlan (52w)", () => {
  it("every weekday and weekend day obeys the contract", () => {
    const { daily } = generatePlan();
    assertBudgetContract(daily, { raceWeek: 52, label: "canonical" });
    // Sanity: 52 weeks * 7 days = 364 rows.
    expect(daily.length).toBe(52 * 7);
  });
});

// ----- Hybrid template — every slider position * every level --------

function hybridConfig(opts: {
  blockWeeks: number;
  position: HybridMixPosition;
  daysPerWeek: number;
  level: HybridFitnessLevel;
}): PlannerConfig {
  const total = opts.blockWeeks + 16;
  const startMs = Date.parse("2026-01-05T00:00:00Z");
  const endMs = startMs + (total * 7 - 1) * 86400000;
  const marathonDate = new Date(endMs).toISOString().slice(0, 10);
  return {
    startDate: "2026-01-05",
    marathonDate,
    blocks: [
      {
        focusType: "Custom",
        weeks: opts.blockWeeks,
        customName: "Hybrid Block",
        customNotes: `[hybrid-mix:${opts.position}] [hybrid-days:${opts.daysPerWeek}] [hybrid-level:${opts.level}]`,
      },
    ],
  };
}

describe("daily time budget contract — hybrid (every slider * every level)", () => {
  const blockWeeks = 8;
  const levels: HybridFitnessLevel[] = ["beginner", "intermediate", "advanced"];

  for (const position of HYBRID_POSITIONS_ORDERED) {
    for (const level of levels) {
      it(`${position} @ ${level}: contract holds across the 8-week hybrid block`, () => {
        const cfg = hybridConfig({
          blockWeeks,
          position,
          daysPerWeek: 5,
          level,
        });
        const { daily } = generatePlanFromConfig(cfg);
        const blockRows = daily.filter((d) => d.week >= 1 && d.week <= blockWeeks);
        assertBudgetContract(blockRows, {
          // Hybrid block is followed by the auto-pinned 16-week
          // Marathon-Specific tail; the block itself is never the
          // race week, so no exemption is needed inside the block.
          raceWeek: null,
          label: `hybrid:${position}:${level}`,
        });
      });
    }
  }
});

// ----- Lift-primary template (4 kinds) ------------------------------

function liftPrimaryConfig(
  kind: "upper" | "lower" | "ppl" | "conditioning",
  blockWeeks: number,
): PlannerConfig {
  const total = blockWeeks + 16;
  const startMs = Date.parse("2026-01-05T00:00:00Z");
  const endMs = startMs + (total * 7 - 1) * 86400000;
  const marathonDate = new Date(endMs).toISOString().slice(0, 10);
  return {
    startDate: "2026-01-05",
    marathonDate,
    blocks: [
      {
        focusType: "Custom",
        weeks: blockWeeks,
        customName: "Lift Block",
        customNotes: `[lift-primary:${kind}]`,
      },
    ],
  };
}

describe("daily time budget contract — lift-primary (every kind)", () => {
  const kinds = ["upper", "lower", "ppl", "conditioning"] as const;
  for (const kind of kinds) {
    it(`lift-primary ${kind}: contract holds across an 8-week block`, () => {
      const { daily } = generatePlanFromConfig(liftPrimaryConfig(kind, 8));
      const blockRows = daily.filter((d) => d.week >= 1 && d.week <= 8);
      assertBudgetContract(blockRows, {
        raceWeek: null,
        label: `lift-primary:${kind}`,
      });
      // Sanity: Mon / Thu / Sun are rest days in this template.
      const week1 = blockRows.filter((d) => d.week === 1);
      const restDays = week1.filter((d) => d.is_rest).map((d) => d.day);
      expect(restDays.sort()).toEqual(["Mon", "Sun", "Thu"]);
    });
  }
});

// ----- No long run on Friday across every generated plan ------------

// ----- Task #338: per-runner daily-budget override propagates -------

describe("daily time budget contract — per-runner dailyBudget override propagates", () => {
  // Pick an override that's clearly outside the defaults so the
  // assertions can't accidentally pass against the constants.
  const override = { weekdayMin: 60, weekdayMax: 90, weekendMin: 75 };

  it("hybrid generator respects the override floors and cap", () => {
    const cfg: PlannerConfig = {
      ...hybridConfig({
        blockWeeks: 8,
        position: "balanced",
        daysPerWeek: 5,
        level: "intermediate",
      }),
      dailyBudget: override,
    };
    const { daily } = generatePlanFromConfig(cfg);
    const blockRows = daily.filter((d) => d.week >= 1 && d.week <= 8);
    for (const row of blockRows) {
      if (row.day === "Mon") continue;
      if (row.is_rest) continue;
      if (RACE_EXEMPT_SESSION_TYPES.has(row.session_type)) continue;
      const min = totalMin(row);
      // Sun is the long-run day (floor only). Sat counts as a weekday
      // for budget purposes since long runs stay on Sun.
      if (row.day === "Sun") {
        expect(min).toBeGreaterThanOrEqual(override.weekendMin);
      } else {
        expect(min).toBeGreaterThanOrEqual(override.weekdayMin);
        expect(min).toBeLessThanOrEqual(override.weekdayMax);
      }
    }
  });

  it("lift-primary applies the override floor end-to-end", () => {
    const cfgDefault: PlannerConfig = liftPrimaryConfig("upper", 8);
    const cfgOverride: PlannerConfig = {
      ...cfgDefault,
      dailyBudget: override,
    };
    const def = generatePlanFromConfig(cfgDefault).daily.filter(
      (d) => d.week >= 1 && d.week <= 8 && !d.is_rest,
    );
    const ovr = generatePlanFromConfig(cfgOverride).daily.filter(
      (d) => d.week >= 1 && d.week <= 8 && !d.is_rest,
    );
    // (1) Under the override, every non-rest weekday sits within the
    // override window; Sun (long-run day) clears the override floor.
    for (const row of ovr) {
      const min = totalMin(row);
      if (row.day === "Sun") {
        expect(min).toBeGreaterThanOrEqual(override.weekendMin);
      } else {
        expect(min).toBeGreaterThanOrEqual(override.weekdayMin);
        expect(min).toBeLessThanOrEqual(override.weekdayMax);
      }
    }
    // (2) The override actually CHANGED weekday minutes: a default
    // weekday session (~45 min lift) sits below the override floor
    // (60), so propagation must push it up. If the override were
    // silently dropped both runs would be identical.
    const sameDay = (a: typeof def[number], b: typeof ovr[number]) =>
      a.date === b.date;
    let mutated = false;
    for (const d of def) {
      if (d.day === "Sun" || d.day === "Mon") continue;
      const o = ovr.find((x) => sameDay(d, x));
      if (!o) continue;
      if (totalMin(d) < override.weekdayMin) {
        // Same session under the override must have been padded up.
        expect(totalMin(o)).toBeGreaterThanOrEqual(override.weekdayMin);
        expect(totalMin(o)).toBeGreaterThan(totalMin(d));
        mutated = true;
      }
    }
    expect(
      mutated,
      "expected the override to widen at least one lift-primary weekday up to the override floor",
    ).toBe(true);
  });

  it("recipe-driven buildWeekDays respects the override on a half-marathon plan", () => {
    // 24-week half marathon (8w user block + 16w marathon tail).
    const cfg: PlannerConfig = {
      startDate: "2026-01-05",
      marathonDate: new Date(
        Date.parse("2026-01-05T00:00:00Z") + (24 * 7 - 1) * 86400000,
      )
        .toISOString()
        .slice(0, 10),
      blocks: [{ focusType: "Base", weeks: 8 }],
      dailyBudget: override,
    };
    const { daily } = generatePlanFromConfig(cfg);
    for (const row of daily) {
      if (row.day === "Mon") continue;
      if (row.is_rest) continue;
      if (RACE_EXEMPT_SESSION_TYPES.has(row.session_type)) continue;
      if (row.description.startsWith("RACE DAY")) continue;
      // Race week (final week) is exempt from the contract.
      if (row.week === 24) continue;
      const min = totalMin(row);
      if (row.day === "Sun") {
        expect(min).toBeGreaterThanOrEqual(override.weekendMin);
      } else {
        expect(min).toBeGreaterThanOrEqual(override.weekdayMin);
        expect(min).toBeLessThanOrEqual(override.weekdayMax);
      }
    }
  });
});

describe("long-run placement — never on a Friday", () => {
  it("canonical plan has no Friday long run", () => {
    const { daily } = generatePlan();
    const fridayLongRuns = daily.filter(
      (d) => d.day === "Fri" && d.session_type === "Long Run",
    );
    expect(fridayLongRuns).toEqual([]);
  });

  it("every hybrid slider position keeps long runs off Friday", () => {
    for (const position of HYBRID_POSITIONS_ORDERED) {
      const cfg = hybridConfig({
        blockWeeks: 8,
        position,
        daysPerWeek: 5,
        level: "intermediate",
      });
      const { daily } = generatePlanFromConfig(cfg);
      const fridayLongRuns = daily.filter(
        (d) => d.week >= 1 && d.week <= 8 && d.day === "Fri" && d.session_type === "Long Run",
      );
      expect(fridayLongRuns, `${position} Fri long-run rows`).toEqual([]);
    }
  });
});
