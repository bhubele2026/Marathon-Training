import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  useListPlannerConfigs,
  useGetPlannerConfig,
  useCreatePlannerConfig,
  useUpdatePlannerConfig,
  useDeletePlannerConfig,
  useDuplicatePlannerConfig,
  useActivatePlannerConfig,
  useApplyPlannerConfig,
  getListPlannerConfigsQueryKey,
  getGetPlannerConfigQueryKey,
  type PhaseBlock,
} from "@workspace/api-client-react";
import {
  FOCUS_TYPES,
  MARATHON_TAIL_WEEKS,
  PLAN_TEMPLATES,
  STARTER_SHORTCUTS,
  expandEntriesToBlocks,
  getTemplateById,
  previewWeeklyMileage,
  type FocusType,
  type PlanTemplate,
  type StarterShortcut,
  type TemplateEntry,
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
import {
  ArrowDown,
  ArrowUp,
  Plus,
  Trash2,
  Save,
  Play,
  Lock,
  Copy,
  FilePlus,
  Library,
  Sparkles,
  BookOpen,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { invalidateMissionRelatedQueries } from "@/lib/invalidate-mission-queries";

// FOCUS_TYPES, FocusType, and MARATHON_TAIL_WEEKS are imported from
// @workspace/plan-generator above so the planner page, the validator, and
// the generator never drift on the canonical set of focus types or the
// auto-pinned tail length.

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function dayOfWeekUTC(iso: string): number | null {
  if (!ISO_DATE_RE.test(iso)) return null;
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(t)) return null;
  return new Date(t).getUTCDay();
}

function addDaysISO(iso: string, days: number): string {
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(t)) return iso;
  const d = new Date(t + days * 86400000);
  return d.toISOString().slice(0, 10);
}

// Given a Monday `startISO` and a desired total span in weeks, returns the
// race-day ISO date — i.e. the Sunday at the end of the final week.
function computeRaceDateForTotalWeeks(
  startISO: string,
  totalWeeks: number,
): string {
  return addDaysISO(startISO, totalWeeks * 7 - 1);
}

