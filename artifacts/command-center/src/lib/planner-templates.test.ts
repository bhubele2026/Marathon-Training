import { describe, expect, it } from "vitest";
import {
  type CategorizableTemplate,
  countTemplatesByTag,
  filterTemplatesByTags,
  getAllTemplateTags,
  sortTagsByCount,
} from "./planner-templates";

function tpl(id: string, tags: string[]): CategorizableTemplate {
  return {
    id,
    name: id,
    source: "test",
    goalDistance: "marathon",
    metadata: { equipmentMixHint: "run" },
    tags,
  } as CategorizableTemplate;
}

describe("getAllTemplateTags", () => {
  it("returns distinct tags sorted alphabetically", () => {
    const templates = [
      tpl("a", ["polarized", "hill focus"]),
      tpl("b", ["base", "polarized"]),
      tpl("c", ["taper"]),
    ];
    expect(getAllTemplateTags(templates)).toEqual([
      "base",
      "hill focus",
      "polarized",
      "taper",
    ]);
  });

  it("returns an empty list when there are no tags", () => {
    expect(getAllTemplateTags([])).toEqual([]);
    expect(getAllTemplateTags([tpl("a", [])])).toEqual([]);
  });
});

describe("countTemplatesByTag", () => {
  it("counts every tag once per template when no selection is active", () => {
    const templates = [
      tpl("a", ["polarized", "hill focus"]),
      tpl("b", ["polarized"]),
      tpl("c", ["taper"]),
    ];
    const counts = countTemplatesByTag(templates, new Set());
    expect(counts.get("polarized")).toBe(2);
    expect(counts.get("hill focus")).toBe(1);
    expect(counts.get("taper")).toBe(1);
  });

  it("uses AND-semantics with a single selected tag (excludes templates missing it)", () => {
    const templates = [
      tpl("a", ["polarized", "hill focus"]),
      tpl("b", ["polarized", "taper"]),
      tpl("c", ["hill focus"]),
    ];
    const counts = countTemplatesByTag(templates, new Set(["polarized"]));
    // Templates a and b carry "polarized"; c is excluded entirely so its
    // "hill focus" tag does not leak into the counts beyond a's contribution.
    expect(counts.get("polarized")).toBe(2);
    expect(counts.get("hill focus")).toBe(1);
    expect(counts.get("taper")).toBe(1);
  });

  it("uses AND-semantics with multiple selected tags (not OR)", () => {
    const templates = [
      tpl("a", ["polarized", "hill focus", "base"]),
      tpl("b", ["polarized", "hill focus", "taper"]),
      tpl("c", ["polarized", "base"]), // missing "hill focus"
      tpl("d", ["hill focus", "taper"]), // missing "polarized"
      tpl("e", ["recovery"]), // unrelated
    ];
    const counts = countTemplatesByTag(
      templates,
      new Set(["polarized", "hill focus"]),
    );
    // Only a and b carry BOTH selected tags. Under OR semantics c and d
    // would also contribute and the numbers below would be larger.
    expect(counts.get("polarized")).toBe(2);
    expect(counts.get("hill focus")).toBe(2);
    expect(counts.get("base")).toBe(1); // only from a
    expect(counts.get("taper")).toBe(1); // only from b
    // Tags that live exclusively on excluded templates do not appear.
    expect(counts.has("recovery")).toBe(false);
    // No phantom keys for tags that never co-occurred with the selection.
    expect(counts.size).toBe(4);
  });

  it("count for an already-selected tag equals the size of the current match set", () => {
    const templates = [
      tpl("a", ["polarized", "hill focus"]),
      tpl("b", ["polarized", "taper"]),
      tpl("c", ["taper"]),
    ];
    const selected = new Set(["polarized"]);
    const counts = countTemplatesByTag(templates, selected);
    const matched = filterTemplatesByTags(templates, selected).length;
    expect(counts.get("polarized")).toBe(matched);
  });

  it("returns an empty map when no templates carry the selected tags", () => {
    const templates = [tpl("a", ["polarized"])];
    const counts = countTemplatesByTag(templates, new Set(["nonexistent"]));
    expect(counts.size).toBe(0);
  });
});

