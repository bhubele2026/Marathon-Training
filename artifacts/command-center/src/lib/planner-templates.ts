// Shared helpers for the planner's searchable template pickers.
//
// Two surfaces in the planner filter the same template catalog by the
// same fields and bucket the matches into the same level groups:
//   1. The Plan Template Library card (free-text search + grouped grid).
//   2. The entries-mode "Quick-add template" combobox (task #106).
//
// Both call into the helpers below so adding a new searchable field or
// changing the level-grouping rule is a single edit that updates
// both surfaces in lock-step.

import {
  type PlanTemplate,
  type PlanTemplateLevel,
} from "@workspace/plan-generator";

export const TEMPLATE_LEVELS = [
  "Beginner",
  "Intermediate",
  "Advanced",
] as const satisfies readonly PlanTemplateLevel[];
export type TemplateLevel = PlanTemplateLevel;

// Accepts both the in-process PlanTemplate (which carries an expand fn)
// and the API-shaped PlanTemplate (no expand) so the picker can
// classify whichever the templatesQuery returns.
export type CategorizableTemplate = Pick<
  PlanTemplate,
  | "id"
  | "name"
  | "source"
  | "goalDistance"
  | "metadata"
  | "tags"
  | "level"
  | "minWeeks"
  | "maxWeeks"
  | "defaultWeeks"
  | "shortDescription"
  | "longDescription"
  | "citation"
>;

export function levelOfTemplate(tpl: CategorizableTemplate): TemplateLevel {
  return tpl.level;
}

// Fields the picker matches the free-text query against, in order.
// Add a new entry here to make a field searchable in BOTH the Plan
// Template Library card and the entries-mode quick-add combobox at
// once.
const SEARCHABLE_FIELDS: ReadonlyArray<(t: CategorizableTemplate) => string> = [
  (t) => t.name,
  (t) => t.source,
  (t) => t.metadata.equipmentMixHint,
  (t) => t.goalDistance,
  // Topic tags rendered as chips on the template card. Joined with
  // spaces so a substring match across multiple tags ("polarized",
  // "hill focus") works the same as for any other field.
  (t) => t.tags.join(" "),
];

export function filterTemplatesByQuery<T extends CategorizableTemplate>(
  templates: readonly T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...templates];
  return templates.filter((tpl) =>
    SEARCHABLE_FIELDS.some((get) => get(tpl).toLowerCase().includes(q)),
  );
}

