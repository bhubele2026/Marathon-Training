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
  useListPlannerTemplates,
  getListPlannerConfigsQueryKey,
  getGetPlannerConfigQueryKey,
  type PhaseBlock,
} from "@workspace/api-client-react";
import {
  FOCUS_TYPES,
  MARATHON_TAIL_WEEKS,
  PLAN_TEMPLATES,
  STARTER_SHORTCUTS,
  expandEntriesToBlocksWithGaps,
  projectEntries,
  getTemplateById,
  isArchivedTemplateId,
  previewWeeklyMileage,
  HYBRID_POSITIONS_ORDERED,
  HYBRID_POSITION_LABEL,
  HYBRID_POSITION_BLURB,
  HYBRID_DEFAULT_DAYS_PER_WEEK,
  HYBRID_MIN_DAYS_PER_WEEK,
  HYBRID_MAX_DAYS_PER_WEEK,
  type FocusType,
  type HybridFitnessLevel,
  type HybridMixPosition,
  type PlanTemplate,
  type StarterShortcut,
  type TemplateEntry,
  type WeekMileagePreview,
} from "@workspace/plan-generator";
import { useQueryClient } from "@tanstack/react-query";
import { HybridWeekPreview } from "@/components/hybrid-week-preview";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
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
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Search,
  X,
  ChevronsUpDown,
  Check,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { invalidateMissionRelatedQueries } from "@/lib/invalidate-mission-queries";
import { describeValidationError } from "@/lib/api-errors";

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

