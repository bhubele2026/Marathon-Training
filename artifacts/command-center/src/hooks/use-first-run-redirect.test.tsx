import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const mockNavigate = vi.fn();
vi.mock("wouter", () => ({
  useLocation: () => ["/", mockNavigate] as const,
}));

import {
  FIRST_RUN_REDIRECT_FLAG,
  useFirstRunRedirect,
} from "./use-first-run-redirect";

beforeEach(() => {
  mockNavigate.mockReset();
  window.sessionStorage.clear();
});

afterEach(() => {
  window.sessionStorage.clear();
});

describe("useFirstRunRedirect", () => {
  it("redirects to /planner when ready, no plan, and no drafts", () => {
    renderHook(() =>
      useFirstRunRedirect({ hasPlan: false, hasDrafts: false, ready: true }),
    );
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith("/planner");
    expect(window.sessionStorage.getItem(FIRST_RUN_REDIRECT_FLAG)).toBe("1");
  });

  it("does not redirect again once the session flag is set", () => {
    window.sessionStorage.setItem(FIRST_RUN_REDIRECT_FLAG, "1");
    renderHook(() =>
      useFirstRunRedirect({ hasPlan: false, hasDrafts: false, ready: true }),
    );
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("does nothing while ready is false (loading or upstream error)", () => {
    renderHook(() =>
      useFirstRunRedirect({ hasPlan: false, hasDrafts: false, ready: false }),
    );
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(FIRST_RUN_REDIRECT_FLAG)).toBeNull();
  });

  it("does not redirect when a plan is already applied", () => {
    renderHook(() =>
      useFirstRunRedirect({ hasPlan: true, hasDrafts: false, ready: true }),
    );
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("does not redirect when the runner has saved planner drafts", () => {
    renderHook(() =>
      useFirstRunRedirect({ hasPlan: false, hasDrafts: true, ready: true }),
    );
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(FIRST_RUN_REDIRECT_FLAG)).toBeNull();
  });

  it("clears the session flag when a plan is applied so a Full Reset re-arms the redirect", () => {
    window.sessionStorage.setItem(FIRST_RUN_REDIRECT_FLAG, "1");
    const { rerender } = renderHook(
      (props: {
        hasPlan: boolean;
        hasDrafts: boolean;
        ready: boolean;
      }) => useFirstRunRedirect(props),
      {
        initialProps: { hasPlan: true, hasDrafts: false, ready: true },
      },
    );
    expect(window.sessionStorage.getItem(FIRST_RUN_REDIRECT_FLAG)).toBeNull();
    expect(mockNavigate).not.toHaveBeenCalled();

    // Simulate a Full Reset: hasPlan flips back to false → redirect fires again.
    rerender({ hasPlan: false, hasDrafts: false, ready: true });
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith("/planner");
  });
});