// Distinct topic tags across the catalog, sorted alphabetically so the
// rendered tag cloud is stable regardless of template insertion order.
// Used by the Plan Template Library card and the entries-mode quick-add
// popover to render a clickable filter cloud above the search input.
export function getAllTemplateTags(
  templates: readonly CategorizableTemplate[],
): string[] {
  const set = new Set<string>();
  for (const t of templates) for (const tag of t.tags) set.add(tag);
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

// Count, for every distinct tag in the catalog, how many templates
// would remain visible if that tag were added to the current selection
// (AND-semantics, matching filterTemplatesByTags). Used to render a
// "tag · count" annotation on each chip in the tag cloud so runners
// can see at a glance how broad or narrow each tag is in the current
// filter context. Callers should pass the already-query-filtered
// template list so the counts reflect the active free-text search.
//
// For a tag the user has already selected, the resulting count equals
// the count of templates that currently match the selection (because
// adding an already-selected tag is a no-op under AND semantics).
export function countTemplatesByTag(
  templates: readonly CategorizableTemplate[],
  selectedTags: ReadonlySet<string>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const tpl of templates) {
    const tagSet = new Set(tpl.tags);
    let carriesAllSelected = true;
    for (const sel of selectedTags) {
      if (!tagSet.has(sel)) {
        carriesAllSelected = false;
        break;
      }
    }
    if (!carriesAllSelected) continue;
    // Every tag on this template would still match if added to the
    // selection, since the template already carries all currently
    // selected tags.
    for (const tag of tagSet) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return counts;
}

// Sort modes for the tag chip cloud. "count" surfaces the broadest
// filters first (most templates would still match); "alpha" sorts the
// chips alphabetically. Both modes pin currently-selected chips to the
// front so the active filter is always visible regardless of mode.
export type TagSortMode = "count" | "alpha";

// Order tags for the chip cloud so the most useful chips come first.
// Sort key (highest priority first):
//   1. Currently selected tags stay pinned at the front so the active
//      filter is always visible regardless of mode.
//   2. When mode = "count": higher template count (broadest tags)
//      before lower counts so runners see the most-used tags first and
//      rarely-used ones fall to the end of the cloud. Alphabetical is
//      a stable tiebreaker.
//      When mode = "alpha": purely alphabetical (after the selected
//      pin) so the cloud is easy to scan when looking for a specific
//      tag by name.
// Tags missing from the counts map are treated as count=0.
export function sortTags(
  tags: readonly string[],
  counts: ReadonlyMap<string, number>,
  selectedTags: ReadonlySet<string>,
  mode: TagSortMode,
): string[] {
  return [...tags].sort((a, b) => {
    const aSel = selectedTags.has(a) ? 1 : 0;
    const bSel = selectedTags.has(b) ? 1 : 0;
    if (aSel !== bSel) return bSel - aSel;
    if (mode === "count") {
      const aCount = counts.get(a) ?? 0;
      const bCount = counts.get(b) ?? 0;
      if (aCount !== bCount) return bCount - aCount;
    }
    return a.localeCompare(b);
  });
}

// Back-compat alias retained for existing callers/tests. New code
// should prefer sortTags(tags, counts, selectedTags, mode) so the
// caller can pick alphabetical or by-count ordering at the surface.
export function sortTagsByCount(
  tags: readonly string[],
  counts: ReadonlyMap<string, number>,
  selectedTags: ReadonlySet<string>,
): string[] {
  return sortTags(tags, counts, selectedTags, "count");
}

// Narrow templates to those that carry EVERY selected tag (AND
// semantics). An empty selection is a no-op so callers can compose
// this with the free-text filter unconditionally.
export function filterTemplatesByTags<T extends CategorizableTemplate>(
  templates: readonly T[],
  selectedTags: ReadonlySet<string>,
): T[] {
  if (selectedTags.size === 0) return [...templates];
  return templates.filter((tpl) => {
    const tagSet = new Set(tpl.tags);
    for (const sel of selectedTags) if (!tagSet.has(sel)) return false;
    return true;
  });
}

// Modality bucket for a template, derived from its equipmentMixHint
// (and id as a tiebreaker for scaffold templates that don't carry a
// modality keyword in the hint). Used by call sites that want to
// surface a coarse "what kind of plan is this?" grouping above the
// finer Beginner/Intermediate/Advanced level. Keep the bucket list
// small and stable: callers may render one chip per category.
//
// "Custom" is the catch-all for runner-defined / scaffold templates
// (e.g. `race_countdown`, `*_custom`, `custom_hybrid`) whose modality
// is decided by the runner at config time, not by the template
// itself. Without this bucket, the previous keyword-only logic
// silently fell through to "Conditioning" because none of the
// strength / endurance / cardio keywords matched the "Runner-defined"
// hint — which is wrong: a scaffold template has no modality of its
// own, so "Custom" is the honest classification.
export type TemplateCategory =
  | "Endurance"
  | "Strength"
  | "Conditioning"
  | "Custom";

const STRENGTH_KEYWORDS = [
  "tonal",
  "barbell",
  "lift",
  "strength",
  "dumbbell",
  "kettlebell",
];
const ENDURANCE_KEYWORDS = [
  "run",
  "tread",
  "outdoor",
  "marathon",
  "5k",
  "10k",
  "half",
];
const CONDITIONING_KEYWORDS = [
  "bike",
  "row",
  "rower",
  "spin",
  "cross-train",
  "cross train",
  "conditioning",
  "hyrox",
];
const CUSTOM_KEYWORDS = [
  "runner-defined",
  "runner defined",
  "scaffold",
  "custom",
  "build your own",
  "user-defined",
  "user defined",
];

function matchesAny(haystack: string, needles: readonly string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}

// Bucket a template into a coarse modality category. Resolution order
// (first match wins):
//   1. Runner-defined / scaffold templates by id pattern
//      (`race_countdown`, `*_custom`, `custom_hybrid`) → Custom.
//   2. equipmentMixHint contains a Custom keyword (e.g. "Runner-defined")
//      → Custom. This is the bucket scaffold templates fall into and
//      the bug fix: previously these silently routed to Conditioning
//      because no other keyword matched.
//   3. Strength keyword (lift / Tonal / barbell …) → Strength.
//   4. Endurance keyword (run / tread / marathon …) → Endurance. Run
//      is checked before Conditioning so a hybrid hint like "Tread +
//      Bike" categorises by its run anchor.
//   5. Conditioning keyword (bike / row / spin …) → Conditioning.
//   6. Default → Custom (safer than mis-bucketing into Conditioning).
export function categorizeTemplate(
  tpl: CategorizableTemplate,
): TemplateCategory {
  const id = tpl.id.toLowerCase();
  if (
    id === "race_countdown" ||
    id === "custom_hybrid" ||
    id.endsWith("_custom")
  ) {
    return "Custom";
  }
  const hint = tpl.metadata.equipmentMixHint.toLowerCase();
  if (matchesAny(hint, CUSTOM_KEYWORDS)) return "Custom";
  if (matchesAny(hint, STRENGTH_KEYWORDS)) return "Strength";
  if (matchesAny(hint, ENDURANCE_KEYWORDS)) return "Endurance";
  if (matchesAny(hint, CONDITIONING_KEYWORDS)) return "Conditioning";
  return "Custom";
}

export interface TemplateGroup<T> {
  level: TemplateLevel;
  list: T[];
}

// Bucket templates into the canonical level order (Beginner →
// Intermediate → Advanced), dropping empty buckets so the section
// list adapts to the current filter.
export function groupTemplatesByLevel<T extends CategorizableTemplate>(
  templates: readonly T[],
): TemplateGroup<T>[] {
  const buckets = new Map<TemplateLevel, T[]>();
  for (const lvl of TEMPLATE_LEVELS) buckets.set(lvl, []);
  for (const tpl of templates) {
    buckets.get(levelOfTemplate(tpl))!.push(tpl);
  }
  return TEMPLATE_LEVELS.map((level) => ({
    level,
    list: buckets.get(level) ?? [],
  })).filter((g) => g.list.length > 0);
}