describe("sortTagsByCount", () => {
  it("pins selected tags to the front regardless of count", () => {
    const tags = ["a", "b", "c"];
    const counts = new Map([
      ["a", 10],
      ["b", 1],
      ["c", 5],
    ]);
    const sorted = sortTagsByCount(tags, counts, new Set(["b"]));
    expect(sorted).toEqual(["b", "a", "c"]);
  });

  it("sorts by count descending", () => {
    const tags = ["a", "b", "c"];
    const counts = new Map([
      ["a", 1],
      ["b", 5],
      ["c", 3],
    ]);
    expect(sortTagsByCount(tags, counts, new Set())).toEqual(["b", "c", "a"]);
  });

  it("breaks count ties alphabetically", () => {
    const tags = ["delta", "alpha", "charlie", "bravo"];
    const counts = new Map([
      ["alpha", 2],
      ["bravo", 2],
      ["charlie", 2],
      ["delta", 2],
    ]);
    expect(sortTagsByCount(tags, counts, new Set())).toEqual([
      "alpha",
      "bravo",
      "charlie",
      "delta",
    ]);
  });

  it("treats tags missing from the counts map as count=0", () => {
    const tags = ["known", "missing-a", "missing-b"];
    const counts = new Map([["known", 1]]);
    const sorted = sortTagsByCount(tags, counts, new Set());
    // "known" has count 1, the others tie at 0 and sort alphabetically.
    expect(sorted).toEqual(["known", "missing-a", "missing-b"]);
  });

  it("orders selected-pinned first, then by count desc, then alphabetical", () => {
    const tags = ["polarized", "taper", "base", "hills"];
    const counts = new Map([
      ["polarized", 1],
      ["taper", 5],
      ["base", 5],
      ["hills", 3],
    ]);
    const sorted = sortTagsByCount(tags, counts, new Set(["polarized"]));
    expect(sorted).toEqual(["polarized", "base", "taper", "hills"]);
  });

  it("does not mutate the input array", () => {
    const tags = ["b", "a"];
    const original = [...tags];
    sortTagsByCount(tags, new Map(), new Set());
    expect(tags).toEqual(original);
  });
});

describe("filterTemplatesByTags", () => {
  it("returns all templates when the selection is empty", () => {
    const templates = [tpl("a", ["x"]), tpl("b", [])];
    expect(filterTemplatesByTags(templates, new Set())).toHaveLength(2);
  });

  it("keeps only templates carrying every selected tag (AND semantics)", () => {
    const templates = [
      tpl("a", ["polarized", "hill focus"]),
      tpl("b", ["polarized"]),
      tpl("c", ["hill focus"]),
    ];
    const result = filterTemplatesByTags(
      templates,
      new Set(["polarized", "hill focus"]),
    );
    expect(result.map((t) => t.id)).toEqual(["a"]);
  });
});

describe("countTemplatesByTag", () => {
  const templates: CategorizableTemplate[] = [
    tpl("a", ["marathon", "polarized", "advanced"]),
    tpl("b", ["marathon", "pyramidal", "advanced"]),
    tpl("c", ["half-marathon", "polarized", "intermediate"]),
    tpl("d", ["5k", "beginner"]),
  ];

  it("with no selection counts every distinct tag across all templates", () => {
    const counts = countTemplatesByTag(templates, new Set());
    expect(counts.get("marathon")).toBe(2);
    expect(counts.get("polarized")).toBe(2);
    expect(counts.get("advanced")).toBe(2);
    expect(counts.get("pyramidal")).toBe(1);
    expect(counts.get("half-marathon")).toBe(1);
    expect(counts.get("intermediate")).toBe(1);
    expect(counts.get("5k")).toBe(1);
    expect(counts.get("beginner")).toBe(1);
  });

  it("with one selected tag scopes counts to templates carrying that tag (and the selected tag's count equals the matching set size)", () => {
    const counts = countTemplatesByTag(templates, new Set(["marathon"]));
    // Templates a + b match -> tags on those two.
    expect(counts.get("marathon")).toBe(2);
    expect(counts.get("advanced")).toBe(2);
    expect(counts.get("polarized")).toBe(1); // only "a"
    expect(counts.get("pyramidal")).toBe(1); // only "b"
    // Tags absent from any matching template don't appear at all.
    expect(counts.has("half-marathon")).toBe(false);
    expect(counts.has("5k")).toBe(false);
    expect(counts.has("beginner")).toBe(false);
    expect(counts.has("intermediate")).toBe(false);
  });

  it("uses AND-semantics when multiple tags are selected", () => {
    const counts = countTemplatesByTag(
      templates,
      new Set(["marathon", "advanced"]),
    );
    // Both "a" and "b" carry marathon AND advanced.
    expect(counts.get("marathon")).toBe(2);
    expect(counts.get("advanced")).toBe(2);
    expect(counts.get("polarized")).toBe(1);
    expect(counts.get("pyramidal")).toBe(1);

    // Narrowing further to a tag only one of them carries leaves
    // exactly that one matching template.
    const narrower = countTemplatesByTag(
      templates,
      new Set(["marathon", "polarized"]),
    );
    expect(narrower.get("marathon")).toBe(1);
    expect(narrower.get("polarized")).toBe(1);
    expect(narrower.get("advanced")).toBe(1);
    expect(narrower.has("pyramidal")).toBe(false);
  });

  it("omits tags that no matching template carries (zero count means absent from the map)", () => {
    // No template carries both marathon AND beginner -> empty match
    // set -> the returned map has no entries at all.
    const counts = countTemplatesByTag(
      templates,
      new Set(["marathon", "beginner"]),
    );
    expect(counts.size).toBe(0);
    // A tag that exists in the catalog but isn't on any matching
    // template is therefore absent (callers read it as count 0).
    expect(counts.get("pyramidal")).toBeUndefined();
  });
});
