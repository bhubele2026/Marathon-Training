import { Trophy } from "lucide-react";
import { Link } from "wouter";
import type { RaceDayKind } from "@/lib/race-day-label";

const RACE_KIND_LABELS: Record<RaceDayKind, string> = {
  marathon: "Marathon",
  half: "Half Marathon",
  "10k": "10K",
  "5k": "5K",
};

export function NextScheduledRaceChip({
  race,
  testId = "chip-next-scheduled-race",
  onLogResult,
}: {
  race: {
    raceDate: string;
    raceKind: string;
    name?: string | null;
    hasResult?: boolean;
    daysUntil: number;
  };
  testId?: string;
  onLogResult?: () => void;
}) {
  const days = race.daysUntil;
  const kindLabel =
    RACE_KIND_LABELS[race.raceKind as RaceDayKind] ?? race.raceKind.toUpperCase();
  // Task #349: on race day with no result yet, the chip becomes an
  // actionable "Log result" CTA that opens the finish-time form right
  // from the page header rather than navigating to /races.
  const isRaceDayUnlogged = days === 0 && !race.hasResult;
  if (isRaceDayUnlogged && onLogResult) {
    return (
      <button
        type="button"
        onClick={onLogResult}
        className="inline-flex items-center gap-1 text-[10px] bg-primary text-primary-foreground px-2 py-1 rounded font-bold tracking-wider w-fit hover:bg-primary/90 transition-colors"
        data-testid={testId}
        data-race-date={race.raceDate}
        data-race-kind={race.raceKind}
        data-days-until={days}
        data-log-result-cta="true"
      >
        <Trophy className="h-3 w-3" />
        {`Log result · ${kindLabel}`}
      </button>
    );
  }
  const text =
    days === 0
      ? `Race Today · ${kindLabel}`
      : `Next race · ${kindLabel} · in ${days} day${days === 1 ? "" : "s"}`;
  return (
    <Link
      href="/races"
      className="inline-flex items-center gap-1 text-[10px] bg-primary/15 text-primary px-2 py-1 rounded font-bold tracking-wider w-fit hover:bg-primary/25 transition-colors"
      data-testid={testId}
      data-race-date={race.raceDate}
      data-race-kind={race.raceKind}
      data-days-until={days}
    >
      <Trophy className="h-3 w-3" />
      {text}
    </Link>
  );
}
