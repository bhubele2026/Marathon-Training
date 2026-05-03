// Shared helpers for the planner's searchable template pickers.
//
// Two surfaces in the planner filter the same template catalog by the
// same fields and bucket the matches into the same categories:
//   1. The Plan Template Library card (free-text search + grouped grid).
//   2. The entries-mode "Quick-add template" combobox (task #106).
//
// Both call into the helpers below so adding a new searchable field or
// changing the category-grouping rule is a single edit that updates
// both surfaces in lock-step.

import { type PlanTemplate } from "@workspace/plan-generator";

export const TEMPLATE_CATEGORIES = [
  "Run",
  "Bike",
  "Row",
  "Strength",
  "Hybrid",
  "Conditioning",
  "Custom",
] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

// Accepts both the in-process PlanTemplate (which carries an expand fn)
// and the API-shaped PlanTemplate (no expand) so the picker can
// categorize whichever the templatesQuery returns.
export type CategorizableTemplate = Pick<
  PlanTemplate,
  "id" | "name" | "source" | "goalDistance" | "metadata" | "tags"
>;

export function categorizeTemplate(
  tpl: CategorizableTemplate,
): TemplateCategory {
  if (tpl.id.endsWith("_custom")) return "Custom";
  const eq = tpl.metadata.equipmentMixHint.toLowerCase();
  const goal = tpl.goalDistance.toLowerCase();
  if (
    eq.includes("runner-defined") ||
    tpl.tags.includes("scaffold")
  ) {
    return "Custom";
  }
  if (eq.includes("hyrox") || goal.includes("hyrox")) return "Hybrid";
  if (
    goal.includes("recovery") ||
    goal.includes("mobility") ||
    goal.includes("hold fitness") ||
    eq.startsWith("mat-only")
  ) {
    return "Conditioning";
  }
  const hasStrength =
    eq.includes("tonal") ||
    eq.includes("kettlebell") ||
    eq.includes("barbell");
  const hasBike = eq.includes("bike");
  const hasRow = eq.includes("row") || eq.includes("concept2");
  const hasRun =
    eq.includes("run") ||
    eq.includes("walk") ||
    eq.includes("hike") ||
    eq.includes("tread");
  if (hasStrength && (hasBike || hasRow || hasRun)) return "Hybrid";
  if (hasStrength) return "Strength";
  if (hasBike && !hasRun && !hasRow) return "Bike";
  if (hasRow && !hasRun && !hasBike) return "Row";
  if (hasRun) return "Run";
  return "Conditioning";
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

export interface TemplateGroup<T> {
  cat: TemplateCategory;
  list: T[];
}

// Bucket templates into the canonical category order, dropping empty
// buckets so the section list adapts to the current filter. Custom
// stays last because TEMPLATE_CATEGORIES lists it last.
export function groupTemplatesByCategory<T extends CategorizableTemplate>(
  templates: readonly T[],
): TemplateGroup<T>[] {
  const buckets = new Map<TemplateCategory, T[]>();
  for (const cat of TEMPLATE_CATEGORIES) buckets.set(cat, []);
  for (const tpl of templates) {
    buckets.get(categorizeTemplate(tpl))!.push(tpl);
  }
  return TEMPLATE_CATEGORIES.map((cat) => ({
    cat,
    list: buckets.get(cat) ?? [],
  })).filter((g) => g.list.length > 0);
}
