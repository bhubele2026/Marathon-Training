import { Trophy } from "lucide-react";
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
}: {
  race: {
    raceDate: string;
    raceKind: string;
    name?: string | null;
    hasResult?: boolean;
    daysUntil: number;
  };
  testId?: string;
}) {
  const days = race.daysUntil;
  const kindLabel =
    RACE_KIND_LABELS[race.raceKind as RaceDayKind] ?? race.raceKind.toUpperCase();
  const text =
    days === 0
      ? `Race Today · ${kindLabel}`
      : `Next race · ${kindLabel} · in ${days} day${days === 1 ? "" : "s"}`;
  return (
    <a
      href="/races"
      className="inline-flex items-center gap-1 text-[10px] bg-primary/15 text-primary px-2 py-1 rounded font-bold uppercase tracking-wider w-fit hover:bg-primary/25 transition-colors"
      data-testid={testId}
      data-race-date={race.raceDate}
      data-race-kind={race.raceKind}
      data-days-until={days}
    >
      <Trophy className="h-3 w-3" />
      {text}
    </a>
  );
}
