import {
  useGetRaceWeek,
  useSetRaceWeekChecklistItem,
  useCreateRaceWeekChecklistItem,
  useDeleteRaceWeekChecklistItem,
  useSetRaceResult,
  getGetRaceWeekQueryKey,
  type RaceWeekStatus,
  type RaceWeekChecklistItem,
  type RaceResult,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Trophy,
  Award,
  Flag,
  ListChecks,
  Plus,
  X,
  Pencil,
  AlertCircle,
  Route,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { formatDistance } from "@/lib/format";
import { raceDayLabel } from "@/lib/race-day-label";
import { HR_ZONE_TONES } from "@/lib/run-target";
import { cn } from "@/lib/utils";

// Task #209: per-kind race-week eyebrow / post-race title so a
// half / 10K / 5K campaign reads "Half Marathon · Race Week" / "Day N
// Half Marathon Recovery" instead of always saying "Race Week" /
// "Race Complete". Marathon collapses to plain "Race Week" so the
// existing flagship copy is unchanged.
type DashboardRaceKind = "marathon" | "half" | "10k" | "5k";
const RACE_KIND_LABELS: Record<DashboardRaceKind, string> = {
  marathon: "Marathon",
  half: "Half Marathon",
  "10k": "10K",
  "5k": "5K",
};

// Task #241: per-kind banner branding so a 5K / 10K / Half campaign
// gets a distinct icon + accent color on the dashboard race-week
// banner instead of inheriting the marathon flagship orange + Flag
// look. Marathon stays on primary/Flag so the existing flagship
// styling is unchanged. Tailwind classes are listed in full so the
// JIT picks them up.
type BannerTheme = {
  Icon: LucideIcon;
  // RaceWeekCountdown surface (lighter gradient).
  countdown: {
    card: string;
    iconBg: string;
    iconColor: string;
    eyebrowColor: string;
    daysColor: string;
  };
  // RaceDayHero surface (heavier gradient).
  hero: {
    card: string;
    iconBg: string;
    iconColor: string;
    eyebrowColor: string;
  };
  // PostRaceRecovery accent on the kind icon (the recovery copy +
  // emerald palette stay so the "Recovery Mode" semantic isn't lost;
  // only the icon + eyebrow tint pick up the kind color).
  recoveryIconColor: string;
  recoveryIconBg: string;
};

const BANNER_THEME_BY_KIND: Record<DashboardRaceKind, BannerTheme> = {
  marathon: {
    Icon: Flag,
    countdown: {
      card: "border-primary/40 bg-gradient-to-br from-primary/15 via-primary/5 to-background",
      iconBg: "bg-primary/20",
      iconColor: "text-primary",
      eyebrowColor: "text-primary",
      daysColor: "text-primary",
    },
    hero: {
      card: "border-primary bg-gradient-to-br from-primary/30 via-primary/10 to-background",
      iconBg: "bg-primary/30",
      iconColor: "text-primary",
      eyebrowColor: "text-primary",
    },
    recoveryIconColor: "text-primary",
    recoveryIconBg: "bg-primary/20",
  },
  half: {
    Icon: Route,
    countdown: {
      card: "border-sky-500/40 bg-gradient-to-br from-sky-500/15 via-sky-500/5 to-background",
      iconBg: "bg-sky-500/20",
      iconColor: "text-sky-600 dark:text-sky-400",
      eyebrowColor: "text-sky-600 dark:text-sky-400",
      daysColor: "text-sky-600 dark:text-sky-400",
    },
    hero: {
      card: "border-sky-500 bg-gradient-to-br from-sky-500/30 via-sky-500/10 to-background",
      iconBg: "bg-sky-500/30",
      iconColor: "text-sky-600 dark:text-sky-400",
      eyebrowColor: "text-sky-600 dark:text-sky-400",
    },
    recoveryIconColor: "text-sky-600 dark:text-sky-400",
    recoveryIconBg: "bg-sky-500/20",
  },
  "10k": {
    Icon: Zap,
    countdown: {
      card: "border-amber-500/40 bg-gradient-to-br from-amber-500/15 via-amber-500/5 to-background",
      iconBg: "bg-amber-500/20",
      iconColor: "text-amber-600 dark:text-amber-400",
      eyebrowColor: "text-amber-600 dark:text-amber-400",
      daysColor: "text-amber-600 dark:text-amber-400",
    },
    hero: {
      card: "border-amber-500 bg-gradient-to-br from-amber-500/30 via-amber-500/10 to-background",
      iconBg: "bg-amber-500/30",
      iconColor: "text-amber-600 dark:text-amber-400",
      eyebrowColor: "text-amber-600 dark:text-amber-400",
    },
    recoveryIconColor: "text-amber-600 dark:text-amber-400",
    recoveryIconBg: "bg-amber-500/20",
  },
  "5k": {
    Icon: Zap,
    countdown: {
      card: "border-red-500/40 bg-gradient-to-br from-red-500/15 via-red-500/5 to-background",
      iconBg: "bg-red-500/20",
      iconColor: "text-red-600 dark:text-red-400",
      eyebrowColor: "text-red-600 dark:text-red-400",
      daysColor: "text-red-600 dark:text-red-400",
    },
    hero: {
      card: "border-red-500 bg-gradient-to-br from-red-500/30 via-red-500/10 to-background",
      iconBg: "bg-red-500/30",
      iconColor: "text-red-600 dark:text-red-400",
      eyebrowColor: "text-red-600 dark:text-red-400",
    },
    recoveryIconColor: "text-red-600 dark:text-red-400",
    recoveryIconBg: "bg-red-500/20",
  },
};

function bannerTheme(kind: DashboardRaceKind | null | undefined): BannerTheme {
  return BANNER_THEME_BY_KIND[kind ?? "marathon"];
}

interface RaceWeekBannerProps {
  // Task #209: per-kind framing flows from the dashboard summary so the
  // banner copy matches the dashboard header. Optional / nullable so
  // callers without raceKind context (or campaigns with no recognised
  // race row) still render the generic "Race Week" / "Race Complete"
  // copy unchanged.
  raceKind?: DashboardRaceKind | null;
}

// Task #39: compact taper-checklist reminder for the dashboard header
// and Today page. Renders a small badge ("3 checklist items remaining")
// only while race week is active, the race hasn't passed, and at least
// one item is still unchecked. Once everything is checked the badge
// disappears so the runner only sees the nudge when there's actually
// something to do. Reuses the same `useGetRaceWeek` query the banner
// already runs so there's no extra round-trip.
export function ChecklistNudge({ testId }: { testId?: string } = {}) {
  const { data } = useGetRaceWeek({
    query: {
      queryKey: getGetRaceWeekQueryKey(),
      refetchOnWindowFocus: true,
      refetchInterval: 60_000,
    },
  });
  if (!data) return null;
  if (!data.inWindow || data.racePassed) return null;
  if (data.uncheckedCount === 0) return null;
  const urgent = data.daysToRace <= 2;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-bold uppercase tracking-wider border w-fit",
        urgent
          ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
          : "border-primary/40 bg-primary/10 text-primary",
      )}
      data-testid={testId ?? "checklist-reminder-badge"}
      data-unchecked-count={data.uncheckedCount}
    >
      {urgent ? <AlertCircle className="h-3.5 w-3.5" /> : <ListChecks className="h-3.5 w-3.5" />}
      {data.uncheckedCount} checklist item{data.uncheckedCount === 1 ? "" : "s"} remaining
    </span>
  );
}

