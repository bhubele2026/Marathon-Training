import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  useGetPlannerConfig,
  usePutPlannerConfig,
  useApplyPlannerConfig,
  getGetPlannerConfigQueryKey,
  type PhaseBlock,
} from "@workspace/api-client-react";
import {
  FOCUS_TYPES,
  MARATHON_TAIL_WEEKS,
  previewWeeklyMileage,
  type FocusType,
  type WeekMileagePreview,
} from "@workspace/plan-generator";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ArrowDown, ArrowUp, Plus, Trash2, Save, Play, Lock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { invalidateMissionRelatedQueries } from "@/lib/invalidate-mission-queries";

// FOCUS_TYPES, FocusType, and MARATHON_TAIL_WEEKS are imported from
// @workspace/plan-generator above so the planner page, the validator, and
// the generator never drift on the canonical set of focus types or the
// auto-pinned tail length.

// ---- Pure date helpers (also tested via the generator's totalWeeksFromDates,
// but kept inline so the Planner page stays self-contained for SSR / build) --

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function dayOfWeekUTC(iso: string): number | null {
  if (!ISO_DATE_RE.test(iso)) return null;
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(t)) return null;
  return new Date(t).getUTCDay();
}

function totalWeeksBetween(startISO: string, raceISO: string): number {
  const start = Date.parse(`${startISO}T00:00:00Z`);
  const race = Date.parse(`${raceISO}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(race)) return 0;
  const diffDays = Math.round((race - start) / 86400000);
  if (diffDays < 6) return 0;
  if ((diffDays + 1) % 7 !== 0) return 0;
  return (diffDays + 1) / 7;
}

// Default config offered when no config has ever been saved. Mirrors the
// canonical 52-week campaign (start Mon 2026-05-04, race Sun 2027-05-02)
// with 18 + 18 user weeks of Base + Time on Feet ahead of the auto-pinned
// 16-week Marathon-Specific tail (52 - 16 = 36).
const DEFAULT_START_DATE = "2026-05-04";
const DEFAULT_MARATHON_DATE = "2027-05-02";

function defaultBlankConfig(): {
  startDate: string;
  marathonDate: string;
  blocks: PhaseBlock[];
} {
  return {
    startDate: DEFAULT_START_DATE,
    marathonDate: DEFAULT_MARATHON_DATE,
    blocks: [
      { focusType: "Base", weeks: 18, customName: null, customNotes: null },
      {
        focusType: "Time on Feet",
        weeks: 18,
        customName: null,
        customNotes: null,
      },
    ],
  };
}

interface DraftBlock {
  focusType: FocusType;
  weeks: number;
  customName: string;
  customNotes: string;
}

function blocksToDraft(blocks: PhaseBlock[]): DraftBlock[] {
  return blocks.map((b) => ({
    focusType: b.focusType as FocusType,
    weeks: b.weeks,
    customName: b.customName ?? "",
    customNotes: b.customNotes ?? "",
  }));
}

function draftToBlocks(draft: DraftBlock[]): PhaseBlock[] {
  return draft.map((b) => ({
    focusType: b.focusType,
    weeks: b.weeks,
    customName: b.focusType === "Custom" ? b.customName.trim() || null : null,
    customNotes: b.customNotes.trim() || null,
  }));
}

export default function Planner() {
  const { data, isLoading } = useGetPlannerConfig();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const putMutation = usePutPlannerConfig();
  const applyMutation = useApplyPlannerConfig();
  const isApplying = putMutation.isPending || applyMutation.isPending;

  const [startDate, setStartDate] = useState<string>("");
  const [marathonDate, setMarathonDate] = useState<string>("");
  const [draft, setDraft] = useState<DraftBlock[]>([]);
  const [confirmApplyOpen, setConfirmApplyOpen] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);

  // Hydrate the local form state once the config GET resolves. We only do
  // this once (gated on `hasLoaded`) so subsequent invalidations from the
  // PUT mutation don't blow away the user's in-progress edits.
  useEffect(() => {
    if (hasLoaded) return;
    if (isLoading) return;
    const cfg = data?.config;
    if (cfg) {
      setStartDate(cfg.startDate);
      setMarathonDate(cfg.marathonDate);
      setDraft(blocksToDraft(cfg.blocks as PhaseBlock[]));
    } else {
      const blank = defaultBlankConfig();
      setStartDate(blank.startDate);
      setMarathonDate(blank.marathonDate);
      setDraft(blocksToDraft(blank.blocks));
    }
    setHasLoaded(true);
  }, [data, isLoading, hasLoaded]);

  // ---- Derived timeline math (mirrors the server validator) -----------
  const totalWeeks = totalWeeksBetween(startDate, marathonDate);
  const expectedUserWeeks = Math.max(0, totalWeeks - MARATHON_TAIL_WEEKS);
  const userWeeksSum = draft.reduce((s, b) => s + (b.weeks || 0), 0);
  const startDow = dayOfWeekUTC(startDate);
  const raceDow = dayOfWeekUTC(marathonDate);

  const issues: string[] = [];
  if (!startDate) issues.push("Pick a training start date.");
  else if (startDow !== 1) issues.push("Training start date must be a Monday.");
  if (!marathonDate) issues.push("Pick a marathon date.");
  else if (raceDow !== 0) issues.push("Marathon date must be a Sunday.");
  if (totalWeeks > 0 && totalWeeks < MARATHON_TAIL_WEEKS) {
    issues.push(
      `Marathon date is only ${totalWeeks} weeks out — needs at least ${MARATHON_TAIL_WEEKS} for the auto-pinned Marathon-Specific block.`,
    );
  } else if (totalWeeks > 0 && userWeeksSum !== expectedUserWeeks) {
    issues.push(
      `Block weeks total ${userWeeksSum}, but need exactly ${expectedUserWeeks} (the trailing ${MARATHON_TAIL_WEEKS}-week Marathon-Specific block is auto-pinned).`,
    );
  }
  for (let i = 0; i < draft.length; i++) {
    const b = draft[i]!;
    if (!b.weeks || b.weeks < 1) {
      issues.push(`Block ${i + 1} (${b.focusType}) needs at least 1 week.`);
    }
    if (b.focusType === "Custom" && !b.customName.trim()) {
      issues.push(`Block ${i + 1} (Custom) needs a name.`);
    }
  }
  const isValid = issues.length === 0;

  // ---- Block list mutations --------------------------------------------
  function addBlock() {
    setDraft((d) => [
      ...d,
      { focusType: "Base", weeks: 4, customName: "", customNotes: "" },
    ]);
  }
  function removeBlock(i: number) {
    setDraft((d) => d.filter((_, idx) => idx !== i));
  }
  function moveBlock(i: number, dir: -1 | 1) {
    setDraft((d) => {
      const next = [...d];
      const j = i + dir;
      if (j < 0 || j >= next.length) return next;
      const [item] = next.splice(i, 1);
      next.splice(j, 0, item!);
      return next;
    });
  }
  function updateBlock(i: number, patch: Partial<DraftBlock>) {
    setDraft((d) =>
      d.map((b, idx) => (idx === i ? { ...b, ...patch } : b)),
    );
  }
  function autoBalance() {
    // Distribute the expected user weeks across existing blocks evenly so
    // the runner doesn't have to do the arithmetic by hand. Keeps the
    // ordering and focus types but nudges weeks to add up to expected.
    if (draft.length === 0 || expectedUserWeeks <= 0) return;
    const base = Math.floor(expectedUserWeeks / draft.length);
    const remainder = expectedUserWeeks - base * draft.length;
    setDraft((d) =>
      d.map((b, idx) => ({
        ...b,
        weeks: Math.max(1, base + (idx < remainder ? 1 : 0)),
      })),
    );
  }

  // ---- Save / Apply -----------------------------------------------------
  function handleSave() {
    if (!isValid) {
      toast({
        title: "Fix errors first",
        description: issues[0],
        variant: "destructive",
      });
      return;
    }
    putMutation.mutate(
      {
        data: {
          startDate,
          marathonDate,
          blocks: draftToBlocks(draft),
        },
      },
      {
        onSuccess: () => {
          toast({
            title: "Planner saved",
            description: "Click Apply to regenerate the plan from this config.",
          });
          queryClient.invalidateQueries({
            queryKey: getGetPlannerConfigQueryKey(),
          });
        },
        onError: (err: unknown) => {
          toast({
            title: "Save failed",
            description: err instanceof Error ? err.message : "Unknown error",
            variant: "destructive",
          });
        },
      },
    );
  }

  // Apply always saves the current draft FIRST so what gets regenerated
  // matches what the runner sees on screen, then triggers regeneration,
  // then routes to /plan so they can immediately inspect the new plan.
  function handleApply() {
    setConfirmApplyOpen(false);
    if (!isValid) {
      toast({
        title: "Fix errors first",
        description: issues[0],
        variant: "destructive",
      });
      return;
    }
    putMutation.mutate(
      {
        data: {
          startDate,
          marathonDate,
          blocks: draftToBlocks(draft),
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: getGetPlannerConfigQueryKey(),
          });
          applyMutation.mutate(undefined as never, {
            onSuccess: (resp) => {
              toast({
                title: "Plan regenerated",
                description: `${resp.weeksSeeded} weeks · ${resp.daysSeeded} days · ${resp.workoutsPreserved} workouts kept`,
              });
              invalidateMissionRelatedQueries(queryClient);
              setLocation("/plan");
            },
            onError: (err: unknown) => {
              toast({
                title: "Apply failed",
                description: err instanceof Error ? err.message : "Unknown error",
                variant: "destructive",
              });
            },
          });
        },
        onError: (err: unknown) => {
          toast({
            title: "Save failed",
            description: err instanceof Error ? err.message : "Unknown error",
            variant: "destructive",
          });
        },
      },
    );
  }

  // ---- Mileage preview --------------------------------------------------
  // Compute the per-week mileage projection using the same recipes the
  // generator will use at Apply time. We always append the auto-pinned
  // 16-week Marathon-Specific tail so the curve matches what regenerating
  // would produce. The helper doesn't validate dates/sums so the preview
  // updates live as the runner edits block weeks.
  const mileagePreview = useMemo<WeekMileagePreview[]>(() => {
    try {
      return previewWeeklyMileage(draftToBlocks(draft), {
        appendMarathonTail: true,
      });
    } catch {
      return [];
    }
  }, [draft]);

  // Per-block slices keyed by blockIndex (user blocks are 0..draft.length-1,
  // the auto-pinned tail is draft.length).
  const mileageByBlock = useMemo(() => {
    const map = new Map<number, WeekMileagePreview[]>();
    for (const w of mileagePreview) {
      const arr = map.get(w.blockIndex) ?? [];
      arr.push(w);
      map.set(w.blockIndex, arr);
    }
    return map;
  }, [mileagePreview]);

  // Peak mileage across the entire plan, used so per-block sparklines all
  // share the same y-axis ceiling — that way two adjacent blocks are visually
  // comparable instead of each auto-scaling to its own peak.
  const peakTotalMi = useMemo(
    () => mileagePreview.reduce((m, w) => Math.max(m, w.totalMi), 0),
    [mileagePreview],
  );

  // ---- Phase block timeline (preview) ----------------------------------
  // Compute the global start week of each block plus the auto-pinned tail
  // so the runner can see exactly where the Marathon-Specific block lands.
  const previewBlocks = useMemo(() => {
    const list: Array<{
      label: string;
      focusType: string;
      weeks: number;
      startWeek: number;
      endWeek: number;
      startDateISO: string | null;
      endDateISO: string | null;
      autoPinned: boolean;
      customNotes?: string | null;
    }> = [];
    // Anchor calendar dates on the configured Monday startDate so each block
    // shows its actual Mon..Sun span. Bail out of date math when startDate
    // isn't a valid yyyy-mm-dd Monday — the labels still fall back gracefully.
    const startMs =
      startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate)
        ? Date.parse(`${startDate}T00:00:00Z`)
        : NaN;
    const isoForWeek = (weekIndexOneBased: number, weekCount: number): string | null => {
      if (!Number.isFinite(startMs)) return null;
      const ms = startMs + (weekIndexOneBased - 1) * 7 * 24 * 3600 * 1000;
      const endMs = ms + (weekCount * 7 - 1) * 24 * 3600 * 1000;
      return new Date(endMs).toISOString().slice(0, 10);
    };
    let week = 1;
    for (const b of draft) {
      const w = b.weeks || 0;
      if (w < 1) continue;
      list.push({
        label:
          b.focusType === "Custom"
            ? b.customName.trim() || "Custom"
            : b.focusType,
        focusType: b.focusType,
        weeks: w,
        startWeek: week,
        endWeek: week + w - 1,
        startDateISO: Number.isFinite(startMs)
          ? new Date(startMs + (week - 1) * 7 * 24 * 3600 * 1000)
              .toISOString()
              .slice(0, 10)
          : null,
        endDateISO: isoForWeek(week, w),
        autoPinned: false,
        customNotes: b.customNotes.trim() || null,
      });
      week += w;
    }
    list.push({
      label: "Marathon-Specific",
      focusType: "Marathon-Specific",
      weeks: MARATHON_TAIL_WEEKS,
      startWeek: week,
      endWeek: week + MARATHON_TAIL_WEEKS - 1,
      startDateISO: Number.isFinite(startMs)
        ? new Date(startMs + (week - 1) * 7 * 24 * 3600 * 1000)
            .toISOString()
            .slice(0, 10)
        : null,
      endDateISO: isoForWeek(week, MARATHON_TAIL_WEEKS),
      autoPinned: true,
    });
    return list;
  }, [draft, startDate]);

  if (isLoading || !hasLoaded) {
    return (
      <div className="space-y-6" data-testid="planner-loading">
        <Skeleton className="h-12 w-1/3" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12" data-testid="planner-page">
      <header>
        <h1 className="text-3xl font-bold tracking-tight uppercase">
          Phase Planner
        </h1>
        <p className="text-muted-foreground mt-1">
          Build your campaign: pick the marathon date, the training start, and
          the ordered phase blocks. The trailing 16-week Marathon-Specific
          block is auto-pinned so race day always lands on the date you set.
        </p>
      </header>

      {/* ---------- DATES ---------- */}
      <Card>
        <CardHeader>
          <CardTitle className="uppercase tracking-wider text-sm">
            Dates
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="planner-start-date">
              Training start (must be a Monday)
            </Label>
            <Input
              id="planner-start-date"
              data-testid="planner-start-date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
            {startDate && startDow !== 1 && (
              <p className="text-xs text-destructive">
                Must be a Monday — currently a{" "}
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][startDow ?? 0]}.
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="planner-marathon-date">
              Marathon date (must be a Sunday)
            </Label>
            <Input
              id="planner-marathon-date"
              data-testid="planner-marathon-date"
              type="date"
              value={marathonDate}
              onChange={(e) => setMarathonDate(e.target.value)}
            />
            {marathonDate && raceDow !== 0 && (
              <p className="text-xs text-destructive">
                Must be a Sunday — currently a{" "}
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][raceDow ?? 0]}.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ---------- TIMELINE MATH ---------- */}
      <Card>
        <CardHeader>
          <CardTitle className="uppercase tracking-wider text-sm">
            Timeline
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div
            className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm"
            data-testid="planner-timeline-math"
          >
            <Stat label="Total weeks" value={totalWeeks || "—"} />
            <Stat
              label="User-block weeks"
              value={`${userWeeksSum} / ${expectedUserWeeks}`}
              ok={userWeeksSum === expectedUserWeeks && expectedUserWeeks > 0}
              data-testid="planner-block-weeks-stat"
            />
            <Stat label="Auto-pinned" value={`${MARATHON_TAIL_WEEKS} weeks`} />
            <Stat
              label="Blocks"
              value={`${draft.length} + 1 pinned`}
            />
          </div>
          {issues.length > 0 && (
            <ul
              className="mt-4 space-y-1 text-sm text-destructive list-disc list-inside"
              data-testid="planner-issues"
            >
              {issues.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          )}
          {expectedUserWeeks > 0 && userWeeksSum !== expectedUserWeeks && (
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={autoBalance}
              data-testid="planner-auto-balance"
            >
              Auto-balance to {expectedUserWeeks} weeks
            </Button>
          )}
        </CardContent>
      </Card>

      {/* ---------- BLOCKS EDITOR ---------- */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="uppercase tracking-wider text-sm">
            Phase Blocks
          </CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={addBlock}
            data-testid="planner-add-block"
          >
            <Plus className="h-4 w-4 mr-1" /> Add Block
          </Button>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3" data-testid="planner-blocks-list">
            {draft.map((b, i) => (
              <li
                key={i}
                className="border rounded-lg p-3 bg-card"
                data-testid={`planner-block-${i}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-mono text-muted-foreground w-6">
                    #{i + 1}
                  </span>
                  <Select
                    value={b.focusType}
                    onValueChange={(v) =>
                      updateBlock(i, { focusType: v as FocusType })
                    }
                  >
                    <SelectTrigger
                      className="w-56"
                      data-testid={`planner-block-${i}-focus`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FOCUS_TYPES.map((f) => (
                        <SelectItem key={f} value={f}>
                          {f}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    type="number"
                    min={1}
                    className="w-24"
                    value={b.weeks}
                    onChange={(e) =>
                      updateBlock(i, {
                        weeks: Math.max(1, Number(e.target.value) || 1),
                      })
                    }
                    data-testid={`planner-block-${i}-weeks`}
                  />
                  <span className="text-xs text-muted-foreground">weeks</span>
                  <div className="ml-auto flex gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => moveBlock(i, -1)}
                      disabled={i === 0}
                      aria-label="Move up"
                    >
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => moveBlock(i, 1)}
                      disabled={i === draft.length - 1}
                      aria-label="Move down"
                    >
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => removeBlock(i)}
                      aria-label="Remove block"
                      data-testid={`planner-block-${i}-remove`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                {b.focusType === "Custom" && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Custom name</Label>
                      <Input
                        value={b.customName}
                        onChange={(e) =>
                          updateBlock(i, { customName: e.target.value })
                        }
                        placeholder="e.g. Heat Adaptation"
                        data-testid={`planner-block-${i}-name`}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Notes (optional)</Label>
                      <Input
                        value={b.customNotes}
                        onChange={(e) =>
                          updateBlock(i, { customNotes: e.target.value })
                        }
                        placeholder="Tagged onto every day's description"
                      />
                    </div>
                  </div>
                )}
                <BlockSparkline
                  weeks={mileageByBlock.get(i) ?? []}
                  peakTotalMi={peakTotalMi}
                  testId={`planner-block-${i}-sparkline`}
                />
              </li>
            ))}
            {draft.length === 0 && (
              <li className="text-sm text-muted-foreground py-4 text-center">
                No user blocks yet. Add one to get started — the
                Marathon-Specific tail is already pinned.
              </li>
            )}
            <li className="border rounded-lg p-3 bg-muted/40 border-dashed">
              <div className="flex items-center gap-2">
                <Lock className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs font-mono text-muted-foreground w-6">
                  #{draft.length + 1}
                </span>
                <Badge variant="secondary">Marathon-Specific</Badge>
                <span className="text-sm">{MARATHON_TAIL_WEEKS} weeks</span>
                <span className="ml-auto text-xs uppercase tracking-wider text-muted-foreground">
                  Auto-pinned
                </span>
              </div>
              <BlockSparkline
                weeks={mileageByBlock.get(draft.length) ?? []}
                peakTotalMi={peakTotalMi}
                testId="planner-block-tail-sparkline"
              />
            </li>
          </ol>
        </CardContent>
      </Card>

      {/* ---------- TIMELINE PREVIEW ---------- */}
      <Card>
        <CardHeader>
          <CardTitle className="uppercase tracking-wider text-sm">
            Plan Preview
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <MileageCurve
            weeks={mileagePreview}
            blocks={previewBlocks}
            testId="planner-mileage-curve"
          />
          <ol
            className="space-y-1 text-sm font-mono"
            data-testid="planner-preview"
          >
            {previewBlocks.map((b, i) => (
              <li
                key={i}
                className="flex items-center gap-3 px-2 py-1 rounded hover:bg-muted/50"
              >
                <span className="text-muted-foreground tabular-nums w-24">
                  W{b.startWeek}-W{b.endWeek}
                </span>
                <span className="text-muted-foreground tabular-nums w-12">
                  {b.weeks}w
                </span>
                {b.startDateISO && b.endDateISO && (
                  <span
                    className="text-xs text-muted-foreground tabular-nums"
                    data-testid="planner-preview-dates"
                  >
                    {b.startDateISO} → {b.endDateISO}
                  </span>
                )}
                <span className="font-semibold uppercase tracking-wider">
                  {b.label}
                </span>
                {b.autoPinned && (
                  <Badge variant="secondary" className="text-[10px]">
                    Auto-pinned
                  </Badge>
                )}
                {b.customNotes && (
                  <span className="text-xs text-muted-foreground">
                    [{b.customNotes}]
                  </span>
                )}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      {/* ---------- ACTIONS ---------- */}
      <div className="flex flex-wrap gap-3 sticky bottom-4 bg-background/80 backdrop-blur-sm p-2 rounded-lg border">
        <Button
          onClick={handleSave}
          disabled={!isValid || putMutation.isPending}
          data-testid="planner-save"
        >
          <Save className="h-4 w-4 mr-1" />
          {putMutation.isPending ? "Saving…" : "Save Config"}
        </Button>
        <Button
          variant="default"
          className="bg-primary"
          onClick={() => setConfirmApplyOpen(true)}
          disabled={!isValid || isApplying}
          data-testid="planner-apply"
        >
          <Play className="h-4 w-4 mr-1" />
          {isApplying ? "Applying…" : "Apply (Regenerate Plan)"}
        </Button>
      </div>

      <AlertDialog open={confirmApplyOpen} onOpenChange={setConfirmApplyOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Regenerate the entire plan?</AlertDialogTitle>
            <AlertDialogDescription>
              This wipes every plan day and week and rebuilds them from this
              config. Your logged workouts and body measurements are kept,
              and any pending reset-undo snapshots are dropped (their day ids
              no longer match). This cannot be undone — the only way back is
              to edit the config and Apply again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleApply}
              data-testid="planner-confirm-apply"
            >
              Yes — regenerate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// Compact inline sparkline for a single phase block. Plots two polylines
// (total weekly mileage and Sunday long run) on a fixed-height SVG so two
// blocks rendered side-by-side are visually comparable. Empty / single-week
// blocks fall back to a tiny "—" placeholder so the row height stays stable
// while the runner is in the middle of editing weeks.
function BlockSparkline({
  weeks,
  peakTotalMi,
  testId,
}: {
  weeks: WeekMileagePreview[];
  peakTotalMi: number;
  testId: string;
}) {
  if (weeks.length === 0) {
    return (
      <div
        className="mt-3 h-10 flex items-center text-[10px] uppercase tracking-wider text-muted-foreground"
        data-testid={testId}
      >
        Mileage preview unavailable
      </div>
    );
  }
  const W = 280;
  const H = 40;
  const PAD_X = 2;
  const PAD_Y = 4;
  const ceiling = Math.max(1, peakTotalMi);
  const x = (i: number) =>
    weeks.length === 1
      ? W / 2
      : PAD_X + (i / (weeks.length - 1)) * (W - PAD_X * 2);
  const y = (mi: number) =>
    H - PAD_Y - (mi / ceiling) * (H - PAD_Y * 2);
  const totalPath = weeks
    .map((w, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(w.totalMi).toFixed(1)}`)
    .join(" ");
  const longPath = weeks
    .map((w, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(w.longRunMi).toFixed(1)}`)
    .join(" ");
  const peakWeekMi = weeks.reduce((m, w) => Math.max(m, w.totalMi), 0);
  const peakLongMi = weeks.reduce((m, w) => Math.max(m, w.longRunMi), 0);
  return (
    <div className="mt-3" data-testid={testId}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-10 block"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path
          d={totalPath}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.25}
          className="text-primary"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={longPath}
          fill="none"
          stroke="currentColor"
          strokeWidth={1}
          strokeDasharray="3 2"
          className="text-muted-foreground"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="flex justify-between text-[10px] uppercase tracking-wider text-muted-foreground mt-1">
        <span>
          <span className="text-primary">●</span> Total · peak{" "}
          <span className="font-semibold tabular-nums">
            {peakWeekMi.toFixed(1)}mi
          </span>
        </span>
        <span>
          <span className="text-muted-foreground">— —</span> Long · peak{" "}
          <span className="font-semibold tabular-nums">
            {peakLongMi.toFixed(1)}mi
          </span>
        </span>
      </div>
    </div>
  );
}

// Full plan-wide mileage curve shown in the Plan Preview card. Renders a
// pure-SVG area-style chart of total weekly miles + the Sunday long run,
// with vertical guides at every phase block boundary so the runner can see
// at a glance where each block bends the curve. Y-axis is auto-scaled to
// the peak week so taper/recovery dips are visible without zooming.
function MileageCurve({
  weeks,
  blocks,
  testId,
}: {
  weeks: WeekMileagePreview[];
  blocks: Array<{ label: string; startWeek: number; endWeek: number }>;
  testId: string;
}) {
  if (weeks.length === 0) {
    return (
      <div
        className="h-40 flex items-center justify-center text-sm text-muted-foreground border rounded-md"
        data-testid={testId}
      >
        Add a phase block to see the projected mileage curve.
      </div>
    );
  }
  const W = 720;
  const H = 180;
  const PAD_L = 32;
  const PAD_R = 12;
  const PAD_T = 12;
  const PAD_B = 22;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const peak = Math.max(
    1,
    weeks.reduce((m, w) => Math.max(m, w.totalMi), 0),
  );
  const ceiling = Math.ceil(peak / 5) * 5;
  const totalWeeks = weeks.length;
  const x = (week: number) =>
    PAD_L +
    (totalWeeks === 1
      ? innerW / 2
      : ((week - 1) / (totalWeeks - 1)) * innerW);
  const y = (mi: number) => PAD_T + innerH - (mi / ceiling) * innerH;

  const totalPoints = weeks
    .map((w) => `${x(w.week).toFixed(1)},${y(w.totalMi).toFixed(1)}`)
    .join(" ");
  const longPoints = weeks
    .map((w) => `${x(w.week).toFixed(1)},${y(w.longRunMi).toFixed(1)}`)
    .join(" ");
  const areaPath = `M${x(weeks[0]!.week).toFixed(1)},${y(0).toFixed(1)} L${totalPoints
    .split(" ")
    .join(" L")} L${x(weeks[weeks.length - 1]!.week).toFixed(1)},${y(0).toFixed(1)} Z`;

  // Y-axis ticks at 0 / 50% / peak.
  const yTicks = [0, ceiling / 2, ceiling];

  return (
    <div data-testid={testId}>
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">
          Projected weekly mileage
        </div>
        <div className="flex gap-3 text-[10px] uppercase tracking-wider text-muted-foreground">
          <span>
            <span className="text-primary">●</span> Total
          </span>
          <span>
            <span className="text-muted-foreground">— —</span> Long run
          </span>
          <span>
            Peak{" "}
            <span className="font-semibold tabular-nums text-foreground">
              {peak.toFixed(1)}mi
            </span>
          </span>
        </div>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-44 block"
        preserveAspectRatio="none"
        role="img"
        aria-label="Projected weekly mileage curve"
      >
        {/* Y-axis grid + labels */}
        {yTicks.map((t, i) => (
          <g key={i}>
            <line
              x1={PAD_L}
              x2={W - PAD_R}
              y1={y(t)}
              y2={y(t)}
              stroke="currentColor"
              strokeWidth={0.5}
              strokeDasharray="2 3"
              className="text-border"
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={PAD_L - 4}
              y={y(t) + 3}
              textAnchor="end"
              fontSize={9}
              className="fill-muted-foreground"
            >
              {Math.round(t)}
            </text>
          </g>
        ))}
        {/* Block boundary verticals */}
        {blocks.map((b, i) => {
          const startX = x(b.startWeek);
          const endX = x(b.endWeek);
          return (
            <g key={i}>
              {i > 0 && (
                <line
                  x1={startX}
                  x2={startX}
                  y1={PAD_T}
                  y2={H - PAD_B}
                  stroke="currentColor"
                  strokeWidth={0.5}
                  className="text-border"
                  vectorEffect="non-scaling-stroke"
                />
              )}
              <text
                x={(startX + endX) / 2}
                y={H - 6}
                textAnchor="middle"
                fontSize={8}
                className="fill-muted-foreground uppercase tracking-wider"
              >
                {b.label.length > 14 ? `${b.label.slice(0, 12)}…` : b.label}
              </text>
            </g>
          );
        })}
        {/* Area under total */}
        <path d={areaPath} className="fill-primary/10" />
        {/* Total polyline */}
        <polyline
          points={totalPoints}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          className="text-primary"
          vectorEffect="non-scaling-stroke"
        />
        {/* Long run polyline */}
        <polyline
          points={longPoints}
          fill="none"
          stroke="currentColor"
          strokeWidth={1}
          strokeDasharray="4 3"
          className="text-muted-foreground"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

function Stat({
  label,
  value,
  ok,
  ...rest
}: {
  label: string;
  value: string | number;
  ok?: boolean;
  "data-testid"?: string;
}) {
  return (
    <div
      className={`rounded-md border p-3 ${
        ok === true
          ? "border-green-500/50 bg-green-500/5"
          : ok === false
          ? "border-destructive/50 bg-destructive/5"
          : ""
      }`}
      data-testid={rest["data-testid"]}
    >
      <div className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="text-xl font-bold tabular-nums mt-1">{value}</div>
    </div>
  );
}
