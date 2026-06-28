// Pure prompt-builders for the coach voice (Phases 4-5). Kept DB-free so the
// tone-safety logic (the SAFETY SIGNAL that drives the supportive flip) is unit-
// testable without a database. The routes own the DB gathering + the AI call;
// these turn the gathered numbers into the model's user message.

import { calorieFloor } from "./nutrition-safety";
// Type-only import (erased at runtime — no DB module is loaded).
import type { WeekReview } from "../routes/week-review";

export type DayInputs = {
  date: string;
  target: { calories: number | null; protein: number | null; carbs: number | null; fat: number | null };
  actual: { calories: number | null; protein: number | null; carbs: number | null; fat: number | null } | null;
  planned: { sessionType: string; isRest: boolean; minutes: number; lifting: boolean; description: string } | null;
  loggedWorkouts: number;
  loggedMinutes: number;
  sex: string | null;
  // True when this is the current day and the runner hasn't "closed" it yet —
  // they're still eating. The voice then judges intake by PACE toward target and
  // never warns it's too low (the day isn't done). False for closed/past days.
  dayOpen?: boolean;
  // The reactive per-day macro target the engine produced (carbs scaled to the
  // day's load, protein anchored, fat balanced) so the coach can reference the
  // macro logic — "big day, more carbs, protein stays high." Null pre-baseline.
  dayTarget?: {
    cal: number;
    protein: number;
    carbs: number;
    load: number;
    summary: string | null;
  } | null;
  // The drinking snapshot for TODAY + this week, when alcohol tracking is
  // active. The client has explicitly asked to drink LESS, so the coach may rib
  // a blown dry-day target or a drinking day that'll tax tomorrow's training —
  // aimed at the choice + pattern, never moralised (see persona). Null when the
  // user isn't tracking alcohol. `heavyToday` flips the safety nudge.
  alcohol?: {
    todayDrinks: number;
    todayLogged: boolean;
    weekDrinks: number;
    drinkingDaysThisWeek: number;
    dryDaysThisWeek: number;
    dryDaysTarget: number;
    currentDryStreak: number;
    heavyToday: boolean;
  } | null;
};

export function buildDataSummary(d: DayInputs): string {
  const lines: string[] = [`Date: ${d.date} (react to TODAY only).`];
  if (d.planned) {
    lines.push(
      d.planned.isRest
        ? `Planned: REST day.`
        : `Planned session: ${d.planned.sessionType} (~${d.planned.minutes} min${d.planned.lifting ? ", a Tonal lifting day" : ""}). ${d.planned.description}`,
    );
  } else {
    lines.push(`Planned: nothing on the plan today.`);
  }
  lines.push(
    `Workouts logged today: ${d.loggedWorkouts}${d.loggedWorkouts ? ` (${d.loggedMinutes} min)` : ""}.` +
      (d.planned && !d.planned.isRest && d.loggedWorkouts === 0
        ? " The planned session has NOT been logged."
        : ""),
  );

  if (d.dayTarget) {
    const t = d.dayTarget;
    lines.push(
      `Today's fuel target (carbs scale with training load ${t.load}, protein anchored, fat balances): ` +
        `${t.protein} g protein, ${t.carbs} g carbs, ${t.cal} kcal` +
        `${t.summary ? ` — drove by: ${t.summary}` : ""}. ` +
        `You may reference this macro logic (e.g. a big day means more carbs to fuel it while protein stays high). ` +
        `This is LOAD-based fuelling, never calories burned.`,
    );
  }

  if (d.actual) {
    const t = d.target;
    const a = d.actual;
    lines.push(
      `Food ${d.dayOpen ? "so far today" : "today"} — calories ${a.calories ?? "—"} (target ${t.calories ?? "—"}), ` +
        `protein ${a.protein ?? "—"} g (target ${t.protein ?? "—"}), ` +
        `carbs ${a.carbs ?? "—"} g, fat ${a.fat ?? "—"} g.`,
    );
    const floor = calorieFloor(d.sex);
    if (d.dayOpen) {
      // The day isn't finished — these are partial numbers. Judge by pace, never
      // warn that intake is low; the runner is still eating.
      lines.push(
        `NOTE: the day is still OPEN — the runner hasn't finished eating, so these ` +
          `numbers are PARTIAL. Do NOT warn about low calories/protein or treat this ` +
          `as a final day. If anything, gauge their pace toward target and nudge ` +
          `encouragingly. The under-floor warning only applies once the day is closed.`,
      );
    } else if (a.calories != null && a.calories > 0 && a.calories < floor) {
      lines.push(
        `SAFETY SIGNAL: today's calories (${a.calories}) are BELOW the safe floor of ${floor}. ` +
          `If this is a real day's intake, DROP the sarcasm and be warm — encourage eating enough.`,
      );
    }
  } else {
    lines.push(`Food today: nothing synced yet.`);
  }

  if (d.alcohol) {
    const al = d.alcohol;
    lines.push(
      `ALCOHOL (the client has explicitly asked to drink LESS — this is FAIR GAME; ` +
        `aim it at the choice + pattern, tie it to the training they care about, never ` +
        `moralise it as sin): today ${al.todayLogged ? `${al.todayDrinks} drink(s)` : "nothing logged yet"}. ` +
        `This week so far: ${al.weekDrinks} drink(s) across ${al.drinkingDaysThisWeek} drinking day(s); ` +
        `${al.dryDaysThisWeek}/${al.dryDaysTarget} dry days; current dry streak ${al.currentDryStreak}. ` +
        `Fair to rib a blown dry-day target or a drinking day that taxes tomorrow's session.`,
    );
    if (al.heavyToday) {
      lines.push(
        `SAFETY SIGNAL (alcohol): today's drinking is heavy. Ease right off the jokes — a ` +
          `light, kind nudge at most. If heavy drinking looks like a pattern they can't ` +
          `steer, DROP the act entirely and gently suggest real support.`,
      );
    }
  }
  return lines.join("\n");
}

