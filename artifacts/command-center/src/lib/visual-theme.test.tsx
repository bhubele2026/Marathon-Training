import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
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

describe("VisualThemeProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.getElementById(STYLE_ELEMENT_ID)?.remove();
  });

  afterEach(() => {
    // The shared `vitest.config.ts` does not enable RTL's auto-cleanup,
    // so previous renders linger in the document and `screen.getBy*`
    // would otherwise hit duplicate test ids across cases.
    cleanup();
    window.localStorage.clear();
    document.getElementById(STYLE_ELEMENT_ID)?.remove();
  });

  it("defaults to arctic-performance when no preference is stored", () => {
    render(
      <VisualThemeProvider>
        <PickerHarness />
      </VisualThemeProvider>,
    );
    expect(screen.getByTestId("active").textContent).toBe("arctic-performance");
  });

  it("hydrates from localStorage on mount", () => {
    window.localStorage.setItem(STORAGE_KEY, "trail-forest");
    render(
      <VisualThemeProvider>
        <PickerHarness />
      </VisualThemeProvider>,
    );
    expect(screen.getByTestId("active").textContent).toBe("trail-forest");
  });

  it("ignores unknown stored values and falls back to default", () => {
    window.localStorage.setItem(STORAGE_KEY, "not-a-real-theme");
    render(
      <VisualThemeProvider>
        <PickerHarness />
      </VisualThemeProvider>,
    );
    expect(screen.getByTestId("active").textContent).toBe("arctic-performance");
  });

  it("persists the new theme to localStorage when changed", () => {
    render(
      <VisualThemeProvider>
        <PickerHarness />
      </VisualThemeProvider>,
    );
    act(() => {
      screen.getByTestId("pick-championship-red").click();
    });
    expect(screen.getByTestId("active").textContent).toBe("championship-red");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("championship-red");
  });

  it("injects a <style> element with the active theme's tokens", () => {
    render(
      <VisualThemeProvider>
        <PickerHarness />
      </VisualThemeProvider>,
    );
    const styleEl = document.getElementById(STYLE_ELEMENT_ID);
    expect(styleEl).not.toBeNull();
    const arctic = THEMES["arctic-performance"];
    // light tokens land under `:root`
    expect(styleEl!.textContent).toContain(":root");
    expect(styleEl!.textContent).toContain(`--primary: ${arctic.light.primary};`);
    expect(styleEl!.textContent).toContain(`--background: ${arctic.light.background};`);
    // dark tokens land under `.dark`
    expect(styleEl!.textContent).toContain(".dark");
    expect(styleEl!.textContent).toContain(`--primary: ${arctic.dark.primary};`);
    // phase colors land under `:root`
    expect(styleEl!.textContent).toContain(
      `--phase-foundation: ${arctic.phaseColors.foundation};`,
    );
  });

  it("rewrites the injected style when the theme changes", () => {
    render(
      <VisualThemeProvider>
        <PickerHarness />
      </VisualThemeProvider>,
    );
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
    render(
      <VisualThemeProvider>
        <PickerHarness />
      </VisualThemeProvider>,
    );
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
