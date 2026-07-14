// Canonical visual theme palettes shared between the Marathon Command
// Center (live app) and the mockup sandbox (design preview). Both
// surfaces import from this single module so a tweak made in one place
// shows up in the other automatically.
//
// The token KEYS use camelCase; they are mapped to the kebab-case CSS
// custom-property names used by `index.css` at runtime via
// `PALETTE_TOKEN_TO_CSS_VAR` and `paletteTokensToCssVars`.

export type PaletteMode = "light" | "dark";

export interface PaletteTokens {
  background: string;
  foreground: string;
  border: string;
  card: string;
  cardForeground: string;
  cardBorder: string;
  sidebar: string;
  sidebarForeground: string;
  sidebarBorder: string;
  sidebarPrimary: string;
  sidebarPrimaryForeground: string;
  sidebarAccent: string;
  sidebarAccentForeground: string;
  sidebarRing: string;
  popover: string;
  popoverForeground: string;
  popoverBorder: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  navy: string;
  navyForeground: string;
  success: string;
  successForeground: string;
  warning: string;
  warningForeground: string;
  destructive: string;
  destructiveForeground: string;
  input: string;
  ring: string;
  brandOrange: string;
  brandPurple: string;
  chart1: string;
  chart2: string;
  chart3: string;
  chart4: string;
  chart5: string;
}

export interface PaletteDefinition {
  key: string;
  name: string;
  number: string;
  tagline: string;
  light: PaletteTokens;
  dark: PaletteTokens;
  // Phase colors are written as full `hsl(...)` strings. They are
  // pushed into CSS variables (`--phase-foundation`, etc.) at runtime
  // so the `phaseColor()` function can stay theme-agnostic.
  phaseColors: {
    foundation: string;
    aerobic: string;
    tempo: string;
    raceSpecific: string;
    taper: string;
  };
}

export const PALETTES: Record<string, PaletteDefinition> = {
  // BH Studio palette — "Vibrant Summer": bright, lively, tiled. Warm sunny cream
  // canvas (with a soft golden/coral/lime corner wash on the body), bright-white
  // tiles, OCEAN BLUE (#1E88D2) as the brand/primary (active
  // nav, primary buttons, focus rings, hero number). Status secondaries stay
  // SEMANTIC: success=green (ahead/good), warning=amber (heads-up),
  // destructive=red (over/behind). The data-viz ramp is a FIXED, coordinated
  // summer palette — calories=ocean blue, protein=coral red (#FF5C5C),
  // carbs=golden yellow (#FFC93C), fat=grape purple (#6B4E9B), water=lime green
  // (#8BC53F) — reused so the same metric is always the same colour. `navy` is
  // an ocean-blue intensity for the activity heatmap (less→more).
  // "Tempo" — the Render-rebuild identity. A crisp, energetic performance
  // dashboard: cool graphite neutrals, an electric cobalt primary, mono
  // numerals, and a real categorical data-viz ramp (cobalt / teal / violet /
  // amber / rose) so each metric owns a hue. Replaces the old monochrome
  // matte-black "Studio" look. Key stays "studio" so the default-key + settings
  // picker keep working unchanged.
  studio: {
    key: "studio",
    name: "Tempo",
    number: "01",
    tagline: "Cool graphite + electric cobalt, mono numerals, a full-colour data ramp.",
    light: {
      background: "220 33% 98%",
      foreground: "222 47% 11%",
      border: "220 20% 90%",
      card: "0 0% 100%",
      cardForeground: "222 47% 11%",
      cardBorder: "220 22% 92%",
      sidebar: "0 0% 100%",
      sidebarForeground: "222 30% 20%",
      sidebarBorder: "220 20% 90%",
      sidebarPrimary: "226 72% 56%",
      sidebarPrimaryForeground: "0 0% 100%",
      sidebarAccent: "220 30% 96%",
      sidebarAccentForeground: "222 40% 20%",
      sidebarRing: "226 72% 56%",
      popover: "0 0% 100%",
      popoverForeground: "222 47% 11%",
      popoverBorder: "220 22% 92%",
      primary: "226 72% 56%",
      primaryForeground: "0 0% 100%",
      secondary: "220 30% 95%",
      secondaryForeground: "222 40% 22%",
      muted: "220 26% 95%",
      mutedForeground: "220 12% 46%",
      accent: "226 72% 56%",
      accentForeground: "0 0% 100%",
      navy: "226 72% 56%",
      navyForeground: "0 0% 100%",
      success: "152 55% 40%",
      successForeground: "0 0% 100%",
      warning: "36 92% 46%",
      warningForeground: "0 0% 100%",
      destructive: "356 70% 54%",
      destructiveForeground: "0 0% 100%",
      input: "220 20% 88%",
      ring: "226 72% 56%",
      brandOrange: "36 92% 50%",
      brandPurple: "265 60% 60%",
      chart1: "226 72% 56%",
      chart2: "178 60% 40%",
      chart3: "265 60% 60%",
      chart4: "36 92% 50%",
      chart5: "340 70% 58%",
    },
    dark: {
      background: "222 42% 8%",
      foreground: "210 30% 92%",
      border: "220 20% 20%",
      card: "222 35% 12%",
      cardForeground: "210 30% 92%",
      cardBorder: "220 18% 22%",
      sidebar: "222 38% 10%",
      sidebarForeground: "210 25% 86%",
      sidebarBorder: "220 18% 18%",
      sidebarPrimary: "226 80% 66%",
      sidebarPrimaryForeground: "222 45% 10%",
      sidebarAccent: "222 30% 16%",
      sidebarAccentForeground: "210 25% 90%",
      sidebarRing: "226 80% 66%",
      popover: "222 35% 12%",
      popoverForeground: "210 30% 92%",
      popoverBorder: "220 18% 22%",
      primary: "226 80% 66%",
      primaryForeground: "222 45% 10%",
      secondary: "222 25% 18%",
      secondaryForeground: "210 25% 90%",
      muted: "222 22% 17%",
      mutedForeground: "215 16% 62%",
      accent: "226 80% 66%",
      accentForeground: "222 45% 10%",
      navy: "226 80% 66%",
      navyForeground: "222 45% 10%",
      success: "152 50% 52%",
      successForeground: "222 40% 8%",
      warning: "36 90% 58%",
      warningForeground: "222 40% 8%",
      destructive: "356 72% 62%",
      destructiveForeground: "0 0% 100%",
      input: "220 18% 24%",
      ring: "226 80% 66%",
      brandOrange: "36 90% 58%",
      brandPurple: "265 70% 70%",
      chart1: "226 80% 68%",
      chart2: "178 60% 50%",
      chart3: "265 70% 70%",
      chart4: "36 90% 60%",
      chart5: "340 75% 66%",
    },
    phaseColors: {
      // The training arc as a cohesive colour progression: teal → cobalt →
      // amber → rose → violet (build to race to taper).
      foundation: "hsl(178 55% 44%)",
      aerobic: "hsl(226 72% 56%)",
      tempo: "hsl(36 92% 50%)",
      raceSpecific: "hsl(340 70% 58%)",
      taper: "hsl(265 60% 62%)",
    },
  },
};

