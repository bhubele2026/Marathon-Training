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
  studio: {
    key: "studio",
    name: "Studio",
    number: "01",
    tagline: "Vibrant summer: ocean-blue brand, a coral/gold/lime/grape data palette. Lively and clean.",
    light: {
      background: "0 0% 98%",
      foreground: "0 0% 11%",
      border: "0 0% 90%",
      card: "0 0% 100%",
      cardForeground: "0 0% 11%",
      cardBorder: "0 0% 91%",
      sidebar: "0 0% 100%",
      sidebarForeground: "0 0% 13%",
      sidebarBorder: "0 0% 90%",
      sidebarPrimary: "0 0% 11%",
      sidebarPrimaryForeground: "0 0% 100%",
      sidebarAccent: "0 0% 96%",
      sidebarAccentForeground: "0 0% 13%",
      sidebarRing: "0 0% 11%",
      popover: "0 0% 100%",
      popoverForeground: "0 0% 11%",
      popoverBorder: "0 0% 91%",
      primary: "0 0% 11%",
      primaryForeground: "0 0% 100%",
      secondary: "0 0% 95%",
      secondaryForeground: "0 0% 20%",
      muted: "0 0% 95%",
      mutedForeground: "0 0% 44%",
      accent: "0 0% 11%",
      accentForeground: "0 0% 100%",
      navy: "0 0% 11%",
      navyForeground: "0 0% 100%",
      success: "152 42% 36%",
      successForeground: "0 0% 100%",
      warning: "36 74% 44%",
      warningForeground: "0 0% 100%",
      destructive: "6 62% 48%",
      destructiveForeground: "0 0% 100%",
      input: "0 0% 88%",
      ring: "0 0% 11%",
      brandOrange: "0 0% 11%",
      brandPurple: "0 0% 11%",
      chart1: "0 0% 11%",
      chart2: "0 0% 34%",
      chart3: "0 0% 52%",
      chart4: "0 0% 68%",
      chart5: "0 0% 82%",
    },
    dark: {
      background: "0 0% 8%",
      foreground: "0 0% 92%",
      border: "0 0% 20%",
      card: "0 0% 12%",
      cardForeground: "0 0% 92%",
      cardBorder: "0 0% 20%",
      sidebar: "0 0% 10%",
      sidebarForeground: "0 0% 88%",
      sidebarBorder: "0 0% 18%",
      sidebarPrimary: "0 0% 92%",
      sidebarPrimaryForeground: "0 0% 10%",
      sidebarAccent: "0 0% 16%",
      sidebarAccentForeground: "0 0% 90%",
      sidebarRing: "0 0% 80%",
      popover: "0 0% 12%",
      popoverForeground: "0 0% 92%",
      popoverBorder: "0 0% 20%",
      primary: "0 0% 92%",
      primaryForeground: "0 0% 10%",
      secondary: "0 0% 17%",
      secondaryForeground: "0 0% 92%",
      muted: "0 0% 16%",
      mutedForeground: "0 0% 62%",
      accent: "0 0% 92%",
      accentForeground: "0 0% 10%",
      navy: "0 0% 92%",
      navyForeground: "0 0% 10%",
      success: "152 44% 50%",
      successForeground: "0 0% 10%",
      warning: "36 76% 56%",
      warningForeground: "0 0% 10%",
      destructive: "6 64% 56%",
      destructiveForeground: "0 0% 100%",
      input: "0 0% 20%",
      ring: "0 0% 80%",
      brandOrange: "0 0% 92%",
      brandPurple: "0 0% 92%",
      chart1: "0 0% 92%",
      chart2: "0 0% 70%",
      chart3: "0 0% 54%",
      chart4: "0 0% 40%",
      chart5: "0 0% 30%",
    },
    phaseColors: {
      // Matte black for the lead phase, neutral greys for the rest.
      foundation: "hsl(0 0% 68%)",
      aerobic: "hsl(0 0% 11%)",
      tempo: "hsl(0 0% 52%)",
      raceSpecific: "hsl(0 0% 34%)",
      taper: "hsl(0 0% 82%)",
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
