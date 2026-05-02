import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
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

  it("freezes the countdown while the toast is paused and resumes from the same value", () => {
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

    // Tick the visible label down to "Undo (3s)" so we have a clearly
    // identifiable mid-countdown value to freeze on.
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(button.textContent).toBe("Undo (3s)");

    // Radix Toast pauses its auto-dismiss timer when the viewport wrapper
    // (role="region") receives a pointermove or focusin, mirroring the same
    // hover/focus-pause behavior we want to test in the countdown action.
    const wrapper = screen.getByRole("region");
    act(() => {
      fireEvent.pointerMove(wrapper);
    });

    // While paused, advancing the clock by far longer than the original TTL
    // must not change the visible label or expire the action.
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(button.textContent).toBe("Undo (3s)");
    expect((button as HTMLButtonElement).disabled).toBe(false);

    // Resume by leaving the wrapper. The countdown should pick up from the
    // same frozen value rather than jumping ahead by the paused duration.
    act(() => {
      fireEvent.pointerLeave(wrapper);
    });
    expect(button.textContent).toBe("Undo (3s)");

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(button.textContent).toBe("Undo (2s)");
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
