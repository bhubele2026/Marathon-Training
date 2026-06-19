import { DAY_ORDER } from "./dates";
import { dayBudgetForDayName } from "./types";
import type {
  AiPlan,
  AiStrengthBlock,
  AiWeek,
  DailyBudget,
  Guardrail,
  MovementPattern,
} from "./types";

// Movement-pattern groups for weekly-balance checks.
const PULL_PATTERNS: MovementPattern[] = ["horizontal_pull", "vertical_pull"];
const PUSH_PATTERNS: MovementPattern[] = ["horizontal_push", "vertical_push"];
const LEG_PATTERNS: MovementPattern[] = ["squat", "hinge", "lunge"];

/** Parse a reps string ("8", "8-10", "12-15") to its top number for sanity
 * checks; returns null when it can't be parsed. */
function topReps(reps: string): number | null {
  const nums = reps.match(/\d+/g);
  if (!nums || nums.length === 0) return null;
  return Math.max(...nums.map(Number));
}

/** A stable signature for one movement's prescription, so we can detect whether
 * the SAME movement changed (load/reps/sets) across weeks = progression. */
function blockSignature(b: AiStrengthBlock): string {
  return `${b.movement.trim().toLowerCase()}|${b.sets}|${b.reps}|${b.loadType}|${b.loadValue ?? ""}`;
}

/** All strength blocks in a week, flattened. */
function weekBlocks(week: AiWeek): AiStrengthBlock[] {
  return week.days.flatMap((d) => d.strengthBlocks ?? []);
}

// Soft guardrails over a proposed plan. These NEVER block — they flag likely
// slips so we can show the runner and/or feed them back to Claude to self-correct.
// Claude still owns the numbers; this just catches obvious mistakes.

const STRENGTH_FLOOR_MIN = 30;
// Flag a weekly-mileage jump above this fraction (the ~10% rule, with slack).
const MILEAGE_JUMP_FRACTION = 0.15;
// Below this many weekly miles, ignore jumps (percentages are noisy when tiny).
const MILEAGE_JUMP_FLOOR_MI = 8;

function dayTotal(d: { strengthMin: number; cardioMin: number; runMin: number }): number {
  return d.strengthMin + d.cardioMin + d.runMin;
}

// Behavior rehaul R1. The single authoritative "this plan includes running"
// notion, as seen by the guardrails. Running is OPT-IN: a plan includes
// running only when it is anchored on a run race (`raceKind !== "none"`).
// Callers that have already derived the flag (e.g. from the planner config /
// a scheduled race) can pass it explicitly via `opts.includesRunning` to
// override the raceKind-derived default.
export function planIncludesRunning(
  plan: Pick<AiPlan, "raceKind" | "goalKind">,
  opts?: { includesRunning?: boolean },
): boolean {
  if (opts && typeof opts.includesRunning === "boolean") {
    return opts.includesRunning;
  }
  // Recomp-first: running is OPT-IN. A plan includes running only when it is
  // anchored on a run race (goalKind "race", or a concrete raceKind). A null /
  // undefined / "none" raceKind on a recomp/strength plan is NOT running.
  if (plan.goalKind === "race") return true;
  return Boolean(plan.raceKind && plan.raceKind !== "none");
}

