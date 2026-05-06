// Per-program colors keyed by `sourceEntryIndex`. Used across the
// dashboard (Week Snapshot per-program rows, the stacked Mileage
// Volume bar chart, and the Arsenal Usage tile) so a runner with
// 2+ overlapping programs can visually trace one program's
// contribution across all three views.
//
// The palette is intentionally distinct from the phase palette
// (`phase-colors.ts`) — phase color sits on actual-miles bars and
// phase swatches; program color rides borders and the planned-miles
// stacked bars so the two encodings don't collide.
const PROGRAM_PALETTE = [
  "hsl(199 89% 55%)", // sky
  "hsl(280 65% 62%)", // violet
  "hsl(150 60% 45%)", // emerald
  "hsl(38 92% 55%)", // amber
  "hsl(340 75% 60%)", // rose
  "hsl(190 80% 45%)", // teal
];

export function programColor(sourceEntryIndex: number): string {
  if (!Number.isFinite(sourceEntryIndex) || sourceEntryIndex < 0) {
    return PROGRAM_PALETTE[0];
  }
  return PROGRAM_PALETTE[sourceEntryIndex % PROGRAM_PALETTE.length];
}

export const PROGRAM_PALETTE_SIZE = PROGRAM_PALETTE.length;
