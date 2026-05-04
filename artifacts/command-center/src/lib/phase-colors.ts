// Phase colors are theme-driven (task #188). Each canonical phase
// resolves to a CSS custom property that the active visual theme
// rewrites on the fly (see `visual-theme.tsx`). Returning `var(...)`
// strings means components don't need to re-render when the theme
// changes — the browser repaints automatically.
//
// Default values for these vars are seeded by `index.css` to the
// Arctic Performance palette, so server-rendered or
// pre-provider markup still gets a coherent, themed color.
const PHASE_PALETTE = [
  "var(--phase-foundation)",
  "var(--phase-aerobic)",
  "var(--phase-tempo)",
  "var(--phase-race-specific)",
  "var(--phase-taper)",
];

const CANONICAL_PHASE_COLORS: Record<string, string> = {
  "foundation build": PHASE_PALETTE[0],
  "aerobic build": PHASE_PALETTE[1],
  "tempo/threshold": PHASE_PALETTE[2],
  "race-specific": PHASE_PALETTE[3],
  "taper & race": PHASE_PALETTE[4],
};

function normalizePhase(phase: string): string {
  return phase
    .toLowerCase()
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ")
    .trim();
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

const NEUTRAL_GRAY = "hsl(220 9% 46%)";

export function phaseColor(phase: string | null | undefined): string {
  if (!phase || !phase.trim()) return NEUTRAL_GRAY;
  const key = normalizePhase(phase);
  if (!key) return NEUTRAL_GRAY;
  const canonical = CANONICAL_PHASE_COLORS[key];
  if (canonical) return canonical;
  return PHASE_PALETTE[hashString(key) % PHASE_PALETTE.length];
}
