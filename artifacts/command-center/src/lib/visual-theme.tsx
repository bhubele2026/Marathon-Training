import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_THEME_KEY,
  PHASE_VAR_NAMES,
  THEMES,
  THEME_LIST,
  TOKEN_VAR_NAMES,
  isThemeKey,
  type ThemeDefinition,
  type ThemeKey,
  type ThemeTokens,
} from "./visual-themes";

const STORAGE_KEY = "marathon-visual-theme";
const STYLE_ELEMENT_ID = "marathon-visual-theme-vars";

interface VisualThemeContextValue {
  themeKey: ThemeKey;
  setThemeKey: (key: ThemeKey) => void;
  theme: ThemeDefinition;
  themes: ThemeDefinition[];
}

const VisualThemeContext = createContext<VisualThemeContextValue | null>(null);

function readStoredTheme(): ThemeKey {
  if (typeof window === "undefined") return DEFAULT_THEME_KEY;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (isThemeKey(raw)) return raw;
  } catch {
    // localStorage may be unavailable (private mode, SSR, etc.) —
    // fall back to the default theme silently.
  }
  return DEFAULT_THEME_KEY;
}

function tokenBlock(selector: string, tokens: ThemeTokens): string {
  const rules = (Object.keys(TOKEN_VAR_NAMES) as Array<keyof ThemeTokens>)
    .map((tokenKey) => {
      const cssName = TOKEN_VAR_NAMES[tokenKey];
      const value = tokens[tokenKey];
      return `  ${cssName}: ${value};`;
    })
    .join("\n");
  return `${selector} {\n${rules}\n}`;
}

function phaseBlock(selector: string, phaseColors: ThemeDefinition["phaseColors"]): string {
  const rules = (Object.keys(PHASE_VAR_NAMES) as Array<keyof typeof PHASE_VAR_NAMES>)
    .map((phaseKey) => {
      const cssName = PHASE_VAR_NAMES[phaseKey];
      const value = phaseColors[phaseKey];
      return `  ${cssName}: ${value};`;
    })
    .join("\n");
  return `${selector} {\n${rules}\n}`;
}

export function buildThemeCss(theme: ThemeDefinition): string {
  return [
    tokenBlock(":root", theme.light),
    tokenBlock(".dark", theme.dark),
    // Phase colors aren't differentiated by light/dark in the source
    // palette, so they live on `:root` only.
    phaseBlock(":root", theme.phaseColors),
  ].join("\n");
}

function applyThemeStyle(theme: ThemeDefinition) {
  if (typeof document === "undefined") return;
  let el = document.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = STYLE_ELEMENT_ID;
    // Append to head so it sits AFTER the bundled `index.css` and
    // wins at equal specificity.
    document.head.appendChild(el);
  }
  el.textContent = buildThemeCss(theme);
}

export interface VisualThemeProviderProps {
  children: ReactNode;
}

export function VisualThemeProvider({ children }: VisualThemeProviderProps) {
  const [themeKey, setThemeKeyState] = useState<ThemeKey>(() => readStoredTheme());

  // useLayoutEffect so the override style is in the DOM before the
  // first paint — prevents a flash of arctic colors when the runner
  // has previously selected a different palette.
  useLayoutEffect(() => {
    applyThemeStyle(THEMES[themeKey]);
  }, [themeKey]);

  // Sync between tabs: if another tab updates the stored theme,
  // mirror the change here.
  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      if (event.key !== STORAGE_KEY) return;
      const next = isThemeKey(event.newValue) ? event.newValue : DEFAULT_THEME_KEY;
      setThemeKeyState(next);
    }
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const setThemeKey = useCallback((next: ThemeKey) => {
    setThemeKeyState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Persistence failure shouldn't break the in-memory swap.
    }
  }, []);

  const value = useMemo<VisualThemeContextValue>(
    () => ({
      themeKey,
      setThemeKey,
      theme: THEMES[themeKey],
      themes: THEME_LIST,
    }),
    [themeKey, setThemeKey],
  );

  return <VisualThemeContext.Provider value={value}>{children}</VisualThemeContext.Provider>;
}

export function useVisualTheme(): VisualThemeContextValue {
  const ctx = useContext(VisualThemeContext);
  if (!ctx) {
    throw new Error("useVisualTheme must be used inside a VisualThemeProvider");
  }
  return ctx;
}

export const __testing = {
  STORAGE_KEY,
  STYLE_ELEMENT_ID,
};