// Returns the next Monday on or after today (ISO yyyy-mm-dd, UTC).
function nextMondayISO(): string {
  const now = new Date();
  const utcMidnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const todayDow = new Date(utcMidnight).getUTCDay(); // 0=Sun..6=Sat
  const daysUntilMonday = todayDow === 1 ? 0 : (8 - todayDow) % 7 || 7;
  return new Date(utcMidnight + daysUntilMonday * 86400000)
    .toISOString()
    .slice(0, 10);
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

// Default config offered when no config has ever been saved (i.e. first
// run of the app). Mirrors the canonical 52-week campaign.
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
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const listQuery = useListPlannerConfigs();
  // The selected config the runner is currently editing. When null, the
  // page renders an "empty" state offering to create the first config.
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [name, setName] = useState<string>("");
  const [startDate, setStartDate] = useState<string>("");
  const [marathonDate, setMarathonDate] = useState<string>("");
  const [draft, setDraft] = useState<DraftBlock[]>([]);
  const [confirmApplyOpen, setConfirmApplyOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  // Tracks whether the local edit form has been hydrated for the
  // currently selected config. Reset whenever selectedId changes so we
  // re-pull the form values from the server response, but stable while
  // the runner is editing so an incidental list refetch doesn't blow
  // away in-progress edits.
  const [hydratedForId, setHydratedForId] = useState<number | null>(null);
  // Plan Template Library state (Task #84). The runner picks a template +
  // user-block week count and clicks Apply Template; we expand the
  // template into the focus-type editor below and adjust the marathon
  // date so the auto-pinned 16-week tail still lands on a Sunday.
  const [tplWeeks, setTplWeeks] = useState<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    for (const t of PLAN_TEMPLATES) out[t.id] = t.defaultWeeks;
    return out;
  });
  const [lastAppliedTemplate, setLastAppliedTemplate] = useState<string | null>(
    null,
  );
  // Entries-mode state (Task #84). When non-null, the runner is composing
  // their plan from PLAN_TEMPLATES instead of editing focus-type blocks
  // directly. The server projects entries → blocks at write time, so the
  // legacy `draft` (PhaseBlock[]) below stays in sync as the read-only
  // projection used for the mileage preview / timeline.
  const [entries, setEntries] = useState<TemplateEntry[] | null>(null);

  const detailQuery = useGetPlannerConfig(selectedId ?? 0, {
    query: {
      enabled: selectedId !== null,
      queryKey: getGetPlannerConfigQueryKey(selectedId ?? 0),
    },
  });

  const createMutation = useCreatePlannerConfig();
  const updateMutation = useUpdatePlannerConfig();
  const deleteMutation = useDeletePlannerConfig();
  const duplicateMutation = useDuplicatePlannerConfig();
  const activateMutation = useActivatePlannerConfig();
  const applyMutation = useApplyPlannerConfig();
  const isApplying = updateMutation.isPending || applyMutation.isPending;

  const configs = listQuery.data?.configs ?? [];
  const activeId = listQuery.data?.activeId ?? null;
  const selectedSummary = configs.find((c) => c.id === selectedId) ?? null;
  const selectedIsActive = selectedSummary?.isActive ?? false;

  // When the configs list loads, auto-select either the active config or
  // the most recently updated one so the runner lands on something useful.
  useEffect(() => {
    if (selectedId !== null) return;
    if (!listQuery.data) return;
    const next = activeId ?? configs[0]?.id ?? null;
    if (next !== null) setSelectedId(next);
  }, [listQuery.data, activeId, configs, selectedId]);

  // Hydrate the form whenever the detail query resolves for a NEW selectedId.
  useEffect(() => {
    if (selectedId === null) return;
    if (hydratedForId === selectedId) return;
    const cfg = detailQuery.data;
    if (!cfg) return;
    setName(cfg.name);
    setStartDate(cfg.startDate);
    setMarathonDate(cfg.marathonDate);
    setDraft(blocksToDraft(cfg.blocks as PhaseBlock[]));
    // Hydrate entries-mode if the saved config has entries; otherwise
    // null = legacy blocks-mode (auto-pinned 16-week tail).
    const cfgEntries = (cfg as { entries?: TemplateEntry[] | null }).entries;
    setEntries(
      Array.isArray(cfgEntries) && cfgEntries.length > 0 ? cfgEntries : null,
    );
    setHydratedForId(selectedId);
  }, [selectedId, hydratedForId, detailQuery.data]);

  const isEntriesMode = entries !== null;

  // ---- Derived timeline math (mirrors the server validator) -----------
  const totalWeeks = totalWeeksBetween(startDate, marathonDate);
  const expectedUserWeeks = Math.max(0, totalWeeks - MARATHON_TAIL_WEEKS);
  const userWeeksSum = draft.reduce((s, b) => s + (b.weeks || 0), 0);
  const entriesWeeksSum = isEntriesMode
    ? entries!.reduce((s, e) => s + (e.weeks || 0), 0)
    : 0;
  const startDow = dayOfWeekUTC(startDate);
  const raceDow = dayOfWeekUTC(marathonDate);

  const issues: string[] = [];
  if (!name.trim()) issues.push("Pick a name for this config.");
  if (!startDate) issues.push("Pick a training start date.");
  else if (startDow !== 1) issues.push("Training start date must be a Monday.");
  if (!marathonDate) issues.push("Pick a marathon date.");
  else if (raceDow !== 0) issues.push("Marathon date must be a Sunday.");
  if (isEntriesMode) {
    // Entries-mode: each template owns its own taper, so entries weeks
    // must sum to the FULL total span (no auto-pinned tail).
    if (entries!.length === 0) {
      issues.push("Composition is empty — add at least one template entry.");
    }
    if (totalWeeks > 0 && entriesWeeksSum !== totalWeeks) {
      issues.push(
        `Template entries total ${entriesWeeksSum} weeks, but need exactly ${totalWeeks} (each template owns its own taper — no auto-pinned tail).`,
      );
    }
    for (let i = 0; i < entries!.length; i++) {
      const e = entries![i]!;
      if (!e.weeks || e.weeks < 1) {
        issues.push(`Entry ${i + 1} needs at least 1 week.`);
      }
      if (!getTemplateById(e.templateId)) {
        issues.push(`Entry ${i + 1} references unknown template "${e.templateId}".`);
      }
    }
  } else {
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

  // ---- Plan Template Library handlers ---------------------------------
  // Apply a template ADDS it as a TemplateEntry to the entries composition
  // (Task #84). Each template owns its own taper, so the new entry's weeks
  // are the FULL span — no auto-pinned 16-week tail. Switches the editor
  // into entries-mode if it isn't already, and bumps the marathon date so
  // totalWeeks == sum(entries.weeks).
  function applyTemplate(tpl: PlanTemplate, weeks: number) {
    const start =
      startDate && dayOfWeekUTC(startDate) === 1 ? startDate : nextMondayISO();
    const nextEntries: TemplateEntry[] = [
      ...(entries ?? []),
      { templateId: tpl.id, weeks, customNotes: null },
    ];
    const total = nextEntries.reduce((s, e) => s + (e.weeks || 0), 0);
    const race = computeRaceDateForTotalWeeks(start, total);
    setEntries(nextEntries);
    setStartDate(start);
    setMarathonDate(race);
    setDraft(blocksToDraft(expandEntriesToBlocks(nextEntries)));
    setLastAppliedTemplate(tpl.id);
    toast({
      title: `${tpl.name} added`,
      description: `${weeks}-week entry added (total span ${total}w). Source: ${tpl.source}.`,
    });
  }

  // Apply a one-click starter shortcut: sets dates AND ENTRIES AND a
  // suggested config name. Each starter is a COMPOSITION of template
  // entries (e.g. Aerobic Base lead-in + race-specific template), so we
  // copy the full entries array. Replaces any existing entries — starters
  // are a "fresh slate" workflow. Total span = sum(entries.weeks); each
  // template owns its own taper (no auto-pinned tail).
  function applyStarter(s: StarterShortcut) {
    const start = nextMondayISO();
    const total = s.entries.reduce((acc, e) => acc + e.weeks, 0);
    const race = computeRaceDateForTotalWeeks(start, total);
    const nextEntries: TemplateEntry[] = s.entries.map((e) => ({
      templateId: e.templateId,
      weeks: e.weeks,
      customNotes: null,
    }));
    setEntries(nextEntries);
    setStartDate(start);
    setMarathonDate(race);
    setDraft(blocksToDraft(expandEntriesToBlocks(nextEntries)));
    const last = nextEntries[nextEntries.length - 1];
    if (last) setLastAppliedTemplate(last.templateId);
    if (!name.trim()) setName(s.name);
    toast({
      title: `${s.name} loaded`,
      description: `Start ${start}, race ${race} (${total}w total). Save then Apply to generate workouts.`,
    });
  }

  // Entries-mode mutators. Every mutation re-projects entries → draft
  // blocks so the mileage preview and timeline stay in sync.
  function reprojectEntries(next: TemplateEntry[]) {
    setEntries(next);
    setDraft(blocksToDraft(expandEntriesToBlocks(next)));
  }
  function updateEntry(i: number, patch: Partial<TemplateEntry>) {
    if (!entries) return;
    reprojectEntries(entries.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));
  }
  function removeEntry(i: number) {
    if (!entries) return;
    reprojectEntries(entries.filter((_, idx) => idx !== i));
  }
  function moveEntry(i: number, dir: -1 | 1) {
    if (!entries) return;
    const next = [...entries];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    const [item] = next.splice(i, 1);
    next.splice(j, 0, item!);
    reprojectEntries(next);
  }
  function addEntry(templateId: string) {
    const tpl = getTemplateById(templateId);
    if (!tpl) return;
    const base: TemplateEntry[] = entries ?? [];
    const next: TemplateEntry[] = [
      ...base,
      { templateId, weeks: tpl.defaultWeeks, customNotes: null },
    ];
    reprojectEntries(next);
  }
  function exitEntriesMode() {
    // Switching out of entries-mode discards the composition list. Warn
    // the runner first so they don't lose their template ordering.
    if (
      entries &&
      entries.length > 0 &&
      !window.confirm(
        "Switching to the advanced (legacy) editor will discard your template composition. The projected blocks will remain editable. Continue?",
      )
    ) {
      return;
    }
    setEntries(null);
  }
  function enterEntriesMode() {
    if (
      draft.length > 0 &&
      !window.confirm(
        "Switching to template composition will clear the current focus-type blocks. You can re-add templates from the library above. Continue?",
      )
    ) {
      return;
    }
    setEntries([]);
    setDraft([]);
  }

  function invalidatePlannerLists() {
    queryClient.invalidateQueries({ queryKey: getListPlannerConfigsQueryKey() });
    if (selectedId !== null) {
      queryClient.invalidateQueries({
        queryKey: getGetPlannerConfigQueryKey(selectedId),
      });
    }
  }

  // ---- Save / Apply -----------------------------------------------------
  function handleSave() {
    if (!isValid || selectedId === null) {
      toast({
        title: "Fix errors first",
        description: issues[0],
        variant: "destructive",
      });
      return;
    }
    updateMutation.mutate(
      {
        id: selectedId,
        data: {
          name: name.trim(),
          startDate,
          marathonDate,
          blocks: draftToBlocks(draft),
          entries: isEntriesMode ? entries! : null,
        },
      },
      {
        onSuccess: () => {
          toast({
            title: "Planner saved",
            description: "Click Apply to regenerate the plan from this config.",
          });
          invalidatePlannerLists();
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

  // Apply always saves the current draft FIRST, then activates this config
  // (so /planner/apply on the server picks it up), then triggers
  // regeneration, then routes to /plan.
  function handleApply() {
    setConfirmApplyOpen(false);
    if (!isValid || selectedId === null) {
      toast({
        title: "Fix errors first",
        description: issues[0],
        variant: "destructive",
      });
      return;
    }
    const id = selectedId;
    updateMutation.mutate(
      {
        id,
        data: {
          name: name.trim(),
          startDate,
          marathonDate,
          blocks: draftToBlocks(draft),
          entries: isEntriesMode ? entries! : null,
        },
      },
      {
        onSuccess: () => {
          invalidatePlannerLists();
          // Activate this config first so /planner/apply targets it,
          // even if the runner had a different config marked active.
          activateMutation.mutate(
            { id },
            {
              onSuccess: () => {
                invalidatePlannerLists();
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
                      description:
                        err instanceof Error ? err.message : "Unknown error",
                      variant: "destructive",
                    });
                  },
                });
              },
              onError: (err: unknown) => {
                toast({
                  title: "Activate failed",
                  description:
                    err instanceof Error ? err.message : "Unknown error",
                  variant: "destructive",
                });
              },
            },
          );
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
      // In entries-mode each template owns its own taper, so we MUST NOT
      // append the auto-pinned 16w Marathon-Specific tail to the preview.
      return previewWeeklyMileage(draftToBlocks(draft), {
        appendMarathonTail: !isEntriesMode,
      });
    } catch {
      return [];
    }
  }, [draft, isEntriesMode]);

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

  function handleSelectConfig(idStr: string) {
    const id = Number(idStr);
    if (!Number.isFinite(id)) return;
    setSelectedId(id);
    // Force re-hydration when the detail query fetches the new id.
    setHydratedForId(null);
  }

  function handleActivate() {
    if (selectedId === null) return;
    activateMutation.mutate(
      { id: selectedId },
      {
        onSuccess: () => {
          toast({
            title: "Config activated",
            description: `"${name}" is now the active config. Click Apply to regenerate the plan.`,
          });
          invalidatePlannerLists();
        },
        onError: (err: unknown) => {
          toast({
            title: "Activate failed",
            description: err instanceof Error ? err.message : "Unknown error",
            variant: "destructive",
          });
        },
      },
    );
  }

  function handleDuplicate() {
    if (selectedId === null) return;
    duplicateMutation.mutate(
      { id: selectedId, data: {} },
      {
        onSuccess: (created) => {
          toast({
            title: "Config duplicated",
            description: `Created "${created.name}".`,
          });
          // Switch to the new copy so the runner can rename / edit it.
          setSelectedId(created.id);
          setHydratedForId(null);
          invalidatePlannerLists();
        },
        onError: (err: unknown) => {
          toast({
            title: "Duplicate failed",
            description: err instanceof Error ? err.message : "Unknown error",
            variant: "destructive",
          });
        },
      },
    );
  }

  function handleDelete() {
    setConfirmDeleteOpen(false);
    if (selectedId === null) return;
    const id = selectedId;
    deleteMutation.mutate(
      { id },
      {
        onSuccess: (resp) => {
          toast({
            title: "Config deleted",
            description: resp.newActiveId
              ? "Promoted another config to active."
              : undefined,
          });
          // Move selection to whichever config the server promoted (or
          // the first remaining one).
          setSelectedId(resp.newActiveId ?? null);
          setHydratedForId(null);
          invalidatePlannerLists();
        },
        onError: (err: unknown) => {
          toast({
            title: "Delete failed",
            description: err instanceof Error ? err.message : "Unknown error",
            variant: "destructive",
          });
        },
      },
    );
  }

  function handleCreateConfig() {
    const blank = defaultBlankConfig();
    const newName = createName.trim() || `Config ${configs.length + 1}`;
    createMutation.mutate(
      {
        data: {
          name: newName,
          startDate: blank.startDate,
          marathonDate: blank.marathonDate,
          blocks: blank.blocks,
        },
      },
      {
        onSuccess: (created) => {
          toast({ title: "Config created", description: `"${created.name}"` });
          setSelectedId(created.id);
          setHydratedForId(null);
          setCreateOpen(false);
          setCreateName("");
          invalidatePlannerLists();
        },
        onError: (err: unknown) => {
          toast({
            title: "Create failed",
            description: err instanceof Error ? err.message : "Unknown error",
            variant: "destructive",
          });
        },
      },
    );
  }

  // ---- Phase block timeline (preview) ----------------------------------
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
    const startMs =
      startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate)
        ? Date.parse(`${startDate}T00:00:00Z`)
        : NaN;
    const isoForWeek = (
      weekIndexOneBased: number,
      weekCount: number,
    ): string | null => {
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
    // Legacy mode pins the trailing 16-week Marathon-Specific block;
    // entries-mode lets each template own its own taper, so the timeline
    // ends at the last user block.
    if (!isEntriesMode) {
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
    }
    return list;
  }, [draft, startDate, isEntriesMode]);

  // ---- Loading / empty states ------------------------------------------
  if (listQuery.isLoading) {
    return (
      <div className="space-y-6" data-testid="planner-loading">
        <Skeleton className="h-12 w-1/3" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (configs.length === 0) {
    return (
      <div className="space-y-6 pb-12" data-testid="planner-page-empty">
        <header>
          <h1 className="text-3xl font-bold tracking-tight uppercase">
            Phase Planner
          </h1>
          <p className="text-muted-foreground mt-1">
            No saved configs yet. Create your first one to get started.
          </p>
        </header>
        <Card>
          <CardContent className="py-8 flex flex-col items-center gap-3">
            <Input
              placeholder="Config name (e.g. Spring 2027 marathon)"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              data-testid="planner-empty-name"
              className="max-w-sm"
            />
            <Button
              onClick={handleCreateConfig}
              data-testid="planner-empty-create"
            >
              <FilePlus className="h-4 w-4 mr-1" /> Create config
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (selectedId === null || (detailQuery.isLoading && hydratedForId === null)) {
    return (
      <div className="space-y-6" data-testid="planner-loading">
        <Skeleton className="h-12 w-1/3" />
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

      {/* ---------- CONFIG PICKER ---------- */}
      <Card>
        <CardHeader>
          <CardTitle className="uppercase tracking-wider text-sm">
            Saved Configs
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Select
            value={String(selectedId)}
            onValueChange={handleSelectConfig}
          >
            <SelectTrigger
              className="w-72"
              data-testid="planner-config-select"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {configs.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.name}
                  {c.isActive ? " (active)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedIsActive ? (
            <Badge variant="default" data-testid="planner-active-badge">
              Active
            </Badge>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={handleActivate}
              disabled={activateMutation.isPending}
              data-testid="planner-activate"
            >
              Set Active
            </Button>
          )}
          <div className="ml-auto flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setCreateOpen(true)}
              data-testid="planner-new-config"
            >
              <FilePlus className="h-4 w-4 mr-1" /> New
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleDuplicate}
              disabled={duplicateMutation.isPending}
              data-testid="planner-duplicate"
            >
              <Copy className="h-4 w-4 mr-1" /> Duplicate
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setConfirmDeleteOpen(true)}
              disabled={configs.length <= 1 || deleteMutation.isPending}
              data-testid="planner-delete"
            >
              <Trash2 className="h-4 w-4 mr-1" /> Delete
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ---------- PLAN TEMPLATE LIBRARY (Task #84) ---------- */}
      <Card data-testid="planner-template-library">
        <CardHeader>
          <CardTitle className="uppercase tracking-wider text-sm flex items-center gap-2">
            <Library className="h-4 w-4" /> Plan Template Library
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Pick a research-backed template — each one owns its own taper.
            Compose multiple templates with &quot;Apply Template&quot; (e.g.
            Aerobic Base + Half Marathon) or one-click a starter shortcut.
            Save then Apply to deterministically generate every workout.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Starter shortcuts: one-click full configs */}
          <div className="space-y-2">
            <h3 className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              <Sparkles className="h-3 w-3" /> Starter shortcuts
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {STARTER_SHORTCUTS.map((s) => (
                <div
                  key={s.id}
                  className="border rounded-md p-3 flex flex-col gap-2"
                  data-testid={`planner-starter-${s.id}`}
                >
                  <div className="font-medium text-sm">{s.name}</div>
                  <div className="text-xs text-muted-foreground flex-1">
                    {s.description}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => applyStarter(s)}
                    data-testid={`planner-starter-apply-${s.id}`}
                  >
                    <Sparkles className="h-3 w-3 mr-1" /> Use this starter
                  </Button>
                </div>
              ))}
            </div>
          </div>

          {/* Template grid */}
          <div className="space-y-2">
            <h3 className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              <BookOpen className="h-3 w-3" /> Templates
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {PLAN_TEMPLATES.map((tpl) => {
                const weeks = tplWeeks[tpl.id] ?? tpl.defaultWeeks;
                const outOfRange =
                  weeks < tpl.minWeeks || weeks > tpl.maxWeeks;
                const isLastApplied = lastAppliedTemplate === tpl.id;
                return (
                  <div
                    key={tpl.id}
                    className={`border rounded-md p-3 flex flex-col gap-2 ${isLastApplied ? "border-primary" : ""}`}
                    data-testid={`planner-template-${tpl.id}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-medium text-sm">{tpl.name}</div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          {tpl.goalDistance} · {tpl.source}
                        </div>
                      </div>
                      {isLastApplied && (
                        <Badge variant="secondary" className="text-[10px]">
                          Applied
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground flex-1">
                      {tpl.shortDescription}
                    </div>
                    <dl className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
                      <dt className="uppercase tracking-wider">Peak LR</dt>
                      <dd
                        className="text-right font-mono"
                        data-testid={`planner-template-${tpl.id}-peak-lr`}
                      >
                        {tpl.metadata.peakLongRun}
                      </dd>
                      <dt className="uppercase tracking-wider">Peak vol</dt>
                      <dd
                        className="text-right font-mono"
                        data-testid={`planner-template-${tpl.id}-peak-vol`}
                      >
                        {tpl.metadata.peakWeeklyVolume}
                      </dd>
                      <dt className="uppercase tracking-wider">Taper</dt>
                      <dd className="text-right font-mono">
                        {tpl.metadata.taperLength}
                      </dd>
                      <dt className="uppercase tracking-wider">Range</dt>
                      <dd className="text-right font-mono">
                        {tpl.minWeeks}–{tpl.maxWeeks}w (default {tpl.defaultWeeks})
                      </dd>
                    </dl>
                    <div className="text-[10px] text-muted-foreground italic">
                      {tpl.citation}
                    </div>
                    <div className="flex items-center gap-2">
                      <Label
                        htmlFor={`tpl-weeks-${tpl.id}`}
                        className="text-xs whitespace-nowrap"
                      >
                        Weeks ({tpl.minWeeks}–{tpl.maxWeeks})
                      </Label>
                      <Input
                        id={`tpl-weeks-${tpl.id}`}
                        type="number"
                        min={1}
                        max={60}
                        value={weeks}
                        onChange={(e) =>
                          setTplWeeks((m) => ({
                            ...m,
                            [tpl.id]: Math.max(
                              1,
                              parseInt(e.target.value, 10) || 0,
                            ),
                          }))
                        }
                        className="h-8 w-20"
                        data-testid={`planner-template-weeks-${tpl.id}`}
                      />
                    </div>
                    {outOfRange && (
                      <p
                        className="text-[10px] text-amber-600 dark:text-amber-400"
                        data-testid={`planner-template-warn-${tpl.id}`}
                      >
                        Outside the published range — program may not match
                        the source.
                      </p>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => applyTemplate(tpl, weeks)}
                      data-testid={`planner-template-apply-${tpl.id}`}
                    >
                      Apply template
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ---------- NAME + DATES ---------- */}
      <Card>
        <CardHeader>
          <CardTitle className="uppercase tracking-wider text-sm">
            Config
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label htmlFor="planner-name">Name</Label>
            <Input
              id="planner-name"
              data-testid="planner-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Spring 2027 marathon"
            />
          </div>
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
            <Stat label="Blocks" value={`${draft.length} + 1 pinned`} />
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

      {/* ---------- COMPOSITION EDITOR (entries mode, Task #84) ---------- */}
      {isEntriesMode && (
        <Card data-testid="planner-composition-editor">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="uppercase tracking-wider text-sm">
                Composition · {entries!.length} entr{entries!.length === 1 ? "y" : "ies"} · {entriesWeeksSum}/{totalWeeks}w
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Each template owns its own taper — no auto-pinned 16-week
                tail. Use Apply Template above to add more entries; reorder
                or remove below.
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={exitEntriesMode}
              data-testid="planner-exit-entries-mode"
            >
              Switch to advanced (legacy) editor
            </Button>
          </CardHeader>
          <CardContent>
            {entries!.length === 0 ? (
              <p
                className="text-sm text-muted-foreground"
                data-testid="planner-composition-empty"
              >
                No entries yet — pick a template from the library above and
                click &quot;Use this starter&quot; or set the weeks and
                &quot;Apply Template&quot; to add it here.
              </p>
            ) : (
              <ol
                className="space-y-2"
                data-testid="planner-composition-list"
              >
                {entries!.map((e, i) => {
                  const tpl = getTemplateById(e.templateId);
                  return (
                    <li
                      key={i}
                      className="border rounded-lg p-3 bg-card"
                      data-testid={`planner-entry-${i}`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-mono text-muted-foreground w-6">
                          #{i + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm">
                            {tpl?.name ?? e.templateId}
                          </div>
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                            {tpl?.goalDistance ?? "—"} · {tpl?.source ?? "unknown source"}
                          </div>
                        </div>
                        <Input
                          type="number"
                          min={1}
                          className="w-24"
                          value={e.weeks}
                          onChange={(ev) =>
                            updateEntry(i, {
                              weeks: Math.max(1, Number(ev.target.value) || 1),
                            })
                          }
                          data-testid={`planner-entry-${i}-weeks`}
                        />
                        <span className="text-xs text-muted-foreground">weeks</span>
                        <div className="ml-auto flex gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => moveEntry(i, -1)}
                            disabled={i === 0}
                            aria-label="Move up"
                            data-testid={`planner-entry-${i}-up`}
                          >
                            <ArrowUp className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => moveEntry(i, 1)}
                            disabled={i === entries!.length - 1}
                            aria-label="Move down"
                            data-testid={`planner-entry-${i}-down`}
                          >
                            <ArrowDown className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => removeEntry(i)}
                            aria-label="Remove entry"
                            data-testid={`planner-entry-${i}-remove`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                      {tpl && (
                        <div className="mt-2 space-y-1">
                          <p
                            className="text-[10px] text-muted-foreground"
                            data-testid={`planner-entry-${i}-range`}
                          >
                            Range {tpl.minWeeks}–{tpl.maxWeeks}w · default {tpl.defaultWeeks}w · peak {tpl.metadata.peakWeeklyVolume} · LR {tpl.metadata.peakLongRun} · taper {tpl.metadata.taperLength}
                          </p>
                          {(e.weeks < tpl.minWeeks || e.weeks > tpl.maxWeeks) && (
                            <p
                              className="text-[10px] text-amber-600 dark:text-amber-400"
                              data-testid={`planner-entry-${i}-out-of-range`}
                            >
                              Outside the published {tpl.minWeeks}–{tpl.maxWeeks}w range — server will reject save.
                            </p>
                          )}
                          <p className="text-[10px] text-muted-foreground italic">
                            {tpl.citation}
                          </p>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
            <div className="mt-3 flex items-center gap-2">
              <Label className="text-xs">Quick-add template:</Label>
              <Select onValueChange={(v) => addEntry(v)} value="">
                <SelectTrigger
                  className="h-8 w-64"
                  data-testid="planner-entry-add-select"
                >
                  <SelectValue placeholder="Pick a template…" />
                </SelectTrigger>
                <SelectContent>
                  {PLAN_TEMPLATES.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name} ({t.defaultWeeks}w default)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ---------- BLOCKS EDITOR (legacy / advanced) ----------
          Hidden entirely in entries-mode: in entries-mode the
          Composition card above is the source of truth, and the
          Timeline Preview card below already shows the projected
          blocks (read-only). Showing a mutable copy here would let
          the runner make edits that are silently discarded on save. */}
      {!isEntriesMode && (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="uppercase tracking-wider text-sm">
            Phase Blocks
          </CardTitle>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={enterEntriesMode}
              data-testid="planner-enter-entries-mode"
            >
              Switch to template composition
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={addBlock}
              data-testid="planner-add-block"
            >
              <Plus className="h-4 w-4 mr-1" /> Add Block
            </Button>
          </div>
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
      )}

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
          disabled={!isValid || updateMutation.isPending}
          data-testid="planner-save"
        >
          <Save className="h-4 w-4 mr-1" />
          {updateMutation.isPending ? "Saving…" : "Save Config"}
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
              This activates "{name}" and wipes every plan day and week,
              rebuilding them from this config. Your logged workouts and body
              measurements are kept, and any pending reset-undo snapshots are
              dropped (their day ids no longer match). This cannot be undone —
              the only way back is to switch configs and Apply again.
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

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this config?</AlertDialogTitle>
            <AlertDialogDescription>
              "{name}" will be removed permanently. The plan rows already on
              disk are not touched — only the saved config is deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              data-testid="planner-confirm-delete"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={createOpen} onOpenChange={setCreateOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>New Planner config</AlertDialogTitle>
            <AlertDialogDescription>
              Starts from the canonical 52-week template. You can edit dates
              and blocks after creating it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            placeholder="Config name (e.g. Fall 2027)"
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            data-testid="planner-new-config-name"
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCreateConfig}
              data-testid="planner-confirm-new-config"
            >
              Create
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
