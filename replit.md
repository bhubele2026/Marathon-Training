# Marathon Command Center

## Overview

Personal 1-year half-marathon training tracker. Goal: 281.6 lbs → 210 lbs by race day **2027-03-06**. Plan starts **2026-03-08** and runs 52 weeks (4 phases: Foundation Build, Aerobic Engine, Race Sharpening, Taper).

UI is an orange-on-dark "mission control" theme. No emojis anywhere.

## Artifacts

- `artifacts/api-server` (`/api`, port 8080) — Express + Drizzle + Postgres backend.
- `artifacts/command-center` (`/`, web) — React + Vite frontend (wouter, shadcn/ui, recharts, react-hook-form + zod).
- `artifacts/mockup-sandbox` (`/__mockup`) — design preview only.

## Pages

- `/` Dashboard — mission status, weekly snapshot, body mass, today's mission, recent activity, equipment usage.
- `/today` Today's mission with workout log dialog.
- `/plan` 52-week plan grouped by phase.
- `/plan/:week` Week detail with 7 day cards.
- `/log` Workouts list with equipment filter + log dialog.
- `/measurements` Body weight trend + check-in dialog.
- `/equipment` Per-equipment session counts and recent activity.

## Data

- Plan + days + body baselines seeded from `.local/data/plan.json` via `pnpm --filter @workspace/scripts run seed`.
- Tables (lib/db): `plan_weeks`, `plan_days`, `workouts`, `body_measurements`.
- Seed reseeds plan/day/measurement tables on every run; `workouts` is preserved.

## Stack

- pnpm workspaces, Node 24, TypeScript 5.9
- Express 5, Drizzle ORM, Postgres
- Zod (`zod/v4`), `drizzle-zod`
- OpenAPI codegen via Orval (`pnpm --filter @workspace/api-spec run codegen`)
- React 18 + Vite, wouter, @tanstack/react-query, shadcn/ui, recharts, date-fns

## Key commands

- `pnpm run typecheck` — typecheck everything. Also wired up as a validation step so it runs before tasks are marked complete.
- `pnpm run test` — run every workspace package's `test` script (currently the api-server vitest suite). Also wired up as a validation step so it runs before tasks are marked complete.
- `pnpm --filter @workspace/api-server run test` — run just the api-server vitest suite
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks/zod from `lib/api-spec/openapi.yaml`
- `pnpm --filter @workspace/db run push` — push schema (dev)
- `pnpm --filter @workspace/scripts run seed` — reseed plan + baseline measurements

## Deployment notes

- Personal-use app: no auth/authz layer; do not expose the published URL publicly.
- CORS is permissive by default — restrict via env if needed.
- "Today" is computed in UTC; tasks near midnight may shift by a day.

See the `pnpm-workspace` skill for monorepo conventions.
