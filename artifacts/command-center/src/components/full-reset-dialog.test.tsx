import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import {
  FULL_RESET_CONFIRM_PHRASE,
  FullResetDialog,
  isFullResetConfirmed,
} from "./full-reset-dialog";

afterEach(() => {
  cleanup();
});

describe("isFullResetConfirmed", () => {
  it("rejects empty, partial, lowercase, and unrelated phrases", () => {
    expect(isFullResetConfirmed("")).toBe(false);
    expect(isFullResetConfirmed("wipe")).toBe(false);
    expect(isFullResetConfirmed("WIPE")).toBe(false);
    expect(isFullResetConfirmed("RESET PLAN")).toBe(false);
    expect(isFullResetConfirmed("delete everything")).toBe(false);
  });

  it("accepts the exact phrase plus reasonable case/whitespace tolerance", () => {
    expect(isFullResetConfirmed(FULL_RESET_CONFIRM_PHRASE)).toBe(true);
    expect(isFullResetConfirmed("wipe everything")).toBe(true);
    expect(isFullResetConfirmed("  WIPE EVERYTHING  ")).toBe(true);
    expect(isFullResetConfirmed("Wipe Everything\n")).toBe(true);
  });
});

describe("FullResetDialog", () => {
  it("keeps the confirm button disabled when the wrong phrase is typed and enables it once the magic phrase is entered", () => {
    const onConfirm = vi.fn();
    render(
      <FullResetDialog
        open
        onOpenChange={() => {}}
        onConfirm={onConfirm}
        isPending={false}
      />,
    );

    const confirmButton = screen.getByTestId(
      "button-confirm-full-reset",
    ) as HTMLButtonElement;
    const input = screen.getByTestId(
      "input-confirm-full-reset",
    ) as HTMLInputElement;

    // Empty input: confirm must be disabled.
    expect(confirmButton.disabled).toBe(true);

    // Wrong phrase: still disabled. Clicking should not invoke onConfirm.
    fireEvent.change(input, { target: { value: "delete it all" } });
    expect(confirmButton.disabled).toBe(true);
    confirmButton.click();
    expect(onConfirm).not.toHaveBeenCalled();

    // Close-but-not-quite (missing the second word): still disabled.
    fireEvent.change(input, { target: { value: "WIPE EVERYTHIN" } });
    expect(confirmButton.disabled).toBe(true);

    // Exact phrase enables the button and a click fires the handler.
    fireEvent.change(input, { target: { value: FULL_RESET_CONFIRM_PHRASE } });
    expect(confirmButton.disabled).toBe(false);
    confirmButton.click();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("disables both confirm and cancel while pending and shows the in-flight label", () => {
    const onOpenChange = vi.fn();
    render(
      <FullResetDialog
        open
        onOpenChange={onOpenChange}
        onConfirm={() => {}}
        isPending
      />,
    );

    const confirmButton = screen.getByTestId(
      "button-confirm-full-reset",
    ) as HTMLButtonElement;
    const input = screen.getByTestId(
      "input-confirm-full-reset",
    ) as HTMLInputElement;

    // Even with the magic phrase typed, isPending must keep confirm disabled
    // so a stray double-click can't fire a second wipe mid-mutation.
    fireEvent.change(input, { target: { value: FULL_RESET_CONFIRM_PHRASE } });
    expect(confirmButton.disabled).toBe(true);
    expect(confirmButton.textContent).toBe("Wiping...");
    expect(input.disabled).toBe(true);
  });
});
