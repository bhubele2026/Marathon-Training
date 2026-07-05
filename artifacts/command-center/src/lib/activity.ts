import type { Workout } from "@workspace/api-client-react";
import type { ActivityDay } from "@/components/studio";

// Shared activity-heatmap builder. Extracted from the (retired) dashboard so the
// landing front door and any future surface can reuse the exact same derivation:
// the last 30 calendar days marked active (level 1 light / 2 solid) from logged
// workout minutes, plus the active-days / streak / vs-prev-30 footer stats. All
// derived client-side from the recent-activity slice already in the bootstrap.

const MS_DAY = 86_400_000;

export function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export interface ActivitySummary {
  days: ActivityDay[];
  activeDays: number;
  prevActiveDays: number;
  streak: number;
}

export function buildActivity(workouts: Workout[]): ActivitySummary {
  const minutesByDate = new Map<string, number>();
  // That day's workout(s), compact label + detail, for the hover/tap tooltip.
  const workoutsByDate = new Map<string, { label: string; detail?: string }[]>();
  for (const w of workouts) {
    const d = (w.date ?? "").slice(0, 10);
    if (!d) continue;
    const mins = w.totalMin ?? w.durationMin ?? 0;
    minutesByDate.set(d, (minutesByDate.get(d) ?? 0) + mins);
    const label = (w.sessionType || w.modality || w.equipment || "Workout").trim();
    const bits: string[] = [];
    if (w.equipment && w.equipment !== label && w.equipment !== "None") bits.push(w.equipment);
    if (mins > 0) bits.push(`${Math.round(mins)} min`);
    else if (w.distanceMi) bits.push(`${w.distanceMi} mi`);
    const list = workoutsByDate.get(d) ?? [];
    list.push({ label, detail: bits.length ? bits.join(" · ") : undefined });
    workoutsByDate.set(d, list);
  }
  const today = new Date();
  const days: ActivityDay[] = [];
  let activeDays = 0;
  let prevActiveDays = 0;
  for (let i = 29; i >= 0; i--) {
    const dt = new Date(today.getTime() - i * MS_DAY);
    const key = dateKey(dt);
    const mins = minutesByDate.get(key) ?? 0;
    const level: 0 | 1 | 2 = mins === 0 ? 0 : mins >= 30 ? 2 : 1;
    if (level > 0) activeDays++;
    days.push({ date: key, level, workouts: workoutsByDate.get(key) });
  }
  // Prior 30-day window (days 31..60) for the "vs last 30" footer stat.
  for (let i = 59; i >= 30; i--) {
    const dt = new Date(today.getTime() - i * MS_DAY);
    if ((minutesByDate.get(dateKey(dt)) ?? 0) > 0) prevActiveDays++;
  }
  // Streak: consecutive active days counting back from today.
  let streak = 0;
  for (let i = 0; i < 60; i++) {
    const dt = new Date(today.getTime() - i * MS_DAY);
    if ((minutesByDate.get(dateKey(dt)) ?? 0) > 0) streak++;
    else if (i > 0) break; // today not logged yet shouldn't break the streak
    else continue;
  }
  return { days, activeDays, prevActiveDays, streak };
}
