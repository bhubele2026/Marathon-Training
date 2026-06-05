---
name: Deploy build runs `build` for EVERY artifact (incl. design-only)
description: Why an artifact's vite.config must not throw on missing PORT/BASE_PATH at build time
---

# Deploy build = `pnpm -r run build` across ALL artifacts

The Replit autoscale deploy runs the root `build` script
(`pnpm run typecheck && pnpm -r --if-present run build`). The `-r` means it
builds **every** workspace package that has a `build` script — including
design-/dev-only artifacts like `mockup-sandbox` (the Canvas preview), which are
never actually served in production. If any one package's build fails, the whole
deploy fails (`ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL`, exit 1).

**The trap:** the deploy build container does NOT set `PORT` or `BASE_PATH`
(those are dev-workflow / serve-runtime env vars). Vite loads `vite.config.ts`
even for `vite build`, so any top-level `throw new Error("PORT ... required")` in
a config kills the build at config-load time — before a single module is
transformed. Symptom in deploy logs:
`failed to load config from .../vite.config.ts` +
`Error: PORT environment variable is required but was not provided.`

**Rule:** every artifact's `vite.config.ts` must treat `PORT`/`BASE_PATH` as
**dev/serve-only** and fall back to sentinels at build time (mirror
`artifacts/command-center/vite.config.ts`):
```ts
const rawPort = process.env.PORT;
const port = rawPort ? Number(rawPort) : 5173;
if (rawPort !== undefined && (Number.isNaN(port) || port <= 0)) throw ...;
const basePath = process.env.BASE_PATH ?? "<artifact previewPath>";
```
Only validate the value when it's actually provided; never hard-require it.

**Why this bites after the fact:** a newly scaffolded artifact (e.g. the mockup
sandbox) can ship a stricter config that throws, and it won't surface in
`typecheck` or `test` — only an actual `pnpm -r run build` (i.e. a publish)
exercises it. To reproduce locally: `env -u PORT -u BASE_PATH pnpm --filter
<pkg> run build`.