/**
 * Single source of truth for mapping {@link PaletteTokens} fields to the CSS
 * custom properties they are written to. Keep this list in sync with the
 * `PaletteTokens` interface.
 */
export const PALETTE_TOKEN_TO_CSS_VAR: Record<keyof PaletteTokens, string> = {
  background: "--background",
  foreground: "--foreground",
  border: "--border",
  card: "--card",
  cardForeground: "--card-foreground",
  cardBorder: "--card-border",
  sidebar: "--sidebar",
  sidebarForeground: "--sidebar-foreground",
  sidebarBorder: "--sidebar-border",
  sidebarPrimary: "--sidebar-primary",
  sidebarPrimaryForeground: "--sidebar-primary-foreground",
  sidebarAccent: "--sidebar-accent",
  sidebarAccentForeground: "--sidebar-accent-foreground",
  sidebarRing: "--sidebar-ring",
  popover: "--popover",
  popoverForeground: "--popover-foreground",
  popoverBorder: "--popover-border",
  primary: "--primary",
  primaryForeground: "--primary-foreground",
  secondary: "--secondary",
  secondaryForeground: "--secondary-foreground",
  muted: "--muted",
  mutedForeground: "--muted-foreground",
  accent: "--accent",
  accentForeground: "--accent-foreground",
  navy: "--navy",
  navyForeground: "--navy-foreground",
  success: "--success",
  successForeground: "--success-foreground",
  warning: "--warning",
  warningForeground: "--warning-foreground",
  destructive: "--destructive",
  destructiveForeground: "--destructive-foreground",
  input: "--input",
  ring: "--ring",
  brandOrange: "--brand-orange",
  brandPurple: "--brand-purple",
  chart1: "--chart-1",
  chart2: "--chart-2",
  chart3: "--chart-3",
  chart4: "--chart-4",
  chart5: "--chart-5",
};

/**
 * Translates a {@link PaletteTokens} object into a `{ "--var": "value" }`
 * map suitable for either inline React `style` props or for serialising into
 * a `<style>` rule body.
 */
export function paletteTokensToCssVars(
  tokens: PaletteTokens,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [tokenKey, cssVar] of Object.entries(PALETTE_TOKEN_TO_CSS_VAR)) {
    out[cssVar] = tokens[tokenKey as keyof PaletteTokens];
  }
  return out;
}

export const PHASE_VAR_NAMES = {
  foundation: "--phase-foundation",
  aerobic: "--phase-aerobic",
  tempo: "--phase-tempo",
  raceSpecific: "--phase-race-specific",
  taper: "--phase-taper",
} as const;

export const PHASE_LABELS: Array<keyof PaletteDefinition["phaseColors"]> = [
  "foundation",
  "aerobic",
  "tempo",
  "raceSpecific",
  "taper",
];

export const PHASE_DISPLAY: Record<keyof PaletteDefinition["phaseColors"], string> = {
  foundation: "Foundation Build",
  aerobic: "Aerobic Build",
  tempo: "Tempo/Threshold",
  raceSpecific: "Race-Specific",
  taper: "Taper & Race",
};

export const DEFAULT_PALETTE_KEY = "studio";

export function isPaletteKey(value: string | null | undefined): value is string {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PALETTES, value);
}
