import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  PALETTES,
  DEFAULT_PALETTE_KEY,
  PALETTE_TOKEN_TO_CSS_VAR,
  paletteTokensToCssVars,
} from "./components/mockups/_shared/palettes";

import "./theme-bootstrap";

const STYLE_ELEMENT_ID = "sandbox-default-theme";
const INDEX_CSS_PATH = path.resolve(import.meta.dirname, "./index.css");
const MAIN_TSX_PATH = path.resolve(import.meta.dirname, "./main.tsx");

function parseCssVarBlock(css: string, blockRegex: RegExp): Record<string, string> {
  const match = css.match(blockRegex);
  if (!match) {
    throw new Error(`Could not find block matching ${blockRegex} in:\n${css}`);
  }
  const body = match[1];
  const out: Record<string, string> = {};
  for (const decl of body.split(";")) {
    const idx = decl.indexOf(":");
    if (idx === -1) continue;
    const name = decl.slice(0, idx).trim();
    const value = decl.slice(idx + 1).trim();
    if (name.startsWith("--")) {
      out[name] = value;
    }
  }
  return out;
}

describe("sandbox theme bootstrap", () => {
  it("injects a <style> element from PALETTES[DEFAULT_PALETTE_KEY]", () => {
    const style = document.getElementById(
      STYLE_ELEMENT_ID,
    ) as HTMLStyleElement | null;

    expect(style).not.toBeNull();
    expect(style!.tagName).toBe("STYLE");

    const css = style!.textContent ?? "";
    const palette = PALETTES[DEFAULT_PALETTE_KEY];

    const rootVars = parseCssVarBlock(css, /:root\s*\{([^}]*)\}/);
    const darkVars = parseCssVarBlock(css, /\.dark\s*\{([^}]*)\}/);

    expect(rootVars).toEqual(paletteTokensToCssVars(palette.light));
    expect(darkVars).toEqual(paletteTokensToCssVars(palette.dark));
  });

  it("is imported by main.tsx so the bootstrap runs in the real app", () => {
    const mainSrc = readFileSync(MAIN_TSX_PATH, "utf8");
    // Match `import "./theme-bootstrap"` or `import './theme-bootstrap'`
    // (with optional `.ts` / `.js` extension and either quote style).
    expect(mainSrc).toMatch(
      /import\s+["']\.\/theme-bootstrap(?:\.[tj]s)?["']/,
    );
  });
});

describe("sandbox index.css palette drift guard", () => {
  it("does not hand-copy any palette CSS variable values", () => {
    const css = readFileSync(INDEX_CSS_PATH, "utf8");
    const offenders: string[] = [];

    for (const cssVar of Object.values(PALETTE_TOKEN_TO_CSS_VAR)) {
      // Match a *definition* of the palette CSS var (e.g.
      // `--background: 210 22% 97%;`) but NOT a reference inside another
      // var name like `--color-background:` or `var(--background)`.
      // The leading `(^|[^a-zA-Z0-9-])` ensures we don't match when the
      // token name is a suffix of a longer identifier such as
      // `--color-background:`. The trailing `\s*:` ensures we only flag
      // assignments, not references inside `var(...)`.
      const re = new RegExp(
        `(?:^|[^a-zA-Z0-9-])${cssVar}\\s*:`,
        "m",
      );
      if (re.test(css)) {
        offenders.push(cssVar);
      }
    }

    expect(
      offenders,
      `index.css must not hand-copy palette CSS vars; theme-bootstrap.ts is the single source of truth. Offenders: ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});