export function buildSummaryData(review: WeekReview, sex: string | null): string {
  const f = review.food;
  const w = review.workouts;
  const wt = review.weight;
  const lines: string[] = [`Week ${review.weekStart} → ${review.weekEnd}.`];

  lines.push(
    `FOOD: ${f.daysLogged}/7 days logged. ` +
      `Avg calories ${f.avgCalories ?? "—"} (target ${f.target.calories ?? "—"}), ` +
      `avg protein ${f.avgProtein ?? "—"} g (target ${f.target.protein ?? "—"}). ` +
      `Protein target hit ${f.proteinHitRate != null ? `${Math.round(f.proteinHitRate * 100)}% of logged days` : "—"}. ` +
      `${f.daysOverCalories} day(s) over calories, ${f.daysUnderCalories} under.`,
  );
  lines.push(
    `WORKOUTS: ${w.done}/${w.planned} planned sessions done (${w.skipped} skipped), ` +
      `${w.minutesDone}/${w.minutesPlanned} planned minutes trained. ` +
      `Lifting days: ${w.liftingDone}/${w.liftingPlanned} done. ` +
      `${w.missedDays.length ? `Missed: ${w.missedDays.join(", ")}.` : "Nothing missed."}`,
  );
  lines.push(
    `WEIGHT: ` +
      (wt.startLb != null && wt.endLb != null
        ? `${wt.startLb} → ${wt.endLb} lb (${wt.actualChangeLb! > 0 ? "+" : ""}${wt.actualChangeLb} lb). `
        : `not enough weigh-ins. `) +
      (wt.goalChangeLb != null
        ? `Weekly goal was ${wt.goalChangeLb} lb. ${wt.onTrack === true ? "On track." : wt.onTrack === false ? "Off track." : ""}`
        : `No weekly weight goal set.`),
  );

  const floor = calorieFloor(sex);
  if (f.avgCalories != null && f.avgCalories > 0 && f.avgCalories < floor) {
    lines.push(
      `SAFETY SIGNAL: average intake (${f.avgCalories} kcal) is BELOW the safe floor of ${floor}. ` +
        `Drop the sarcasm — be warm, encourage eating enough, suggest a professional if it's a pattern.`,
    );
  }
  if (wt.actualChangeLb != null && wt.actualChangeLb < -2.5) {
    lines.push(
      `SAFETY SIGNAL: dropped ${Math.abs(wt.actualChangeLb)} lb this week — faster than safe. ` +
        `Be warm and concerned; do NOT praise rapid loss or push for more.`,
    );
  }
  return lines.join("\n");
}
