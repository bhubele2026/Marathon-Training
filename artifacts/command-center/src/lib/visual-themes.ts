// Re-exports the shared `@workspace/visual-themes` lib using the
// command center's historical `Theme*` naming. The sandbox imports
// the same data under its `Palette*` names, so both surfaces stay
// in lockstep.
import {
  PALETTES,
  PALETTE_TOKEN_TO_CSS_VAR,
  PHASE_VAR_NAMES,
  DEFAULT_PALETTE_KEY,
  type PaletteDefinition,
  type PaletteMode,
  type PaletteTokens,
} from "@workspace/visual-themes";

export type ThemeMode = PaletteMode;
export type ThemeTokens = PaletteTokens;
export type ThemeDefinition = PaletteDefinition;

export const THEMES: Record<string, ThemeDefinition> = PALETTES;

export type ThemeKey = keyof typeof THEMES;

export const DEFAULT_THEME_KEY: ThemeKey = DEFAULT_PALETTE_KEY;

export const THEME_LIST: ThemeDefinition[] = Object.values(THEMES);

export const TOKEN_VAR_NAMES: Record<keyof ThemeTokens, string> =
  PALETTE_TOKEN_TO_CSS_VAR;

export { PHASE_VAR_NAMES };

export function isThemeKey(value: string | null | undefined): value is ThemeKey {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(THEMES, value);
}
