import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Mutable refs so individual tests can flip the saved server-side
// visualTheme value (Task #196 hydration). vi.hoisted is required
// because vi.mock factories run before top-level statements.
const { serverVisualThemeRef, mutateSpy, isSuccessRef } = vi.hoisted(() => ({
  serverVisualThemeRef: { current: null as string | null },
  mutateSpy: vi.fn(),
  isSuccessRef: { current: true },
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetUserPreferences: () => ({
    data: {
      runTargetingMode: "effort",
      maxHr: null,
      restingHr: null,
      hrZoneModel: "five_zone_max",
      visualTheme: serverVisualThemeRef.current,
      updatedAt: "2026-05-05T00:00:00.000Z",
    },
    isSuccess: isSuccessRef.current,
  }),
  useUpdateUserPreferences: () => ({
    mutate: mutateSpy,
    isPending: false,
  }),
  getGetUserPreferencesQueryKey: () => ["user-preferences"],
}));

import {
  VisualThemeProvider,
  buildThemeCss,
  useVisualTheme,
  __testing,
} from "./visual-theme";
import { THEMES } from "./visual-themes";

const { STORAGE_KEY, STYLE_ELEMENT_ID } = __testing;

function PickerHarness() {
  const { themeKey, setThemeKey, themes } = useVisualTheme();
  return (
    <div>
      <span data-testid="active">{themeKey}</span>
      {themes.map((theme) => (
        <button
          key={theme.key}
          data-testid={`pick-${theme.key}`}
          onClick={() => setThemeKey(theme.key as typeof themeKey)}
        >
          {theme.name}
        </button>
      ))}
    </div>
  );
}

function renderWithProviders(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <VisualThemeProvider>{ui}</VisualThemeProvider>
    </QueryClientProvider>,
  );
}

describe("VisualThemeProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.getElementById(STYLE_ELEMENT_ID)?.remove();
    serverVisualThemeRef.current = null;
    isSuccessRef.current = true;
    mutateSpy.mockReset();
  });

  afterEach(() => {
    // The shared `vitest.config.ts` does not enable RTL's auto-cleanup,
    // so previous renders linger in the document and `screen.getBy*`
    // would otherwise hit duplicate test ids across cases.
    cleanup();
    window.localStorage.clear();
    document.getElementById(STYLE_ELEMENT_ID)?.remove();
  });

  it("defaults to studio when no preference is stored", () => {
    renderWithProviders(<PickerHarness />);
    expect(screen.getByTestId("active").textContent).toBe("studio");
  });

  it("hydrates the single studio palette from localStorage on mount", () => {
    window.localStorage.setItem(STORAGE_KEY, "studio");
    renderWithProviders(<PickerHarness />);
    expect(screen.getByTestId("active").textContent).toBe("studio");
  });

  it("ignores unknown stored values and falls back to default", () => {
    window.localStorage.setItem(STORAGE_KEY, "not-a-real-theme");
    renderWithProviders(<PickerHarness />);
    expect(screen.getByTestId("active").textContent).toBe("studio");
  });

  it("ignores a legacy (now-removed) palette key and falls back to studio", () => {
    // Phase 2 collapsed the palette set to a single `studio` theme.
    // A stale `blacksmith`/`arctic-performance` value from before the
    // overhaul should no longer resolve — it falls back to default.
    window.localStorage.setItem(STORAGE_KEY, "blacksmith");
    renderWithProviders(<PickerHarness />);
    expect(screen.getByTestId("active").textContent).toBe("studio");
  });

  it("persists the picked theme to localStorage", () => {
    renderWithProviders(<PickerHarness />);
    act(() => {
      screen.getByTestId("pick-studio").click();
    });
    expect(screen.getByTestId("active").textContent).toBe("studio");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("studio");
  });

  it("injects a <style> element with the active theme's tokens", () => {
    renderWithProviders(<PickerHarness />);
    const styleEl = document.getElementById(STYLE_ELEMENT_ID);
    expect(styleEl).not.toBeNull();
    const active = THEMES["studio"];
    // light tokens land under `:root`
    expect(styleEl!.textContent).toContain(":root");
    expect(styleEl!.textContent).toContain(`--primary: ${active.light.primary};`);
    expect(styleEl!.textContent).toContain(`--background: ${active.light.background};`);
    // dark tokens land under `.dark`
    expect(styleEl!.textContent).toContain(".dark");
    expect(styleEl!.textContent).toContain(`--primary: ${active.dark.primary};`);
    // phase colors land under `:root`
    expect(styleEl!.textContent).toContain(
      `--phase-foundation: ${active.phaseColors.foundation};`,
    );
  });

  it("syncs across tabs via the storage event", () => {
    renderWithProviders(<PickerHarness />);
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: STORAGE_KEY,
          newValue: "studio",
        }),
      );
    });
    expect(screen.getByTestId("active").textContent).toBe("studio");
  });

  // Task #196 — server-side hydration / cross-device persistence.

  it("hydrates from the server visualTheme preference", () => {
    serverVisualThemeRef.current = "studio";
    renderWithProviders(<PickerHarness />);
    expect(screen.getByTestId("active").textContent).toBe("studio");
    // …and the server choice is mirrored down to localStorage so an
    // offline reload still picks the right palette.
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("studio");
  });

  it("writes the picked theme through to the user-preferences mutation", () => {
    renderWithProviders(<PickerHarness />);
    mutateSpy.mockClear();
    act(() => {
      screen.getByTestId("pick-studio").click();
    });
    expect(mutateSpy).toHaveBeenCalledWith({
      data: { visualTheme: "studio" },
    });
  });

  it("does NOT push the default up when the server has no saved choice yet", () => {
    // No localStorage value, server has none either — nothing to
    // migrate. The single default is never force-pushed to the server.
    serverVisualThemeRef.current = null;
    renderWithProviders(<PickerHarness />);
    expect(mutateSpy).not.toHaveBeenCalled();
  });
});

describe("buildThemeCss", () => {
  it("produces selectors for :root, .dark, and the phase block", () => {
    const css = buildThemeCss(THEMES["studio"]);
    expect(css).toContain(":root {");
    expect(css).toContain(".dark {");
    // exactly two `:root {` occurrences (tokens + phase colors)
    const matches = css.match(/:root \{/g) ?? [];
    expect(matches.length).toBe(2);
  });
});
