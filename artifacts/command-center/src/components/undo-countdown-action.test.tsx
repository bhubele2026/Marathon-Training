import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { Toast, ToastProvider, ToastViewport } from "@/components/ui/toast";
import { UndoCountdownAction } from "./undo-countdown-action";

function renderInToast(ui: ReactNode) {
  return render(
    <ToastProvider>
      <Toast open>{ui}</Toast>
      <ToastViewport />
    </ToastProvider>,
  );
}

describe("UndoCountdownAction", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("starts at the server-provided TTL", () => {
    renderInToast(
      <UndoCountdownAction
        expiresInSeconds={30}
        onUndo={() => {}}
        altText="Undo reset"
        testId="undo-action"
      />,
    );

    const button = screen.getByTestId("undo-action") as HTMLButtonElement;
    expect(button.textContent).toBe("Undo (30s)");
    expect(button.disabled).toBe(false);
  });

  it("decrements the visible countdown once per second", () => {
    renderInToast(
      <UndoCountdownAction
        expiresInSeconds={5}
        onUndo={() => {}}
        altText="Undo reset"
        testId="undo-action"
      />,
    );

    const button = screen.getByTestId("undo-action");
    expect(button.textContent).toBe("Undo (5s)");

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(button.textContent).toBe("Undo (4s)");

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(button.textContent).toBe("Undo (3s)");

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(button.textContent).toBe("Undo (1s)");
  });

  it("disables the button and shows '(expired)' when the timer reaches zero", () => {
    renderInToast(
      <UndoCountdownAction
        expiresInSeconds={3}
        onUndo={() => {}}
        altText="Undo reset"
        testId="undo-action"
      />,
    );

    const button = screen.getByTestId("undo-action") as HTMLButtonElement;
    expect(button.disabled).toBe(false);

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(button.textContent).toBe("Undo (expired)");
    expect(button.disabled).toBe(true);
  });

  it("fires the undo handler when clicked before expiry", () => {
    const onUndo = vi.fn();
    renderInToast(
      <UndoCountdownAction
        expiresInSeconds={10}
        onUndo={onUndo}
        altText="Undo reset"
        testId="undo-action"
      />,
    );

    const button = screen.getByTestId("undo-action");
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(button.textContent).toBe("Undo (8s)");

    act(() => {
      button.click();
    });

    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it("does not fire the undo handler once the countdown has expired", () => {
    const onUndo = vi.fn();
    renderInToast(
      <UndoCountdownAction
        expiresInSeconds={2}
        onUndo={onUndo}
        altText="Undo reset"
        testId="undo-action"
      />,
    );

    const button = screen.getByTestId("undo-action") as HTMLButtonElement;
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(button.disabled).toBe(true);

    act(() => {
      button.click();
    });

    expect(onUndo).not.toHaveBeenCalled();
  });
});
