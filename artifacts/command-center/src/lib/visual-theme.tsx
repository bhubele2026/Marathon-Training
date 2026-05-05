import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  useGetUserPreferences,
  useUpdateUserPreferences,
  getGetUserPreferencesQueryKey,
  type UpdateUserPreferencesBodyVisualTheme,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
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

function writeStoredTheme(key: ThemeKey) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, key);
  } catch {
    // Persistence failure shouldn't break the in-memory swap.
  }
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
  // Seed synchronously from localStorage so the first paint matches
  // the runner's previous choice on this device — prevents a flash of
  // the arctic default while the server-preferences query resolves.
  const [themeKey, setThemeKeyState] = useState<ThemeKey>(() => readStoredTheme());

  // Task #196 — hydrate from the server-side user-preferences row so
  // the chosen theme follows the runner across devices. Server value
  // wins over localStorage once it arrives. If the server has no
  // saved choice yet but localStorage does, push the local choice up
  // so subsequent devices inherit it (one-shot migration per browser).
  const queryClient = useQueryClient();
  const prefsQuery = useGetUserPreferences();
  const updatePrefs = useUpdateUserPreferences({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getGetUserPreferencesQueryKey(),
        });
      },
    },
  });
  const serverVisualTheme = prefsQuery.data?.visualTheme ?? null;
  const hasHydratedFromServer = useRef(false);
  const hasMigratedLocalToServer = useRef(false);

  useEffect(() => {
    if (!prefsQuery.isSuccess) return;
    if (hasHydratedFromServer.current) return;
    hasHydratedFromServer.current = true;
    if (isThemeKey(serverVisualTheme)) {
      // Server has a saved choice — adopt it (and mirror to
      // localStorage so an offline reload still picks it up).
      if (serverVisualTheme !== themeKey) {
        setThemeKeyState(serverVisualTheme);
      }
      writeStoredTheme(serverVisualTheme);
    } else if (!hasMigratedLocalToServer.current) {
      // Server has nothing yet. If this device has a non-default
      // local choice, push it up so other devices inherit it.
      hasMigratedLocalToServer.current = true;
      const stored = readStoredTheme();
      if (stored !== DEFAULT_THEME_KEY) {
        updatePrefs.mutate({
          data: { visualTheme: stored as UpdateUserPreferencesBodyVisualTheme },
        });
      }
    }
    // We intentionally only react to the initial query success — later
    // refetches with the same value shouldn't fight the user's in-flight
    // optimistic local change. The cross-tab `storage` listener still
    // catches multi-tab edits on the same browser.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefsQuery.isSuccess, serverVisualTheme]);

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

  const setThemeKey = useCallback(
    (next: ThemeKey) => {
      setThemeKeyState(next);
      writeStoredTheme(next);
      // Persist to the server-side user-preferences row so the choice
      // follows the runner across devices (Task #196). Failures are
      // swallowed — the in-memory + localStorage swap still wins.
      updatePrefs.mutate({
        data: { visualTheme: next as UpdateUserPreferencesBodyVisualTheme },
      });
    },
    [updatePrefs],
  );

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
