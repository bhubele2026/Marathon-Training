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
  // BH Studio palette: bright, cool, airy, tiled. Faint cool-gray canvas,
  // bright-white tiles, azure as the ONE loud color (active nav, primary
  // buttons, focus rings, hero number). Pastel secondaries are SEMANTIC:
  // success=green (ahead/good), warning=amber (heads-up), destructive=red
  // (over/behind), navy for tile gradients + active calendar dots. The chart
  // ramp is FIXED per metric — calories=azure, protein=violet, carbs=teal,
  // fat=amber, water=cyan — never a neutral gray ramp, never all-blue. (No
  // orange/teal-as-identity anywhere; the old warm look is gone.)
  studio: {
    key: "studio",
    name: "Studio",
    number: "01",
    tagline: "Bright cool tiles, one azure highlight. Clean and confident.",
    light: {
      background: "214 32% 97%",
      foreground: "222 30% 12%",
      border: "214 24% 91%",
      card: "0 0% 100%",
      cardForeground: "222 30% 12%",
      cardBorder: "214 24% 91%",
      sidebar: "0 0% 100%",
      sidebarForeground: "222 30% 18%",
      sidebarBorder: "214 24% 91%",
      sidebarPrimary: "218 90% 56%",
      sidebarPrimaryForeground: "0 0% 100%",
      sidebarAccent: "214 30% 95%",
      sidebarAccentForeground: "222 30% 18%",
      sidebarRing: "218 90% 56%",
      popover: "0 0% 100%",
      popoverForeground: "222 30% 12%",
      popoverBorder: "214 24% 91%",
      primary: "218 90% 56%",
      primaryForeground: "0 0% 100%",
      secondary: "214 30% 95%",
      secondaryForeground: "222 30% 18%",
      muted: "214 28% 95%",
      mutedForeground: "215 16% 47%",
      accent: "218 90% 56%",
      accentForeground: "0 0% 100%",
      navy: "222 47% 26%",
      navyForeground: "0 0% 100%",
      success: "150 58% 40%",
      successForeground: "0 0% 100%",
      warning: "38 92% 50%",
      warningForeground: "222 30% 12%",
      destructive: "0 72% 51%",
      destructiveForeground: "0 0% 100%",
      input: "214 24% 89%",
      ring: "218 90% 56%",
      // Legacy token NAMES preserved so downstream components keep working;
      // both now map to the single azure accent (orange is retired).
      brandOrange: "218 90% 56%",
      brandPurple: "218 90% 56%",
      // Fixed metric palette: calories=azure, protein=violet, carbs=teal,
      // fat=amber, water=cyan.
      chart1: "218 90% 56%",
      chart2: "262 70% 62%",
      chart3: "168 62% 42%",
      chart4: "38 92% 56%",
      chart5: "192 78% 50%",
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
      sidebarPrimary: "216 92% 64%",
      sidebarPrimaryForeground: "222 47% 11%",
      sidebarAccent: "222 18% 18%",
      sidebarAccentForeground: "210 30% 92%",
      sidebarRing: "216 92% 64%",
      popover: "222 24% 13%",
      popoverForeground: "210 30% 94%",
      popoverBorder: "222 16% 22%",
      primary: "216 92% 64%",
      primaryForeground: "222 47% 11%",
      secondary: "222 18% 18%",
      secondaryForeground: "210 30% 94%",
      muted: "222 18% 16%",
      mutedForeground: "215 18% 65%",
      accent: "216 92% 64%",
      accentForeground: "222 47% 11%",
      navy: "218 60% 72%",
      navyForeground: "222 47% 11%",
      success: "150 56% 52%",
      successForeground: "222 47% 11%",
      warning: "38 92% 58%",
      warningForeground: "222 47% 11%",
      destructive: "0 70% 58%",
      destructiveForeground: "0 0% 100%",
      input: "222 16% 20%",
      ring: "216 92% 64%",
      brandOrange: "216 92% 64%",
      brandPurple: "216 92% 64%",
      chart1: "216 92% 64%",
      chart2: "262 72% 70%",
      chart3: "168 60% 52%",
      chart4: "38 92% 62%",
      chart5: "192 76% 58%",
    },
    phaseColors: {
      // Cool, semantic phase markers drawn from the fixed metric palette —
      // no second warm hue, no neutral-gray ramp. Distinct pastels so a
      // plan's phase band reads at a glance.
      foundation: "hsl(168 62% 42%)",
      aerobic: "hsl(218 90% 56%)",
      tempo: "hsl(38 92% 50%)",
      raceSpecific: "hsl(262 70% 62%)",
      taper: "hsl(192 78% 50%)",
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
