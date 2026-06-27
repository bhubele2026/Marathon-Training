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
      background: "40 44% 97%",
      foreground: "222 30% 12%",
      border: "38 30% 90%",
      card: "0 0% 100%",
      cardForeground: "222 30% 12%",
      cardBorder: "38 30% 90%",
      sidebar: "0 0% 100%",
      sidebarForeground: "222 30% 18%",
      sidebarBorder: "38 30% 90%",
      sidebarPrimary: "205 75% 47%",
      sidebarPrimaryForeground: "0 0% 100%",
      sidebarAccent: "40 36% 94%",
      sidebarAccentForeground: "222 30% 18%",
      sidebarRing: "205 75% 47%",
      popover: "0 0% 100%",
      popoverForeground: "222 30% 12%",
      popoverBorder: "38 30% 90%",
      primary: "205 75% 47%",
      primaryForeground: "0 0% 100%",
      secondary: "40 36% 94%",
      secondaryForeground: "222 30% 18%",
      muted: "40 32% 94%",
      mutedForeground: "215 16% 47%",
      accent: "205 75% 47%",
      accentForeground: "0 0% 100%",
      navy: "205 78% 38%",
      navyForeground: "0 0% 100%",
      success: "150 58% 40%",
      successForeground: "0 0% 100%",
      warning: "38 92% 50%",
      warningForeground: "222 30% 12%",
      destructive: "0 72% 51%",
      destructiveForeground: "0 0% 100%",
      input: "38 28% 88%",
      ring: "205 75% 47%",
      // Legacy token NAMES preserved so downstream components keep working;
      // both now map to the ocean-blue brand accent.
      brandOrange: "205 75% 47%",
      brandPurple: "205 75% 47%",
      // Fixed summer metric palette: calories=ocean blue, protein=coral red,
      // carbs=golden yellow, fat=grape purple, water=lime green.
      chart1: "205 75% 47%",
      chart2: "0 100% 68%",
      chart3: "43 100% 62%",
      chart4: "263 33% 46%",
      chart5: "86 54% 51%",
    },
    dark: {
      background: "222 28% 10%",
      foreground: "210 30% 94%",
      border: "222 16% 22%",
      card: "222 24% 13%",
      cardForeground: "210 30% 94%",
      cardBorder: "222 16% 22%",
      sidebar: "222 24% 12%",
      sidebarForeground: "210 30% 90%",
      sidebarBorder: "222 16% 20%",
      sidebarPrimary: "205 82% 60%",
      sidebarPrimaryForeground: "222 47% 11%",
      sidebarAccent: "222 18% 18%",
      sidebarAccentForeground: "210 30% 92%",
      sidebarRing: "205 82% 60%",
      popover: "222 24% 13%",
      popoverForeground: "210 30% 94%",
      popoverBorder: "222 16% 22%",
      primary: "205 82% 60%",
      primaryForeground: "222 47% 11%",
      secondary: "222 18% 18%",
      secondaryForeground: "210 30% 94%",
      muted: "222 18% 16%",
      mutedForeground: "215 18% 65%",
      accent: "205 82% 60%",
      accentForeground: "222 47% 11%",
      navy: "205 75% 66%",
      navyForeground: "222 47% 11%",
      success: "150 56% 52%",
      successForeground: "222 47% 11%",
      warning: "38 92% 58%",
      warningForeground: "222 47% 11%",
      destructive: "0 70% 58%",
      destructiveForeground: "0 0% 100%",
      input: "222 16% 20%",
      ring: "205 82% 60%",
      brandOrange: "205 82% 60%",
      brandPurple: "205 82% 60%",
      chart1: "205 82% 60%",
      chart2: "0 95% 72%",
      chart3: "43 95% 64%",
      chart4: "263 42% 64%",
      chart5: "86 56% 58%",
    },
    phaseColors: {
      // Cool, semantic phase markers drawn from the fixed metric palette —
      // no second warm hue, no neutral-gray ramp. Distinct pastels so a
      // plan's phase band reads at a glance.
      foundation: "hsl(86 54% 51%)",
      aerobic: "hsl(205 75% 47%)",
      tempo: "hsl(43 100% 62%)",
      raceSpecific: "hsl(263 33% 46%)",
      taper: "hsl(0 100% 68%)",
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
