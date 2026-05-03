import { useEffect, useRef, useState } from "react";
import { ToastAction, useToastPaused } from "@/components/ui/toast";

interface UndoCountdownActionProps {
  expiresInSeconds: number;
  onUndo: () => void;
  altText: string;
  testId?: string;
}

// Toast action button that shows a live "Undo (Ns)" countdown matching the
// server's undo TTL. The host toast is given the same duration so it
// auto-dismisses the moment the countdown hits zero; this component just keeps
// the user-visible label in sync and disables itself at expiry as a belt-and-
// suspenders guard against any drift between the visual tick and the toast's
// own auto-dismiss timer.
//
// Radix Toast pauses its auto-dismiss timer while the toast is hovered or
// focused, so we mirror that behavior here: when paused we freeze the
// countdown, and on resume we shift the visible expiry forward by the paused
// duration so the label always matches the toast's actual remaining time.
export function UndoCountdownAction({
  expiresInSeconds,
  onUndo,
  altText,
  testId,
}: UndoCountdownActionProps) {
  const paused = useToastPaused();
  const expiresAtRef = useRef<number>(Date.now() + expiresInSeconds * 1000);
  const pausedRemainingMsRef = useRef<number | null>(null);
  const computeRemaining = () =>
    Math.max(0, Math.ceil((expiresAtRef.current - Date.now()) / 1000));
  const [secondsLeft, setSecondsLeft] = useState<number>(computeRemaining);

  useEffect(() => {
    if (paused) {
      // Freeze: capture remaining ms and stop ticking.
      pausedRemainingMsRef.current = Math.max(
        0,
        expiresAtRef.current - Date.now(),
      );
      return;
    }

    if (pausedRemainingMsRef.current !== null) {
      // Resume: shift expiry forward by the time we spent paused.
      expiresAtRef.current = Date.now() + pausedRemainingMsRef.current;
      pausedRemainingMsRef.current = null;
      setSecondsLeft(computeRemaining());
    }

    if (computeRemaining() <= 0) return;
    const id = setInterval(() => {
      const remaining = computeRemaining();
      setSecondsLeft(remaining);
      if (remaining <= 0) clearInterval(id);
    }, 250);
    return () => clearInterval(id);
  }, [paused]);

  const expired = secondsLeft <= 0;

  const progress = expiresInSeconds > 0 ? secondsLeft / expiresInSeconds : 0;
  const r = 8;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - progress);

  return (
    <ToastAction
      altText={altText}
      onClick={onUndo}
      disabled={expired}
      data-testid={testId}
      className="gap-1.5"
    >
      <svg width="20" height="20" viewBox="0 0 20 20" className="shrink-0 -ml-0.5">
        <circle cx="10" cy="10" r={r} fill="none" stroke="currentColor" strokeWidth="2" opacity={0.2} />
        <circle
          cx="10" cy="10" r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 10 10)"
          style={{ transition: "stroke-dashoffset 0.25s linear" }}
        />
      </svg>
      Undo {expired ? "(expired)" : `(${secondsLeft}s)`}
    </ToastAction>
  );
}
