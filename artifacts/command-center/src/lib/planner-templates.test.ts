import { describe, expect, it } from "vitest";
import {
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
