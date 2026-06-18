import type { Workout } from "@workspace/api-client-react";

// Numeric rank used to sort same-day sessions: AM first, then PM, then Other,
// then untagged rows. Keep this aligned with the SQL CASE expression on the
// server (artifacts/api-server/src/routes/plan.ts and routes/workouts.ts).
const TIME_OF_DAY_RANK: Record<string, number> = {
  AM: 0,
  PM: 1,
  Other: 2,
};

function timeOfDayRank(value: string | null | undefined): number {
  if (value && value in TIME_OF_DAY_RANK) return TIME_OF_DAY_RANK[value]!;
  return 3;
}

// Sort a list of workouts in-place (and return it) by time-of-day tag, with
// createdAt ascending as the tiebreaker. Use this for client-side ordering
// of multi-session days so AM strength logged in the evening still surfaces
// above an earlier PM run.
export function sortWorkoutsByTimeOfDay<T extends Pick<Workout, "timeOfDay" | "createdAt">>(
  workouts: T[],
): T[] {
  return workouts.sort((a, b) => {
    const ra = timeOfDayRank(a.timeOfDay ?? null);
    const rb = timeOfDayRank(b.timeOfDay ?? null);
    if (ra !== rb) return ra - rb;
    if (a.createdAt < b.createdAt) return -1;
    if (a.createdAt > b.createdAt) return 1;
    return 0;
  });
}

// Default tag to apply to a "Done" / quick-log workout so it lands
// in a sensible AM/PM bucket without the user having to pick. Returns null
// before noon so AM remains the implicit untagged default for morning logs;
// otherwise tag as PM. The user can always override in the form.
export function defaultTimeOfDayForNow(now: Date = new Date()): "AM" | "PM" {
  return now.getHours() < 12 ? "AM" : "PM";
}