// Given a Monday `startISO` and an arbitrary user-picked end date,
// snaps the end to the nearest week boundary (Sunday `weeks*7-1` days
// after the start) and clamps the resulting week count to
// [minWeeks, maxWeeks]. Returns null if either date is malformed or
// the picked end is before the start. `clamped` is true when the
// user's intent was outside the template's published range.
function weeksFromEndDateISO(
  startISO: string,
  endISO: string,
  minWeeks: number,
  maxWeeks: number,
): { weeks: number; clamped: boolean; rawWeeks: number } | null {
  if (!ISO_DATE_RE.test(startISO) || !ISO_DATE_RE.test(endISO)) return null;
  const startMs = Date.parse(`${startISO}T00:00:00Z`);
  const endMs = Date.parse(`${endISO}T00:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  const days = Math.round((endMs - startMs) / 86400000);
  // weeks satisfies endISO == startISO + (weeks*7 - 1) days, so a Sunday
  // pick on week N gives days+1 == 7*N exactly. Mid-week picks snap
  // FORWARD to the next Sunday (ceil) so the runner never loses a week
  // they meant to include. End dates at or before start floor to 1 week
  // (caller's clamp then raises that to minWeeks if minWeeks > 1).
  const rawWeeks = Math.max(1, Math.ceil((days + 1) / 7));
  const clamped = rawWeeks < minWeeks || rawWeeks > maxWeeks;
  const weeks = Math.min(maxWeeks, Math.max(minWeeks, rawWeeks));
  return { weeks, clamped, rawWeeks };
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
// run of the app). Anchors to the next Monday and a short Tonal-first
// upper-body lift block followed by the auto-pinned 16-week
// Marathon-Specific tail so the resulting payload immediately satisfies
// validatePlannerConfig (legacy blocks-mode requires
// sum(user blocks) === totalWeeks - MARATHON_TAIL_WEEKS, which would be
// negative if marathonDate were closer than MARATHON_TAIL_WEEKS out).
// The runner can flip the "Training for a marathon?" toggle and add
// user blocks / templates to grow it into a race campaign.
//
// Default user phase length (weeks) prepended before the auto-pinned
// MARATHON_TAIL_WEEKS Marathon-Specific tail. Kept short so the runner
// can immediately edit it, but >= 1 so the validator's
// "block weeks must sum to totalWeeks - MARATHON_TAIL_WEEKS" rule
// is satisfied by the blank payload.
const DEFAULT_BLANK_USER_WEEKS = 4;

export function defaultBlankConfig(): {
  startDate: string;
  marathonDate: string;
  blocks: PhaseBlock[];
} {
  const start = nextMondayISO();
  const totalWeeks = DEFAULT_BLANK_USER_WEEKS + MARATHON_TAIL_WEEKS;
  const marathon = computeRaceDateForTotalWeeks(start, totalWeeks);
  return {
    startDate: start,
    marathonDate: marathon,
    blocks: [
      {
        focusType: "Custom",
        weeks: DEFAULT_BLANK_USER_WEEKS,
        customName: "Tonal Strength — Upper",
        customNotes: "[lift-primary:upper]",
      },
    ],
  };
}

// Categories for grouping the Plan Template Library. The catalog grew
// from 16 to 54+ templates so a flat grid is unbrowsable; we bucket
// each template by its primary modality (cardio machine vs strength
// vs custom slot) so the runner can collapse irrelevant sections.
//
// TEMPLATE_LEVELS, levelOfTemplate, filterTemplatesByQuery, and
// groupTemplatesByLevel all live in src/lib/planner-templates.ts so
// the Plan Template Library card and the entries-mode quick-add
// combobox stay in lock-step when new searchable fields are added.
import {
  TEMPLATE_LEVELS,
  type TemplateLevel,
  levelOfTemplate,
  filterTemplatesByQuery,
  filterTemplatesByTags,
  getAllTemplateTags,
  countTemplatesByTag,
  sortTags,
  type TagSortMode,
  groupTemplatesByLevel,
} from "../lib/planner-templates";
export { levelOfTemplate };

// localStorage key for the planner's per-level collapse state.
// Versioned so we can change the shape later without colliding with
// stale entries. Bumped to v2 when the picker switched from
// modality-based categories to skill-level groupings (task #132) so
// stale "Bike"/"Strength" collapse state doesn't bleed into the new
// Beginner/Intermediate/Advanced layout.
const COLLAPSED_CATEGORIES_STORAGE_KEY =
  "planner.collapsedTemplateLevels.v2";

// localStorage key for the planner's per-template "Details" expansion
// state in the Plan Template Library card. Versioned so we can change
// the shape later without colliding with stale entries.
const EXPANDED_TEMPLATES_STORAGE_KEY = "planner.expandedTemplates.v1";

// localStorage key for the planner's free-text template search filter.
// Versioned so we can change the shape later without colliding with
// stale entries.
const TEMPLATE_SEARCH_STORAGE_KEY = "planner.templateSearch.v1";

// localStorage key for the planner's tag-cloud filter selection in the
// Plan Template Library card. Versioned so we can change the shape
// later without colliding with stale entries.
const SELECTED_TEMPLATE_TAGS_STORAGE_KEY = "planner.selectedTemplateTags.v1";

// localStorage keys for the per-surface tag-cloud sort mode toggle
// (alphabetical vs. by template count). Each surface persists its
// own choice so the runner's preference sticks per cloud.
const TEMPLATE_TAG_SORT_STORAGE_KEY = "planner.templateTagSort.v1";
const QUICKADD_TAG_SORT_STORAGE_KEY = "planner.quickAddTagSort.v1";

function readTagSortMode(key: string, fallback: TagSortMode): TagSortMode {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === "alpha" || raw === "count") return raw;
  } catch {
    // Ignore corrupt storage and fall through to default.
  }
  return fallback;
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
  // Plan Template Library state. The runner picks a template +
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
  // Set of template ids whose "Details" panel is currently expanded in
  // the Plan Template Library card. Toggled by the per-card Details
  // button, and also force-expanded when the runner clicks "View source"
  // from a composition entry (which also scrolls the card into view).
  const [expandedTemplates, setExpandedTemplates] = useState<Set<string>>(
    () => {
      if (typeof window !== "undefined") {
        try {
          const raw = window.localStorage.getItem(
            EXPANDED_TEMPLATES_STORAGE_KEY,
          );
          if (raw) {
            const parsed: unknown = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              const knownIds = new Set(PLAN_TEMPLATES.map((t) => t.id));
              const valid = parsed.filter(
                (id): id is string =>
                  typeof id === "string" && knownIds.has(id),
              );
              return new Set<string>(valid);
            }
          }
        } catch {
          // Ignore corrupt storage and fall through to default.
        }
      }
      return new Set();
    },
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        EXPANDED_TEMPLATES_STORAGE_KEY,
        JSON.stringify(Array.from(expandedTemplates)),
      );
    } catch {
      // Storage may be full or disabled; ignore.
    }
  }, [expandedTemplates]);
  // Free-text filter applied to the Plan Template Library — matches
  // template name, source (author / book), and equipment hint
  // (case-insensitive). When non-empty, every category section that
  // contains a match auto-expands so results are visible without an
  // extra click.
  const [templateSearch, setTemplateSearch] = useState<string>(() => {
    if (typeof window !== "undefined") {
      try {
        const raw = window.localStorage.getItem(TEMPLATE_SEARCH_STORAGE_KEY);
        if (typeof raw === "string") return raw;
      } catch {
        // Ignore corrupt storage and fall through to default.
      }
    }
    return "";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (templateSearch === "") {
        window.localStorage.removeItem(TEMPLATE_SEARCH_STORAGE_KEY);
      } else {
        window.localStorage.setItem(
          TEMPLATE_SEARCH_STORAGE_KEY,
          templateSearch,
        );
      }
    } catch {
      // Storage may be full or disabled; ignore.
    }
  }, [templateSearch]);
  // Tag-cloud filter applied to the Plan Template Library (AND
  // semantics — selecting multiple chips narrows to templates that
  // carry every selected tag). Clickable chips above the search input
  // make tag-based discovery work without typing, especially on mobile.
  const [selectedTemplateTags, setSelectedTemplateTags] = useState<
    Set<string>
  >(() => {
    if (typeof window !== "undefined") {
      try {
        const raw = window.localStorage.getItem(
          SELECTED_TEMPLATE_TAGS_STORAGE_KEY,
        );
        if (raw) {
          const parsed: unknown = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            // Hydrate against the bundled fallback catalog so we can
            // drop obviously-stale tags before the server catalog
            // arrives. A second pass below prunes any tags that are
            // present in the fallback but missing from the live
            // server catalog (e.g. a tag the server has retired).
            const knownTags = new Set(getAllTemplateTags(PLAN_TEMPLATES));
            const valid = parsed.filter(
              (t): t is string => typeof t === "string" && knownTags.has(t),
            );
            return new Set<string>(valid);
          }
        }
      } catch {
        // Ignore corrupt storage and fall through to default.
      }
    }
    return new Set();
  });
  function toggleTemplateTag(tag: string) {
    setSelectedTemplateTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (selectedTemplateTags.size === 0) {
        window.localStorage.removeItem(SELECTED_TEMPLATE_TAGS_STORAGE_KEY);
      } else {
        window.localStorage.setItem(
          SELECTED_TEMPLATE_TAGS_STORAGE_KEY,
          JSON.stringify(Array.from(selectedTemplateTags)),
        );
      }
    } catch {
      // Storage may be full or disabled; ignore.
    }
  }, [selectedTemplateTags]);
  // Parallel tag-cloud filter applied to the entries-mode quick-add
  // popover so the runner can narrow the same catalog without typing
  // there too. Reset whenever the popover closes (alongside the
  // free-text query) so re-opening the popover is a clean slate.
  const [quickAddSelectedTags, setQuickAddSelectedTags] = useState<
    Set<string>
  >(() => new Set());
  // Per-surface sort mode for the tag chip cloud. "count" surfaces the
  // broadest filters first (default — most useful out of the box);
  // "alpha" sorts the chips alphabetically for runners who want to
  // scan by name. Persisted per surface so each cloud remembers the
  // runner's preference independently.
  const [templateTagSortMode, setTemplateTagSortMode] = useState<TagSortMode>(
    () => readTagSortMode(TEMPLATE_TAG_SORT_STORAGE_KEY, "count"),
  );
  const [quickAddTagSortMode, setQuickAddTagSortMode] = useState<TagSortMode>(
    () => readTagSortMode(QUICKADD_TAG_SORT_STORAGE_KEY, "count"),
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        TEMPLATE_TAG_SORT_STORAGE_KEY,
        templateTagSortMode,
      );
    } catch {
      // Storage may be full or disabled; ignore.
    }
  }, [templateTagSortMode]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        QUICKADD_TAG_SORT_STORAGE_KEY,
        quickAddTagSortMode,
      );
    } catch {
      // Storage may be full or disabled; ignore.
    }
  }, [quickAddTagSortMode]);
  function toggleQuickAddTag(tag: string) {
    setQuickAddSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }
  // Once the runner has applied at least one filter (free-text or
  // chip), zero-count chips are collapsed behind a "+N hidden" toggle
  // so a wide tag catalog doesn't leave a forest of muted chips
  // crowding the cloud. Per-surface so the two clouds expand
  // independently.
  const [showHiddenTemplateChips, setShowHiddenTemplateChips] =
    useState(false);
  const [showHiddenQuickAddChips, setShowHiddenQuickAddChips] =
    useState(false);
  // Tag cloud collapse state. Defaults closed so the wide chip wall
  // doesn't dominate the card on open; trigger button reveals the panel
  // and keeps any selected-count badge visible at all times.
  const [templateTagCloudOpen, setTemplateTagCloudOpen] = useState(false);
  const [quickAddTagCloudOpen, setQuickAddTagCloudOpen] = useState(false);
  // Per-level collapse state for the grouped template grid. Default
  // is "Beginner" expanded (the gentlest entry point) and Intermediate
  // / Advanced collapsed so the picker doesn't overwhelm a first-time
  // runner with high-mileage Pfitz plans. Toggled by the section
  // header chevron. Persisted to localStorage so a returning advanced
  // runner sees their preferred level already expanded (storage key
  // `COLLAPSED_CATEGORIES_STORAGE_KEY`, hoisted to module scope).
  const [collapsedCategories, setCollapsedCategories] = useState<
    Set<TemplateLevel>
  >(() => {
    if (typeof window !== "undefined") {
      try {
        const raw = window.localStorage.getItem(
          COLLAPSED_CATEGORIES_STORAGE_KEY,
        );
        if (raw) {
          const parsed: unknown = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            const valid = parsed.filter((c): c is TemplateLevel =>
              (TEMPLATE_LEVELS as readonly string[]).includes(c as string),
            );
            return new Set<TemplateLevel>(valid);
          }
        }
      } catch {
        // Ignore corrupt storage and fall through to default.
      }
    }
    return new Set<TemplateLevel>(
      TEMPLATE_LEVELS.filter((c) => c !== "Beginner"),
    );
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        COLLAPSED_CATEGORIES_STORAGE_KEY,
        JSON.stringify(Array.from(collapsedCategories)),
      );
    } catch {
      // Storage may be full or disabled; ignore.
    }
  }, [collapsedCategories]);
  function toggleCategory(cat: TemplateLevel) {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }
  function toggleTemplateDetails(id: string) {
    setExpandedTemplates((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function viewTemplateSource(id: string) {
    setExpandedTemplates((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    if (typeof window !== "undefined") {
      // Defer until after the details panel re-renders so the scroll
      // target lands on the fully-expanded card height.
      window.requestAnimationFrame(() => {
        const el = document.querySelector(
          `[data-testid="planner-template-${id}"]`,
        );
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
    }
  }
  // Entries-mode state. When non-null, the runner is composing
  // their plan from PLAN_TEMPLATES instead of editing focus-type blocks
  // directly. The server projects entries → blocks at write time, so the
  // legacy `draft` (PhaseBlock[]) below stays in sync as the read-only
  // projection used for the mileage preview / timeline.
  const [entries, setEntries] = useState<TemplateEntry[] | null>(null);
  // Apply Template on a 2nd+ entry stages a pending template; the
  // dialog asks for the Monday it should start on (default = stack
  // back-to-back; later = insert a Recovery filler gap).
  const [pendingApplyTemplate, setPendingApplyTemplate] = useState<
    | {
        templateId: string;
        templateName: string;
        templateSource: string;
        weeks: number;
        proposedStartDate: string;
      }
    | null
  >(null);
  const [pendingApplyStartDate, setPendingApplyStartDate] = useState<string>("");
  // Index of the composition entry currently hovered/focused via the
  // timeline strip (or list row), used to highlight the corresponding
  // bar/row pair. Null = nothing highlighted.
  const [hoveredEntry, setHoveredEntry] = useState<number | null>(null);
  // Per-entry clamp feedback: last picked end date that was outside the
  // template's published [minWeeks, maxWeeks] range and got snapped.
  // Cleared when the user picks an in-range date or removes the entry.
  const [entryClampHints, setEntryClampHints] = useState<
    Record<number, { rawWeeks: number; clampedWeeks: number; bound: "min" | "max" }>
  >({});
  // Same shape for the Apply Template dialog (single staged entry).
  const [applyClampHint, setApplyClampHint] = useState<
    { rawWeeks: number; clampedWeeks: number; bound: "min" | "max" } | null
  >(null);
  // Open state for the searchable Quick-add template combobox in the
  // Composition card. We control it so we can close the popover after
  // the runner picks a template.
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddSearch, setQuickAddSearch] = useState("");
  // ---- Custom hybrid builder state (Task #136) ----
  // Locally-staged inputs for the "Build my own hybrid" Beginner card.
  // Stored as a separate slice so the form state survives template
  // search / collapse without being entangled with `tplWeeks` (which
  // is keyed by template id and used for the standard apply flow).
  // Default to a 5-day Balanced beginner plan with no event date —
  // matches the most common runner asking for "a bit of both".
  const [hybridPosition, setHybridPosition] =
    useState<HybridMixPosition>("balanced");
  const [hybridDaysPerWeek, setHybridDaysPerWeek] = useState<number>(
    HYBRID_DEFAULT_DAYS_PER_WEEK,
  );
  const [hybridLevel, setHybridLevel] =
    useState<HybridFitnessLevel>("beginner");
  // Optional event date — when set, we trim the block weeks so the
  // hybrid block ends exactly the Sunday before the event Monday.
  // Empty string = no event, runner picks weeks directly via Weeks input.
  const [hybridEventDate, setHybridEventDate] = useState<string>("");
  // Reset the "show hidden" toggles whenever the runner clears their
  // filters so the next filter session starts from the
  // collapsed-by-default state instead of remembering a stale
  // expansion. (The popover also resets quickAddSearch /
  // quickAddSelectedTags on close, so this also covers "popover
  // closed" implicitly.)
  const templateFiltersActive =
    templateSearch.trim().length > 0 || selectedTemplateTags.size > 0;
  useEffect(() => {
    if (!templateFiltersActive && showHiddenTemplateChips) {
      setShowHiddenTemplateChips(false);
    }
  }, [templateFiltersActive, showHiddenTemplateChips]);
  const quickAddFiltersActive =
    quickAddSearch.trim().length > 0 || quickAddSelectedTags.size > 0;
  useEffect(() => {
    if (!quickAddFiltersActive && showHiddenQuickAddChips) {
      setShowHiddenQuickAddChips(false);
    }
  }, [quickAddFiltersActive, showHiddenQuickAddChips]);
  // Marathon mode toggle. When true (legacy default), the planner
  // auto-pins a trailing 16-week Marathon-Specific block, the validator
  // requires (totalWeeks - 16) user-block weeks, and the preview / pinned
  // tail card render. When false, the planner is a general workout
  // planner — user blocks must sum to the full totalWeeks span. Hidden
  // entirely in entries-mode (each template owns its own taper). The
  // initial value is auto-detected on hydration so legacy marathon
  // configs keep their old behavior.
  const [isMarathonMode, setIsMarathonMode] = useState(false);

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
  // Fetch the catalog from the server so the runner-facing UI is
  // sourced from the API (the server's catalog is canonical; the
  // imported registry is the same data and used as a fallback for
  // type-safety when the request is loading).
  const templatesQuery = useListPlannerTemplates();
  const templates = templatesQuery.data?.templates ?? PLAN_TEMPLATES;
  const starters = templatesQuery.data?.starters ?? STARTER_SHORTCUTS;
  const isApplying = updateMutation.isPending || applyMutation.isPending;

  // Group templates by category, applying the free-text search filter
  // (case-insensitive match against name, source, and equipment hint).
  // Empty categories are dropped so the section list adapts to the
  // current filter.
  const groupedTemplates = useMemo(() => {
    return groupTemplatesByLevel(
      filterTemplatesByTags(
        filterTemplatesByQuery(templates, templateSearch),
        selectedTemplateTags,
      ),
    );
  }, [templates, templateSearch, selectedTemplateTags]);
  // Search/filter results are scoped to currently-VISIBLE level
  // sections. A level the runner has collapsed is treated as "out of
  // view" — its matches do NOT inflate the summary count and do NOT
  // force-expand the section. Each level's own header still shows its
  // local match count so the runner can opt in by clicking to expand.
  const totalMatchedTemplates = groupedTemplates.reduce(
    (s, g) => (collapsedCategories.has(g.level) ? s : s + g.list.length),
    0,
  );
  const hiddenMatchedTemplates = groupedTemplates.reduce(
    (s, g) => (collapsedCategories.has(g.level) ? s + g.list.length : s),
    0,
  );
  const hasActiveSearch = templateSearch.trim().length > 0;
  const hasActiveTags = selectedTemplateTags.size > 0;
  // Distinct tags across the catalog. Memoized so the chip cloud
  // doesn't re-build on every keystroke in the search input. The final
  // chip order is derived per-surface below via sortTags so the
  // most-used (or alphabetical) tags come first under the active
  // filter context, controlled by the per-surface sort toggle.
  const allDistinctTags = useMemo(
    () => getAllTemplateTags(templates),
    [templates],
  );
  // Per-chip "would-still-match" counts for each tag cloud, scoped to
  // the surface's own free-text search + currently selected tags so a
  // chip's "tag · N" annotation reflects how many templates would
  // remain visible if that chip were added (or kept) in the filter.
  // Chips with a zero count are de-emphasized in the UI below.
  const templateTagCounts = useMemo(
    () =>
      countTemplatesByTag(
        filterTemplatesByQuery(templates, templateSearch),
        selectedTemplateTags,
      ),
    [templates, templateSearch, selectedTemplateTags],
  );
  const quickAddTagCounts = useMemo(
    () =>
      countTemplatesByTag(
        filterTemplatesByQuery(templates, quickAddSearch),
        quickAddSelectedTags,
      ),
    [templates, quickAddSearch, quickAddSelectedTags],
  );
  // Chip render order per surface: selected tags pinned first, then
  // by template count (descending), alphabetical as a tiebreaker. The
  // order updates whenever counts change (e.g. when the runner narrows
  // the free-text search or selects another tag).
  const allTemplateTags = useMemo(
    () =>
      sortTags(
        allDistinctTags,
        templateTagCounts,
        selectedTemplateTags,
        templateTagSortMode,
      ),
    [
      allDistinctTags,
      templateTagCounts,
      selectedTemplateTags,
      templateTagSortMode,
    ],
  );
  const allQuickAddTags = useMemo(
    () =>
      sortTags(
        allDistinctTags,
        quickAddTagCounts,
        quickAddSelectedTags,
        quickAddTagSortMode,
      ),
    [
      allDistinctTags,
      quickAddTagCounts,
      quickAddSelectedTags,
      quickAddTagSortMode,
    ],
  );
  // Once the live server catalog resolves, drop any persisted tags
  // that no longer exist (catalog churn between visits) so we never
  // filter on a tag the runner can't see in the chip cloud.
  useEffect(() => {
    if (!templatesQuery.data) return;
    if (selectedTemplateTags.size === 0) return;
    const known = new Set(allTemplateTags);
    let changed = false;
    const pruned = new Set<string>();
    for (const t of selectedTemplateTags) {
      if (known.has(t)) pruned.add(t);
      else changed = true;
    }
    if (changed) setSelectedTemplateTags(pruned);
  }, [templatesQuery.data, allTemplateTags, selectedTemplateTags]);

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
    // Auto-detect marathon mode for legacy blocks-mode configs. Any
    // Custom block whose customNotes opens with the lift-primary
    // sentinel marks the config as a non-marathon (Tonal-first) plan;
    // otherwise default to marathon-mode so pre-existing race configs
    // keep auto-pinning the 16-week tail.
    const hasLiftPrimary = (cfg.blocks as PhaseBlock[]).some(
      (b) =>
        b.focusType === "Custom" &&
        typeof b.customNotes === "string" &&
        /^\[lift-primary:/.test(b.customNotes),
    );
    setIsMarathonMode(
      !(Array.isArray(cfgEntries) && cfgEntries.length > 0) && !hasLiftPrimary,
    );
    setHydratedForId(selectedId);
  }, [selectedId, hydratedForId, detailQuery.data]);

  const isEntriesMode = entries !== null;

  // Preview the marathon-date impact of the staged Apply Template so
  // the runner can see whether confirming will push race day forward
  // (which is silent re-anchoring otherwise). When `willOverrun` is
  // true we surface a warning + a "Keep current race date" trim option.
  const pendingApplyPreview = useMemo(() => {
    if (!pendingApplyTemplate) return null;
    const chosen = pendingApplyStartDate;
    if (!chosen || dayOfWeekUTC(chosen) !== 1) return null;
    const existing = entries ?? [];
    const isFirst = existing.length === 0;
    const baseStart = isFirst
      ? chosen
      : startDate && dayOfWeekUTC(startDate) === 1
        ? startDate
        : nextMondayISO();
    const cursorDefault = pendingApplyTemplate.proposedStartDate;
    const startDateField = isFirst
      ? null
      : chosen !== cursorDefault
        ? chosen
        : null;
    const staged: TemplateEntry[] = [
      ...existing,
      {
        templateId: pendingApplyTemplate.templateId,
        weeks: pendingApplyTemplate.weeks,
        customName: null,
        customNotes: null,
        startDate: startDateField,
      },
    ];
    const projs = projectEntries(staged, baseStart);
    const projected =
      staged.reduce((s, e) => s + (e.weeks || 0), 0) +
      projs.reduce((s, p) => s + p.gapWeeksBefore, 0);
    const previewRace = computeRaceDateForTotalWeeks(baseStart, projected);
    if (!marathonDate) {
      return {
        previewRace,
        currentRace: marathonDate,
        weekDelta: 0,
        willOverrun: false,
        trimmedWeeks: null as number | null,
      };
    }
    const previewMs = Date.parse(`${previewRace}T00:00:00Z`);
    const currentMs = Date.parse(`${marathonDate}T00:00:00Z`);
    const weekDelta = Number.isFinite(previewMs) && Number.isFinite(currentMs)
      ? Math.round((previewMs - currentMs) / (7 * 86400000))
      : 0;
    const willOverrun = previewMs > currentMs;
    let trimmedWeeks: number | null = null;
    if (willOverrun) {
      const baseProjs = projectEntries(existing, baseStart);
      const existingProjected =
        existing.reduce((s, e) => s + (e.weeks || 0), 0) +
        baseProjs.reduce((s, p) => s + p.gapWeeksBefore, 0);
      const probe: TemplateEntry[] = [
        ...existing,
        {
          templateId: pendingApplyTemplate.templateId,
          weeks: 1,
          customName: null,
          customNotes: null,
          startDate: startDateField,
        },
      ];
      const probeProjs = projectEntries(probe, baseStart);
      const gapForNew =
        probeProjs[probeProjs.length - 1]?.gapWeeksBefore ?? 0;
      const currentTotal = isFirst
        ? totalWeeksBetween(baseStart, marathonDate)
        : totalWeeksBetween(startDate, marathonDate);
      const t = currentTotal - existingProjected - gapForNew;
      trimmedWeeks = t >= 1 ? t : null;
    }
    return { previewRace, currentRace: marathonDate, weekDelta, willOverrun, trimmedWeeks };
  }, [pendingApplyTemplate, pendingApplyStartDate, entries, startDate, marathonDate]);

  // ---- Derived timeline math (mirrors the server validator) -----------
  const totalWeeks = totalWeeksBetween(startDate, marathonDate);
  const expectedUserWeeks = Math.max(
    0,
    totalWeeks - (isMarathonMode ? MARATHON_TAIL_WEEKS : 0),
  );
  const userWeeksSum = draft.reduce((s, b) => s + (b.weeks || 0), 0);
  const entriesWeeksSum = isEntriesMode
    ? entries!.reduce((s, e) => s + (e.weeks || 0), 0)
    : 0;
  // Per-entry projections (start/end ISO + leading gap weeks). Only
  // computed when the runner has a valid Monday startDate so the
  // running cursor is well-defined.
  const entryProjections = useMemo(() => {
    if (!isEntriesMode || !startDate || dayOfWeekUTC(startDate) !== 1) return [];
    return projectEntries(entries!, startDate);
  }, [entries, isEntriesMode, startDate]);
  const entriesGapWeeksSum = entryProjections.reduce(
    (s, p) => s + p.gapWeeksBefore,
    0,
  );
  // Projected span = sum of entry weeks + sum of leading gap weeks.
  // This is what the server's totalWeeks invariant compares against in
  // entries-mode (each gap is filled with a Recovery block).
  const entriesProjectedWeeks = entriesWeeksSum + entriesGapWeeksSum;
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
    // (plus any per-entry gap weeks) must sum to the FULL total span
    // (no auto-pinned tail).
    if (entries!.length === 0) {
      issues.push("Composition is empty — add at least one template entry.");
    }
    if (totalWeeks > 0 && entriesProjectedWeeks !== totalWeeks) {
      const gapsCopy =
        entriesGapWeeksSum > 0
          ? ` plus ${entriesGapWeeksSum} gap week(s)`
          : "";
      issues.push(
        `Template entries total ${entriesWeeksSum} weeks${gapsCopy}, but need exactly ${totalWeeks} (each template owns its own taper — no auto-pinned tail).`,
      );
    }
    for (let i = 0; i < entries!.length; i++) {
      const e = entries![i]!;
      if (!e.weeks || e.weeks < 1) {
        issues.push(`Entry ${i + 1} needs at least 1 week.`);
      }
      if (!getTemplateById(e.templateId) && !isArchivedTemplateId(e.templateId)) {
        issues.push(`Entry ${i + 1} references unknown template "${e.templateId}".`);
      }
      // Per-entry startDate sanity (Monday, on/after cursor, first
      // equals config startDate). Mirrors the server validator so
      // Save/Apply gating reflects what the server will accept.
      const sd = e.startDate;
      if (sd != null && sd !== "") {
        if (!ISO_DATE_RE.test(sd)) {
          issues.push(`Entry ${i + 1} start date must be yyyy-mm-dd.`);
        } else if (dayOfWeekUTC(sd) !== 1) {
          issues.push(`Entry ${i + 1} start date must be a Monday.`);
        } else if (i === 0 && startDate && sd !== startDate) {
          issues.push(
            `Entry 1 start date must equal the config start date (${startDate}).`,
          );
        } else if (i > 0) {
          const prev = entryProjections.find((p) => p.entryIndex === i - 1);
          if (prev) {
            const cursor = addDaysISO(prev.endDateISO, 1);
            if (sd < cursor) {
              issues.push(
                `Entry ${i + 1} start date (${sd}) overlaps the previous entry — must be on or after ${cursor}.`,
              );
            }
          }
        }
      }
    }
  } else if (isMarathonMode) {
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
  } else {
    if (totalWeeks > 0 && userWeeksSum !== totalWeeks) {
      issues.push(
        `Block weeks total ${userWeeksSum}, but need exactly ${totalWeeks} (no auto-pinned tail when "Training for a marathon?" is off).`,
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
  //. Each template owns its own taper, so the new entry's weeks
  // are the FULL span — no auto-pinned 16-week tail. Switches the editor
  // into entries-mode if it isn't already, and bumps the marathon date so
  // totalWeeks == sum(entries.weeks).
  function applyTemplate(
    tpl: { id: string; name: string; source: string },
    weeks: number,
  ) {
    const start =
      startDate && dayOfWeekUTC(startDate) === 1 ? startDate : nextMondayISO();
    const existing = entries ?? [];
    // Every Apply (including the first entry) opens the start-date
    // confirmation dialog so the runner explicitly picks when this
    // template begins. Default = config start for entry #1, end of
    // previous entry for entries #2+.
    let cursor = start;
    if (existing.length > 0) {
      // Proposed start = end of last entry's last day + 1 (the next Monday).
      const projections = projectEntries(existing, start);
      const last = projections[projections.length - 1];
      cursor =
        last && last.endDateISO ? addDaysISO(last.endDateISO, 1) : start;
    }
    setPendingApplyTemplate({
      templateId: tpl.id,
      templateName: tpl.name,
      templateSource: tpl.source,
      weeks,
      proposedStartDate: cursor,
    });
    setPendingApplyStartDate(cursor);
    setApplyClampHint(null);
  }

  // Confirms the dialog opened by applyTemplate. For the FIRST entry,
  // the chosen date becomes the new config start (entry #0 must equal
  // config start). For LATER entries, the chosen date is recorded on
  // the entry only when it differs from the cursor default — in which
  // case a Recovery gap is inserted. Either way, re-anchors the race
  // date to weeks + gap weeks.
  function confirmPendingApplyTemplate(opts: { keepRaceDate?: boolean } = {}) {
    if (!pendingApplyTemplate) return;
    const existing = entries ?? [];
    const isFirst = existing.length === 0;
    const chosen = pendingApplyStartDate;
    // For the first entry, the chosen date IS the new config start
    // (entry #0's startDate must equal the config start, so we anchor
    // the config to the runner's pick instead of storing it on the
    // entry). For later entries, keep the existing config start and
    // record the chosen date on the entry only when it differs from
    // the cursor default (= insert a Recovery gap).
    const baseStart = isFirst
      ? (chosen && dayOfWeekUTC(chosen) === 1 ? chosen : nextMondayISO())
      : (startDate && dayOfWeekUTC(startDate) === 1 ? startDate : nextMondayISO());
    const cursorDefault = pendingApplyTemplate.proposedStartDate;
    const startDateField = isFirst
      ? null
      : chosen && chosen !== cursorDefault
        ? chosen
        : null;
    // "Keep current race date" mode: trim the new entry's weeks so the
    // projected total span stays equal to the current totalWeeks
    // between startDate/marathonDate (i.e. race day does NOT move).
    let weeks = pendingApplyTemplate.weeks;
    if (opts.keepRaceDate) {
      const baseProjs = projectEntries(existing, baseStart);
      const existingProjected =
        existing.reduce((s, e) => s + (e.weeks || 0), 0) +
        baseProjs.reduce((s, p) => s + p.gapWeeksBefore, 0);
      const probe: TemplateEntry[] = [
        ...existing,
        {
          templateId: pendingApplyTemplate.templateId,
          weeks: 1,
          customName: null,
          customNotes: null,
          startDate: startDateField,
        },
      ];
      const probeProjs = projectEntries(probe, baseStart);
      const gapForNew =
        probeProjs[probeProjs.length - 1]?.gapWeeksBefore ?? 0;
      const currentTotal = isFirst
        ? totalWeeksBetween(baseStart, marathonDate)
        : totalWeeksBetween(startDate, marathonDate);
      const trimmed = currentTotal - existingProjected - gapForNew;
      if (trimmed >= 1 && trimmed < weeks) weeks = trimmed;
    }
    const nextEntries: TemplateEntry[] = [
      ...existing,
      {
        templateId: pendingApplyTemplate.templateId,
        weeks,
        customName: null,
        customNotes: null,
        startDate: startDateField,
      },
    ];
    const projections = projectEntries(nextEntries, baseStart);
    const projected =
      nextEntries.reduce((s, e) => s + (e.weeks || 0), 0) +
      projections.reduce((s, p) => s + p.gapWeeksBefore, 0);
    const race = computeRaceDateForTotalWeeks(baseStart, projected);
    setEntries(nextEntries);
    setStartDate(baseStart);
    setMarathonDate(race);
    setDraft(blocksToDraft(expandEntriesToBlocksWithGaps(nextEntries, baseStart)));
    setLastAppliedTemplate(pendingApplyTemplate.templateId);
    const tplName = pendingApplyTemplate.templateName;
    const requested = pendingApplyTemplate.weeks;
    const src = pendingApplyTemplate.templateSource;
    setPendingApplyTemplate(null);
    setPendingApplyStartDate("");
    toast({
      title: `${tplName} added`,
      description:
        weeks !== requested
          ? `Trimmed to ${weeks}w (was ${requested}w) to keep race date ${race}. Source: ${src}.`
          : `${weeks}-week entry added (total span ${projected}w). Source: ${src}.`,
    });
  }

  // Apply a one-click starter shortcut: sets dates AND ENTRIES AND a
  // suggested config name. Each starter is a COMPOSITION of template
  // entries (e.g. Aerobic Base lead-in + race-specific template), so we
  // copy the full entries array. Replaces any existing entries — starters
  // are a "fresh slate" workflow. Total span = sum(entries.weeks); each
  // template owns its own taper (no auto-pinned tail).
  function applyStarter(s: StarterShortcut) {
    // Respect the user's chosen config start date when it's a valid
    // Monday so picking a custom start date before applying a starter
    // is preserved; otherwise fall back to the next Monday.
    const start =
      startDate && dayOfWeekUTC(startDate) === 1 ? startDate : nextMondayISO();
    const total = s.entries.reduce((acc, e) => acc + e.weeks, 0);
    const race = computeRaceDateForTotalWeeks(start, total);
    const nextEntries: TemplateEntry[] = s.entries.map((e) => ({
      templateId: e.templateId,
      weeks: e.weeks,
      customName: null,
      customNotes: null,
      startDate: null,
    }));
    setEntries(nextEntries);
    setStartDate(start);
    setMarathonDate(race);
    setDraft(blocksToDraft(expandEntriesToBlocksWithGaps(nextEntries, start)));
    const last = nextEntries[nextEntries.length - 1];
    if (last) setLastAppliedTemplate(last.templateId);
    if (!name.trim()) setName(s.name);
    toast({
      title: `${s.name} loaded`,
      description: `Start ${start}, race ${race} (${total}w total). Save then Apply to generate workouts.`,
    });
  }

  // Entries-mode mutators. Every mutation re-projects entries → draft
  // blocks so the mileage preview and timeline stay in sync. Also
  // re-anchors the marathonDate so sum(entries.weeks) === totalWeeks
  // — the server's entries-mode invariant — without making the runner
  // hand-fix dates after every add/remove/reorder.
  // Changing the config start date when entries already exist must:
  // 1. Shift entry-1's pinned startDate (which must equal config start)
  //    so the validator stays happy.
  // 2. Re-project the gap-aware draft so the preview/timeline reflect
  //    the new dates without losing composed gaps.
  // 3. Re-anchor the marathon date to the same projected span.
  function handleConfigStartDateChange(nextStart: string) {
    const prevStart = startDate;
    setStartDate(nextStart);
    if (
      !prevStart ||
      !nextStart ||
      !ISO_DATE_RE.test(prevStart) ||
      !ISO_DATE_RE.test(nextStart) ||
      dayOfWeekUTC(nextStart) !== 1
    ) {
      return;
    }
    const days = Math.round(
      (Date.parse(`${nextStart}T00:00:00Z`) -
        Date.parse(`${prevStart}T00:00:00Z`)) /
        86400000,
    );
    if (entries && entries.length > 0) {
      // Shift every pinned entry startDate by the same delta so composed
      // gaps survive the move; reproject the gap-aware draft and
      // re-anchor marathonDate from the projected span.
      const next = entries.map((e, i) => {
        if (i === 0 && e.startDate) return { ...e, startDate: nextStart };
        if (e.startDate && ISO_DATE_RE.test(e.startDate)) {
          return { ...e, startDate: addDaysISO(e.startDate, days) };
        }
        return e;
      });
      setEntries(next);
      setDraft(blocksToDraft(expandEntriesToBlocksWithGaps(next, nextStart)));
      const projections = projectEntries(next, nextStart);
      const projected =
        next.reduce((s, e) => s + (e.weeks || 0), 0) +
        projections.reduce((s, p) => s + p.gapWeeksBefore, 0);
      if (projected > 0) {
        setMarathonDate(computeRaceDateForTotalWeeks(nextStart, projected));
      }
      return;
    }
    // Legacy/blank/empty-entries: preserve the current total span by
    // shifting marathonDate by the same delta so changing the config
    // start date does not silently alter the plan duration.
    if (marathonDate && ISO_DATE_RE.test(marathonDate)) {
      setMarathonDate(addDaysISO(marathonDate, days));
    }
  }
  // Normalize per-entry startDate values after a structural mutation
  // (remove/move/update). Rules mirror the server validator so the
  // composition stays saveable:
  //   - Entry 0: startDate must be null OR exactly the config start.
  //     Anything else (e.g. an absolute Monday inherited from a moved
  //     entry) is cleared so it stacks on the config start.
  //   - Entries i>0: startDate must be Monday and >= the running
  //     cursor (= projected end of previous entry + 1 day). Anything
  //     else is cleared so it stacks back-to-back.
  function normalizeEntries(
    next: TemplateEntry[],
    configStart: string,
  ): TemplateEntry[] {
    const out: TemplateEntry[] = [];
    let cursor = configStart;
    for (let i = 0; i < next.length; i++) {
      const e = next[i]!;
      let sd: string | null = e.startDate ?? null;
      if (i === 0) {
        if (sd && sd !== configStart) sd = null;
      } else if (sd) {
        const valid =
          ISO_DATE_RE.test(sd) && dayOfWeekUTC(sd) === 1 && sd >= cursor;
        if (!valid) sd = null;
      }
      const startISO = sd ?? cursor;
      out.push({ ...e, startDate: sd });
      const weeks = Math.max(0, Math.floor(e.weeks));
      cursor = addDaysISO(startISO, weeks * 7);
    }
    return out;
  }
  function reprojectEntries(next: TemplateEntry[]) {
    const start =
      startDate && dayOfWeekUTC(startDate) === 1 ? startDate : nextMondayISO();
    const normalized = normalizeEntries(next, start);
    setEntries(normalized);
    setDraft(blocksToDraft(expandEntriesToBlocksWithGaps(normalized, start)));
    const projections = projectEntries(normalized, start);
    const projected =
      normalized.reduce((s, e) => s + (e.weeks || 0), 0) +
      projections.reduce((s, p) => s + p.gapWeeksBefore, 0);
    if (projected > 0) {
      if (start !== startDate) setStartDate(start);
      setMarathonDate(computeRaceDateForTotalWeeks(start, projected));
    }
  }
  function updateEntry(i: number, patch: Partial<TemplateEntry>) {
    if (!entries) return;
    reprojectEntries(entries.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));
  }
  function removeEntry(i: number) {
    if (!entries) return;
    reprojectEntries(entries.filter((_, idx) => idx !== i));
    // Drop hint for the removed row and shift down hints for rows after it.
    setEntryClampHints((prev) => {
      const next: typeof prev = {};
      for (const [k, v] of Object.entries(prev)) {
        const idx = Number(k);
        if (idx === i) continue;
        next[idx < i ? idx : idx - 1] = v;
      }
      return next;
    });
  }
  function moveEntry(i: number, dir: -1 | 1) {
    if (!entries) return;
    const next = [...entries];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    const [item] = next.splice(i, 1);
    next.splice(j, 0, item!);
    reprojectEntries(next);
    // Swap the two affected hint slots so they follow their entries.
    setEntryClampHints((prev) => {
      const out = { ...prev };
      const a = prev[i];
      const b = prev[j];
      if (a) out[j] = a; else delete out[j];
      if (b) out[i] = b; else delete out[i];
      return out;
    });
  }
  // Build the canonical sentinel string the generator parses to render
  // a hybrid week. Mirrors the `[hybrid-mix:<pos>] [hybrid-days:<N>]
  // [hybrid-level:<lvl>]` format expected by hybridMixSpec().
  function encodeHybridNotes(
    position: HybridMixPosition,
    daysPerWeek: number,
    level: HybridFitnessLevel,
  ): string {
    return `[hybrid-mix:${position}] [hybrid-days:${daysPerWeek}] [hybrid-level:${level}]`;
  }

  // Apply the custom_hybrid template as a TemplateEntry. Encodes the
  // slider position, days/week, and fitness level into customNotes so
  // the generator's hybrid week builder picks them up. If the runner
  // entered an event date (must be a Monday), trims the entry's weeks
  // so the block ends on the Sunday before the event Monday — that
  // way race-week falls just before the event without overshooting.
  // Falls back to the configured Weeks input when no event date is set.
  function applyHybridTemplate() {
    const tpl = getTemplateById("custom_hybrid");
    if (!tpl) return;
    const start =
      startDate && dayOfWeekUTC(startDate) === 1 ? startDate : nextMondayISO();
    let weeks = tplWeeks["custom_hybrid"] ?? tpl.defaultWeeks;
    // When the runner pinned an event date, derive weeks from
    // start..eventDate so the hybrid block ends right before it.
    // Event date must be a future Monday; if not, we ignore the value
    // and fall back to the Weeks input rather than guess at the date.
    if (
      hybridEventDate &&
      ISO_DATE_RE.test(hybridEventDate) &&
      dayOfWeekUTC(hybridEventDate) === 1
    ) {
      const days = Math.round(
        (Date.parse(`${hybridEventDate}T00:00:00Z`) -
          Date.parse(`${start}T00:00:00Z`)) /
          86400000,
      );
      const derived = Math.floor(days / 7);
      if (derived >= tpl.minWeeks && derived <= tpl.maxWeeks) {
        weeks = derived;
      }
    }
    if (weeks < tpl.minWeeks) weeks = tpl.minWeeks;
    if (weeks > tpl.maxWeeks) weeks = tpl.maxWeeks;
    const customName = `Custom Hybrid (${HYBRID_POSITION_LABEL[hybridPosition]})`;
    const customNotes = encodeHybridNotes(
      hybridPosition,
      hybridDaysPerWeek,
      hybridLevel,
    );
    const existing = entries ?? [];
    const isFirst = existing.length === 0;
    // For the first entry, the chosen start IS the new config start
    // (entry #0's startDate must equal config start, so we anchor the
    // config to the runner's pick instead of storing it on the entry).
    const startDateField = isFirst
      ? null
      : (() => {
          const projections = projectEntries(existing, start);
          const last = projections[projections.length - 1];
          const cursor =
            last && last.endDateISO ? addDaysISO(last.endDateISO, 1) : start;
          return cursor;
        })();
    const nextEntries: TemplateEntry[] = [
      ...existing,
      {
        templateId: "custom_hybrid",
        weeks,
        customName,
        customNotes,
        startDate: startDateField,
      },
    ];
    const projections = projectEntries(nextEntries, start);
    const projected =
      nextEntries.reduce((s, e) => s + (e.weeks || 0), 0) +
      projections.reduce((s, p) => s + p.gapWeeksBefore, 0);
    const race = computeRaceDateForTotalWeeks(start, projected);
    setEntries(nextEntries);
    setStartDate(start);
    setMarathonDate(race);
    setDraft(blocksToDraft(expandEntriesToBlocksWithGaps(nextEntries, start)));
    setLastAppliedTemplate("custom_hybrid");
    toast({
      title: `${customName} added`,
      description: `${weeks}-week hybrid (${hybridDaysPerWeek} days/week, ${hybridLevel}). Total span ${projected}w → race ${race}.`,
    });
  }

  function addEntry(templateId: string) {
    const tpl = getTemplateById(templateId);
    if (!tpl) return;
    const base: TemplateEntry[] = entries ?? [];
    const next: TemplateEntry[] = [
      ...base,
      {
        templateId,
        weeks: tpl.defaultWeeks,
        customName: null,
        customNotes: null,
        startDate: null,
      },
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
            description: describeValidationError(err),
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
                      description: describeValidationError(err),
                      variant: "destructive",
                    });
                  },
                });
              },
              onError: (err: unknown) => {
                toast({
                  title: "Activate failed",
                  description: describeValidationError(err),
                  variant: "destructive",
                });
              },
            },
          );
        },
        onError: (err: unknown) => {
          toast({
            title: "Save failed",
            description: describeValidationError(err),
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
        appendMarathonTail: !isEntriesMode && isMarathonMode,
      });
    } catch {
      return [];
    }
  }, [draft, isEntriesMode, isMarathonMode]);

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
            description: describeValidationError(err),
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
            description: describeValidationError(err),
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
            description: describeValidationError(err),
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
            description: describeValidationError(err),
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
    // In entries-mode `draft` is the gap-aware projection (Recovery
    // filler blocks already inserted between non-adjacent entries), so
    // the timeline reads back the canonical block list including gaps.
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
    if (!isEntriesMode && isMarathonMode) {
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
          Build your program: pick the program end date, the training start,
          and the ordered phase blocks. Toggle &quot;Training for a marathon?&quot;
          on the Config card to auto-pin the trailing 16-week Marathon-Specific
          block, or leave it off for ongoing strength / conditioning programs.
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

      {/* ---------- NAME + DATES ---------- */}
      <Card data-testid="planner-config-card">
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
              onChange={(e) => handleConfigStartDateChange(e.target.value)}
            />
            {startDate && startDow !== 1 && (
              <p className="text-xs text-destructive">
                Must be a Monday — currently a{" "}
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][startDow ?? 0]}.
              </p>
            )}
            <p
              className="text-[11px] text-muted-foreground leading-snug"
              data-testid="planner-start-date-helper"
            >
              1. Pick when training starts. 2. Add one or more templates from
              the library below — each one will ask when it begins.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="planner-marathon-date">
              Program end date (must be a Sunday)
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
          {!isEntriesMode && (
            <div className="md:col-span-3 flex items-center gap-2 pt-2 border-t">
              <input
                type="checkbox"
                id="planner-marathon-toggle"
                data-testid="planner-marathon-toggle"
                checked={isMarathonMode}
                onChange={(e) => setIsMarathonMode(e.target.checked)}
                className="h-4 w-4 cursor-pointer"
              />
              <Label
                htmlFor="planner-marathon-toggle"
                className="text-xs text-muted-foreground cursor-pointer font-normal"
              >
                Training for a marathon? (auto-pin a trailing 16-week
                Marathon-Specific block so race day lands on the program end
                date)
              </Label>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---------- PLAN TEMPLATE LIBRARY ---------- */}
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
              {starters.map((s) => (
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

          {/* Tag-cloud filter (chips) — clickable AND-semantics filter
              above the search input so runners can narrow the catalog
              without typing (especially handy on mobile). */}
          {allTemplateTags.length > 0 && (
            <div
              className="space-y-2"
              data-testid="planner-template-tag-cloud"
            >
              <button
                type="button"
                onClick={() => setTemplateTagCloudOpen((o) => !o)}
                aria-expanded={templateTagCloudOpen}
                aria-controls="planner-template-tag-cloud-panel"
                data-testid="planner-template-tag-cloud-trigger"
                className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded border border-border bg-background hover:bg-muted text-left"
              >
                <span className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                  Filter by tag
                  {selectedTemplateTags.size > 0 && (
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded bg-primary text-primary-foreground tabular-nums"
                      data-testid="planner-template-tag-cloud-trigger-count"
                    >
                      {selectedTemplateTags.size} selected
                    </span>
                  )}
                </span>
                <ChevronDown
                  className={
                    templateTagCloudOpen
                      ? "h-3 w-3 text-muted-foreground rotate-180 transition-transform"
                      : "h-3 w-3 text-muted-foreground transition-transform"
                  }
                />
              </button>
              <div
                id="planner-template-tag-cloud-panel"
                hidden={!templateTagCloudOpen}
                className={
                  templateTagCloudOpen ? "space-y-2" : "space-y-2 hidden"
                }
              >
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  Sort
                </Label>
                <div className="flex items-center gap-2">
                  {/* Sort mode toggle: A-Z vs by template count.
                      Defaults to "count" so the broadest filters
                      land at the top-left and dead-ends sink to the
                      bottom; the choice is persisted per surface. */}
                  <div
                    className="inline-flex rounded border border-border overflow-hidden"
                    role="group"
                    aria-label="Sort tag cloud"
                    data-testid="planner-template-tag-cloud-sort"
                  >
                    <button
                      type="button"
                      onClick={() => setTemplateTagSortMode("count")}
                      aria-pressed={templateTagSortMode === "count"}
                      data-testid="planner-template-tag-cloud-sort-count"
                      className={
                        templateTagSortMode === "count"
                          ? "text-[10px] px-1.5 py-0.5 bg-primary text-primary-foreground"
                          : "text-[10px] px-1.5 py-0.5 bg-background text-muted-foreground hover:text-foreground"
                      }
                    >
                      By count
                    </button>
                    <button
                      type="button"
                      onClick={() => setTemplateTagSortMode("alpha")}
                      aria-pressed={templateTagSortMode === "alpha"}
                      data-testid="planner-template-tag-cloud-sort-alpha"
                      className={
                        templateTagSortMode === "alpha"
                          ? "text-[10px] px-1.5 py-0.5 bg-primary text-primary-foreground border-l border-border"
                          : "text-[10px] px-1.5 py-0.5 bg-background text-muted-foreground hover:text-foreground border-l border-border"
                      }
                    >
                      A–Z
                    </button>
                  </div>
                  {hasActiveTags && (
                    <button
                      type="button"
                      onClick={() => setSelectedTemplateTags(new Set())}
                      className="text-[10px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                      data-testid="planner-template-tag-cloud-clear"
                    >
                      Clear ({selectedTemplateTags.size})
                    </button>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                {(() => {
                  // Once the runner has applied at least one filter
                  // (free-text or chip), zero-count chips collapse
                  // behind a "+N hidden" toggle so the cloud stays
                  // scannable on a wide tag catalog. Active chips
                  // never hide so deselecting stays one click away.
                  const filtersActive = hasActiveSearch || hasActiveTags;
                  const isHidden = (tag: string) => {
                    const active = selectedTemplateTags.has(tag);
                    const count = templateTagCounts.get(tag) ?? 0;
                    return filtersActive && !active && count === 0;
                  };
                  const visibleTags = showHiddenTemplateChips
                    ? allTemplateTags
                    : allTemplateTags.filter((t) => !isHidden(t));
                  const hiddenCount = allTemplateTags.filter(isHidden).length;
                  return (
                    <>
                      {visibleTags.map((tag) => {
                        const active = selectedTemplateTags.has(tag);
                        const count = templateTagCounts.get(tag) ?? 0;
                        // De-emphasize (and disable) zero-count chips
                        // that the runner has expanded back into view
                        // so they still signal "dead end" without
                        // pretending to be clickable.
                        const wouldZero = !active && count === 0;
                        return (
                          <button
                            key={tag}
                            type="button"
                            onClick={() => toggleTemplateTag(tag)}
                            aria-pressed={active}
                            disabled={wouldZero}
                            data-testid={`planner-template-tag-chip-${tag}`}
                            className={
                              active
                                ? "text-[10px] px-1.5 py-0.5 rounded border border-primary bg-primary text-primary-foreground"
                                : wouldZero
                                  ? "text-[10px] px-1.5 py-0.5 rounded border border-border bg-background text-muted-foreground/40 opacity-50 cursor-not-allowed"
                                  : "text-[10px] px-1.5 py-0.5 rounded border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                            }
                          >
                            {tag}
                            <span
                              className="ml-1 opacity-70 tabular-nums"
                              data-testid={`planner-template-tag-chip-count-${tag}`}
                            >
                              · {count}
                            </span>
                          </button>
                        );
                      })}
                      {hiddenCount > 0 && (
                        <button
                          type="button"
                          onClick={() =>
                            setShowHiddenTemplateChips((s) => !s)
                          }
                          aria-pressed={showHiddenTemplateChips}
                          data-testid="planner-template-tag-cloud-toggle-hidden"
                          className="text-[10px] px-1.5 py-0.5 rounded border border-dashed border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          {showHiddenTemplateChips
                            ? "Show less"
                            : `+${hiddenCount} hidden`}
                        </button>
                      )}
                    </>
                  );
                })()}
              </div>
              </div>
            </div>
          )}

          {/* Search + filter */}
          <div className="space-y-2">
            <Label
              htmlFor="planner-template-search"
              className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1"
            >
              <Search className="h-3 w-3" /> Search templates
            </Label>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
              <Input
                id="planner-template-search"
                value={templateSearch}
                onChange={(e) => setTemplateSearch(e.target.value)}
                placeholder="Filter by name, source, equipment, or goal…"
                className="h-8 pl-7 pr-8"
                data-testid="planner-template-search"
              />
              {templateSearch && (
                <button
                  type="button"
                  onClick={() => setTemplateSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label="Clear search"
                  data-testid="planner-template-search-clear"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
            <p
              className="text-[10px] text-muted-foreground"
              data-testid="planner-template-search-summary"
            >
              {hasActiveSearch || hasActiveTags
                ? `${totalMatchedTemplates} template${totalMatchedTemplates === 1 ? "" : "s"} match${
                    hasActiveSearch ? ` "${templateSearch.trim()}"` : ""
                  }${
                    hasActiveTags
                      ? `${hasActiveSearch ? " +" : ""} tag${selectedTemplateTags.size === 1 ? "" : "s"} ${Array.from(
                          selectedTemplateTags,
                        )
                          .map((t) => `#${t}`)
                          .join(" ")}`
                      : ""
                  }${
                    hiddenMatchedTemplates > 0
                      ? ` (+${hiddenMatchedTemplates} in collapsed level${
                          hiddenMatchedTemplates === 1 ? "" : "s"
                        })`
                      : ""
                  }`
                : `${templates.length} templates across ${TEMPLATE_LEVELS.length} levels`}
            </p>
          </div>

          {/* Grouped template grid */}
          <div className="space-y-3">
            <h3 className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              <BookOpen className="h-3 w-3" /> Templates by level
            </h3>
            {totalMatchedTemplates === 0 && (
              <p
                className="text-xs text-muted-foreground italic"
                data-testid="planner-template-empty"
              >
                No templates match that filter. Try a different name, author,
                tag, or piece of equipment.
              </p>
            )}
            {groupedTemplates.map(({ level, list }) => {
              // Search results are scoped to visible levels only — a
              // collapsed section stays collapsed even when filters
              // have matches inside it. The header badge still shows
              // the local match count so the runner can decide to
              // expand it explicitly.
              const isCollapsed = collapsedCategories.has(level);
              return (
                <div
                  key={level}
                  className="border rounded-md"
                  data-testid={`planner-template-level-${level.toLowerCase()}`}
                >
                  <button
                    type="button"
                    onClick={() => toggleCategory(level)}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/40"
                    aria-expanded={!isCollapsed}
                    data-testid={`planner-template-level-toggle-${level.toLowerCase()}`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="text-sm font-medium">{level}</span>
                      <Badge variant="secondary" className="text-[10px]">
                        {list.length}
                      </Badge>
                    </span>
                    {isCollapsed ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronUp className="h-4 w-4 text-muted-foreground" />
                    )}
                  </button>
                  <div
                    hidden={isCollapsed}
                    className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 p-3 pt-0"
                  >
              {list.map((tpl) => {
                const weeks = tplWeeks[tpl.id] ?? tpl.defaultWeeks;
                const outOfRange =
                  weeks < tpl.minWeeks || weeks > tpl.maxWeeks;
                const isLastApplied = lastAppliedTemplate === tpl.id;
                const isExpanded = expandedTemplates.has(tpl.id);
                return (
                  <div
                    key={tpl.id}
                    className={`border rounded-md p-3 flex flex-col gap-2 scroll-mt-4 ${isLastApplied ? "border-primary" : ""}`}
                    data-testid={`planner-template-${tpl.id}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-medium text-sm">{tpl.name}</div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          {tpl.goalDistance} · {tpl.source}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Badge
                          variant="outline"
                          className="text-[10px]"
                          data-testid={`planner-template-${tpl.id}-level`}
                        >
                          {tpl.level}
                        </Badge>
                        {isLastApplied && (
                          <Badge variant="secondary" className="text-[10px]">
                            Applied
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground flex-1">
                      {tpl.shortDescription}
                    </div>
                    {tpl.tags.length > 0 && (
                      <div
                        className="flex flex-wrap gap-1"
                        data-testid={`planner-template-${tpl.id}-tags`}
                      >
                        {tpl.tags.map((tag) => (
                          <Badge
                            key={tag}
                            variant="outline"
                            className="text-[10px] font-normal px-1.5 py-0"
                            data-testid={`planner-template-${tpl.id}-tag-${tag}`}
                          >
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    )}
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
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => toggleTemplateDetails(tpl.id)}
                      className="h-7 justify-start px-2 text-xs"
                      data-testid={`planner-template-details-toggle-${tpl.id}`}
                      aria-expanded={isExpanded}
                    >
                      {isExpanded ? (
                        <ChevronUp className="h-3 w-3 mr-1" />
                      ) : (
                        <ChevronDown className="h-3 w-3 mr-1" />
                      )}
                      {isExpanded ? "Hide details" : "Show details"}
                    </Button>
                    {isExpanded && (
                      <div
                        className="border-t pt-2 space-y-2 text-xs"
                        data-testid={`planner-template-details-${tpl.id}`}
                      >
                        <p
                          className="text-xs text-foreground leading-relaxed"
                          data-testid={`planner-template-long-${tpl.id}`}
                        >
                          {tpl.longDescription}
                        </p>
                        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
                          <dt className="uppercase tracking-wider text-muted-foreground">
                            Intensity
                          </dt>
                          <dd
                            className="font-mono"
                            data-testid={`planner-template-${tpl.id}-intensity`}
                          >
                            {tpl.metadata.intensityDistribution}
                          </dd>
                          <dt className="uppercase tracking-wider text-muted-foreground">
                            Peak long run
                          </dt>
                          <dd className="font-mono">
                            {tpl.metadata.peakLongRun}
                          </dd>
                          <dt className="uppercase tracking-wider text-muted-foreground">
                            Peak volume
                          </dt>
                          <dd className="font-mono">
                            {tpl.metadata.peakWeeklyVolume}
                          </dd>
                          <dt className="uppercase tracking-wider text-muted-foreground">
                            Taper
                          </dt>
                          <dd className="font-mono">
                            {tpl.metadata.taperLength}
                          </dd>
                          <dt className="uppercase tracking-wider text-muted-foreground">
                            Cutback
                          </dt>
                          <dd
                            className="font-mono"
                            data-testid={`planner-template-${tpl.id}-cutback`}
                          >
                            {tpl.metadata.cutbackCadence}
                          </dd>
                          <dt className="uppercase tracking-wider text-muted-foreground">
                            Rest days
                          </dt>
                          <dd
                            className="font-mono"
                            data-testid={`planner-template-${tpl.id}-rest-days`}
                          >
                            {tpl.metadata.mandatoryRestDays} / week
                          </dd>
                          <dt className="uppercase tracking-wider text-muted-foreground">
                            Equipment
                          </dt>
                          <dd
                            className="font-mono"
                            data-testid={`planner-template-${tpl.id}-equipment`}
                          >
                            {tpl.metadata.equipmentMixHint}
                          </dd>
                          <dt className="uppercase tracking-wider text-muted-foreground">
                            Source
                          </dt>
                          <dd className="font-mono">{tpl.source}</dd>
                          <dt className="uppercase tracking-wider text-muted-foreground">
                            Citation
                          </dt>
                          <dd
                            className="italic"
                            data-testid={`planner-template-${tpl.id}-citation`}
                          >
                            {tpl.citation}
                          </dd>
                        </dl>
                      </div>
                    )}
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
                        Outside the published {tpl.minWeeks}–{tpl.maxWeeks}w range — server will reject save. Adjust weeks before applying.
                      </p>
                    )}
                    {tpl.id === "custom_hybrid" ? (
                      <div
                        className="space-y-3 border-t pt-3 mt-1"
                        data-testid="planner-hybrid-builder"
                      >
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <Label className="text-xs">Lift / Run mix</Label>
                            <span
                              className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground"
                              data-testid="planner-hybrid-position-label"
                            >
                              {HYBRID_POSITION_LABEL[hybridPosition]}
                            </span>
                          </div>
                          <Slider
                            min={0}
                            max={HYBRID_POSITIONS_ORDERED.length - 1}
                            step={1}
                            value={[
                              HYBRID_POSITIONS_ORDERED.indexOf(hybridPosition),
                            ]}
                            onValueChange={(v) => {
                              const idx = v[0] ?? 0;
                              const next = HYBRID_POSITIONS_ORDERED[idx];
                              if (next) setHybridPosition(next);
                            }}
                            data-testid="planner-hybrid-slider"
                          />
                          <div className="flex justify-between text-[10px] text-muted-foreground">
                            <span>Lift</span>
                            <span>Balanced</span>
                            <span>Run</span>
                          </div>
                          <p
                            className="text-[11px] text-muted-foreground italic"
                            data-testid="planner-hybrid-blurb"
                          >
                            {HYBRID_POSITION_BLURB[hybridPosition]}
                          </p>
                        </div>
                        {/*
                          Live structured preview of week 1 — re-rendered
                          on every slider / days-per-week / level change.
                          Driven by `previewHybridWeek` in the generator
                          (via the dedicated <HybridWeekPreview /> child)
                          so it can never drift from what the runner will
                          actually get when they hit "Build". Shows a
                          Mon..Sun strip with each day's session label
                          (and miles for runs), an intensity tag below
                          each non-rest slot, a Cutback badge on
                          deload weeks, and a totals line.
                        */}
                        <HybridWeekPreview
                          position={hybridPosition}
                          daysPerWeek={hybridDaysPerWeek}
                          level={hybridLevel}
                          blockWeeks={
                            tplWeeks["custom_hybrid"] ?? tpl.defaultWeeks
                          }
                        />
                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <Label
                              htmlFor="planner-hybrid-days"
                              className="text-xs"
                            >
                              Days / week ({HYBRID_MIN_DAYS_PER_WEEK}–
                              {HYBRID_MAX_DAYS_PER_WEEK})
                            </Label>
                            <Input
                              id="planner-hybrid-days"
                              type="number"
                              min={HYBRID_MIN_DAYS_PER_WEEK}
                              max={HYBRID_MAX_DAYS_PER_WEEK}
                              value={hybridDaysPerWeek}
                              onChange={(e) => {
                                const n = parseInt(e.target.value, 10);
                                if (!Number.isFinite(n)) return;
                                setHybridDaysPerWeek(
                                  Math.max(
                                    HYBRID_MIN_DAYS_PER_WEEK,
                                    Math.min(HYBRID_MAX_DAYS_PER_WEEK, n),
                                  ),
                                );
                              }}
                              className="h-8"
                              data-testid="planner-hybrid-days-input"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label
                              htmlFor="planner-hybrid-level"
                              className="text-xs"
                            >
                              Fitness level
                            </Label>
                            <Select
                              value={hybridLevel}
                              onValueChange={(v) =>
                                setHybridLevel(v as HybridFitnessLevel)
                              }
                            >
                              <SelectTrigger
                                id="planner-hybrid-level"
                                className="h-8"
                                data-testid="planner-hybrid-level-select"
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="beginner">
                                  Beginner
                                </SelectItem>
                                <SelectItem value="intermediate">
                                  Intermediate
                                </SelectItem>
                                <SelectItem value="advanced">
                                  Advanced
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <div className="space-y-1">
                          <Label
                            htmlFor="planner-hybrid-event-date"
                            className="text-xs"
                          >
                            Optional event date (Monday)
                          </Label>
                          <Input
                            id="planner-hybrid-event-date"
                            type="date"
                            value={hybridEventDate}
                            onChange={(e) =>
                              setHybridEventDate(e.target.value)
                            }
                            className="h-8"
                            data-testid="planner-hybrid-event-date-input"
                          />
                          {hybridEventDate &&
                            (!ISO_DATE_RE.test(hybridEventDate) ||
                              dayOfWeekUTC(hybridEventDate) !== 1) && (
                              <p className="text-[10px] text-amber-600 dark:text-amber-400">
                                Event date must be a Monday — falling back to
                                the Weeks input above.
                              </p>
                            )}
                        </div>
                        <Button
                          size="sm"
                          variant="default"
                          onClick={() => applyHybridTemplate()}
                          data-testid="planner-hybrid-build"
                          disabled={outOfRange}
                          className="w-full"
                        >
                          Build my hybrid plan
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => applyTemplate(tpl, weeks)}
                        data-testid={`planner-template-apply-${tpl.id}`}
                        disabled={outOfRange}
                      >
                        Apply template
                      </Button>
                    )}
                  </div>
                );
              })}
                  </div>
                </div>
              );
            })}
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
            {entries !== null ? (
              <>
                <Stat
                  label="Template weeks"
                  value={entries.reduce((s, e) => s + (e.weeks || 0), 0)}
                  data-testid="planner-block-weeks-stat"
                />
                <Stat
                  label="Gap weeks"
                  value={entriesGapWeeksSum}
                />
                <Stat
                  label="Blocks"
                  value={`${draft.length}`}
                />
              </>
            ) : (
              <>
                <Stat
                  label="User-block weeks"
                  value={`${userWeeksSum} / ${expectedUserWeeks}`}
                  ok={userWeeksSum === expectedUserWeeks && expectedUserWeeks > 0}
                  data-testid="planner-block-weeks-stat"
                />
                {isMarathonMode ? (
                  <>
                    <Stat
                      label="Auto-pinned"
                      value={`${MARATHON_TAIL_WEEKS} weeks`}
                    />
                    <Stat
                      label="Blocks"
                      value={`${draft.length} + 1 pinned`}
                    />
                  </>
                ) : (
                  <Stat label="Blocks" value={`${draft.length}`} />
                )}
              </>
            )}
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

      {/* ---------- COMPOSITION EDITOR (entries mode) ---------- */}
      {isEntriesMode && (
        <Card data-testid="planner-composition-editor">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="uppercase tracking-wider text-sm">
                Composition · {entries!.length} entr{entries!.length === 1 ? "y" : "ies"} · {entriesProjectedWeeks}/{totalWeeks}w
                {entriesGapWeeksSum > 0 && (
                  <span
                    className="ml-2 text-[10px] font-normal text-muted-foreground normal-case tracking-normal"
                    data-testid="planner-composition-gap-summary"
                  >
                    ({entriesWeeksSum}w templates + {entriesGapWeeksSum}w gap)
                  </span>
                )}
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Each template owns its own taper — no auto-pinned 16-week
                tail. Use Apply Template above to add more entries; reorder
                or remove below. Push an entry's start date later to
                insert a Recovery rest gap between templates.
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
                  const isArchived = isArchivedTemplateId(e.templateId);
                  const proj = entryProjections.find((p) => p.entryIndex === i);
                  const isHighlighted = hoveredEntry === i;
                  return (
                    <li
                      key={i}
                      className={`border rounded-lg p-3 bg-card transition-shadow ${
                        isHighlighted
                          ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
                          : ""
                      }`}
                      data-testid={`planner-entry-${i}`}
                      onMouseEnter={() => setHoveredEntry(i)}
                      onMouseLeave={() =>
                        setHoveredEntry((cur) => (cur === i ? null : cur))
                      }
                    >
                      {proj && proj.gapWeeksBefore > 0 && (
                        <div
                          className="mb-2 text-[10px] uppercase tracking-wider text-amber-600 dark:text-amber-400 flex items-center gap-1"
                          data-testid={`planner-entry-${i}-gap-banner`}
                        >
                          ↳ {proj.gapWeeksBefore}w Recovery gap before this
                          entry
                        </div>
                      )}
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-mono text-muted-foreground w-6">
                          #{i + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm flex items-center gap-2 flex-wrap">
                            <span>{tpl?.name ?? e.templateId}</span>
                            {isArchived && (
                              <Badge
                                variant="outline"
                                className="text-[10px] border-amber-500 text-amber-700 dark:text-amber-400"
                                data-testid={`planner-entry-${i}-archived`}
                                title="This template is no longer in the catalog. Existing entries still expand for compatibility, but you can't add new entries from it."
                              >
                                Archived template
                              </Badge>
                            )}
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
                        <div className="mt-2 space-y-2">
                          <Input
                            value={e.customName ?? ""}
                            placeholder="Optional label (e.g. Spring base build)"
                            className="h-7 text-xs"
                            onChange={(ev) =>
                              updateEntry(i, {
                                customName: ev.target.value || null,
                              })
                            }
                            data-testid={`planner-entry-${i}-name`}
                          />
                          {proj && (
                            <div
                              className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground"
                              data-testid={`planner-entry-${i}-dates`}
                            >
                              <span className="uppercase tracking-wider">
                                Starts
                              </span>
                              {i === 0 ? (
                                <Input
                                  type="date"
                                  value={proj.startDateISO}
                                  className="h-6 w-36 text-xs"
                                  onChange={(ev) => {
                                    const v = ev.target.value;
                                    if (v) handleConfigStartDateChange(v);
                                  }}
                                  data-testid={`planner-entry-${i}-start-date`}
                                />
                              ) : (
                                <Input
                                  type="date"
                                  value={proj.startDateISO}
                                  className="h-6 w-36 text-xs"
                                  onChange={(ev) => {
                                    const v = ev.target.value;
                                    updateEntry(i, {
                                      startDate: v || null,
                                    });
                                  }}
                                  data-testid={`planner-entry-${i}-start-date`}
                                />
                              )}
                              <span className="uppercase tracking-wider">
                                Ends
                              </span>
                              <Input
                                type="date"
                                value={proj.endDateISO}
                                className="h-6 w-36 text-xs"
                                onChange={(ev) => {
                                  const v = ev.target.value;
                                  if (!v) return;
                                  const r = weeksFromEndDateISO(
                                    proj.startDateISO,
                                    v,
                                    tpl.minWeeks,
                                    tpl.maxWeeks,
                                  );
                                  if (!r) return;
                                  updateEntry(i, { weeks: r.weeks });
                                  setEntryClampHints((prev) => {
                                    const next = { ...prev };
                                    if (r.clamped) {
                                      next[i] = {
                                        rawWeeks: r.rawWeeks,
                                        clampedWeeks: r.weeks,
                                        bound:
                                          r.rawWeeks > tpl.maxWeeks
                                            ? "max"
                                            : "min",
                                      };
                                    } else {
                                      delete next[i];
                                    }
                                    return next;
                                  });
                                }}
                                data-testid={`planner-entry-${i}-end-date`}
                              />
                              <span
                                className="font-mono tabular-nums"
                                data-testid={`planner-entry-${i}-weeks-badge`}
                              >
                                {e.weeks}w
                              </span>
                              {i > 0 && e.startDate && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-5 px-2 text-[10px] uppercase tracking-wider"
                                  onClick={() =>
                                    updateEntry(i, { startDate: null })
                                  }
                                  data-testid={`planner-entry-${i}-clear-start-date`}
                                >
                                  Stack
                                </Button>
                              )}
                            </div>
                          )}
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
                          {entryClampHints[i] && (
                            <p
                              className="text-[10px] text-amber-600 dark:text-amber-400"
                              data-testid={`planner-entry-${i}-clamp-hint`}
                            >
                              Adjusted to {entryClampHints[i].clampedWeeks}w (
                              {entryClampHints[i].bound === "max" ? "max" : "min"}{" "}
                              for this template); you picked {entryClampHints[i].rawWeeks}w.
                            </p>
                          )}
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[10px] text-muted-foreground italic flex-1 min-w-0 truncate">
                              {tpl.citation}
                            </p>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => viewTemplateSource(tpl.id)}
                              className="h-6 px-2 text-[10px] uppercase tracking-wider shrink-0"
                              data-testid={`planner-entry-${i}-view-source`}
                            >
                              <ExternalLink className="h-3 w-3 mr-1" />
                              View source
                            </Button>
                          </div>
                        </div>
                      )}
                      {!tpl && proj && (
                        <div
                          className="text-[10px] text-muted-foreground"
                          data-testid={`planner-entry-${i}-end-readonly`}
                        >
                          Ends{" "}
                          <span className="font-mono">{proj.endDateISO}</span>{" "}
                          ({e.weeks}w)
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
            {entries!.length > 0 && entryProjections.length > 0 && (
              <div
                className="mt-4 border rounded-lg p-3 bg-muted/30"
                data-testid="planner-composition-timeline"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Timeline · {entriesProjectedWeeks}w total
                  </div>
                  <div className="text-[10px] text-muted-foreground font-mono tabular-nums">
                    {startDate} → {marathonDate}
                  </div>
                </div>
                <div
                  className="relative w-full h-14 rounded-md overflow-hidden bg-background border"
                  role="list"
                  aria-label="Composition timeline"
                >
                  {(() => {
                    const total = entriesProjectedWeeks;
                    if (total <= 0) return null;
                    const segs: React.ReactNode[] = [];
                    let cursorPct = 0;
                    for (let i = 0; i < entries!.length; i++) {
                      const proj = entryProjections.find(
                        (p) => p.entryIndex === i,
                      );
                      if (!proj) continue;
                      const e = entries![i]!;
                      const tpl = getTemplateById(e.templateId);
                      // Render gap (if any) immediately before this entry.
                      if (proj.gapWeeksBefore > 0) {
                        const gapPct = (proj.gapWeeksBefore / total) * 100;
                        segs.push(
                          <div
                            key={`gap-${i}`}
                            className="absolute top-0 bottom-0 border-r border-background/50"
                            style={{
                              left: `${cursorPct}%`,
                              width: `${gapPct}%`,
                              backgroundImage:
                                "repeating-linear-gradient(45deg, hsl(var(--muted-foreground) / 0.25) 0 4px, transparent 4px 8px)",
                              backgroundColor:
                                "hsl(var(--muted) / 0.6)",
                            }}
                            title={`Recovery gap · ${proj.gapWeeksBefore}w`}
                            data-testid={`planner-timeline-gap-${i}`}
                          >
                            <div className="absolute inset-0 flex items-center justify-center text-[9px] uppercase tracking-wider text-muted-foreground font-medium pointer-events-none">
                              {proj.gapWeeksBefore >= 2 ? `Gap ${proj.gapWeeksBefore}w` : ""}
                            </div>
                          </div>,
                        );
                        cursorPct += gapPct;
                      }
                      const entryPct = ((e.weeks || 0) / total) * 100;
                      // Stable per-template hue derived from templateId.
                      let hash = 0;
                      for (let k = 0; k < e.templateId.length; k++) {
                        hash = (hash * 31 + e.templateId.charCodeAt(k)) | 0;
                      }
                      const hue = Math.abs(hash) % 360;
                      const isActive = hoveredEntry === i;
                      segs.push(
                        <button
                          type="button"
                          key={`entry-${i}`}
                          className={`absolute top-0 bottom-0 border-r border-background/50 text-left overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:z-10 ${
                            isActive ? "ring-2 ring-primary z-10" : ""
                          }`}
                          style={{
                            left: `${cursorPct}%`,
                            width: `${entryPct}%`,
                            backgroundColor: `hsl(${hue} 65% 55% / ${isActive ? 0.95 : 0.78})`,
                          }}
                          title={`${tpl?.name ?? e.templateId} · ${e.weeks}w · ${proj.startDateISO} → ${proj.endDateISO}`}
                          aria-label={`${tpl?.name ?? e.templateId}, ${e.weeks} weeks, ${proj.startDateISO} to ${proj.endDateISO}`}
                          onMouseEnter={() => setHoveredEntry(i)}
                          onMouseLeave={() =>
                            setHoveredEntry((cur) =>
                              cur === i ? null : cur,
                            )
                          }
                          onFocus={() => setHoveredEntry(i)}
                          onBlur={() =>
                            setHoveredEntry((cur) =>
                              cur === i ? null : cur,
                            )
                          }
                          onClick={() => {
                            setHoveredEntry(i);
                            if (typeof window !== "undefined") {
                              const el = document.querySelector(
                                `[data-testid="planner-entry-${i}"]`,
                              );
                              if (el) {
                                el.scrollIntoView({
                                  behavior: "smooth",
                                  block: "center",
                                });
                              }
                            }
                          }}
                          data-testid={`planner-timeline-bar-${i}`}
                        >
                          <div className="absolute inset-x-0 top-0 h-7 px-1.5 flex items-center text-[10px] font-medium text-white drop-shadow-sm pointer-events-none">
                            <span className="truncate">
                              #{i + 1} {tpl?.name ?? e.templateId} · {e.weeks}w
                            </span>
                          </div>
                          <div className="absolute inset-x-0 bottom-0 h-6 px-1.5 flex items-center justify-between text-[9px] font-mono tabular-nums text-white/90 drop-shadow-sm pointer-events-none gap-1">
                            <span className="truncate">{proj.startDateISO}</span>
                            {entryPct > 14 && (
                              <span className="truncate">{proj.endDateISO}</span>
                            )}
                          </div>
                        </button>,
                      );
                      cursorPct += entryPct;
                    }
                    return segs;
                  })()}
                </div>
                <div className="mt-2 flex items-center gap-3 text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <span
                      className="inline-block w-3 h-3 rounded-sm"
                      style={{
                        backgroundImage:
                          "repeating-linear-gradient(45deg, hsl(var(--muted-foreground) / 0.4) 0 3px, transparent 3px 6px)",
                        backgroundColor: "hsl(var(--muted) / 0.6)",
                      }}
                    />
                    Recovery gap
                  </span>
                  <span>Hover or click a bar to highlight its entry above.</span>
                </div>
              </div>
            )}
            <div className="mt-3 flex items-center gap-2">
              <Label className="text-xs">Quick-add template:</Label>
              <Popover
                open={quickAddOpen}
                onOpenChange={(open) => {
                  setQuickAddOpen(open);
                  if (!open) {
                    setQuickAddSearch("");
                    setQuickAddSelectedTags(new Set());
                  }
                }}
              >
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={quickAddOpen}
                    className="h-8 w-64 justify-between font-normal"
                    data-testid="planner-entry-add-select"
                  >
                    <span className="text-muted-foreground">
                      Pick a template…
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="w-80 p-0"
                  align="start"
                  data-testid="planner-entry-add-popover"
                >
                  {/*
                    Combobox replacement for the legacy shadcn Select
                    so the runner can type to filter the 50+ templates
                    by name, source, equipment hint, or goal distance
                    (mirrors the Plan Template Library search). We do
                    the filtering manually via filterTemplatesByQuery
                    rather than relying on cmdk's built-in scoring so
                    we match the same fields as the picker (cmdk's
                    default only looks at each item's `value` /
                    textContent).
                  */}
                  <Command shouldFilter={false}>
                    <CommandInput
                      placeholder="Search templates…"
                      value={quickAddSearch}
                      onValueChange={setQuickAddSearch}
                      data-testid="planner-entry-add-search"
                    />
                    {/* Tag-cloud filter mirrors the Plan Template
                        Library card so the runner can narrow the
                        catalog by topic tag without typing here too. */}
                    {allQuickAddTags.length > 0 && (
                      <div
                        className="border-b px-2 py-2 space-y-1.5"
                        data-testid="planner-entry-add-tag-cloud"
                      >
                        <button
                          type="button"
                          onClick={() => setQuickAddTagCloudOpen((o) => !o)}
                          aria-expanded={quickAddTagCloudOpen}
                          aria-controls="planner-entry-add-tag-cloud-panel"
                          data-testid="planner-entry-add-tag-cloud-trigger"
                          className="w-full flex items-center justify-between gap-2 text-left"
                        >
                          <span className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                            Filter by tag
                            {quickAddSelectedTags.size > 0 && (
                              <span
                                className="text-[10px] px-1.5 py-0.5 rounded bg-primary text-primary-foreground tabular-nums"
                                data-testid="planner-entry-add-tag-cloud-trigger-count"
                              >
                                {quickAddSelectedTags.size} selected
                              </span>
                            )}
                          </span>
                          <ChevronDown
                            className={
                              quickAddTagCloudOpen
                                ? "h-3 w-3 text-muted-foreground rotate-180 transition-transform"
                                : "h-3 w-3 text-muted-foreground transition-transform"
                            }
                          />
                        </button>
                        <div
                          id="planner-entry-add-tag-cloud-panel"
                          hidden={!quickAddTagCloudOpen}
                          className={
                            quickAddTagCloudOpen
                              ? "space-y-1.5"
                              : "space-y-1.5 hidden"
                          }
                        >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                            Sort
                          </span>
                          <div className="flex items-center gap-2">
                            <div
                              className="inline-flex rounded border border-border overflow-hidden"
                              role="group"
                              aria-label="Sort tag cloud"
                              data-testid="planner-entry-add-tag-cloud-sort"
                            >
                              <button
                                type="button"
                                onClick={() => setQuickAddTagSortMode("count")}
                                aria-pressed={quickAddTagSortMode === "count"}
                                data-testid="planner-entry-add-tag-cloud-sort-count"
                                className={
                                  quickAddTagSortMode === "count"
                                    ? "text-[10px] px-1.5 py-0.5 bg-primary text-primary-foreground"
                                    : "text-[10px] px-1.5 py-0.5 bg-background text-muted-foreground hover:text-foreground"
                                }
                              >
                                By count
                              </button>
                              <button
                                type="button"
                                onClick={() => setQuickAddTagSortMode("alpha")}
                                aria-pressed={quickAddTagSortMode === "alpha"}
                                data-testid="planner-entry-add-tag-cloud-sort-alpha"
                                className={
                                  quickAddTagSortMode === "alpha"
                                    ? "text-[10px] px-1.5 py-0.5 bg-primary text-primary-foreground border-l border-border"
                                    : "text-[10px] px-1.5 py-0.5 bg-background text-muted-foreground hover:text-foreground border-l border-border"
                                }
                              >
                                A–Z
                              </button>
                            </div>
                            {quickAddSelectedTags.size > 0 && (
                              <button
                                type="button"
                                onClick={() =>
                                  setQuickAddSelectedTags(new Set())
                                }
                                className="text-[10px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                                data-testid="planner-entry-add-tag-cloud-clear"
                              >
                                Clear ({quickAddSelectedTags.size})
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                          {(() => {
                            // Mirror the Plan Template Library
                            // behaviour: collapse zero-count chips
                            // behind a "+N hidden" toggle once a
                            // filter is active so the popover stays
                            // tidy on a wide tag catalog.
                            const filtersActive =
                              quickAddSearch.trim().length > 0 ||
                              quickAddSelectedTags.size > 0;
                            const isHidden = (tag: string) => {
                              const active = quickAddSelectedTags.has(tag);
                              const count = quickAddTagCounts.get(tag) ?? 0;
                              return filtersActive && !active && count === 0;
                            };
                            const visibleTags = showHiddenQuickAddChips
                              ? allQuickAddTags
                              : allQuickAddTags.filter((t) => !isHidden(t));
                            const hiddenCount =
                              allQuickAddTags.filter(isHidden).length;
                            return (
                              <>
                                {visibleTags.map((tag) => {
                                  const active =
                                    quickAddSelectedTags.has(tag);
                                  const count =
                                    quickAddTagCounts.get(tag) ?? 0;
                                  const wouldZero = !active && count === 0;
                                  return (
                                    <button
                                      key={tag}
                                      type="button"
                                      onClick={() => toggleQuickAddTag(tag)}
                                      aria-pressed={active}
                                      disabled={wouldZero}
                                      data-testid={`planner-entry-add-tag-chip-${tag}`}
                                      className={
                                        active
                                          ? "text-[10px] px-1.5 py-0.5 rounded border border-primary bg-primary text-primary-foreground"
                                          : wouldZero
                                            ? "text-[10px] px-1.5 py-0.5 rounded border border-border bg-background text-muted-foreground/40 opacity-50 cursor-not-allowed"
                                            : "text-[10px] px-1.5 py-0.5 rounded border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                                      }
                                    >
                                      {tag}
                                      <span
                                        className="ml-1 opacity-70 tabular-nums"
                                        data-testid={`planner-entry-add-tag-chip-count-${tag}`}
                                      >
                                        · {count}
                                      </span>
                                    </button>
                                  );
                                })}
                                {hiddenCount > 0 && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setShowHiddenQuickAddChips((s) => !s)
                                    }
                                    aria-pressed={showHiddenQuickAddChips}
                                    data-testid="planner-entry-add-tag-cloud-toggle-hidden"
                                    className="text-[10px] px-1.5 py-0.5 rounded border border-dashed border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                                  >
                                    {showHiddenQuickAddChips
                                      ? "Show less"
                                      : `+${hiddenCount} hidden`}
                                  </button>
                                )}
                              </>
                            );
                          })()}
                        </div>
                        </div>
                      </div>
                    )}
                    <CommandList>
                      <CommandEmpty>No templates match.</CommandEmpty>
                      {(() => {
                        // Templates are grouped by skill level so the
                        // Beginner picks come first (matching the order
                        // of TEMPLATE_LEVELS used in
                        // groupTemplatesByLevel).
                        const groups = groupTemplatesByLevel(
                          filterTemplatesByTags(
                            filterTemplatesByQuery(templates, quickAddSearch),
                            quickAddSelectedTags,
                          ),
                        );
                        return groups.map(({ level, list }) => {
                          return (
                            <CommandGroup key={level} heading={level}>
                              {list.map((t) => (
                                <CommandItem
                                  key={t.id}
                                  value={t.id}
                                  onSelect={() => {
                                    addEntry(t.id);
                                    setQuickAddOpen(false);
                                    setQuickAddSearch("");
                                  }}
                                  data-testid={`planner-entry-add-option-${t.id}`}
                                >
                                  <Check className="mr-2 h-4 w-4 opacity-0" />
                                  <span className="truncate">
                                    {t.name} ({t.defaultWeeks}w default)
                                  </span>
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          );
                        });
                      })()}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
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
                No user blocks yet. Add one to get started
                {isMarathonMode
                  ? " — the Marathon-Specific tail is already pinned."
                  : "."}
              </li>
            )}
            {isMarathonMode && (
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
            )}
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

      <AlertDialog
        open={pendingApplyTemplate !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingApplyTemplate(null);
            setPendingApplyStartDate("");
            setApplyClampHint(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              When should &quot;{pendingApplyTemplate?.templateName}&quot; start?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Default is{" "}
              <span className="font-mono">
                {pendingApplyTemplate?.proposedStartDate}
              </span>
              {(entries ?? []).length === 0
                ? " — the current training start date. Pick any Monday to set when training begins; the overall config start date will move to match."
                : " — the Monday right after the previous entry ends. Push it later (must still be a Monday) to insert a Recovery rest gap between templates."}{" "}
              The race date will re-anchor so the totals match.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="planner-pending-start-date">
              Entry start date
            </Label>
            <Input
              id="planner-pending-start-date"
              type="date"
              value={pendingApplyStartDate}
              min={
                (entries ?? []).length > 0
                  ? pendingApplyTemplate?.proposedStartDate
                  : undefined
              }
              onChange={(ev) => setPendingApplyStartDate(ev.target.value)}
              data-testid="planner-pending-apply-start-date"
            />
            {pendingApplyStartDate &&
              dayOfWeekUTC(pendingApplyStartDate) !== 1 && (
                <p className="text-xs text-destructive">
                  Must be a Monday — currently a{" "}
                  {
                    ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][
                      dayOfWeekUTC(pendingApplyStartDate) ?? 0
                    ]
                  }
                  .
                </p>
              )}
            {pendingApplyStartDate &&
              pendingApplyTemplate &&
              (entries ?? []).length > 0 &&
              pendingApplyStartDate < pendingApplyTemplate.proposedStartDate && (
                <p className="text-xs text-destructive">
                  Cannot start before {pendingApplyTemplate.proposedStartDate}{" "}
                  (the end of the previous entry).
                </p>
              )}
            {pendingApplyTemplate && pendingApplyStartDate && (
              <div className="space-y-1">
                <Label htmlFor="planner-pending-end-date">
                  Entry end date
                </Label>
                <Input
                  id="planner-pending-end-date"
                  type="date"
                  value={addDaysISO(
                    pendingApplyStartDate,
                    pendingApplyTemplate.weeks * 7 - 1,
                  )}
                  onChange={(ev) => {
                    const v = ev.target.value;
                    if (!v || !pendingApplyTemplate) return;
                    const tpl = getTemplateById(pendingApplyTemplate.templateId);
                    if (!tpl) return;
                    const r = weeksFromEndDateISO(
                      pendingApplyStartDate,
                      v,
                      tpl.minWeeks,
                      tpl.maxWeeks,
                    );
                    if (!r) return;
                    setPendingApplyTemplate({
                      ...pendingApplyTemplate,
                      weeks: r.weeks,
                    });
                    if (r.clamped) {
                      setApplyClampHint({
                        rawWeeks: r.rawWeeks,
                        clampedWeeks: r.weeks,
                        bound: r.rawWeeks > tpl.maxWeeks ? "max" : "min",
                      });
                    } else {
                      setApplyClampHint(null);
                    }
                  }}
                  data-testid="planner-pending-apply-end-date"
                />
                <p
                  className="text-[10px] text-muted-foreground"
                  data-testid="planner-pending-apply-weeks-readout"
                >
                  {pendingApplyTemplate.weeks}w
                  {(() => {
                    const tpl = getTemplateById(
                      pendingApplyTemplate.templateId,
                    );
                    return tpl
                      ? ` · range ${tpl.minWeeks}–${tpl.maxWeeks}w`
                      : "";
                  })()}
                </p>
                {applyClampHint && (
                  <p
                    className="text-[10px] text-amber-600 dark:text-amber-400"
                    data-testid="planner-pending-apply-clamp-hint"
                  >
                    Adjusted to {applyClampHint.clampedWeeks}w (
                    {applyClampHint.bound === "max" ? "max" : "min"} for this
                    template); you picked {applyClampHint.rawWeeks}w.
                  </p>
                )}
              </div>
            )}
            {pendingApplyPreview && (
              <div
                className="rounded-md border bg-muted/40 p-2 text-xs"
                data-testid="planner-pending-apply-race-preview"
              >
                <div>
                  Race date will be{" "}
                  <span className="font-mono">
                    {pendingApplyPreview.previewRace}
                  </span>
                  {marathonDate && (
                    <>
                      {" "}(was{" "}
                      <span className="font-mono">{marathonDate}</span>
                      {pendingApplyPreview.weekDelta === 0
                        ? ", unchanged"
                        : pendingApplyPreview.weekDelta > 0
                          ? `, +${pendingApplyPreview.weekDelta} week${pendingApplyPreview.weekDelta === 1 ? "" : "s"} later`
                          : `, ${Math.abs(pendingApplyPreview.weekDelta)} week${Math.abs(pendingApplyPreview.weekDelta) === 1 ? "" : "s"} earlier`}
                      )
                    </>
                  )}
                  .
                </div>
              </div>
            )}
            {pendingApplyPreview?.willOverrun && (
              <div
                className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs space-y-2"
                data-testid="planner-pending-apply-overrun-warning"
              >
                <div>
                  Heads up: confirming will move your marathon date forward
                  by{" "}
                  <span className="font-semibold">
                    {pendingApplyPreview.weekDelta} week
                    {pendingApplyPreview.weekDelta === 1 ? "" : "s"}
                  </span>
                  . If you have a fixed race date, keep it instead and
                  shorten this entry.
                </div>
                {pendingApplyPreview.trimmedWeeks !== null ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      confirmPendingApplyTemplate({ keepRaceDate: true })
                    }
                    data-testid="planner-keep-race-date"
                  >
                    Keep current race date (trim to{" "}
                    {pendingApplyPreview.trimmedWeeks}w)
                  </Button>
                ) : (
                  <div className="text-muted-foreground">
                    Can&apos;t fit any of this template before the current race
                    date — pick an earlier start or accept the new race date.
                  </div>
                )}
              </div>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="planner-cancel-pending-apply">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmPendingApplyTemplate()}
              data-testid="planner-confirm-pending-apply"
              disabled={
                !pendingApplyStartDate ||
                dayOfWeekUTC(pendingApplyStartDate) !== 1 ||
                (pendingApplyTemplate !== null &&
                  (entries ?? []).length > 0 &&
                  pendingApplyStartDate <
                    pendingApplyTemplate.proposedStartDate)
              }
            >
              {pendingApplyPreview?.willOverrun
                ? "Add entry & move race date"
                : "Add entry"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={createOpen} onOpenChange={setCreateOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>New Planner config</AlertDialogTitle>
            <AlertDialogDescription>
              Starts from the default 8-week Tonal upper-body block. You can
              rename it, edit the dates, swap in a template, or toggle marathon
              mode after creating it.
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
