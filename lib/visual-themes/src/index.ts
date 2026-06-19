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
  // Phase 2 overhaul: a single, calm, professional palette. Neutral
  // charcoal/gray base + exactly ONE accent (a muted, desaturated
  // teal). No red/orange. The accent is reserved for active nav,
  // primary buttons, focus rings, and the single most important number
  // on a screen. chart-1 is the accent; chart-2..5 are a graded neutral
  // gray ramp so charts never go multi-hue / rainbow.
  studio: {
    key: "studio",
    name: "Studio",
    number: "01",
    tagline: "Matte black on light, one orange highlight. Clean and confident.",
    light: {
      background: "210 20% 98%",
      foreground: "20 12% 12%",
      border: "220 14% 90%",
      card: "0 0% 100%",
      cardForeground: "20 12% 12%",
      cardBorder: "220 14% 91%",
      sidebar: "220 16% 13%",
      sidebarForeground: "220 12% 82%",
      sidebarBorder: "220 12% 20%",
      sidebarPrimary: "22 92% 50%",
      sidebarPrimaryForeground: "0 0% 100%",
      sidebarAccent: "220 12% 20%",
      sidebarAccentForeground: "0 0% 98%",
      sidebarRing: "22 92% 50%",
      popover: "0 0% 100%",
      popoverForeground: "20 12% 12%",
      popoverBorder: "220 14% 91%",
      primary: "22 92% 52%",
      primaryForeground: "0 0% 100%",
      secondary: "220 16% 95%",
      secondaryForeground: "220 18% 18%",
      muted: "220 16% 96%",
      mutedForeground: "220 9% 45%",
      accent: "22 92% 52%",
      accentForeground: "0 0% 100%",
      destructive: "0 60% 48%",
      destructiveForeground: "0 0% 100%",
      input: "220 14% 89%",
      ring: "22 92% 52%",
      // Legacy token NAMES preserved so downstream components keep
      // working; both now map to the single teal accent.
      brandOrange: "22 92% 52%",
      brandPurple: "22 92% 52%",
      chart1: "22 92% 52%",
      chart2: "220 10% 38%",
      chart3: "220 9% 52%",
      chart4: "220 8% 66%",
      chart5: "220 8% 78%",
    },
    dark: {
      background: "220 14% 8%",
      foreground: "210 16% 94%",
      border: "220 10% 18%",
      card: "220 12% 12%",
      cardForeground: "210 16% 94%",
      cardBorder: "220 10% 18%",
      sidebar: "220 16% 6%",
      sidebarForeground: "210 12% 84%",
      sidebarBorder: "220 10% 14%",
      sidebarPrimary: "24 95% 58%",
      sidebarPrimaryForeground: "0 0% 100%",
      sidebarAccent: "220 10% 15%",
      sidebarAccentForeground: "210 16% 94%",
      sidebarRing: "24 95% 58%",
      popover: "220 12% 12%",
      popoverForeground: "210 16% 94%",
      popoverBorder: "220 10% 18%",
      primary: "24 95% 58%",
      primaryForeground: "0 0% 100%",
      secondary: "220 10% 16%",
      secondaryForeground: "210 16% 94%",
      muted: "220 10% 14%",
      mutedForeground: "215 10% 62%",
      accent: "24 95% 58%",
      accentForeground: "0 0% 100%",
      destructive: "0 62% 52%",
      destructiveForeground: "0 0% 100%",
      input: "220 10% 16%",
      ring: "24 95% 58%",
      brandOrange: "24 95% 58%",
      brandPurple: "24 95% 58%",
      chart1: "24 95% 60%",
      chart2: "220 10% 70%",
      chart3: "220 9% 56%",
      chart4: "220 8% 42%",
      chart5: "220 8% 30%",
    },
    phaseColors: {
      // Collapsed to the accent + a graded neutral ramp — no second
      // hue. The teal marks the most "active" phase; the rest read as
      // quieter grays differentiated by lightness.
      foundation: "hsl(220 9% 56%)",
      aerobic: "hsl(220 9% 46%)",
      tempo: "hsl(22 85% 53%)",
      raceSpecific: "hsl(24 95% 58%)",
      taper: "hsl(220 9% 66%)",
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