export function RaceWeekBanner({ raceKind = null }: RaceWeekBannerProps = {}) {
  const { data, isLoading } = useGetRaceWeek({
    query: {
      queryKey: getGetRaceWeekQueryKey(),
      refetchOnWindowFocus: true,
      refetchInterval: 60_000,
    },
  });

  if (isLoading) {
    return <Skeleton className="h-48 w-full" />;
  }
  if (!data || !data.inWindow) return null;

  if (data.racePassed) {
    return <PostRaceRecovery data={data} raceKind={raceKind} />;
  }
  if (data.isRaceDay) {
    return <RaceDayHero data={data} raceKind={raceKind} />;
  }
  return <RaceWeekCountdown data={data} raceKind={raceKind} />;
}

function RaceWeekCountdown({
  data,
  raceKind,
}: {
  data: RaceWeekStatus;
  raceKind: DashboardRaceKind | null;
}) {
  const showHours = data.daysToRace <= 7;
  // Marathon collapses to the existing "Race Week" copy so flagship
  // marathon framing is unchanged; shorter races prepend the kind so a
  // 5K / 10K / Half campaign reads "Half Marathon · Race Week".
  const eyebrow =
    raceKind && raceKind !== "marathon"
      ? `${RACE_KIND_LABELS[raceKind]} · Race Week`
      : "Race Week";
  // Task #241: per-kind banner palette + icon. Marathon collapses to
  // the existing primary/Flag flagship look so unchanged.
  const theme = bannerTheme(raceKind);
  const Icon = theme.Icon;
  return (
    <Card
      className={cn(theme.countdown.card, "overflow-hidden")}
      data-testid="race-week-banner"
      data-banner-kind={raceKind ?? "marathon"}
    >
      <CardContent className="p-6 space-y-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className={cn("rounded-md p-2", theme.countdown.iconBg)}>
              <Icon className={cn("h-6 w-6", theme.countdown.iconColor)} />
            </div>
            <div>
              <p
                className={cn(
                  "text-xs uppercase tracking-[0.2em] font-bold",
                  theme.countdown.eyebrowColor,
                )}
                data-testid="race-week-eyebrow"
                data-race-kind={raceKind ?? ""}
              >
                {eyebrow}
              </p>
              <h2 className="text-xl md:text-2xl font-black uppercase tracking-wider">
                Final Approach
              </h2>
            </div>
          </div>
          <div className="flex items-baseline gap-3 md:gap-4 flex-wrap">
            <div className="flex items-baseline gap-1.5">
              <span
                className={cn(
                  "text-4xl md:text-5xl font-black tabular-nums leading-none",
                  theme.countdown.daysColor,
                )}
                data-testid="race-week-days"
              >
                {data.daysToRace}
              </span>
              <span className="text-xs uppercase tracking-wider font-bold text-muted-foreground">
                day{data.daysToRace === 1 ? "" : "s"}
              </span>
            </div>
            {showHours && (
              <div className="flex items-baseline gap-1.5" data-testid="race-week-hours">
                <span className="text-2xl md:text-3xl font-black tabular-nums leading-none">
                  {data.hoursToRace}
                </span>
                <span className="text-xs uppercase tracking-wider font-bold text-muted-foreground">
                  hr
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider font-bold text-muted-foreground">
              <ListChecks className="h-4 w-4" />
              Taper Checklist
            </div>
            {(() => {
              const done = data.checklist.filter((c) => c.checked).length;
              const total = data.checklist.length;
              const remaining = total - done;
              if (remaining === 0) return (
                <span className="text-[10px] uppercase tracking-wider font-bold text-emerald-600 dark:text-emerald-400">
                  All done
                </span>
              );
              if (data.daysToRace <= 2 && remaining > 0) return (
                <span className="text-[10px] uppercase tracking-wider font-bold text-amber-600 dark:text-amber-400" data-testid="checklist-nudge">
                  {remaining} item{remaining === 1 ? "" : "s"} left — race is close!
                </span>
              );
              return (
                <span className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">
                  {done}/{total} complete
                </span>
              );
            })()}
          </div>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {data.checklist.map((item) => (
              <ChecklistRow key={item.itemId} item={item} />
            ))}
          </ul>
          <AddChecklistItem />
        </div>
      </CardContent>
    </Card>
  );
}

function PostRaceRecovery({
  data,
  raceKind,
}: {
  data: RaceWeekStatus;
  raceKind: DashboardRaceKind | null;
}) {
  // Marathon collapses to the existing "Race Complete" copy; shorter
  // races call out the kind so post-race framing reads e.g. "5K
  // Complete — Day 2 Recovery" instead of generic "Race Complete".
  const completedLabel =
    raceKind && raceKind !== "marathon"
      ? `${RACE_KIND_LABELS[raceKind]} Complete`
      : "Race Complete";
  const daysAfter = data.daysAfterRace ?? 0;
  // Task #241: per-kind icon accent on the post-race banner so a 5K
  // / 10K / Half campaign keeps its branding through recovery. The
  // emerald recovery palette stays on the surface + body copy so the
  // "Recovery Mode" semantic isn't lost; only the icon picks up the
  // kind tone.
  const theme = bannerTheme(raceKind);
  const Icon = theme.Icon;
  return (
    <Card
      className="border-emerald-500/40 bg-gradient-to-br from-emerald-500/15 via-emerald-500/5 to-background overflow-hidden"
      data-testid="post-race-banner"
      data-banner-kind={raceKind ?? "marathon"}
    >
      <CardContent className="p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className={cn("rounded-md p-2", theme.recoveryIconBg)}>
            <Icon className={cn("h-6 w-6", theme.recoveryIconColor)} />
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.2em] font-bold text-emerald-600 dark:text-emerald-400">
              Recovery Mode
            </p>
            <h2
              className="text-xl md:text-2xl font-black uppercase tracking-wider"
              data-testid="post-race-headline"
              data-race-kind={raceKind ?? ""}
            >
              {completedLabel} — Day {daysAfter} Recovery
            </h2>
          </div>
        </div>

        <RaceResultSection result={data.raceResult ?? null} />

        <div className="space-y-2 text-sm text-muted-foreground" data-testid="post-race-recovery-guidance">
          <p>Focus on gentle movement, hydration, and nutrition. Your body earned this rest.</p>
          {daysAfter <= 3 && (
            <p className="text-emerald-600 dark:text-emerald-400 font-bold uppercase text-xs tracking-wider" data-testid="recovery-phase-1">
              Days 1-3: Walk only. Ice sore spots. Eat well. Sleep extra.
            </p>
          )}
          {daysAfter > 3 && daysAfter <= 7 && (
            <p className="text-emerald-600 dark:text-emerald-400 font-bold uppercase text-xs tracking-wider" data-testid="recovery-phase-2">
              Days 4-7: Light movement OK. No intensity. Listen to your body.
            </p>
          )}
          {daysAfter > 7 && (
            <p className="text-emerald-600 dark:text-emerald-400 font-bold uppercase text-xs tracking-wider" data-testid="recovery-phase-3">
              Week 2+: Gradually return to easy efforts. No racing for 2-4 weeks.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function RaceResultSection({ result }: { result: RaceResult | null }) {
  // Local edit-mode toggle so the runner can re-open the form to amend
  // a saved result. Defaults to "show form" when no result exists yet.
  const [editing, setEditing] = useState(result == null);
  // Whenever the server payload changes (e.g. after a successful save
  // refetch), collapse back into the saved-summary view so the runner
  // sees their captured result rather than the still-open form.
  useEffect(() => {
    if (result != null) setEditing(false);
  }, [result?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  if (result && !editing) {
    return (
      <SavedRaceResult result={result} onEdit={() => setEditing(true)} />
    );
  }
  return (
    <RaceResultForm
      initial={result}
      onCancel={result ? () => setEditing(false) : undefined}
    />
  );
}

// Task #265. Format a signed second-delta back into a "−1:43" /
// "+0:08" string for the PR comparison line. Mirrors the server-side
// `formatSignedDelta` helper in race-week.ts so the post-race banner
// can render the comparison without an extra round-trip.
function formatSignedDelta(deltaSeconds: number): string {
  const sign = deltaSeconds < 0 ? "−" : deltaSeconds > 0 ? "+" : "±";
  const abs = Math.abs(deltaSeconds);
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = abs % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${sign}${h}:${mm}:${ss}` : `${sign}${mm}:${ss}`;
}

function SavedRaceResult({
  result,
  onEdit,
}: {
  result: RaceResult;
  onEdit: () => void;
}) {
  const placement =
    result.placementOverall != null
      ? result.placementTotal != null
        ? `${result.placementOverall} / ${result.placementTotal}`
        : `${result.placementOverall}`
      : null;
  // Task #265. Show the PR celebration badge whenever the server
  // flagged this row as a new personal record for its race kind. The
  // comparison line below ("−1:43 vs prior best 2:15:51") renders any
  // time we have a previous best to compare against — so a slower
  // finish still gets context, just without the badge.
  const isPR = result.isPersonalRecord === true;
  const previousBest = result.previousBest ?? null;
  return (
    <div
      className="rounded-md border border-emerald-500/30 bg-background/60 p-4 space-y-3"
      data-testid="race-result-summary"
      data-is-personal-record={isPR ? "true" : "false"}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-xs uppercase tracking-wider font-bold text-emerald-600 dark:text-emerald-400">
            Race Result
          </p>
          {isPR ? (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-[0.2em] border border-amber-500/50 bg-amber-500/15 text-amber-700 dark:text-amber-400"
              data-testid="race-result-pr-badge"
              title={
                previousBest
                  ? `New personal record — beat your prior best of ${previousBest.finishTime}`
                  : "New personal record"
              }
            >
              <Award className="h-3 w-3" />
              PR!
            </span>
          ) : null}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onEdit}
          data-testid="edit-race-result"
          className="h-7 px-2 text-xs"
        >
          <Pencil className="h-3 w-3 mr-1" />
          Edit
        </Button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <ResultStat label="Finish" value={result.finishTime ?? "—"} testId="race-result-finish-time" />
        <ResultStat label="Place" value={placement ?? "—"} testId="race-result-placement" />
        <ResultStat
          label="Felt"
          value={result.feltRating != null ? `${result.feltRating} / 5` : "—"}
          testId="race-result-felt"
        />
      </div>
      {previousBest ? (
        <p
          className={cn(
            "text-xs uppercase tracking-wider font-bold",
            isPR
              ? "text-amber-700 dark:text-amber-400"
              : "text-muted-foreground",
          )}
          data-testid="race-result-pr-comparison"
          data-delta-seconds={previousBest.deltaSeconds}
        >
          {formatSignedDelta(previousBest.deltaSeconds)} vs prior best{" "}
          {previousBest.finishTime}
        </p>
      ) : null}
      {result.notes ? (
        <p
          className="text-sm text-muted-foreground italic border-t border-emerald-500/20 pt-3 whitespace-pre-line"
          data-testid="race-result-notes"
        >
          {result.notes}
        </p>
      ) : null}
    </div>
  );
}

function ResultStat({
  label,
  value,
  testId,
}: {
  label: string;
  value: string;
  testId: string;
}) {
  return (
    <div className="rounded-md bg-background/60 border border-border p-3" data-testid={testId}>
      <p className="text-xs uppercase tracking-wider font-bold text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-base font-black">{value}</p>
    </div>
  );
}

function RaceResultForm({
  initial,
  onCancel,
}: {
  initial: RaceResult | null;
  onCancel?: () => void;
}) {
  const queryClient = useQueryClient();
  const queryKey = getGetRaceWeekQueryKey();
  const { toast } = useToast();
  const [finishTime, setFinishTime] = useState(initial?.finishTime ?? "");
  const [placementOverall, setPlacementOverall] = useState(
    initial?.placementOverall != null ? String(initial.placementOverall) : "",
  );
  const [placementTotal, setPlacementTotal] = useState(
    initial?.placementTotal != null ? String(initial.placementTotal) : "",
  );
  const [feltRating, setFeltRating] = useState<number | null>(
    initial?.feltRating ?? null,
  );
  const [notes, setNotes] = useState(initial?.notes ?? "");

  const mutation = useSetRaceResult({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey });
        toast({ title: "Race result saved", description: "Recovery on. Earned." });
      },
      onError: () => {
        toast({ title: "Could not save race result", variant: "destructive" });
      },
    },
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const overall = placementOverall.trim() ? Number(placementOverall) : null;
    const total = placementTotal.trim() ? Number(placementTotal) : null;
    if (overall != null && !Number.isFinite(overall)) {
      toast({ title: "Placement must be a number", variant: "destructive" });
      return;
    }
    if (total != null && !Number.isFinite(total)) {
      toast({ title: "Field size must be a number", variant: "destructive" });
      return;
    }
    mutation.mutate({
      data: {
        finishTime: finishTime.trim() || null,
        placementOverall: overall,
        placementTotal: total,
        feltRating,
        notes: notes.trim() || null,
      },
    });
  };

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-md border border-emerald-500/30 bg-background/60 p-4 space-y-4"
      data-testid="race-result-form"
    >
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-wider font-bold text-emerald-600 dark:text-emerald-400">
          {initial ? "Edit Race Result" : "Log Your Race"}
        </p>
        {onCancel ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onCancel}
            className="h-7 px-2 text-xs"
            data-testid="race-result-cancel"
          >
            Cancel
          </Button>
        ) : null}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="race-result-finish">Finish time</Label>
          <Input
            id="race-result-finish"
            placeholder="2:14:08"
            value={finishTime}
            onChange={(e) => setFinishTime(e.target.value)}
            data-testid="input-finish-time"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="race-result-place">Placement</Label>
          <Input
            id="race-result-place"
            inputMode="numeric"
            placeholder="312"
            value={placementOverall}
            onChange={(e) => setPlacementOverall(e.target.value)}
            data-testid="input-placement-overall"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="race-result-total">Field size</Label>
          <Input
            id="race-result-total"
            inputMode="numeric"
            placeholder="1804"
            value={placementTotal}
            onChange={(e) => setPlacementTotal(e.target.value)}
            data-testid="input-placement-total"
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>How did it feel?</Label>
        <div className="flex gap-2" data-testid="felt-rating">
          {[1, 2, 3, 4, 5].map((n) => (
            <Button
              key={n}
              type="button"
              variant={feltRating === n ? "default" : "outline"}
              size="sm"
              onClick={() => setFeltRating(feltRating === n ? null : n)}
              data-testid={`felt-rating-${n}`}
              className="h-9 w-9 p-0 font-black"
            >
              {n}
            </Button>
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="race-result-notes">Notes</Label>
        <Textarea
          id="race-result-notes"
          placeholder="Splits, weather, fueling, what worked, what didn't..."
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          data-testid="input-notes"
        />
      </div>
      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={mutation.isPending}
          data-testid="submit-race-result"
        >
          {mutation.isPending ? "Saving..." : initial ? "Update result" : "Save result"}
        </Button>
      </div>
    </form>
  );
}

function RaceDayHero({
  data,
  raceKind,
}: {
  data: RaceWeekStatus;
  raceKind: DashboardRaceKind | null;
}) {
  const plan = data.racePlan;
  // Task #201: surface the per-kind label ("5K Day" / "10K Day" /
  // "Half Marathon Day" / "Marathon Day") in the eyebrow above the
  // race-day headline so the dashboard hero matches the actual
  // distance the runner is racing today, not a hardcoded "Race Day".
  // Falls back to the generic "Race Day" eyebrow only when the plan
  // row is missing or its distance doesn't match a real race kind.
  const race = plan ? raceDayLabel(plan.distanceMi, plan.description) : null;
  const eyebrow = race ? race.label : "Race Day";
  // Task #241: per-kind hero palette + icon. Prefer the prop (single
  // source of truth from the dashboard summary) and fall back to the
  // detected race kind from the plan distance for older callers.
  const themeKind: DashboardRaceKind | null =
    raceKind ?? (race?.kind as DashboardRaceKind | undefined) ?? null;
  const theme = bannerTheme(themeKind);
  const Icon = theme.Icon;
  return (
    <Card
      className={cn(theme.hero.card, "overflow-hidden")}
      data-testid="race-day-hero"
      data-banner-kind={themeKind ?? "marathon"}
    >
      <CardContent className="p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className={cn("rounded-md p-2", theme.hero.iconBg)}>
            <Icon className={cn("h-6 w-6", theme.hero.iconColor)} />
          </div>
          <div>
            <p
              className={cn(
                "text-xs uppercase tracking-[0.2em] font-bold",
                theme.hero.eyebrowColor,
              )}
              data-testid="race-day-hero-eyebrow"
              data-race-kind={race?.kind ?? "unknown"}
            >
              {eyebrow}
            </p>
            <h2 className="text-2xl md:text-3xl font-black uppercase tracking-wider">
              Today is the day. Execute.
            </h2>
          </div>
        </div>

        {plan ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Task #233: the sibling Distance + Fueling tiles pick up
                a hairline accent in the same race-kind zone tone via
                `accentZoneBucket` (border + eyebrow-label color only,
                no full bg wash) so the runner reads the whole race-day
                stat trio as one toned unit while the Target Pace tile
                still carries the louder full tone from Task #227. */}
            <PlanStat
              label="Distance"
              value={formatDistance(plan.distanceMi)}
              accentZoneBucket={race?.zoneBucket}
              testId="race-day-distance"
            />
            {/* Task #227: race-week pace chip picks up the runner's
                actual race-kind zone tone (5K → VO2 red, 10K →
                threshold orange, marathon-pace → steady amber) instead
                of the generic muted card surface. The bucket is looked
                up from `race?.zoneBucket` (single source of truth in
                race-day-label.ts) so every surface that paints this
                chip — dashboard hero, Today's Mission Brief, the
                week-detail day card — stays in lockstep. Falls back to
                untoned styling when the row isn't a recognised race
                kind. */}
            <PlanStat
              label="Target Pace"
              value={plan.targetPace ? `${plan.targetPace}/mi` : "Run by feel"}
              zoneBucket={race?.zoneBucket}
              testId="race-day-target-pace"
            />
            <PlanStat
              label="Fueling"
              value={plan.fuelingNote ?? "Per plan"}
              accentZoneBucket={race?.zoneBucket}
              testId="race-day-fueling"
            />
          </div>
        ) : null}

        {plan?.description && (
          <p className="text-sm text-muted-foreground italic border-t border-border pt-4">
            {plan.description}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function PlanStat({
  label,
  value,
  zoneBucket,
  accentZoneBucket,
  testId,
}: {
  label: string;
  value: string;
  // Task #227: when set, the chip wrapper picks up the zone-N tone
  // (border + bg + label color) from HR_ZONE_TONES instead of the
  // generic background/border. Used by the race-day Target Pace chip
  // to communicate that 5K race pace is meant to feel VO2 (red) etc.
  zoneBucket?: 1 | 2 | 3 | 4 | 5;
  // Task #233: hairline-accent variant. When set (and `zoneBucket` is
  // not), the chip keeps the muted background but borrows just the
  // border + eyebrow-label color from HR_ZONE_TONES so the sibling
  // race-day stat tiles (Distance, Fueling) read as part of the same
  // toned trio as the louder Target Pace chip without competing with
  // it visually.
  accentZoneBucket?: 1 | 2 | 3 | 4 | 5;
  testId?: string;
}) {
  const tone = zoneBucket != null ? HR_ZONE_TONES[zoneBucket] : null;
  const accent =
    tone == null && accentZoneBucket != null
      ? HR_ZONE_TONES[accentZoneBucket]
      : null;
  return (
    <div
      className={cn(
        "rounded-md border p-4",
        tone
          ? cn(tone.borderClass, tone.bgClass)
          : accent
            ? cn("bg-background/60", accent.borderClass)
            : "bg-background/60 border-border",
      )}
      data-testid={testId}
      data-zone-bucket={zoneBucket ?? undefined}
      data-accent-zone-bucket={accentZoneBucket ?? undefined}
    >
      <p
        className={cn(
          "text-xs uppercase tracking-wider font-bold",
          tone
            ? tone.labelClass
            : accent
              ? accent.labelClass
              : "text-muted-foreground",
        )}
      >
        {label}
      </p>
      <p className="mt-1 text-lg font-black">{value}</p>
      {/* Task #234: decode the zone tone with a one-line caption using
          the same Z3/Z4/Z5 + threshold/VO2 vocabulary used elsewhere
          (Settings preview, RunTargetLine) so the dashboard runner
          learns red 5K means VO2 / amber marathon means settle in,
          rather than the colors looking purely decorative. */}
      {tone ? (
        <p
          className={cn(
            "mt-1 text-[10px] uppercase font-bold tracking-wider",
            tone.labelClass,
          )}
          data-testid={testId ? `${testId}-zone-hint` : undefined}
        >
          {tone.description}
        </p>
      ) : null}
    </div>
  );
}

function ChecklistRow({ item }: { item: RaceWeekChecklistItem }) {
  const queryClient = useQueryClient();
  const queryKey = getGetRaceWeekQueryKey();
  const toggleMutation = useSetRaceWeekChecklistItem({
    mutation: {
      onMutate: async ({ itemId, data }) => {
        await queryClient.cancelQueries({ queryKey });
        const prev = queryClient.getQueryData<RaceWeekStatus>(queryKey);
        if (prev) {
          queryClient.setQueryData<RaceWeekStatus>(queryKey, {
            ...prev,
            checklist: prev.checklist.map((c) =>
              c.itemId === itemId
                ? {
                    ...c,
                    checked: data.checked,
                    checkedAt: data.checked ? new Date().toISOString() : null,
                  }
                : c,
            ),
          });
        }
        return { prev };
      },
      onError: (_err, _vars, ctx) => {
        if (ctx?.prev) queryClient.setQueryData(queryKey, ctx.prev);
      },
      onSettled: () => {
        queryClient.invalidateQueries({ queryKey });
      },
    },
  });

  const deleteMutation = useDeleteRaceWeekChecklistItem({
    mutation: {
      onMutate: async ({ itemId }) => {
        await queryClient.cancelQueries({ queryKey });
        const prev = queryClient.getQueryData<RaceWeekStatus>(queryKey);
        if (prev) {
          queryClient.setQueryData<RaceWeekStatus>(queryKey, {
            ...prev,
            checklist: prev.checklist.filter((c) => c.itemId !== itemId),
          });
        }
        return { prev };
      },
      onError: (_err, _vars, ctx) => {
        if (ctx?.prev) queryClient.setQueryData(queryKey, ctx.prev);
      },
      onSettled: () => {
        queryClient.invalidateQueries({ queryKey });
      },
    },
  });

  const toggle = () => {
    toggleMutation.mutate({ itemId: item.itemId, data: { checked: !item.checked } });
  };

  const remove = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    deleteMutation.mutate({ itemId: item.itemId });
  };

  return (
    <li>
      <label
        className="flex items-start gap-3 cursor-pointer rounded-md border border-border bg-background/60 hover:bg-background hover:border-primary/40 transition-colors px-3 py-2.5"
        data-testid={`race-week-checklist-${item.itemId}`}
        data-is-custom={item.isCustom ? "true" : "false"}
      >
        <Checkbox
          checked={item.checked}
          onCheckedChange={toggle}
          className="mt-0.5"
          data-testid={`race-week-checklist-checkbox-${item.itemId}`}
        />
        <span
          className={
            "text-sm leading-tight flex-1 " +
            (item.checked
              ? "line-through text-muted-foreground"
              : "text-foreground")
          }
        >
          {item.label}
        </span>
        {item.isCustom && (
          <button
            type="button"
            onClick={remove}
            className="text-muted-foreground hover:text-destructive transition-colors p-0.5 -m-0.5 rounded"
            aria-label={`Delete ${item.label}`}
            data-testid={`race-week-checklist-delete-${item.itemId}`}
            disabled={deleteMutation.isPending}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </label>
    </li>
  );
}

function AddChecklistItem() {
  const queryClient = useQueryClient();
  const queryKey = getGetRaceWeekQueryKey();
  const [label, setLabel] = useState("");
  const createMutation = useCreateRaceWeekChecklistItem({
    mutation: {
      onSuccess: () => {
        setLabel("");
        queryClient.invalidateQueries({ queryKey });
      },
    },
  });

  const trimmed = label.trim();
  const canSubmit = trimmed.length > 0 && !createMutation.isPending;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    createMutation.mutate({ data: { label: trimmed } });
  };

  return (
    <form
      onSubmit={submit}
      className="flex items-center gap-2 pt-1"
      data-testid="race-week-checklist-add-form"
    >
      <Input
        type="text"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Add your own item (e.g. Pick up bib)"
        maxLength={200}
        className="h-9 text-sm"
        data-testid="race-week-checklist-add-input"
      />
      <Button
        type="submit"
        size="sm"
        disabled={!canSubmit}
        data-testid="race-week-checklist-add-submit"
      >
        <Plus className="h-4 w-4 mr-1" />
        Add
      </Button>
    </form>
  );
}
