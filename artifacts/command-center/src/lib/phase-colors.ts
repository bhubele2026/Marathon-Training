// Arctic Performance phase palette (task #186):
//   Foundation Build → slate-blue
//   Aerobic Build    → teal
//   Tempo/Threshold  → mint
//   Race-Specific    → soft plum
//   Taper & Race     → warm amber
// The trailing entries are theme-coordinated fallbacks for any
// non-canonical phase name (hashed deterministically below).
const PHASE_PALETTE = [
  "hsl(215 50% 52%)",
  "hsl(178 65% 42%)",
  "hsl(160 55% 48%)",
  "hsl(260 40% 58%)",
  "hsl(30 65% 55%)",
  "hsl(195 70% 50%)",
  "hsl(140 45% 50%)",
  "hsl(245 45% 60%)",
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
