import { describe, expect, it } from "vitest";
import {
  countTemplatesByTag,
  filterTemplatesByTags,
  getAllTemplateTags,
  type CategorizableTemplate,
} from "./planner-templates";

function tpl(
  id: string,
  tags: string[],
  overrides: Partial<CategorizableTemplate> = {},
): CategorizableTemplate {
  return {
    id,
    name: id,
    source: "Test",
    goalDistance: "Marathon",
    metadata: { equipmentMixHint: "Run" },
    tags,
    ...overrides,
  } as CategorizableTemplate;
}

describe("getAllTemplateTags", () => {
  it("returns the empty list for an empty catalog", () => {
    expect(getAllTemplateTags([])).toEqual([]);
  });

  it("returns distinct tags across the catalog (de-duplicated)", () => {
    const tags = getAllTemplateTags([
      tpl("a", ["polarized", "marathon"]),
      tpl("b", ["polarized", "hansons"]),
      tpl("c", ["marathon", "hansons"]),
    ]);
    // Each label appears exactly once.
    expect([...tags].sort()).toEqual(["hansons", "marathon", "polarized"]);
    expect(new Set(tags).size).toBe(tags.length);
  });

  it("alphabetizes the result regardless of template insertion order", () => {
    const tags = getAllTemplateTags([
      tpl("x", ["zebra", "apple"]),
      tpl("y", ["mango"]),
      tpl("z", ["banana", "apple"]),
    ]);
    expect(tags).toEqual(["apple", "banana", "mango", "zebra"]);
  });

  it("ignores templates that carry no tags without throwing", () => {
    const tags = getAllTemplateTags([
      tpl("a", []),
      tpl("b", ["tempo"]),
      tpl("c", []),
    ]);
    expect(tags).toEqual(["tempo"]);
  });
});

describe("filterTemplatesByTags", () => {
  const catalog: CategorizableTemplate[] = [
    tpl("hm_pfitz", ["half-marathon", "pfitzinger", "threshold"]),
    tpl("marathon_pfitz", ["marathon", "pfitzinger", "threshold"]),
    tpl("marathon_hansons", ["marathon", "hansons", "threshold"]),
    tpl("base_lydiard", ["base", "lydiard", "easy"]),
  ];

  it("is a no-op when no tags are selected (returns a fresh copy)", () => {
    const out = filterTemplatesByTags(catalog, new Set<string>());
    expect(out).toEqual(catalog);
    // Returns a fresh array (callers may mutate without affecting the input).
    expect(out).not.toBe(catalog);
  });

  it("narrows to templates that carry the single selected tag", () => {
    const out = filterTemplatesByTags(
      catalog,
      new Set(["pfitzinger"]),
    );
    expect(out.map((t) => t.id)).toEqual(["hm_pfitz", "marathon_pfitz"]);
  });

  it("composes selections with AND semantics, not OR", () => {
    const out = filterTemplatesByTags(
      catalog,
      new Set(["marathon", "pfitzinger"]),
    );
    // Only the template carrying BOTH tags survives — the hansons
    // marathon and the half-marathon pfitz are filtered out.
    expect(out.map((t) => t.id)).toEqual(["marathon_pfitz"]);
  });

  it("returns zero matches when an unknown tag is part of the selection", () => {
    const out = filterTemplatesByTags(
      catalog,
      new Set(["pfitzinger", "does-not-exist"]),
    );
    expect(out).toEqual([]);
  });

  it("returns zero matches when the only selected tag is unknown", () => {
    const out = filterTemplatesByTags(catalog, new Set(["zzz-nope"]));
    expect(out).toEqual([]);
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
