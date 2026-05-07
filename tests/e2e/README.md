# `@workspace/e2e-tests`

Playwright end-to-end specs that drive the running dev workflows through
the shared proxy. Not wired into root `pnpm run test` so the regular CI
loop stays fast and headless-browser-free.

## Run

```bash
pnpm --filter @workspace/e2e-tests run test:e2e
```

Override the target deployment with `E2E_BASE_URL`, e.g.

```bash
E2E_BASE_URL=https://<your-deployment-domain> \
  pnpm --filter @workspace/e2e-tests run test:e2e
```

## Required environment

- The `artifacts/api-server: API Server` workflow must be running
  (serves `/api`).
- The `artifacts/command-center: web` workflow must be running
  (serves `/`).
- Chromium needs the system libraries Playwright depends on. They are
  installed via Nix in this workspace (glib, nss, nspr, atk, cups,
  libdrm, dbus, libxkbcommon, at-spi2-*, alsa-lib, mesa, libgbm,
  xorg.libX*, pango, cairo, expat).
- Browser binaries: `pnpm --filter @workspace/e2e-tests exec playwright install chromium`
  (only needed once, or after a Playwright upgrade).

## Specs

- `specs/empty-plan-ui.spec.ts` (Task #309) — wipes the plan via Full
  Reset, asserts the EmptyPlanState CTA on `/`, `/today`, `/plan`, and
  `/plan/:week`, then applies a fresh PlannerConfig via the API and
  verifies the four pages exit the empty state.

## Notes

- The empty-plan spec is destructive against the dev DB: Full Reset
  wipes workouts/measurements/checklist and demotes every applied
  planner config back to draft (Task #326), then the spec applies a
  new config. Don't point this at any environment whose data you want
  to keep.
