import {
  useGetTodayPlan,
  useGetPlanOverview,
  useGetRaceWeek,
  useUpsertRaceResult,
  getGetRaceWeekQueryKey,
  getListRaceResultsQueryKey,
  getListScheduledRacesQueryKey,
  getGetTodayPlanQueryKey,
  getGetPlanOverviewQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import type { RaceDayKind } from "@/lib/race-day-label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDistance, formatLoad } from "@/lib/format";
import { CheckCircle2, Activity, Trash2, Edit, Zap, Pencil, XCircle, Rocket, Sparkles, Trophy, Wand2 } from "lucide-react";
import { useMissionActions } from "@/hooks/use-mission-actions";
import { QuickLogActivity } from "@/components/quick-log-activity";
import { EatToday } from "@/components/eat-today";
import { NutritionistPanel } from "@/components/nutritionist-panel";
import { TimeOfDayBadge } from "@/components/time-of-day-badge";
import { PlannedBreakdown } from "@/components/planned-breakdown";
import { ActualBreakdown } from "@/components/actual-breakdown";
import { PrimaryMetricDisplay } from "@/components/primary-metric-display";
import { SessionDetailDisclosure } from "@/components/session-detail-disclosure";
import { EquipmentChipRail } from "@/components/equipment-chip-rail";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  getPrimaryMetric,
  getPrimaryMetricCompare,
} from "@/lib/primary-metric";
import { RunTargetLine } from "@/components/run-target-line";
import { sessionVerdict, type VerdictBucket } from "@/lib/session-verdict";
import { raceDayLabel } from "@/lib/race-day-label";
import { ChecklistNudge } from "@/components/race-week-banner";
import { EmptyPlanState } from "@/components/empty-plan-state";
import { NextScheduledRaceChip } from "@/components/next-scheduled-race-chip";
import { useFirstRunRedirect } from "@/hooks/use-first-run-redirect";
import { useListPlannerConfigs } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { format, parseISO } from "date-fns";

