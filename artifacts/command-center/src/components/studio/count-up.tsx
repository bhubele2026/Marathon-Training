import { useEffect, useState } from "react";
import { animate, useReducedMotion } from "framer-motion";

// A calm count-up for HERO numbers on mount. Numerals stay tabular mono via the
// caller's className. Respects prefers-reduced-motion: when reduced, the final
// value renders instantly (no animation), so the value is always the final DOM
// text content. Animates from 0 -> value over ~700ms ease-out otherwise.
export function CountUp({
  value,
  format,
  className,
  durationMs = 700,
}: {
  value: number;
  format?: (n: number) => string;
  className?: string;
  durationMs?: number;
}) {
  const reduced = useReducedMotion();
  // Start at the final value when reduced motion (instant); else start at 0 and
  // animate up. Either way the resting DOM text equals the final value.
  const [display, setDisplay] = useState<number>(reduced ? value : 0);

  useEffect(() => {
    if (reduced) {
      setDisplay(value);
      return;
    }
    const controls = animate(0, value, {
      duration: durationMs / 1000,
      ease: "easeOut",
      onUpdate: (v) => setDisplay(v),
    });
    return () => controls.stop();
  }, [value, reduced, durationMs]);

  const fmt = format ?? ((n: number) => Math.round(n).toLocaleString());
  return <span className={className}>{fmt(display)}</span>;
}
