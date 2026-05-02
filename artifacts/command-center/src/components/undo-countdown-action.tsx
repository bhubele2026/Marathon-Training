import { useEffect, useRef, useState } from "react";
import { ToastAction } from "@/components/ui/toast";

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
export function UndoCountdownAction({
  expiresInSeconds,
  onUndo,
  altText,
  testId,
}: UndoCountdownActionProps) {
  const expiresAtRef = useRef<number>(Date.now() + expiresInSeconds * 1000);
  const computeRemaining = () =>
    Math.max(0, Math.ceil((expiresAtRef.current - Date.now()) / 1000));
  const [secondsLeft, setSecondsLeft] = useState<number>(computeRemaining);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const id = setInterval(() => {
      const remaining = computeRemaining();
      setSecondsLeft(remaining);
      if (remaining <= 0) clearInterval(id);
    }, 250);
    return () => clearInterval(id);
  }, [secondsLeft]);

  const expired = secondsLeft <= 0;

  return (
    <ToastAction
      altText={altText}
      onClick={onUndo}
      disabled={expired}
      data-testid={testId}
    >
      Undo {expired ? "(expired)" : `(${secondsLeft}s)`}
    </ToastAction>
  );
}
