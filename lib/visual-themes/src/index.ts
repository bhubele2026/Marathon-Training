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
  success: string;
  successForeground: string;
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
  // BH Studio palette: a single, confident, professional look. Neutral
  // charcoal/gray base + exactly ONE accent — BH Studio orange (hue ~22).
  // The accent is reserved for active nav, primary buttons, focus rings,
  // and the single most important number on a screen. chart-1 is the orange
  // accent; chart-2..5 are a graded neutral gray ramp so charts never go
  // multi-hue / rainbow. (Earlier comments said "teal" — that drift is
  // fixed; the identity is orange. Do not reintroduce teal.)
  studio: {
    key: "studio",
    name: "Studio",
    number: "01",
    tagline: "Matte black on light, one orange highlight. Clean and confident.",
    light: {
      background: "30 33% 98%",
      foreground: "24 14% 12%",
      border: "28 16% 90%",
      card: "30 40% 99%",
      cardForeground: "24 14% 12%",
      cardBorder: "28 16% 90%",
      sidebar: "24 14% 9%",
      sidebarForeground: "30 10% 82%",
      sidebarBorder: "26 10% 18%",
      sidebarPrimary: "18 89% 52%",
      sidebarPrimaryForeground: "0 0% 100%",
      sidebarAccent: "26 10% 16%",
      sidebarAccentForeground: "30 10% 92%",
      sidebarRing: "18 89% 52%",
      popover: "30 40% 99%",
      popoverForeground: "24 14% 12%",
      popoverBorder: "28 16% 90%",
      primary: "18 89% 52%",
      primaryForeground: "0 0% 100%",
      secondary: "30 20% 95%",
      secondaryForeground: "24 14% 18%",
      muted: "30 24% 95.5%",
      mutedForeground: "25 8% 42%",
      accent: "18 89% 52%",
      accentForeground: "0 0% 100%",
      success: "152 52% 38%",
      successForeground: "0 0% 100%",
      destructive: "0 60% 48%",
      destructiveForeground: "0 0% 100%",
      input: "28 16% 88%",
      ring: "18 89% 52%",
      // Legacy token NAMES preserved so downstream components keep
      // working; both map to the single BH Studio orange accent.
      brandOrange: "18 89% 52%",
      brandPurple: "18 89% 52%",
      chart1: "18 89% 52%",
      chart2: "26 8% 38%",
      chart3: "26 7% 52%",
      chart4: "28 8% 68%",
      chart5: "30 10% 80%",
    },
    dark: {
      background: "24 12% 8%",
      foreground: "30 12% 92%",
      border: "26 9% 18%",
      card: "24 11% 12%",
      cardForeground: "30 12% 92%",
      cardBorder: "26 9% 18%",
      sidebar: "24 14% 6%",
      sidebarForeground: "30 10% 84%",
      sidebarBorder: "26 9% 14%",
      sidebarPrimary: "20 90% 56%",
      sidebarPrimaryForeground: "0 0% 100%",
      sidebarAccent: "24 9% 15%",
      sidebarAccentForeground: "30 12% 92%",
      sidebarRing: "20 90% 56%",
      popover: "24 11% 12%",
      popoverForeground: "30 12% 92%",
      popoverBorder: "26 9% 18%",
      primary: "20 90% 56%",
      primaryForeground: "0 0% 100%",
      secondary: "24 9% 16%",
      secondaryForeground: "30 12% 92%",
      muted: "24 9% 14%",
      mutedForeground: "28 8% 60%",
      accent: "20 90% 56%",
      accentForeground: "0 0% 100%",
      success: "150 50% 48%",
      successForeground: "0 0% 100%",
      destructive: "0 62% 52%",
      destructiveForeground: "0 0% 100%",
      input: "24 9% 16%",
      ring: "20 90% 56%",
      brandOrange: "20 90% 56%",
      brandPurple: "20 90% 56%",
      chart1: "20 90% 56%",
      chart2: "28 8% 72%",
      chart3: "26 7% 58%",
      chart4: "26 7% 44%",
      chart5: "24 7% 32%",
    },
    phaseColors: {
      // Collapsed to the accent + a graded WARM neutral ramp — no second
      // hue. The orange marks the most "active" phase; the rest read as
      // quieter warm grays differentiated by lightness.
      foundation: "hsl(26 8% 56%)",
      aerobic: "hsl(26 8% 46%)",
      tempo: "hsl(18 85% 53%)",
      raceSpecific: "hsl(20 90% 58%)",
      taper: "hsl(28 8% 66%)",
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
  success: "--success",
  successForeground: "--success-foreground",
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