export function runGuardrails(
  plan: AiPlan,
  budget: DailyBudget,
  opts?: { includesRunning?: boolean },
): Guardrail[] {
  const out: Guardrail[] = [];
  const includesRunning = planIncludesRunning(plan, opts);

  // Phase 5: the strength-model checks (real blocks, weekly movement balance,
  // week-over-week progression, sane sets/reps/load) only apply to plans that
  // actually use the new strengthBlocks model. A legacy / engine / minute-only
  // plan with no blocks anywhere is left alone.
  const planUsesBlocks = plan.weeks.some((w) =>
    w.days.some((d) => (d.strengthBlocks?.length ?? 0) > 0),
  );

  // startDate is no longer required to be a Monday — the server snaps it to the
  // Monday on/before (week 1's rest day). So we don't flag a non-Monday start.

  let prevWeeklyMiles: number | null = null;

  for (const week of plan.weeks) {
    // Shape: 7 days, Mon→Sun, correct labels.
    if (week.days.length !== 7) {
      out.push({
        level: "warn",
        code: "week_day_count",
        week: week.week,
        message: `Week ${week.week} has ${week.days.length} days; expected 7 (Mon→Sun).`,
      });
    }
    week.days.forEach((d, i) => {
      const expected = DAY_ORDER[i];
      if (expected && d.day !== expected) {
        out.push({
          level: "warn",
          code: "day_order",
          week: week.week,
          day: d.day,
          message: `Week ${week.week} day ${i + 1} is ${d.day}; expected ${expected}.`,
        });
      }
    });

    let weeklyMiles = 0;

    for (const d of week.days) {
      const total = dayTotal(d);
      if (d.distanceMi) weeklyMiles += d.distanceMi;

      // R1: a recomp/strength default plan (includesRunning === false) must
      // NOT center running. Flag any programmed running — a "Long Run"
      // session, programmed mileage, or run minutes — so a plan that drifts
      // back to a mileage program when the runner never opted in surfaces
      // loudly. Running is an opt-in module; without a run goal there should
      // be zero miles and no Long Run (default = lift + low-impact
      // conditioning).
      if (!includesRunning) {
        const isLongRun = d.sessionType === "Long Run";
        const hasMiles = (d.distanceMi ?? 0) > 0;
        const hasRunMin = (d.runMin ?? 0) > 0;
        if (isLongRun || hasMiles || hasRunMin) {
          const parts: string[] = [];
          if (isLongRun) parts.push("Long Run");
          if (hasMiles) parts.push(`${d.distanceMi} mi`);
          if (hasRunMin) parts.push(`${d.runMin} run min`);
          out.push({
            level: "warn",
            code: "running_without_run_goal",
            week: week.week,
            day: d.day,
            message:
              `Week ${week.week} ${d.day} programs running (${parts.join(", ")}) ` +
              `but no run goal is set; the default plan is strength + low-impact ` +
              `conditioning with zero miles.`,
          });
        }
      }

      // Rest-day integrity.
      if (d.isRest && total > 0) {
        out.push({
          level: "warn",
          code: "rest_not_rest",
          week: week.week,
          day: d.day,
          message: `Week ${week.week} ${d.day} is marked rest but has ${total} min of work.`,
        });
      }

      // Monday should be full rest.
      if (d.day === "Mon" && total > 0) {
        out.push({
          level: "warn",
          code: "monday_not_rest",
          week: week.week,
          day: d.day,
          message: `Week ${week.week} Monday has ${total} min; Monday should be full rest.`,
        });
      }

      if (d.isRest) continue;

      // Fixed-cadence per-day budget window. Mon is handled by the
      // monday_not_rest check above; here we enforce the SHORT (Tue-Thu,
      // default 30-50) and LONG (Fri-Sun, default 60-90) windows. Both the
      // floor and the ceiling are flagged so an over- or under-loaded day
      // surfaces regardless of which bucket it falls in.
      if (d.day !== "Mon") {
        const win = dayBudgetForDayName(d.day, budget);
        const bucket =
          d.day === "Tue" || d.day === "Wed" || d.day === "Thu" ? "short" : "long";
        if (total > win.max) {
          out.push({
            level: "warn",
            code: "over_budget",
            week: week.week,
            day: d.day,
            message: `Week ${week.week} ${d.day} totals ${total} min, over the ${win.max} min ${bucket}-day ceiling.`,
          });
        }
        if (total < win.min) {
          out.push({
            level: "info",
            code: "under_budget",
            week: week.week,
            day: d.day,
            message: `Week ${week.week} ${d.day} totals ${total} min, under the ${win.min} min ${bucket}-day floor.`,
          });
        }
      }

      // Strength floor on training days.
      if (d.day !== "Mon" && d.strengthMin < STRENGTH_FLOOR_MIN) {
        out.push({
          level: "info",
          code: "below_strength_floor",
          week: week.week,
          day: d.day,
          message: `Week ${week.week} ${d.day} has ${d.strengthMin} min lifting, under the ${STRENGTH_FLOOR_MIN} min floor.`,
        });
      }

      // Phase 5 (new-model plans only): a real lifting day must carry real
      // movements, not just minutes; and each block's prescription must be sane.
      if (planUsesBlocks) {
        const blocks = d.strengthBlocks ?? [];
        if (d.strengthMin >= STRENGTH_FLOOR_MIN && blocks.length === 0) {
          out.push({
            level: "warn",
            code: "strength_day_no_blocks",
            week: week.week,
            day: d.day,
            message: `Week ${week.week} ${d.day} has ${d.strengthMin} min of lifting but no movements — program real strength blocks (movement, sets, reps, load).`,
          });
        }
        for (const b of blocks) {
          const reasons: string[] = [];
          if (!(b.sets >= 1 && b.sets <= 12)) reasons.push(`${b.sets} sets`);
          // Reps are OPTIONAL (Tonal owns them); only sanity-check when the coach
          // chose to add a rep note.
          if (b.reps != null && b.reps !== "") {
            const tr = topReps(b.reps);
            if (tr == null || tr < 1 || tr > 50) reasons.push(`reps "${b.reps}"`);
          }
          if (b.loadType === "percent_1rm" && b.loadValue != null && (b.loadValue < 30 || b.loadValue > 100)) {
            reasons.push(`${b.loadValue}% 1RM`);
          }
          if (b.loadType === "rir" && b.loadValue != null && (b.loadValue < 0 || b.loadValue > 6)) {
            reasons.push(`RIR ${b.loadValue}`);
          }
          if (b.loadType === "lb" && b.loadValue != null && (b.loadValue < 0 || b.loadValue > 2000)) {
            reasons.push(`${b.loadValue} lb`);
          }
          if (reasons.length) {
            out.push({
              level: "info",
              code: "implausible_block",
              week: week.week,
              day: d.day,
              message: `Week ${week.week} ${d.day} "${b.movement}" looks off: ${reasons.join(", ")}.`,
            });
          }
        }
      }

      // Pace sanity (plausible human running paces).
      if (d.pace) {
        const m = /^(\d{1,2}):(\d{2})$/.exec(d.pace);
        if (!m) {
          out.push({
            level: "warn",
            code: "bad_pace_format",
            week: week.week,
            day: d.day,
            message: `Week ${week.week} ${d.day} pace "${d.pace}" is not mm:ss.`,
          });
        } else {
          const sec = Number(m[1]) * 60 + Number(m[2]);
          if (sec < 300 || sec > 1080) {
            out.push({
              level: "info",
              code: "implausible_pace",
              week: week.week,
              day: d.day,
              message: `Week ${week.week} ${d.day} pace ${d.pace}/mi looks out of range (5:00-18:00).`,
            });
          }
        }
      }
    }

    // Week-to-week mileage jump.
    if (
      prevWeeklyMiles != null &&
      weeklyMiles > MILEAGE_JUMP_FLOOR_MI &&
      prevWeeklyMiles > 0 &&
      weeklyMiles > prevWeeklyMiles * (1 + MILEAGE_JUMP_FRACTION)
    ) {
      const pct = Math.round((weeklyMiles / prevWeeklyMiles - 1) * 100);
      out.push({
        level: "info",
        code: "mileage_jump",
        week: week.week,
        message: `Week ${week.week} weekly mileage jumps ${pct}% (${prevWeeklyMiles.toFixed(
          1,
        )}→${weeklyMiles.toFixed(1)} mi) vs the ~10% guideline.`,
      });
    }
    // Phase 5: weekly movement balance — a week of lifting shouldn't be all
    // push with no pull or no legs. Only checked on new-model weeks that have a
    // few blocks (a tiny 1-2 movement week isn't expected to be balanced).
    if (planUsesBlocks) {
      const patterns = weekBlocks(week).map((b) => b.pattern);
      if (patterns.length >= 4) {
        const has = (group: MovementPattern[]) => patterns.some((p) => group.includes(p));
        const hasPush = has(PUSH_PATTERNS);
        const hasPull = has(PULL_PATTERNS);
        const hasLegs = has(LEG_PATTERNS);
        const missing: string[] = [];
        if (hasPush && !hasPull) missing.push("no pulling");
        if (!hasLegs) missing.push("no legs (squat/hinge/lunge)");
        if (missing.length) {
          out.push({
            level: "warn",
            code: "weekly_movement_imbalance",
            week: week.week,
            message: `Week ${week.week} is unbalanced (${missing.join(", ")}) — spread the week across push, pull, legs and core.`,
          });
        }
      }
    }

    prevWeeklyMiles = weeklyMiles;
  }

  // Phase 5: week-over-week progression. With the new model, the same movement
  // should change across the block (load up, reps up, or volume up). If the
  // first and last training weeks are byte-identical in their block
  // prescriptions, the plan isn't progressing.
  if (planUsesBlocks && plan.weeks.length >= 2) {
    const withBlocks = plan.weeks.filter((w) => weekBlocks(w).length > 0);
    if (withBlocks.length >= 2) {
      const first = withBlocks[0];
      const last = withBlocks[withBlocks.length - 1];
      const sig = (w: AiWeek) => weekBlocks(w).map(blockSignature).sort().join(";");
      if (sig(first) === sig(last)) {
        out.push({
          level: "info",
          code: "no_progression",
          message: `Weeks ${first.week} and ${last.week} prescribe identical lifts — add week-over-week progression (more load, reps, or sets).`,
        });
      }
    }
  }

  return out;
}
