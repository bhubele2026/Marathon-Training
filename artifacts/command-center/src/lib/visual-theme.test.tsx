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

  it("defaults to blacksmith when no preference is stored", () => {
    renderWithProviders(<PickerHarness />);
    expect(screen.getByTestId("active").textContent).toBe("blacksmith");
  });

  it("hydrates from localStorage on mount", () => {
    window.localStorage.setItem(STORAGE_KEY, "trail-forest");
    renderWithProviders(<PickerHarness />);
    expect(screen.getByTestId("active").textContent).toBe("trail-forest");
  });

  it("ignores unknown stored values and falls back to default", () => {
    window.localStorage.setItem(STORAGE_KEY, "not-a-real-theme");
    renderWithProviders(<PickerHarness />);
    expect(screen.getByTestId("active").textContent).toBe("blacksmith");
  });

  it("persists the new theme to localStorage when changed", () => {
    renderWithProviders(<PickerHarness />);
    act(() => {
      screen.getByTestId("pick-championship-red").click();
    });
    expect(screen.getByTestId("active").textContent).toBe("championship-red");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("championship-red");
  });

  it("injects a <style> element with the active theme's tokens", () => {
    renderWithProviders(<PickerHarness />);
    const styleEl = document.getElementById(STYLE_ELEMENT_ID);
    expect(styleEl).not.toBeNull();
    const active = THEMES["blacksmith"];
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

  it("rewrites the injected style when the theme changes", () => {
    renderWithProviders(<PickerHarness />);
    act(() => {
      screen.getByTestId("pick-sunset-endurance").click();
    });
    const styleEl = document.getElementById(STYLE_ELEMENT_ID);
    const sunset = THEMES["sunset-endurance"];
    expect(styleEl!.textContent).toContain(`--primary: ${sunset.light.primary};`);
    expect(styleEl!.textContent).toContain(
      `--phase-race-specific: ${sunset.phaseColors.raceSpecific};`,
    );
    // The arctic value should no longer be present.
    expect(styleEl!.textContent).not.toContain(
      `--phase-race-specific: ${THEMES["arctic-performance"].phaseColors.raceSpecific};`,
    );
  });

  it("syncs across tabs via the storage event", () => {
    renderWithProviders(<PickerHarness />);
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: STORAGE_KEY,
          newValue: "midnight-track",
        }),
      );
    });
    expect(screen.getByTestId("active").textContent).toBe("midnight-track");
  });

  // Task #196 — server-side hydration / cross-device persistence.

  it("hydrates from the server visualTheme preference (server wins over localStorage)", () => {
    // Local says trail-forest, server says midnight-track. Server
    // should win so the choice follows the runner across devices.
    window.localStorage.setItem(STORAGE_KEY, "trail-forest");
    serverVisualThemeRef.current = "midnight-track";
    renderWithProviders(<PickerHarness />);
    expect(screen.getByTestId("active").textContent).toBe("midnight-track");
    // …and the server choice is mirrored down to localStorage so an
    // offline reload still picks the right palette.
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("midnight-track");
  });

  it("writes the picked theme through to the user-preferences mutation", () => {
    renderWithProviders(<PickerHarness />);
    mutateSpy.mockClear();
    act(() => {
      screen.getByTestId("pick-championship-red").click();
    });
    expect(mutateSpy).toHaveBeenCalledWith({
      data: { visualTheme: "championship-red" },
    });
  });

  it("migrates a non-default localStorage choice up to the server when the server has none", () => {
    window.localStorage.setItem(STORAGE_KEY, "sunset-endurance");
    serverVisualThemeRef.current = null;
    renderWithProviders(<PickerHarness />);
    // After hydration the mutation should have been fired with the
    // local value so other devices inherit it.
    expect(mutateSpy).toHaveBeenCalledWith({
      data: { visualTheme: "sunset-endurance" },
    });
  });

  it("does NOT push the arctic default up when the server has no saved choice yet", () => {
    // No localStorage value, server has none either — nothing to
    // migrate. Otherwise we'd lock every new account into arctic.
    serverVisualThemeRef.current = null;
    renderWithProviders(<PickerHarness />);
    expect(mutateSpy).not.toHaveBeenCalled();
  });
});

describe("buildThemeCss", () => {
  it("produces selectors for :root, .dark, and the phase block", () => {
    const css = buildThemeCss(THEMES["championship-red"]);
    expect(css).toContain(":root {");
    expect(css).toContain(".dark {");
    // exactly two `:root {` occurrences (tokens + phase colors)
    const matches = css.match(/:root \{/g) ?? [];
    expect(matches.length).toBe(2);
  });
});
