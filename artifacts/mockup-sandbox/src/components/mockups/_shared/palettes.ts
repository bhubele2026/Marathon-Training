// Thin re-export of the shared `@workspace/visual-themes` lib so the
// sandbox and the live Command Center read from a single source of
// truth. Keep all palette additions/edits in the lib package.
export {
  PALETTES,
  DEFAULT_PALETTE_KEY,
  PALETTE_TOKEN_TO_CSS_VAR,
  paletteTokensToCssVars,
  PHASE_LABELS,
  PHASE_DISPLAY,
  type PaletteMode,
  type PaletteTokens,
  type PaletteDefinition,
} from "@workspace/visual-themes";
