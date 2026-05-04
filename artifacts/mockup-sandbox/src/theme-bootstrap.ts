/**
 * Sandbox default theme bootstrap.
 *
 * The sandbox renders mockups with the "Arctic Performance" palette as the
 * baseline look-and-feel (matching the live Command Center). Rather than
 * hand-copying those HSL values into `index.css` — where they would silently
 * drift if anyone tweaked the canonical palette in `palettes.ts` — we
 * generate the `:root { ... }` and `.dark { ... }` CSS variable blocks
 * directly from `PALETTES["arctic-performance"]` at module-load time and
 * inject them as a `<style>` element in the document head.
 *
 * Importing this module is enough; it has a top-level side effect that runs
 * exactly once per page load (it bails out if the style element is already
 * present, e.g. during HMR).
 *
 * The PaletteVariant gallery components inline their own per-palette CSS
 * variables on a wrapper element, which override these document-level
 * defaults wherever they render — so swapping the Arctic palette here does
 * not affect the other palette previews.
 */

import {
  PALETTES,
  paletteTokensToCssVars,
  type PaletteTokens,
} from "./components/mockups/_shared/palettes";

const STYLE_ELEMENT_ID = "sandbox-default-theme";
const DEFAULT_PALETTE_KEY = "arctic-performance";

function tokensToCssBlock(tokens: PaletteTokens): string {
  const vars = paletteTokensToCssVars(tokens);
  return Object.entries(vars)
    .map(([cssVar, value]) => `  ${cssVar}: ${value};`)
    .join("\n");
}

function buildDefaultThemeCss(): string {
  const palette = PALETTES[DEFAULT_PALETTE_KEY];
  if (!palette) {
    throw new Error(
      `theme-bootstrap: missing default palette "${DEFAULT_PALETTE_KEY}"`,
    );
  }

  return [
    "/* Auto-generated from PALETTES['" +
      DEFAULT_PALETTE_KEY +
      "'] by theme-bootstrap.ts. Do not hand-edit. */",
    ":root {",
    tokensToCssBlock(palette.light),
    "}",
    ".dark {",
    tokensToCssBlock(palette.dark),
    "}",
  ].join("\n");
}

export function installDefaultTheme(): void {
  if (typeof document === "undefined") {
    return;
  }
  if (document.getElementById(STYLE_ELEMENT_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = STYLE_ELEMENT_ID;
  style.textContent = buildDefaultThemeCss();
  document.head.appendChild(style);
}

installDefaultTheme();
