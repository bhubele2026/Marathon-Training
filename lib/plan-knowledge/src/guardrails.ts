import { DAY_ORDER, isMonday } from "./dates";
import { dayBudgetForDayName } from "./types";
import type { AiPlan, DailyBudget, Guardrail } from "./types";

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
  plan: Pick<AiPlan, "raceKind">,
  opts?: { includesRunning?: boolean },
): boolean {
  if (opts && typeof opts.includesRunning === "boolean") {
    return opts.includesRunning;
  }
  return plan.raceKind !== "none";
}

export function runGuardrails(
  plan: AiPlan,
  budget: DailyBudget,
  opts?: { includesRunning?: boolean },
): Guardrail[] {
  const out: Guardrail[] = [];
  const includesRunning = planIncludesRunning(plan, opts);

  if (!isMonday(plan.startDate)) {
    out.push({
      level: "warn",
      code: "start_not_monday",
      message: `startDate ${plan.startDate} is not a Monday; week 1 must start on Monday.`,
    });
  }

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
    prevWeeklyMiles = weeklyMiles;
  }

  return out;
}