export default function Today() {
  const { data: today, isLoading } = useGetTodayPlan();
  // Task #307: TodayPlan.hasPlan is per-day (only checks today's plan
  // rows). To distinguish "no campaign exists at all" (show the
  // EmptyPlanState CTA) from "campaign exists but today is a rest day"
  // (keep the original rest-day card), we additionally consult the
  // campaign-level overview.hasPlan flag.
  const { data: overview } = useGetPlanOverview();
  const campaignHasPlan = overview ? overview.hasPlan : true;
  // Behavior rehaul R2. Authoritative "this plan includes running" flag.
  // Running is opt-in; the default plan is strength + recomp with zero
  // miles. Gate the run-only Adjust Pace control and the pre-launch
  // "campaign" countdown framing on this so a recomp runner gets a calm
  // "Starts <date>" line, not a race countdown.
  const includesRunning = overview ? overview.includesRunning : false;
  const { openLog, openEdit, requestDelete, requestSkip, crushIt, isDeleting, isCrushing, dialogs } =
    useMissionActions();

  // Adjust-from-anywhere (Phase 6): open the Claude plan builder pre-seeded
  // with a context message about this day/session ("Make Wednesday shorter",
  // "swap the bike for the row", "I'm sore today"). The builder reads ?seed=
  // on mount and pre-fills the chat input; the runner sends/edits from there.
  const askAiToAdjust = (seed: string) => {
    window.location.assign(`/planner?seed=${encodeURIComponent(seed)}`);
  };

  // Task #345 review fix: open the same finish-time form on /today so
  // the runner can log a scheduled race result without bouncing to
  // /races. Mirrors the LogResultDraft / handleLogResult flow on
  // races.tsx and shares the upsert endpoint + invalidation set.
  const [logDraft, setLogDraft] = useState<{
    raceDate: string;
    raceKind: string;
    name: string | null | undefined;
    finishTime: string;
    placementOverall: string;
    placementTotal: string;
    feltRating: string;
    notes: string;
  } | null>(null);
  const upsertResult = useUpsertRaceResult();
  const qc = useQueryClient();
  const { toast } = useToast();
  const handleLogResult = () => {
    if (!logDraft) return;
    const parseIntOrInvalid = (s: string): number | null | "invalid" => {
      const t = s.trim();
      if (!t) return null;
      const n = Number(t);
      if (!Number.isInteger(n) || n < 1) return "invalid";
      return n;
    };
    const overall = parseIntOrInvalid(logDraft.placementOverall);
    const total = parseIntOrInvalid(logDraft.placementTotal);
    if (overall === "invalid" || total === "invalid") {
      toast({
        title: "Invalid placement",
        description: "Placements must be positive integers.",
        variant: "destructive",
      });
      return;
    }
    const feltRaw = logDraft.feltRating.trim();
    const feltRating = feltRaw ? Number(feltRaw) : null;
    if (
      feltRating != null &&
      (!Number.isInteger(feltRating) || feltRating < 1 || feltRating > 5)
    ) {
      toast({
        title: "Invalid felt rating",
        description: "Felt rating must be 1-5.",
        variant: "destructive",
      });
      return;
    }
    upsertResult.mutate(
      {
        raceDate: logDraft.raceDate,
        data: {
          finishTime: logDraft.finishTime.trim() || null,
          placementOverall: overall,
          placementTotal: total,
          feltRating,
          notes: logDraft.notes.trim() || null,
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Race result saved" });
          setLogDraft(null);
          qc.invalidateQueries({ queryKey: getListRaceResultsQueryKey() });
          qc.invalidateQueries({ queryKey: getListScheduledRacesQueryKey() });
          qc.invalidateQueries({ queryKey: getGetRaceWeekQueryKey() });
          qc.invalidateQueries({ queryKey: getGetTodayPlanQueryKey() });
          qc.invalidateQueries({ queryKey: getGetPlanOverviewQueryKey() });
        },
        onError: () => {
          toast({ title: "Could not save result", variant: "destructive" });
        },
      },
    );
  };
  const openLogDraftFor = (race: {
    raceDate: string;
    raceKind: string;
    name?: string | null;
  }) => {
    setLogDraft({
      raceDate: race.raceDate,
      raceKind: race.raceKind,
      name: race.name ?? null,
      finishTime: "",
      placementOverall: "",
      placementTotal: "",
      feltRating: "",
      notes: "",
    });
  };

  // Task #308: drop the runner straight into the Phase Planner on first
  // session load when no plan has ever been applied AND no planner
  // drafts exist. We gate on the campaign-level `overview.hasPlan`
  // (not `today.hasPlan`, which is per-day and would mis-fire on rest
  // days).
  const plannerConfigsQuery = useListPlannerConfigs();
  useFirstRunRedirect({
    hasPlan: overview?.hasPlan ?? false,
    hasDrafts: (plannerConfigsQuery.data?.configs?.length ?? 0) > 0,
    ready:
      overview !== undefined &&
      plannerConfigsQuery.data !== undefined &&
      !plannerConfigsQuery.isError,
  });

  if (isLoading) {
    return <div className="space-y-6"><Skeleton className="h-64" /></div>;
  }

  if (!today) {
    return <div>Failed to load plan</div>;
  }

  const sessions = today.loggedWorkouts ?? [];
  // Pre-launch countdown: when the API tells us today is before the first
  // scheduled session, take over the page with a dedicated countdown card so
  // the user has clear orientation during the gap. We hide both the plan card
  // (which would otherwise show a Mon rest day at the start of week 1) and
  // the generic "Rest Day" empty state in this window.
  const showCountdown =
    typeof today.daysUntilStart === "number" && today.daysUntilStart > 0 && !!today.firstSession;
  // Task #345 review fix: replace the regular Mission Brief framing on
  // race day. The "Race Day — Log result" CTA above takes over the page
  // so the runner isn't presented with a stale planned-session card
  // when the only thing that matters is logging the finish.
  const isRaceDayUnlogged =
    !!today.nextScheduledRace &&
    today.nextScheduledRace.raceDate === today.date &&
    !today.nextScheduledRace.hasResult;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-[1600px] mx-auto">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <TodayEyebrow raceKind={(today.raceKind ?? null) as RaceDayKind | null} />
          {today.nextScheduledRace && (
            <div className="mt-1">
              <NextScheduledRaceChip
                race={today.nextScheduledRace}
                onLogResult={() => openLogDraftFor(today.nextScheduledRace!)}
              />
            </div>
          )}
          <h2 className="text-4xl font-extrabold tracking-tight text-foreground">Today</h2>
          <p className="text-muted-foreground font-medium tracking-widest">{today.date}</p>
        </div>
        <div className="flex items-center gap-2">
          {campaignHasPlan && (
            <Button
              variant="outline"
              size="sm"
              className="text-xs font-bold tracking-wider"
              onClick={() => askAiToAdjust("Adjust my plan for today")}
              data-testid="button-today-ask-ai-adjust"
            >
              <Wand2 className="mr-1 h-3.5 w-3.5" />
              Ask AI to adjust
            </Button>
          )}
          {/* R2: Adjust Pace is a run-only control. Hidden on the default
              recomp plan, which has no programmed running pace. */}
          {campaignHasPlan && includesRunning && (
            <Button
              variant="outline"
              size="sm"
              className="text-xs font-bold tracking-wider"
              onClick={() => {
                window.location.assign("/plan?repace=1");
              }}
              data-testid="button-today-adjust-pace"
            >
              Adjust Pace
            </Button>
          )}
          <ChecklistNudge testId="today-checklist-reminder" />
        </div>
      </div>


      {/* R6: reactive "Eat today" block — today's AI-adjusted calorie + macro
          target, the one-line rationale, and progress vs actual intake. Lives
          near the top so the runner sees the day's fueling target before the
          session. Refreshes when a workout is logged via the day-target query
          key invalidation in useMissionActions. */}
      <EatToday date={today.date} />

      {/* Compact daily nutritionist verdict — protein status + the coach's
          one-line read, with a link into the full body-comp analysis on the
          Nutrition page. */}
      <NutritionistPanel variant="today" />

      {today.nextScheduledRace &&
        today.nextScheduledRace.raceDate === today.date &&
        !today.nextScheduledRace.hasResult && (
          <Card
            className="border-primary/40 bg-primary/5"
            data-testid="card-race-day-log-result"
          >
            <CardContent className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Trophy className="h-6 w-6 text-primary" />
                <div>
                  <p className="text-sm font-bold tracking-wider text-primary">
                    Race Day —{" "}
                    {RACE_KIND_LABELS[
                      today.nextScheduledRace.raceKind as RaceDayKind
                    ] ?? today.nextScheduledRace.raceKind.toUpperCase()}
                  </p>
                  {today.nextScheduledRace.name && (
                    <p className="text-xs text-muted-foreground">
                      {today.nextScheduledRace.name}
                    </p>
                  )}
                </div>
              </div>
              <Button
                onClick={() => openLogDraftFor(today.nextScheduledRace!)}
                data-testid="button-race-day-log-result"
              >
                Log result
              </Button>
            </CardContent>
          </Card>
        )}

      {showCountdown && today.firstSession ? (
        <Card
          className="border-primary/40 bg-primary/5"
          data-testid="card-campaign-countdown"
        >
          <CardHeader className="border-b border-border pb-4">
            <CardTitle className="text-lg tracking-wider text-primary flex items-center gap-2">
              <Rocket className="h-5 w-5" />
              {/* R2: drop the "Pre-Launch / campaign" framing on the
                  default recomp plan — just a calm "Starts soon". The
                  countdown framing stays for opted-in running plans. */}
              {includesRunning ? "Pre-Launch" : "Starts soon"}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5 space-y-4">
            {/* Phase 6: de-boxed + left-aligned. The number is the hero on a
                single tight line — no centered hero panel, no empty space. */}
            <div className="flex items-baseline gap-3">
              {includesRunning ? (
                <>
                  <p
                    className="text-4xl font-black text-primary leading-none tabular-nums"
                    data-testid="text-countdown-days"
                  >
                    {today.daysUntilStart}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {today.daysUntilStart === 1 ? "Day" : "Days"}
                    </span>{" "}
                    until your campaign starts
                  </p>
                </>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">
                    Starts
                  </p>
                  <p
                    className="text-2xl font-black text-primary leading-none"
                    data-testid="text-starts-date"
                  >
                    {format(parseISO(today.firstSession.date), "EEE MMM d")}
                  </p>
                </>
              )}
            </div>
            {/* Phase 6: de-boxed inner section — a hairline divider, not a
                nested bordered card. */}
            <div className="border-t border-border pt-4">
              <p className="text-xs text-muted-foreground font-bold tracking-wider mb-2">
                First Scheduled Session
              </p>
              <p className="text-lg font-black tracking-tight" data-testid="text-first-session-date">
                {format(parseISO(today.firstSession.date), "EEE MMM d")} —{" "}
                <span className="text-primary">{today.firstSession.sessionType}</span>
              </p>
              {today.firstSession.description && (
                <p className="text-sm text-muted-foreground mt-2">{today.firstSession.description}</p>
              )}
              {/* Task #238: mirror the Mission Brief race-day badge +
                  personalized vs catalog chip pair onto the pre-launch
                  First Scheduled Session preview for the rare campaign-
                  final-week edge case where the first scheduled session
                  is itself a race-day Sun. The IIFE returns null on
                  every non-race row so this is a no-op for normal
                  pre-launch previews (e.g. a Tue strength + cardio
                  first session). */}
              {(() => {
                const fs = today.firstSession!;
                const race = raceDayLabel(fs.distanceMi, fs.description, fs.sessionType);
                if (!race) return null;
                const prp = fs.personalizedRacePace ?? null;
                return (
                  <div className="flex flex-wrap items-center gap-2 mt-3">
                    <span
                      className="inline-flex items-center gap-1 text-[10px] bg-primary/15 text-primary px-2 py-1 rounded font-bold tracking-wider w-fit"
                      data-testid={`badge-race-day-first-session-${fs.date}`}
                      data-race-kind={race.kind}
                    >
                      <Activity className="h-3 w-3" />
                      {race.label}
                    </span>
                    {prp && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded font-bold tracking-wider w-fit cursor-help",
                              prp.source === "personalized"
                                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                                : "bg-muted text-muted-foreground",
                            )}
                            data-testid={`badge-race-pace-source-first-session-${fs.date}`}
                            data-pace-source={prp.source}
                            data-personalized-pace={prp.pace}
                          >
                            <Sparkles className="h-3 w-3" />
                            {prp.source === "personalized"
                              ? `${prp.pace}/mi · Personalized`
                              : `${prp.pace}/mi · From catalog`}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent
                          side="top"
                          align="start"
                          className="max-w-xs text-xs"
                        >
                          {prp.source === "personalized" && prp.basisPaceSeconds != null ? (
                            <span>
                              Personalized from {prp.sampleSize} quality run
                              {prp.sampleSize === 1 ? "" : "s"} (tempo / threshold /
                              interval / VO2 / race) in the last {prp.lookbackWeeks} weeks.
                              Avg training pace{" "}
                              <span className="font-mono font-bold">
                                {Math.floor(prp.basisPaceSeconds / 60)}:
                                {String(prp.basisPaceSeconds % 60).padStart(2, "0")}
                              </span>
                              /mi → race-day target{" "}
                              <span className="font-mono font-bold">{prp.pace}</span>/mi.
                            </span>
                          ) : (
                            <span>
                              Showing the catalog {race.label.toLowerCase()} pace —
                              not enough recent quality runs in the last{" "}
                              {prp.lookbackWeeks} weeks to personalize. Log a few
                              tempo / threshold / interval workouts and this chip
                              will retune to your training.
                            </span>
                          )}
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                );
              })()}
              {/* Phase 7: prominent equipment rail on the pre-launch preview
                  too, so the runner knows which machine(s) the first session
                  uses before the campaign even starts. */}
              {((today.firstSession.equipmentList &&
                today.firstSession.equipmentList.length > 0) ||
                today.firstSession.equipment) && (
                <div className="mt-4 flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-bold tracking-widest text-muted-foreground">
                    EQUIPMENT
                  </span>
                  <EquipmentChipRail
                    equipmentList={today.firstSession.equipmentList}
                    equipment={today.firstSession.equipment}
                    chipTestIdPrefix={`chip-equipment-first-prominent-${today.firstSession.date}`}
                    railTestId="chip-rail-first-prominent"
                    keyPrefix="first-prom-eq"
                  />
                </div>
              )}

              {/* Slim collapsed view (Task #133): just the one headline
                  number for the first session. Equipment chips, the
                  planned minute breakdown, and the strength / total load
                  tiles all live behind "Show details" below. */}
              <div className="mt-4">
                <PrimaryMetricDisplay
                  metric={getPrimaryMetric(today.firstSession)}
                  variant="prominent"
                  testIdPrefix="first-session"
                />
              </div>
              <div className="mt-4">
                <SessionDetailDisclosure testId="toggle-first-session-detail">
                  <div className="space-y-4">
                    <EquipmentChipRail
                      equipmentList={today.firstSession.equipmentList}
                      equipment={today.firstSession.equipment}
                      chipTestIdPrefix={`chip-equipment-${today.firstSession.date}`}
                      keyPrefix="first-eq"
                    />
                    <RunTargetLine
                      sessionType={today.firstSession.sessionType}
                      week={today.firstSession.week}
                      runMin={today.firstSession.runMin}
                      distanceMi={today.firstSession.distanceMi}
                      // Task #235: when the first scheduled session
                      // happens to be a race-day Sun (campaign-final
                      // week edge case), prefer the personalized pace
                      // overlay over the seeded catalog value so the
                      // pre-launch preview matches the race-day chip
                      // the runner will see on /plan and /today.
                      // Task #239: also honor the Sun long-run overlay
                      // when the first scheduled session happens to
                      // be a Sun "Long Run" — the three overlays are
                      // mutually exclusive so precedence is symbolic.
                      pace={
                        today.firstSession.personalizedRacePace?.pace ??
                        today.firstSession.personalizedLongRunPace?.pace ??
                        today.firstSession.pace
                      }
                      variant="prominent"
                      testId="first-session-run-target"
                      // Task #227: when the first scheduled session
                      // happens to be a race-day Sun (rare — campaign-
                      // final week), recolor the chip to the race-kind
                      // zone tone so the pre-launch preview already
                      // signals the right effort.
                      zoneBucket={
                        raceDayLabel(
                          today.firstSession.distanceMi,
                          today.firstSession.description,
                          today.firstSession.sessionType,
                        )?.zoneBucket
                      }
                    />
                    <PlannedBreakdown
                      totalMin={today.firstSession.totalMin}
                      strengthMin={today.firstSession.strengthMin}
                      cardioMin={today.firstSession.cardioMin}
                      runMin={today.firstSession.runMin}
                      runDistanceMi={today.firstSession.distanceMi}
                      date={today.firstSession.date}
                      variant="prominent"
                      testIdPrefix="first-session"
                    />
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                      {today.firstSession.distanceMi != null && today.firstSession.distanceMi > 0 && (
                        <div>
                          <p className="text-xs text-muted-foreground font-bold tracking-wider">Distance</p>
                          <p className="text-base font-black">{formatDistance(today.firstSession.distanceMi)}</p>
                        </div>
                      )}
                      {today.firstSession.strengthLoad != null && today.firstSession.strengthLoad > 0 && (
                        <div>
                          <p className="text-xs text-muted-foreground font-bold tracking-wider">Strength Load</p>
                          <p className="text-base font-black">{today.firstSession.strengthLoad}</p>
                        </div>
                      )}
                      {today.firstSession.totalLoad > 0 && (
                        <div>
                          <p className="text-xs text-muted-foreground font-bold tracking-wider">Total Load</p>
                          <p className="text-base font-black">{formatLoad(today.firstSession.totalLoad)}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </SessionDetailDisclosure>
              </div>
            </div>
            <p className="text-sm text-muted-foreground italic">
              Use this window to dial in nutrition, sleep, and gear.
            </p>
          </CardContent>
        </Card>
      ) : !campaignHasPlan ? (
        <EmptyPlanState
          description="Build your first training plan in the Phase Planner — pick programs, set the dates, and apply to schedule today's session."
          testId="today-empty-plan"
        />
      ) : !today.hasPlan ? (
        // Phase 6: tasteful, compact empty state — a quiet line, not a giant
        // dashed panel.
        <div className="flex items-center gap-3 py-6 text-muted-foreground">
          <Activity className="h-6 w-6 opacity-60" />
          <div>
            <h3 className="text-base font-bold tracking-tight text-foreground">Rest Day</h3>
            <p className="text-sm">Recover and rebuild — no planned session today.</p>
          </div>
        </div>
      ) : null}

      <QuickLogActivity testIdSuffix="today" />

      {today.hasPlan && !showCountdown && !isRaceDayUnlogged && (
        <div className="grid gap-6">
          {/* Task #135 + #143: render one Mission Brief card per concurrent
              program. `plans[]` is ordered by sourceEntryIndex so the
              lowest-index program (typically the legacy run program)
              renders first. When multiple programs overlap each card
              shows its program name as a header badge ("TONAL LIFT",
              "5K IMPROVER") so the runner can tell which session
              belongs to which template. EVERY card now exposes its own
              Crushed/Log/Skip buttons that link the resulting workout
              back to that specific plan_day via planDayId so dashboards
              and adherence math can attribute completion per program.

              Each card uses the slim collapsed view (Task #133): title +
              the one headline number via PrimaryMetricDisplay. Equipment
              chips, planned minute breakdown, distance, strength load
              and total load all live in the "Show details" disclosure
              below so the card stays scannable. */}
          {(today.plans && today.plans.length > 0
            ? today.plans
            : today.plan
              ? [today.plan]
              : []
          ).map((plan, planIdx) => {
            // Task #143: per-program completion. A plan card's
            // hasSessions is now keyed off workouts that link back to
            // THIS plan_day (via plan_day_id) so each concurrent
            // program's button label reflects its own state. Legacy /
            // unattributed workouts (planDayId == null) are credited to
            // the lowest-index plan card so the existing single-program
            // single-log behaviour is unchanged.
            const cardSessions = sessions.filter(
              (s) => s.planDayId === plan.id || (s.planDayId == null && planIdx === 0),
            );
            const hasSessions = cardSessions.length > 0;
            // Suggestions are computed server-side for the lowest-index
            // plan_day; share them only with that primary card so the
            // history-based pace pre-fill keeps working there. Other
            // concurrent cards get null suggestions — they'll still
            // pre-fill from the plan_day's prescribed values.
            const planSuggestions = planIdx === 0 ? today.suggestions : null;
            const ctx = { date: today.date, plan, suggestions: planSuggestions };
            return (
            <Card
              key={`today-plan-${plan.id}`}
              className="border-primary/20 bg-primary/5 border-l-4 border-l-primary shadow-card-lg"
              data-testid={`card-mission-brief-${plan.sourceEntryIndex}`}
            >
              <CardHeader>
                <CardTitle className="text-lg tracking-wider text-primary flex items-center gap-3 flex-wrap">
                  <span>Today's session</span>
                  {plan.sourceEntryLabel && (today.plans?.length ?? 0) > 1 && (
                    <span
                      className="px-2 py-0.5 text-xs bg-primary/15 text-primary rounded font-bold tracking-wider"
                      data-testid={`badge-program-${plan.sourceEntryIndex}`}
                    >
                      {plan.sourceEntryLabel}
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="bg-background p-6 rounded-md border border-border">
                  <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
                    <div className="space-y-4 flex-1">
                      {/* Task #235: mirror the race-day badge + personalized
                          vs catalog pace chip pair from week-detail.tsx so
                          a runner who saw the chip on /plan yesterday
                          sees the same explainer on /today the morning
                          of the race. The IIFE returns null on every
                          non-race row, so this is a no-op for normal
                          weekday plans. */}
                      {(() => {
                        const race = raceDayLabel(plan.distanceMi, plan.description, plan.sessionType);
                        if (!race) return null;
                        const prp = plan.personalizedRacePace ?? null;
                        return (
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className="inline-flex items-center gap-1 text-[10px] bg-primary/15 text-primary px-2 py-1 rounded font-bold tracking-wider w-fit"
                              data-testid={`badge-race-day-today-${plan.date}`}
                              data-race-kind={race.kind}
                            >
                              <Activity className="h-3 w-3" />
                              {race.label}
                            </span>
                            {prp && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span
                                    className={cn(
                                      "inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded font-bold tracking-wider w-fit cursor-help",
                                      prp.source === "personalized"
                                        ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                                        : "bg-muted text-muted-foreground",
                                    )}
                                    data-testid={`badge-race-pace-source-today-${plan.date}`}
                                    data-pace-source={prp.source}
                                    data-personalized-pace={prp.pace}
                                  >
                                    <Sparkles className="h-3 w-3" />
                                    {prp.source === "personalized"
                                      ? `${prp.pace}/mi · Personalized`
                                      : `${prp.pace}/mi · From catalog`}
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent
                                  side="top"
                                  align="start"
                                  className="max-w-xs text-xs"
                                >
                                  {prp.source === "personalized" && prp.basisPaceSeconds != null ? (
                                    <span>
                                      Personalized from {prp.sampleSize} quality run
                                      {prp.sampleSize === 1 ? "" : "s"} (tempo / threshold /
                                      interval / VO2 / race) in the last {prp.lookbackWeeks} weeks.
                                      Avg training pace{" "}
                                      <span className="font-mono font-bold">
                                        {Math.floor(prp.basisPaceSeconds / 60)}:
                                        {String(prp.basisPaceSeconds % 60).padStart(2, "0")}
                                      </span>
                                      /mi → race-day target{" "}
                                      <span className="font-mono font-bold">{prp.pace}</span>/mi.
                                    </span>
                                  ) : (
                                    <span>
                                      Showing the catalog {race.label.toLowerCase()} pace —
                                      not enough recent quality runs in the last{" "}
                                      {prp.lookbackWeeks} weeks to personalize. Log a few
                                      tempo / threshold / interval workouts and this chip
                                      will retune to your training.
                                    </span>
                                  )}
                                </TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        );
                      })()}
                      {/* Task #239 (Today mirror): Sun long-run
                          personalized pace chip. Mirrors the IIFE in
                          week-detail.tsx so the same Sparkles chip /
                          tooltip appears whether the runner lands on
                          /plan/weeks/:week or /plan/today. */}
                      {(() => {
                        const lp = plan.personalizedLongRunPace ?? null;
                        if (!lp) return null;
                        return (
                          <div className="flex flex-wrap items-center gap-2">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span
                                  className={cn(
                                    "inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded font-bold tracking-wider w-fit cursor-help",
                                    lp.source === "personalized"
                                      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                                      : "bg-muted text-muted-foreground",
                                  )}
                                  data-testid={`badge-long-run-pace-source-today-${plan.date}`}
                                  data-pace-source={lp.source}
                                  data-personalized-pace={lp.pace}
                                >
                                  <Sparkles className="h-3 w-3" />
                                  {lp.source === "personalized"
                                    ? `${lp.pace}/mi · Personalized`
                                    : `${lp.pace}/mi · From catalog`}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent
                                side="top"
                                align="start"
                                className="max-w-xs text-xs"
                              >
                                {lp.source === "personalized" && lp.basisPaceSeconds != null ? (
                                  <span>
                                    Personalized from {lp.sampleSize} easy aerobic run
                                    {lp.sampleSize === 1 ? "" : "s"} (long run / aerobic
                                    base / recovery) in the last {lp.lookbackWeeks} weeks.
                                    Avg training pace{" "}
                                    <span className="font-mono font-bold">
                                      {Math.floor(lp.basisPaceSeconds / 60)}:
                                      {String(lp.basisPaceSeconds % 60).padStart(2, "0")}
                                    </span>
                                    /mi → today's long-run target{" "}
                                    <span className="font-mono font-bold">{lp.pace}</span>/mi.
                                  </span>
                                ) : (
                                  <span>
                                    Showing the catalog long-run pace —
                                    not enough recent easy aerobic runs in the last{" "}
                                    {lp.lookbackWeeks} weeks to personalize. Log a few
                                    long runs / aerobic base sessions and this chip
                                    will retune to your training.
                                  </span>
                                )}
                              </TooltipContent>
                            </Tooltip>
                          </div>
                        );
                      })()}
                      {/* Task #240: Wed steady (Z3) / Fri tempo /
                          threshold / race-pace personalized pace chip
                          mirrored from week-detail.tsx so the same
                          Sparkles chip + tooltip explainer renders on
                          the dedicated /plan/today page too. Server
                          only populates `plan.personalizedPace` on
                          rows that match `isPersonalizableQualityPlanDay`
                          AND carry a non-null catalog `pace`, so this
                          block stays absent on every other card.
                          Race-day Sun and Wed/Fri quality rows never
                          overlap, so this chip and the race-day chip
                          above can never both render on the same card. */}
                      {(() => {
                        const pp = plan.personalizedPace ?? null;
                        if (!pp) return null;
                        const lowerSession = plan.sessionType.toLowerCase();
                        return (
                          <div className="flex flex-wrap items-center gap-2">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span
                                  className={cn(
                                    "inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded font-bold tracking-wider w-fit cursor-help",
                                    pp.source === "personalized"
                                      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                                      : "bg-muted text-muted-foreground",
                                  )}
                                  data-testid={`badge-quality-pace-source-today-${plan.date}`}
                                  data-pace-source={pp.source}
                                  data-personalized-pace={pp.pace}
                                >
                                  <Sparkles className="h-3 w-3" />
                                  {pp.source === "personalized"
                                    ? `${pp.pace}/mi · Personalized`
                                    : `${pp.pace}/mi · From catalog`}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent
                                side="top"
                                align="start"
                                className="max-w-xs text-xs"
                              >
                                {pp.source === "personalized" && pp.basisPaceSeconds != null ? (
                                  <span>
                                    Personalized from {pp.sampleSize} quality run
                                    {pp.sampleSize === 1 ? "" : "s"} (tempo / threshold /
                                    interval / VO2 / race) in the last {pp.lookbackWeeks} weeks.
                                    Avg training pace{" "}
                                    <span className="font-mono font-bold">
                                      {Math.floor(pp.basisPaceSeconds / 60)}:
                                      {String(pp.basisPaceSeconds % 60).padStart(2, "0")}
                                    </span>
                                    /mi → today's {lowerSession} target{" "}
                                    <span className="font-mono font-bold">{pp.pace}</span>/mi.
                                  </span>
                                ) : (
                                  <span>
                                    Showing the catalog {lowerSession} pace —
                                    not enough recent quality runs in the last{" "}
                                    {pp.lookbackWeeks} weeks to personalize. Log a few
                                    tempo / threshold / interval workouts and this chip
                                    will retune to your training.
                                  </span>
                                )}
                              </TooltipContent>
                            </Tooltip>
                          </div>
                        );
                      })()}
                      <div className="flex flex-wrap items-baseline gap-3">
                        <span className="font-extrabold text-3xl md:text-4xl tracking-tight leading-none">{plan.sessionType}</span>
                      </div>

                      {/* Phase 7: prominent "what to use today" rail — the
                          machine(s) for this session are obvious at a glance
                          (e.g. "Tonal · Peloton Row") without expanding the
                          detail disclosure. Distinct testid prefix so it
                          doesn't collide with the in-disclosure rail below. */}
                      {((plan.equipmentList && plan.equipmentList.length > 0) ||
                        plan.equipment) && (
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] font-bold tracking-widest text-muted-foreground">
                            TODAY
                          </span>
                          <EquipmentChipRail
                            equipmentList={plan.equipmentList}
                            equipment={plan.equipment}
                            chipTestIdPrefix={`chip-equipment-today-prominent-${plan.date}`}
                            railTestId={`chip-rail-today-prominent-${plan.sourceEntryIndex}`}
                            keyPrefix={`today-prom-eq-${plan.id}`}
                          />
                        </div>
                      )}

                      {plan.description && (
                        <p className="text-foreground text-lg leading-relaxed">{plan.description}</p>
                      )}

                      <PrimaryMetricDisplay
                        metric={getPrimaryMetric(plan)}
                        variant="prominent"
                        testIdPrefix={`today-plan-${plan.sourceEntryIndex}`}
                      />

                      <SessionDetailDisclosure
                        testId={`toggle-today-plan-detail-${plan.sourceEntryIndex}`}
                      >
                        <div className="space-y-4">
                          <EquipmentChipRail
                            equipmentList={plan.equipmentList}
                            equipment={plan.equipment}
                            chipTestIdPrefix={`chip-equipment-${plan.date}`}
                            keyPrefix={`today-eq-${plan.id}`}
                          />
                          {/* Task #135 + RunTargetLine: per-plan run-pace
                              target line so each concurrent program's
                              run target stands on its own. testId is
                              keyed by sourceEntryIndex to disambiguate
                              when multiple programs render on the same
                              day. */}
                          <RunTargetLine
                            sessionType={plan.sessionType}
                            week={plan.week}
                            runMin={plan.runMin}
                            distanceMi={plan.distanceMi}
                            // Task #235: when a personalized race-day
                            // pace is available, override the seeded
                            // catalog `plan.pace` so the headline run
                            // target reflects the live recommendation
                            // derived from the runner's training. Falls
                            // back to `plan.pace` on every non-race day
                            // (and on race days where there isn't yet
                            // enough quality history to personalize, in
                            // which case `personalizedRacePace.pace` IS
                            // the catalog value anyway). Mirrors the
                            // override in week-detail.tsx.
                            // Task #239: also honor the Sun long-run
                            // overlay (mutually exclusive with the
                            // race-day overlay above).
                            // Task #240: extend the precedence chain
                            // to also honor the Wed/Fri quality
                            // overlay (`personalizedPace`). The three
                            // overlays are mutually exclusive so the
                            // order is symbolic — any non-null wins
                            // over the seeded catalog `plan.pace`.
                            pace={
                              plan.personalizedRacePace?.pace ??
                              plan.personalizedPace?.pace ??
                              plan.personalizedLongRunPace?.pace ??
                              plan.pace
                            }
                            variant="prominent"
                            testId={`today-plan-${plan.sourceEntryIndex}-run-target`}
                            // Task #227: tone the chip per race-kind on
                            // race day (Sun) so the runner sees that
                            // 5K is meant to feel VO2 (red), 10K
                            // threshold (orange), marathon-pace steady
                            // (amber). Returns undefined for non-race
                            // rows so the generic primary tone holds.
                            zoneBucket={
                              raceDayLabel(
                                plan.distanceMi,
                                plan.description,
                                plan.sessionType,
                              )?.zoneBucket
                            }
                          />
                          <PlannedBreakdown
                            totalMin={plan.totalMin}
                            strengthMin={plan.strengthMin}
                            cardioMin={plan.cardioMin}
                            runMin={plan.runMin}
                            runDistanceMi={plan.distanceMi}
                            date={plan.date}
                            actualTotalMin={cardSessions.reduce(
                              (sum, s) =>
                                sum + (s.totalMin ?? s.durationMin ?? 0),
                              0,
                            )}
                            variant="prominent"
                            testIdPrefix={`today-plan-${plan.sourceEntryIndex}`}
                          />
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                            {plan.distanceMi != null && plan.distanceMi > 0 && (
                              <div>
                                <p className="text-xs text-muted-foreground font-bold tracking-wider">Distance</p>
                                <p className="text-xl font-black">{formatDistance(plan.distanceMi)}</p>
                              </div>
                            )}
                            {plan.strengthLoad != null && plan.strengthLoad > 0 && (
                              <div>
                                <p className="text-xs text-muted-foreground font-bold tracking-wider">Strength Load</p>
                                <p className="text-xl font-black">{plan.strengthLoad}</p>
                              </div>
                            )}
                            {plan.totalLoad > 0 && (
                              <div>
                                <p className="text-xs text-muted-foreground font-bold tracking-wider">Total Load</p>
                                <p className="text-xl font-black">{formatLoad(plan.totalLoad)}</p>
                              </div>
                            )}
                          </div>
                        </div>
                      </SessionDetailDisclosure>
                    </div>

                    <div className="shrink-0 flex flex-col items-stretch justify-center gap-3 border-t md:border-t-0 md:border-l border-border pt-6 md:pt-0 md:pl-6 md:w-56">
                      <Button
                        size="lg"
                        className="h-14 px-6 text-base font-black tracking-widest group"
                        onClick={() => crushIt({ ...ctx, loggedWorkout: null })}
                        disabled={isCrushing}
                        data-testid={
                          planIdx === 0
                            ? "button-crush-today"
                            : `button-crush-today-${plan.sourceEntryIndex}`
                        }
                      >
                        <Zap className="mr-2 h-5 w-5 group-hover:scale-110 transition-transform" />
                        {hasSessions ? "Done again" : "Done"}
                      </Button>
                      <Button
                        variant="secondary"
                        className="font-bold tracking-wider"
                        onClick={() => openLog({ ...ctx, loggedWorkout: null })}
                        disabled={isCrushing}
                        data-testid={
                          planIdx === 0
                            ? "button-log-today"
                            : `button-log-today-${plan.sourceEntryIndex}`
                        }
                      >
                        <Pencil className="mr-2 h-4 w-4" />
                        {hasSessions ? "Log Another" : "Log session"}
                      </Button>
                      {!hasSessions && (
                        <Button
                          variant="outline"
                          className="font-bold tracking-wider text-destructive hover:text-destructive border-destructive/40"
                          onClick={() => requestSkip({ ...ctx, loggedWorkout: null })}
                          disabled={isCrushing}
                          data-testid={
                            planIdx === 0
                              ? "button-skip-today"
                              : `button-skip-today-${plan.sourceEntryIndex}`
                          }
                        >
                          <XCircle className="mr-2 h-4 w-4" />
                          Skipped
                        </Button>
                      )}
                      {/* Adjust-from-anywhere: seed the builder with this
                          session's day so "Ask AI" lands on the right card. */}
                      <Button
                        variant="ghost"
                        className="font-bold tracking-wider text-muted-foreground"
                        onClick={() =>
                          askAiToAdjust(
                            `Adjust my ${plan.day ?? "today's"} session (${plan.sessionType}). `,
                          )
                        }
                        data-testid={
                          planIdx === 0
                            ? "button-ask-ai-today"
                            : `button-ask-ai-today-${plan.sourceEntryIndex}`
                        }
                      >
                        <Wand2 className="mr-2 h-4 w-4" />
                        Ask AI to adjust
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
            );
          })}

          {sessions.map((session) => {
            // Task #143: when a workout was logged against a specific
            // concurrent program, pull THAT plan_day for the
            // planned-vs-actual comparison and the edit/delete ctx.
            // Legacy or unattributed workouts (planDayId == null) fall
            // back to the lowest-index program (today.plan) so single
            // program flows are unchanged.
            const matchedPlan =
              (session.planDayId != null
                ? today.plans?.find((p) => p.id === session.planDayId)
                : null) ?? today.plan ?? null;
            const sessionCtx = matchedPlan
              ? { date: today.date, plan: matchedPlan, suggestions: null }
              : null;
            return (
            <Card key={session.id} className="border-border" data-testid={`session-today-${session.id}`}>
              <CardHeader className="bg-muted/30 border-b border-border pb-4 flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-lg tracking-wider flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-primary" />
                  Done
                  <TimeOfDayBadge
                    value={session.timeOfDay}
                    className="ml-2"
                    testId={`badge-time-of-day-today-${session.id}`}
                  />
                  <span className="text-xs font-mono normal-case tracking-normal text-muted-foreground ml-2">
                    {session.sessionType}
                  </span>
                </CardTitle>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => sessionCtx && openEdit({ ...sessionCtx, loggedWorkout: session })}
                    data-testid={`button-edit-today-${session.id}`}
                  >
                    <Edit className="h-4 w-4 mr-2" /> Edit
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => sessionCtx && requestDelete({ ...sessionCtx, loggedWorkout: session })}
                    disabled={isDeleting}
                    data-testid={`button-delete-today-${session.id}`}
                  >
                    <Trash2 className="h-4 w-4 mr-2" /> Delete
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-6 space-y-4">
                {/* Task #237: mirror the race-day badge + personalized
                    vs catalog pace chip pair from the Mission Brief card
                    above so the explainer stays visible after the runner
                    logs the race-day session. The IIFE no-ops on every
                    non-race row so this is invisible for normal
                    weekday sessions. testIds are keyed off the logged
                    session id so they don't collide with the Mission
                    Brief chips when both cards co-render. */}
                {(() => {
                  if (!matchedPlan) return null;
                  const race = raceDayLabel(
                    matchedPlan.distanceMi,
                    matchedPlan.description,
                    matchedPlan.sessionType,
                  );
                  if (!race) return null;
                  const prp = matchedPlan.personalizedRacePace ?? null;
                  return (
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className="inline-flex items-center gap-1 text-[10px] bg-primary/15 text-primary px-2 py-1 rounded font-bold tracking-wider w-fit"
                        data-testid={`badge-race-day-today-session-${session.id}`}
                        data-race-kind={race.kind}
                      >
                        <Activity className="h-3 w-3" />
                        {race.label}
                      </span>
                      {prp && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span
                              className={cn(
                                "inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded font-bold tracking-wider w-fit cursor-help",
                                prp.source === "personalized"
                                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                                  : "bg-muted text-muted-foreground",
                              )}
                              data-testid={`badge-race-pace-source-today-session-${session.id}`}
                              data-pace-source={prp.source}
                              data-personalized-pace={prp.pace}
                            >
                              <Sparkles className="h-3 w-3" />
                              {prp.source === "personalized"
                                ? `${prp.pace}/mi · Personalized`
                                : `${prp.pace}/mi · From catalog`}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent
                            side="top"
                            align="start"
                            className="max-w-xs text-xs"
                          >
                            {prp.source === "personalized" && prp.basisPaceSeconds != null ? (
                              <span>
                                Personalized from {prp.sampleSize} quality run
                                {prp.sampleSize === 1 ? "" : "s"} (tempo / threshold /
                                interval / VO2 / race) in the last {prp.lookbackWeeks} weeks.
                                Avg training pace{" "}
                                <span className="font-mono font-bold">
                                  {Math.floor(prp.basisPaceSeconds / 60)}:
                                  {String(prp.basisPaceSeconds % 60).padStart(2, "0")}
                                </span>
                                /mi → race-day target{" "}
                                <span className="font-mono font-bold">{prp.pace}</span>/mi.
                              </span>
                            ) : (
                              <span>
                                Showing the catalog {race.label.toLowerCase()} pace —
                                not enough recent quality runs in the last{" "}
                                {prp.lookbackWeeks} weeks to personalize. Log a few
                                tempo / threshold / interval workouts and this chip
                                will retune to your training.
                              </span>
                            )}
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  );
                })()}
                {/* Slim collapsed view (Task #133): show only the one
                    headline actual-vs-planned number. The full per-bucket
                    ActualBreakdown, distance, pace, RPE, avg HR, load,
                    equipment chips and notes all live in the disclosure
                    below so the card stays scannable. */}
                <PrimaryMetricDisplay
                  metric={getPrimaryMetricCompare(session, matchedPlan)}
                  variant="prominent"
                  testIdPrefix={`session-today-${session.id}`}
                />
                {/* The coach's verdict on what you did vs the plan — did-it-all
                    / close / fell-short / overdelivered, in the same sardonic
                    voice as the daily line. Pure client-side from the
                    planned-vs-actual minutes already on this card. */}
                {(() => {
                  const v = sessionVerdict({
                    plannedMin: matchedPlan?.totalMin ?? null,
                    actualMin: session.totalMin ?? session.durationMin ?? null,
                    seed: session.id,
                  });
                  if (!v) return null;
                  return (
                    <div
                      className={cn(
                        "rounded-md border-l-4 px-4 py-3 flex items-start gap-3",
                        VERDICT_TONE[v.bucket],
                      )}
                      data-testid={`session-verdict-${session.id}`}
                      data-verdict-bucket={v.bucket}
                    >
                      <span className="text-[10px] font-black uppercase tracking-widest mt-0.5 shrink-0">
                        {v.headline}
                      </span>
                      <span className="text-sm leading-snug">{v.line}</span>
                    </div>
                  );
                })()}
                <SessionDetailDisclosure
                  testId={`toggle-today-session-detail-${session.id}`}
                >
                  <div className="space-y-6">
                    <EquipmentChipRail
                      equipmentList={session.equipmentList}
                      equipment={session.equipment}
                      chipTestIdPrefix={`chip-equipment-actual-${session.id}`}
                      railTestId={`chip-rail-actual-${session.id}`}
                      keyPrefix={`actual-eq-${session.id}`}
                    />
                    {/* Task #140: surface the prescribed run-target
                        line in the user's chosen mode (effort /
                        intervals / HR zone / pace) next to the actuals
                        so the runner can compare what they were asked
                        to do vs what they actually did. The component
                        no-ops on rest / strength / cardio days, so we
                        can render it unconditionally — only run-shaped
                        plan days actually surface a target. */}
                    {today.plan && (
                      <RunTargetLine
                        sessionType={today.plan.sessionType}
                        week={today.plan.week}
                        runMin={today.plan.runMin}
                        distanceMi={today.plan.distanceMi}
                        // Task #235: same personalized-pace override as
                        // the Mission Brief above so the post-log
                        // target line shown next to the actuals
                        // reflects the live race-day recommendation
                        // rather than the seeded catalog value.
                        // Task #239: also honor the Sun long-run
                        // overlay (mutually exclusive with the race
                        // overlay).
                        pace={
                          today.plan.personalizedRacePace?.pace ??
                          today.plan.personalizedLongRunPace?.pace ??
                          today.plan.pace
                        }
                        variant="prominent"
                        testId={`session-today-${session.id}-run-target`}
                        // Task #227: race-kind zone tone on race day so
                        // the post-log target line keeps the same
                        // visual cue the pre-log Mission Brief carries.
                        zoneBucket={
                          raceDayLabel(
                            today.plan.distanceMi,
                            today.plan.description,
                            today.plan.sessionType,
                          )?.zoneBucket
                        }
                      />
                    )}
                    <ActualBreakdown
                      totalMin={session.totalMin}
                      strengthMin={session.strengthMin}
                      cardioMin={session.cardioMin}
                      runMin={session.runMin}
                      durationMin={session.durationMin}
                      plannedTotalMin={matchedPlan?.totalMin}
                      plannedStrengthMin={matchedPlan?.strengthMin}
                      plannedCardioMin={matchedPlan?.cardioMin}
                      plannedRunMin={matchedPlan?.runMin}
                      variant="prominent"
                      testIdPrefix={`session-today-${session.id}`}
                    />
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
                      {session.distanceMi != null && (
                        <div>
                          <p className="text-xs text-muted-foreground font-bold tracking-wider">Distance</p>
                          <p className="text-xl font-black">{formatDistance(session.distanceMi)}</p>
                        </div>
                      )}
                      {session.pace && (
                        <div>
                          <p className="text-xs text-muted-foreground font-bold tracking-wider">Pace</p>
                          <p className="text-xl font-black">{session.pace}/mi</p>
                        </div>
                      )}
                      {session.rpe != null && (
                        <div>
                          <p className="text-xs text-muted-foreground font-bold tracking-wider">RPE</p>
                          <p className="text-xl font-black">{session.rpe}/10</p>
                        </div>
                      )}
                      {session.avgHr != null && (
                        <div>
                          <p className="text-xs text-muted-foreground font-bold tracking-wider">Avg HR</p>
                          <p className="text-xl font-black">{session.avgHr} bpm</p>
                        </div>
                      )}
                      {session.totalLoad != null && (
                        <div>
                          <p className="text-xs text-muted-foreground font-bold tracking-wider">Total Load</p>
                          <p className="text-xl font-black">{formatLoad(session.totalLoad)}</p>
                        </div>
                      )}
                    </div>
                    {session.notes && (
                      <div className="pt-4 border-t border-border">
                        <p className="text-xs text-muted-foreground font-bold tracking-wider mb-2">Notes</p>
                        <p className="text-sm">{session.notes}</p>
                      </div>
                    )}
                  </div>
                </SessionDetailDisclosure>
              </CardContent>
            </Card>
            );
          })}
        </div>
      )}

      {dialogs}

      <Dialog
        open={logDraft != null}
        onOpenChange={(o) => !o && setLogDraft(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Log race result</DialogTitle>
          </DialogHeader>
          {logDraft && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="secondary" className="tracking-wider">
                  {RACE_KIND_LABELS[logDraft.raceKind as RaceDayKind] ??
                    logDraft.raceKind}
                </Badge>
                <span className="font-mono font-bold text-primary">
                  {logDraft.raceDate}
                </span>
                {logDraft.name && (
                  <span className="text-sm text-muted-foreground">
                    {logDraft.name}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <Label htmlFor="todayLogFinish">Finish time</Label>
                  <Input
                    id="todayLogFinish"
                    placeholder="2:14:08"
                    value={logDraft.finishTime}
                    onChange={(e) =>
                      setLogDraft({ ...logDraft, finishTime: e.target.value })
                    }
                    data-testid="input-today-log-finish-time"
                  />
                </div>
                <div>
                  <Label htmlFor="todayLogOverall">Placement</Label>
                  <Input
                    id="todayLogOverall"
                    inputMode="numeric"
                    placeholder="312"
                    value={logDraft.placementOverall}
                    onChange={(e) =>
                      setLogDraft({
                        ...logDraft,
                        placementOverall: e.target.value,
                      })
                    }
                    data-testid="input-today-log-placement-overall"
                  />
                </div>
                <div>
                  <Label htmlFor="todayLogTotal">Field size</Label>
                  <Input
                    id="todayLogTotal"
                    inputMode="numeric"
                    placeholder="1804"
                    value={logDraft.placementTotal}
                    onChange={(e) =>
                      setLogDraft({
                        ...logDraft,
                        placementTotal: e.target.value,
                      })
                    }
                    data-testid="input-today-log-placement-total"
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="todayLogFelt">Felt rating (1-5)</Label>
                <Input
                  id="todayLogFelt"
                  inputMode="numeric"
                  placeholder="4"
                  value={logDraft.feltRating}
                  onChange={(e) =>
                    setLogDraft({ ...logDraft, feltRating: e.target.value })
                  }
                  data-testid="input-today-log-felt-rating"
                />
              </div>
              <div>
                <Label htmlFor="todayLogNotes">Notes</Label>
                <Textarea
                  id="todayLogNotes"
                  rows={3}
                  placeholder="Splits, weather, fueling, what worked, what didn't..."
                  value={logDraft.notes}
                  onChange={(e) =>
                    setLogDraft({ ...logDraft, notes: e.target.value })
                  }
                  data-testid="input-today-log-notes"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setLogDraft(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleLogResult}
              disabled={upsertResult.isPending}
              data-testid="button-today-confirm-log-result"
            >
              {upsertResult.isPending ? "Saving…" : "Save result"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Tone per verdict bucket for the post-log coach verdict strip — praise reads
// green, a near miss amber, a real shortfall/skip in the destructive tone, and
// an off-plan bonus in the brand primary.
const VERDICT_TONE: Record<VerdictBucket, string> = {
  over: "border-l-emerald-500 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
  complete: "border-l-emerald-500 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
  close: "border-l-amber-500 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  short: "border-l-destructive bg-destructive/10 text-destructive",
  skipped: "border-l-destructive bg-destructive/10 text-destructive",
  bonus: "border-l-primary bg-primary/10 text-primary",
};

// Task #306: per-kind eyebrow above the "Today's Mission" header so the
// Today page mirrors the dashboard / plan / week-detail framing
// (Tasks #209, #204, #242). Tonal-first / non-race plans (raceKind null)
// render no eyebrow at all so we don't presuppose a race day. Race-week
// and post-race states are sourced from the same /race-week query the
// ChecklistNudge / RaceWeekBanner already use, so a 5K runner in the
// final week sees "5K · Race Week" and the recovery week reads "5K
// Complete" — matching the per-kind copy on the other surfaces. Marathon
// collapses to the existing flagship "Race Campaign" / "Race Week" /
// "Race Complete" copy unchanged.
const RACE_KIND_LABELS: Record<RaceDayKind, string> = {
  marathon: "Marathon",
  half: "Half Marathon",
  "10k": "10K",
  "5k": "5K",
};

function TodayEyebrow({ raceKind }: { raceKind: RaceDayKind | null }) {
  // Reuses the same query key as RaceWeekBanner / ChecklistNudge so
  // there's no extra round-trip — the cached payload already drives the
  // race-week reminder in the header.
  const { data: raceWeek } = useGetRaceWeek({
    query: {
      queryKey: getGetRaceWeekQueryKey(),
      refetchOnWindowFocus: true,
      refetchInterval: 60_000,
    },
  });
  if (raceKind == null) return null;
  const label = RACE_KIND_LABELS[raceKind];
  const isRaceWeek = !!raceWeek?.inWindow && !raceWeek.racePassed;
  const isPostRace = !!raceWeek?.racePassed;
  let text: string;
  if (isPostRace) {
    text = raceKind === "marathon" ? "Race Complete" : `${label} Complete`;
  } else if (isRaceWeek) {
    text = raceKind === "marathon" ? "Race Week" : `${label} · Race Week`;
  } else {
    text = raceKind === "marathon" ? "Race Campaign" : `${label} Campaign`;
  }
  return (
    <p
      className="text-[10px] tracking-[0.2em] font-bold text-primary mb-1"
      data-testid="today-eyebrow"
      data-race-kind={raceKind}
      data-race-week={isRaceWeek ? "true" : undefined}
      data-post-race={isPostRace ? "true" : undefined}
    >
      {text}
    </p>
  );
}
