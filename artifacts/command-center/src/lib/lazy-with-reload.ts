import { lazy, type ComponentType } from "react";

// After a new version is published, the static deploy serves freshly
// content-hashed chunk filenames and deletes the old ones. A browser tab
// that loaded the previous build (or cached its index.html) still asks for
// the now-deleted `*-<oldhash>.js` chunk when the runner navigates to a
// lazy route — that dynamic import 404s and, without handling, throws an
// uncaught error that unmounts the whole app to a blank page.
//
// `lazyWithReload` catches that specific chunk-load failure and recovers by
// forcing one full page reload, which re-fetches the revalidated index.html
// (served with an already-expired Expires header) and the new chunk names.
// A short-lived sessionStorage marker prevents an infinite reload loop if
// the failure is genuine (a real network outage rather than a stale deploy).

const RELOAD_MARKER = "lazyChunkReloadAt";
const WINDOW_NAME_PREFIX = "__lazyReloadAt:";
const RELOAD_COOLDOWN_MS = 10_000;

function isChunkLoadError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /dynamically imported module|module script failed|Failed to fetch|ChunkLoadError|error loading dynamically imported/i.test(
    message,
  );
}

// Read/write a "last auto-reload" timestamp that survives a full page reload
// within the same tab. Prefer sessionStorage; fall back to window.name (which
// persists across same-tab reloads and is not subject to storage-permission
// restrictions in private mode) so the one-shot reload guard still holds when
// sessionStorage throws. Without this fallback, a privacy-restricted browser
// could reload-loop on a genuine chunk failure.
function readReloadMarker(): number {
  try {
    const stored = window.sessionStorage.getItem(RELOAD_MARKER);
    if (stored !== null) return Number(stored) || 0;
  } catch {
    // sessionStorage unavailable — fall through to window.name.
  }
  if (window.name.startsWith(WINDOW_NAME_PREFIX)) {
    return Number(window.name.slice(WINDOW_NAME_PREFIX.length)) || 0;
  }
  return 0;
}

function writeReloadMarker(value: number): void {
  try {
    window.sessionStorage.setItem(RELOAD_MARKER, String(value));
    return;
  } catch {
    // sessionStorage unavailable — persist in window.name instead.
  }
  window.name = `${WINDOW_NAME_PREFIX}${value}`;
}

function clearReloadMarker(): void {
  try {
    window.sessionStorage.removeItem(RELOAD_MARKER);
  } catch {
    // ignore — nothing was stored there.
  }
  if (window.name.startsWith(WINDOW_NAME_PREFIX)) {
    window.name = "";
  }
}

export function lazyWithReload<T extends ComponentType<unknown>>(
  factory: () => Promise<{ default: T }>,
) {
  return lazy(async () => {
    try {
      const mod = await factory();
      // Successful load — clear any stale marker so a future deploy can
      // trigger its own one-shot reload.
      clearReloadMarker();
      return mod;
    } catch (err) {
      if (isChunkLoadError(err)) {
        const lastReload = readReloadMarker();
        if (Date.now() - lastReload > RELOAD_COOLDOWN_MS) {
          writeReloadMarker(Date.now());
          window.location.reload();
          // Keep Suspense pending while the browser navigates away so the
          // error never surfaces to an error boundary during reload.
          return new Promise<{ default: T }>(() => {});
        }
      }
      throw err;
    }
  });
}
