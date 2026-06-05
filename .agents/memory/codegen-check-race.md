---
name: Codegen drift-check race blanks the dev preview
description: Why the API codegen drift check must never regenerate into the committed working tree
---

# Codegen drift-check must generate to a temp dir, never the working tree

The OpenAPI codegen (orval, in `lib/api-spec`) is configured with `clean: true`,
so every run deletes the output `generated/` directory before rewriting it. The
generated client (`lib/api-client-react/src/generated`) is committed and imported
by basically every page.

The drift check (`codegen:check`, run by the root `typecheck` validation) used to
regenerate **into the real committed dirs** and then restore a snapshot. During
that delete→regenerate→restore window the committed files are gone, and any
concurrently running vite dev server fails to resolve `./generated/api` →
`[vite] Internal server error: Failed to resolve import "./generated/api"` →
the workspace preview goes **blank**. Because the "Run" button runs `test` +
`typecheck` in parallel with the dev servers, this repeats on every run/publish →
user perceives "the app keeps going blank."

**Rule:** the drift check must generate into a throwaway temp dir and diff against
the committed files, never mutating the working tree. Implemented via a
`CODEGEN_OUTPUT_ROOT` env honored by `orval.config.ts` and
`generate-error-zod.ts`; `check-codegen.ts` copies the lib src into the temp root
(so orval has its `custom-fetch.ts` mutator + relative-import context), generates
there, then diffs.

**Why:** the real `codegen:generate` (manual/intentional) legitimately cleans the
committed dirs — that's fine because a human runs it deliberately. The automated
*check* must be side-effect-free so it can run safely alongside live dev servers.

**How to apply:** any time a check/CI step "regenerates to compare," route output
to a temp location. Never delete-and-restore committed files that a running
process imports.

## Note on the deployed app
A separate earlier hypothesis was that the *published* app went blank. Verified
the live deployment is healthy three ways (screenshot, headless Chromium load
with 0 console/page errors and a single navigation, healthy API logs). The
recurring blank was the **dev/workspace preview**, caused by the codegen race
above — not the production build (generated files are committed, built once).
