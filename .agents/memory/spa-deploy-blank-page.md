---
name: SPA lazy-loading + deploy blank page
description: Why React.lazy routes can blank the published app after a redeploy, and the required guardrail
---

# Lazy routes must handle chunk-load failure or a redeploy blanks the app

When command-center routes are `React.lazy`/dynamic-import split, a browser tab
holding an OLD build (or a cached index.html) requests a now-deleted
content-hashed chunk (`*-<oldhash>.js`) after a new deploy. The dynamic import
404s and, with only `<Suspense>` (no error handling), the error is uncaught and
unmounts the whole tree to a blank page. A single bundle never had this failure.

**Why:** static deploys publish freshly-hashed chunk filenames and delete the old
ones; `Suspense` only covers the pending state, not the rejected import.

**How to apply:** any time you add `React.lazy`/dynamic imports to a deployed SPA,
wrap the factory with `lib/lazy-with-reload.ts` (`lazyWithReload`) which catches
chunk-load errors and forces ONE full reload (sessionStorage marker guards against
a reload loop), and keep `RouteErrorBoundary` around the `<Suspense>` as a final
net. Do NOT ship lazy routes with a bare `<Suspense>`.

Diagnosis note: a fresh-load screenshot of the live URL rendering fine does NOT
clear lazy-split apps of blank-page reports — the failure only hits returning/cached
tabs across a deploy boundary, which a fresh browser never reproduces.
