import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Hard-coded here (and in the matching dialog copy below) so the test
// suite can assert against the exact same constant the user has to type.
export const FULL_RESET_CONFIRM_PHRASE = "WIPE EVERYTHING";

// Centralizing the "did the runner type the magic phrase?" check means
// both the UI gating and the unit test share one rule. Trim + uppercase
// matches the server-side comparison so leading/trailing whitespace and
// stray capitalization don't re-introduce a footgun.
export function isFullResetConfirmed(value: string): boolean {
  return value.trim().toUpperCase() === FULL_RESET_CONFIRM_PHRASE;
}

export interface FullResetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  isPending: boolean;
}

export function FullResetDialog({
  open,
  onOpenChange,
  onConfirm,
  isPending,
}: FullResetDialogProps) {
  const [confirmText, setConfirmText] = useState("");

  // Reset the typed phrase whenever the dialog closes so reopening it
  // forces the runner to re-type the gate from scratch — no carry-over of
  // a previously-confirmed value.
  useEffect(() => {
    if (!open) setConfirmText("");
  }, [open]);

  const handleOpenChange = (next: boolean) => {
    // Refuse to close while a request is in flight so the dialog can't be
    // half-cancelled mid-mutation.
    if (isPending) return;
    onOpenChange(next);
  };

  const confirmed = isFullResetConfirmed(confirmText);

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Wipe everything and start over?</AlertDialogTitle>
          <AlertDialogDescription>
            This is a nuclear reset. It permanently deletes every logged
            workout, every body measurement, the race-week checklist, every
            plan customization, then reseeds the canonical 52-week plan
            from scratch and reinserts only the seeded baseline weight.
            There is no undo. Type{" "}
            <span className="font-mono font-bold">
              {FULL_RESET_CONFIRM_PHRASE}
            </span>{" "}
            below to confirm.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2 py-2">
          <Label
            htmlFor="full-reset-confirm"
            className="text-xs uppercase tracking-wider"
          >
            Confirmation
          </Label>
          <Input
            id="full-reset-confirm"
            autoFocus
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={FULL_RESET_CONFIRM_PHRASE}
            disabled={isPending}
            data-testid="input-confirm-full-reset"
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={isPending || !confirmed}
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            data-testid="button-confirm-full-reset"
          >
            {isPending ? "Wiping..." : "Wipe Everything"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
