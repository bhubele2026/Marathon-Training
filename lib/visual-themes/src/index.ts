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
  // "Cockpit" — the Render-rebuild identity. A dark-first performance cockpit:
  // cool near-black canvas, a NEON LIME signature accent, high contrast, mono
  // numerals, and a neon categorical data-viz ramp (lime / cyan / violet /
  // amber / rose). Hover surfaces stay a calm elevated tone; lime is reserved
  // for CTAs, active state, focus, and hero data so it always reads as "the
  // signal". Light mode mirrors it with a deepened lime for legibility. Key
  // stays "studio" so the default-key + settings picker keep working.
  studio: {
    key: "studio",
    name: "Cockpit",
    number: "01",
    tagline: "Dark-first performance cockpit: near-black, neon-lime signal, mono numerals.",
    light: {
      background: "210 20% 98%",
      foreground: "222 30% 12%",
      border: "220 16% 88%",
      card: "0 0% 100%",
      cardForeground: "222 30% 12%",
      cardBorder: "220 16% 90%",
      sidebar: "0 0% 100%",
      sidebarForeground: "222 25% 18%",
      sidebarBorder: "220 16% 88%",
      sidebarPrimary: "90 60% 36%",
      sidebarPrimaryForeground: "0 0% 100%",
      sidebarAccent: "210 20% 95%",
      sidebarAccentForeground: "222 25% 18%",
      sidebarRing: "90 60% 40%",
      popover: "0 0% 100%",
      popoverForeground: "222 30% 12%",
      popoverBorder: "220 16% 90%",
      primary: "90 62% 36%",
      primaryForeground: "0 0% 100%",
      secondary: "210 20% 94%",
      secondaryForeground: "222 25% 20%",
      muted: "210 20% 95%",
      mutedForeground: "220 10% 42%",
      accent: "210 20% 94%",
      accentForeground: "222 25% 20%",
      navy: "90 62% 36%",
      navyForeground: "0 0% 100%",
      success: "152 55% 38%",
      successForeground: "0 0% 100%",
      warning: "38 92% 45%",
      warningForeground: "0 0% 100%",
      destructive: "2 72% 50%",
      destructiveForeground: "0 0% 100%",
      input: "220 16% 86%",
      ring: "90 60% 40%",
      brandOrange: "38 92% 48%",
      brandPurple: "265 55% 55%",
      chart1: "90 55% 40%",
      chart2: "190 80% 38%",
      chart3: "265 55% 55%",
      chart4: "38 92% 48%",
      chart5: "330 70% 52%",
    },
    dark: {
      background: "222 24% 7%",
      foreground: "210 22% 92%",
      border: "220 14% 20%",
      card: "222 20% 11%",
      cardForeground: "210 22% 92%",
      cardBorder: "220 14% 20%",
      sidebar: "222 24% 9%",
      sidebarForeground: "210 18% 84%",
      sidebarBorder: "220 14% 18%",
      sidebarPrimary: "84 80% 58%",
      sidebarPrimaryForeground: "222 30% 8%",
      sidebarAccent: "222 18% 15%",
      sidebarAccentForeground: "210 18% 88%",
      sidebarRing: "84 80% 58%",
      popover: "222 20% 11%",
      popoverForeground: "210 22% 92%",
      popoverBorder: "220 14% 20%",
      primary: "84 80% 58%",
      primaryForeground: "222 30% 8%",
      secondary: "222 16% 16%",
      secondaryForeground: "210 20% 90%",
      muted: "222 14% 15%",
      mutedForeground: "215 14% 60%",
      accent: "222 18% 16%",
      accentForeground: "210 20% 90%",
      navy: "84 80% 58%",
      navyForeground: "222 30% 8%",
      success: "152 60% 50%",
      successForeground: "222 30% 8%",
      warning: "40 95% 58%",
      warningForeground: "222 30% 8%",
      destructive: "2 78% 62%",
      destructiveForeground: "0 0% 100%",
      input: "220 14% 22%",
      ring: "84 80% 58%",
      brandOrange: "40 95% 58%",
      brandPurple: "265 85% 72%",
      chart1: "84 80% 60%",
      chart2: "188 90% 56%",
      chart3: "265 85% 72%",
      chart4: "40 95% 60%",
      chart5: "330 88% 68%",
    },
    phaseColors: {
      // The training arc as a neon progression: cyan → lime → amber → rose →
      // violet (build to race to taper).
      foundation: "hsl(188 85% 52%)",
      aerobic: "hsl(84 80% 58%)",
      tempo: "hsl(40 95% 58%)",
      raceSpecific: "hsl(330 85% 65%)",
      taper: "hsl(265 82% 70%)",
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
