// Per-program colors keyed by `sourceEntryIndex`. Used across the
// dashboard (Week Snapshot per-program rows, the stacked Mileage
// Volume bar chart, and the Arsenal Usage tile) so a runner with
// 2+ overlapping programs can visually trace one program's
// contribution across all three views.
//
// Phase 2 overhaul: single-accent + neutral-gray ramp (no rainbow).
// The first program reads in the teal accent; additional concurrent
// programs are differentiated by lightness on the SAME neutral hue, so
// the planned-miles stacked bars and per-program borders never collide
// with a second color family. Entries stay distinct (by lightness) so
// 2+ overlapping programs remain traceable.
const PROGRAM_PALETTE = [
  "hsl(174 60% 45%)", // accent teal
  "hsl(220 9% 70%)", // light gray
  "hsl(220 9% 56%)", // mid gray
  "hsl(220 9% 42%)", // dark gray
  "hsl(220 9% 80%)", // lighter gray
  "hsl(220 9% 34%)", // deeper gray
];

export function programColor(sourceEntryIndex: number): string {
  if (!Number.isFinite(sourceEntryIndex) || sourceEntryIndex < 0) {
    return PROGRAM_PALETTE[0];
  }
  return PROGRAM_PALETTE[sourceEntryIndex % PROGRAM_PALETTE.length];
}

export const PROGRAM_PALETTE_SIZE = PROGRAM_PALETTE.length;
