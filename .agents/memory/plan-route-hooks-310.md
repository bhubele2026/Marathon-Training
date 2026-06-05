---
name: /plan blanked by React #310 (hooks after early return)
description: Why the whole app went blank on the /plan route, and the rule it taught
---

# /plan blanked the whole app: useMemo placed after early returns

The `/plan` page (`artifacts/command-center/src/pages/plan.tsx`) blanked the
**entire** SPA (no nav, no sidebar) in the *published* build. Root cause: a
performance change added two `useMemo` calls **below** the component's early
`return` guards (loading skeleton, null-data, empty-plan). The loading render ran
fewer hooks than the loaded render, so React threw **minified error #310**
(hook-count mismatch). An unhandled render error unmounts the whole tree → blank.

Symptoms / how it was found:
- Headless load of the live route: `document.getElementById("root").innerHTML`
  empty, a single `pageerror` = `Minified React error #310`, stack pointing into
  the lazy `plan-*.js` chunk's `useMemo`. No failed network requests, all assets
  200 — so it was a **runtime** crash, not a missing bundle.
- It only hit `/plan`; the dashboard `/` rendered fine, which is why an earlier
  check of just the root URL wrongly concluded "production is healthy."

**Rule:** all hooks (`useMemo`/`useState`/`useEffect`/...) must run on every
render **before any conditional `return`**. Move derivations above the
loading/empty guards and guard their *inputs* instead (e.g. `weeks ?? []`), never
gate the hook call itself.

**Why this is easy to reintroduce here:** this repo's pages use multiple stacked
early returns (loading → `!data` → empty-state) before the main render. It is
tempting to colocate a `useMemo` next to where its result is used (deep in the
main branch), which silently puts it after those returns. There is no
`react-hooks/rules-of-hooks` lint gate catching it, and `tsc` won't either — only
a runtime render of the loaded branch surfaces it.

**How to verify a route-blank fix:** load the live/preview route headless and
assert zero `pageerror`s + non-empty `#root` innerHTML across the
loading→loaded transition. A passing `typecheck` does NOT catch hook-order bugs.
