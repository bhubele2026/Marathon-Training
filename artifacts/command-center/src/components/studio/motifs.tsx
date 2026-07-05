// Strength line-art motifs + the BH STUDIO wordmark, as inline SVG. Used by
// PageBackdrop for the faint brand backsplash + per-page watermark. All draw in
// `currentColor` so the caller controls tint/opacity and they adapt to the
// theme. No external assets — crisp at any size.

import type { ReactElement, SVGProps } from "react";

type MotifProps = SVGProps<SVGSVGElement>;

const base = {
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/** Barbell — Plan / training. */
export function BarbellMotif(props: MotifProps) {
  return (
    <svg viewBox="0 0 240 240" aria-hidden {...props}>
      <g {...base}>
        <line x1="70" y1="120" x2="170" y2="120" />
        <rect x="52" y="86" width="18" height="68" rx="3" />
        <rect x="170" y="86" width="18" height="68" rx="3" />
        <rect x="34" y="100" width="16" height="40" rx="3" />
        <rect x="190" y="100" width="16" height="40" rx="3" />
      </g>
    </svg>
  );
}

/** Dumbbell — Today / session. */
export function DumbbellMotif(props: MotifProps) {
  return (
    <svg viewBox="0 0 240 240" aria-hidden {...props}>
      <g {...base}>
        <line x1="92" y1="120" x2="148" y2="120" />
        <rect x="60" y="90" width="20" height="60" rx="4" />
        <rect x="160" y="90" width="20" height="60" rx="4" />
        <rect x="40" y="102" width="18" height="36" rx="4" />
        <rect x="182" y="102" width="18" height="36" rx="4" />
      </g>
    </svg>
  );
}

/** Weight plate — Body / measurements. */
export function PlateMotif(props: MotifProps) {
  return (
    <svg viewBox="0 0 240 240" aria-hidden {...props}>
      <g {...base}>
        <circle cx="120" cy="120" r="82" />
        <circle cx="120" cy="120" r="26" />
      </g>
    </svg>
  );
}

/** Kettlebell — general strength. */
export function KettlebellMotif(props: MotifProps) {
  return (
    <svg viewBox="0 0 240 240" aria-hidden {...props}>
      <g {...base}>
        <path d="M96 78a24 24 0 0 1 48 0" />
        <path d="M96 78c-6 10-8 16-8 22M144 78c6 10 8 16 8 22" />
        <path d="M88 100a40 44 0 1 0 64 0 90 90 0 0 1-64 0Z" />
      </g>
    </svg>
  );
}

/** Protein / fuel — Nutrition (a shaker + scoop mark). */
export function ProteinMotif(props: MotifProps) {
  return (
    <svg viewBox="0 0 240 240" aria-hidden {...props}>
      <g {...base}>
        <path d="M92 70h56l-6 108a10 10 0 0 1-10 10h-24a10 10 0 0 1-10-10Z" />
        <line x1="90" y1="104" x2="150" y2="104" />
        <path d="M100 56h40l4 14H96Z" />
      </g>
    </svg>
  );
}

/** Stopwatch — Log / history. */
export function StopwatchMotif(props: MotifProps) {
  return (
    <svg viewBox="0 0 240 240" aria-hidden {...props}>
      <g {...base}>
        <circle cx="120" cy="130" r="66" />
        <line x1="120" y1="130" x2="120" y2="92" />
        <line x1="104" y1="52" x2="136" y2="52" />
        <line x1="120" y1="52" x2="120" y2="64" />
      </g>
    </svg>
  );
}

/** Target — Goals. */
export function TargetMotif(props: MotifProps) {
  return (
    <svg viewBox="0 0 240 240" aria-hidden {...props}>
      <g {...base}>
        <circle cx="120" cy="120" r="80" />
        <circle cx="120" cy="120" r="50" />
        <circle cx="120" cy="120" r="20" />
      </g>
    </svg>
  );
}

/** Machine rack — Equipment. */
export function RackMotif(props: MotifProps) {
  return (
    <svg viewBox="0 0 240 240" aria-hidden {...props}>
      <g {...base}>
        <line x1="66" y1="52" x2="66" y2="188" />
        <line x1="174" y1="52" x2="174" y2="188" />
        <line x1="66" y1="86" x2="174" y2="86" />
        <line x1="66" y1="130" x2="174" y2="130" />
        <line x1="54" y1="188" x2="186" y2="188" />
      </g>
    </svg>
  );
}

export type MotifName =
  | "barbell"
  | "dumbbell"
  | "plate"
  | "kettlebell"
  | "protein"
  | "stopwatch"
  | "target"
  | "rack";

export const MOTIFS: Record<MotifName, (p: MotifProps) => ReactElement> = {
  barbell: BarbellMotif,
  dumbbell: DumbbellMotif,
  plate: PlateMotif,
  kettlebell: KettlebellMotif,
  protein: ProteinMotif,
  stopwatch: StopwatchMotif,
  target: TargetMotif,
  rack: RackMotif,
};

/**
 * BH STUDIO wordmark as SVG — the brand backsplash layer. Uppercase, heavy,
 * italic, tight — matches the app's `font-display` wordmark. Draws in
 * currentColor so the caller sets a faint tint.
 */
export function BhStudioWordmark(props: MotifProps) {
  return (
    <svg viewBox="0 0 900 150" aria-hidden {...props}>
      <text
        x="0"
        y="112"
        fill="currentColor"
        style={{
          fontFamily:
            "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif",
          fontSize: "128px",
          fontWeight: 800,
          fontStyle: "italic",
          letterSpacing: "-0.04em",
        }}
      >
        BH STUDIO
      </text>
    </svg>
  );
}
