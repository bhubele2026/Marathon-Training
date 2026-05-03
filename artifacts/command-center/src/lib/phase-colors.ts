const PHASE_PALETTE = [
  "hsl(24 95% 53%)",
  "hsl(199 89% 48%)",
  "hsl(142 71% 45%)",
  "hsl(271 76% 53%)",
  "hsl(346 87% 55%)",
  "hsl(48 96% 53%)",
  "hsl(180 65% 40%)",
  "hsl(217 91% 60%)",
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
