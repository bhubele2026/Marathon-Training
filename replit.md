# Studio — a strength + recomposition trainer

## Overview

Studio is a strength + recomposition trainer, with running and races as an optional layer. Originally a 1-year half-marathon campaign (281.6 lbs → 210 lbs, race day **2027-05-02** Sun, plan starts **2026-05-04** Mon, 52 weeks across Foundation Build / Aerobic Build / Tempo-Threshold / Race-Specific / Taper & Race). The planner also supports Tonal-first / non-running programs: 4 lift-priority templates (`tonal_strength_upper`, `tonal_strength_lower`, `push_pull_legs`, `tonal_conditioning`), an 8-week Tonal upper-body default for new configs, and a "Training for a marathon?" toggle that gates the legacy 16-week MARATHON_TAIL auto-pin. Race-only UI surfaces fall back to a generic "Workout Plan" framing when the active plan has no Marathon-Specific phase. Each week runs Mon → Sun.

UI: a calm, professional "Studio" theme — neutral charcoals + a single muted-teal accent (charts included; no rainbow), **dark by default**, sentence case, airy spacing. Navigation is a slim sticky **top bar** (no sidebar) with four primary destinations — Today, Plan, Body (`/measurements`), Nutrition — plus a **Cmd-K command palette** and a single "More" menu for everything else. No emojis anywhere.

## How it works now (post-overhaul)

- **Cadence (hard invariant):** Monday is always full rest (0 min); Tue–Thu are short days (30–50 min); Fri–Sun are long days (60–90 min). Enforced in `briefing.ts`, the generator (`lib/plan-generator`), and `guardrails.ts`; editable in the planner. `DailyBudget` carries `shortDayMin/Max` + `longDayMin/Max` (legacy `weekday*/weekend*` kept for back-compat).
- **Recomp dashboard:** the home dashboard leads with **inches lost** (sum of circumference reductions across belly/chest/arms/legs, baseline→latest) + a muscle/strength **proxy** (Tonal Strength Score current→goal and arm/leg growth). Weight is secondary. Computed server-side in `routes/dashboard.ts` (`computeRecompSummary`).
- **Full macros:** `nutrition_days` tracks calories + protein + **carbs + fat**; `user_preferences` holds AI-computed targets for all four. The Nutrition page shows four rings vs target. AI targets come from `POST /api/goals/compute-targets` (Claude + web search).
- **AI plan builder** accepts a target date or program length, reasons about recomp + the cadence + current macro goals, outputs nutrition guidance alongside training, and is reachable via "Ask AI to adjust" from Today and each day card (seeded via a `?seed=` message).

## Plan generator (`lib/plan-generator/src/index.ts`)

- **Long-run progression** is length-aware via `rampToBlockEnd(weekInBlock, blockWeeks, start, peak)` so each block lands at `peak` on its block-final week. Research-aligned peaks: Base 4→10, Time on Feet 10→16, Speed 8→12, Marathon-Specific 12→20, Taper 12→6.
- **Race-distance ceilings** in `clampRunMi` cap from above without raising (5K 3, 10K 8, half 14). `hybridMileage()` adds peakLong safety floors (5K 3, 10K 6, half 11, marathon 18 ≈ 69% of 26.2) per ACSM 75-85% guideline. `previewWeeklyMileage`'s hybrid raceKind aligns with `generatePlanFromConfig`'s "marathon" default so preview/planned stay symmetric in legacy appendTail mode.
- **Run descriptions** are pace-target sentences — `"{Kind} run: {min} min @ {pace}/mi (~{dist} mi)"` — across `buildWeekDays`, `buildHybridWeekDays`, legacy `generatePlan()`, race-week Wed easy, and every `fridayContent` quality variant. The retired walk-run cards' helpers (`composeWalkRun`, `walkRunDescription`) stay exported for back-compat; `buildPaceOverride()` always emits `walkRun: false`.
- **Pace ramp** `computeEffectivePace` ramps ~3.75 sec/mi/week continuously across stacked entries via `paceWeekOffset`. When both `startingPaceSec` and `goalEndingPaceSec` are set, easy pace linearly interpolates from start to goal (anchored on the final non-taper week — trailing `isTaper` recipes and hybrid `[hybrid-phase:taper]` blocks are subtracted) instead of using the fixed ramp.
- **Race-distance pace offset** `applyRaceKindPaceOffset` adds easy +0/+5/+15/+25 sec/mi for 5K/10K/half/marathon (long gets an additional +0/+5/+15/+30) per Daniels VDOT E-pace + Pfitz offsets. Applied at the top of both `buildWeekDays` and `buildHybridWeekDays`.
- `deriveEffectiveMarathonDate(config)` returns the date or computes the effective end-of-campaign Sunday so generator paths always anchor on a concrete Sunday even when `marathonDate` is null.
- PLAN_SCIENCE_VERSION: `"2026-05-21"`.

## Phase Planner

- **Date-optional** end-to-end. `marathonDate` is nullable on `planner_configs` + every API contract. Validator skips the Sunday + future-date + 16-week-tail checks when null; totalWeeks derives from the composition (entries-mode: latest projected entry end via `projectEntries`; blocks-mode: sum(blocks.weeks)). The "Training for a marathon?" toggle gates the 16-week MARATHON_TAIL auto-pin; the Config card's auto-derive `useEffect` no-ops in blocks-mode when the toggle is off.
- `readActiveRaceDate()` returns `string | null`: no applied config → legacy RACE_DATE_ISO fallback; applied + marathonDate set → that date; applied + marathonDate null → null. `/api/race-week` returns an early stub (raceDate null, daysToRace 0, checklist still populated) when no race date is anchored; `PUT /api/race-week/result` returns 400 (callers use `PUT /api/race-results/{raceDate}`).
- **Starting + goal ending pace** anchors persist on `planner_configs.startingPaceSec` / `goalEndingPaceSec` + matching `applied*` snapshots (snapshotted on Apply, cleared on Full Reset, restored by reset-undo). `PlanOverview.startingPaceSec` / `goalEndingPaceSec` surface the applied snapshot so the /plan dialog pre-fills both anchors. `POST /api/planner/applied/starting-pace` takes an optional `goalEndingPaceSec` (absent leaves untouched, null clears, number 360-1500 writes); `backfillPaceTargetCards` re-paces uncustomized run cards in place after either field changes.
- **Body-mass targets** source from `appliedStartWeight` / `appliedGoalWeight` snapshots. Start falls back to earliest measurement; goal has no fallback (em-dash). Config card inputs round-trip NULL on blank.

## Weekly schedule (lift-priority, hybrid)

Generated by `scripts/src/generate-plan.ts`:

- **Mon** — full REST (only true rest day across all templates). Days other templates previously emitted as rest now emit a short "Active Recovery" walk (`Lifestyle`, ~25 min cardio, exempt from strength floor + budget enforcer). Race-week tapers (Mon/Thu rest) remain full rest.
- **Tue** — Heavy upper-body Tonal + short Peloton Bike.
- **Wed** — Easy Tread run + Tonal core/accessory.
- **Thu** — Heavy lower-body Tonal + short Peloton Row.
- **Fri** — Quality Tread run (tempo/threshold/race-pace past Foundation) + 30-min Tonal accessory. Long runs are NEVER on Fri.
- **Sat** — Heavy full-body Tonal + short Peloton Bike or Row (alternates).
- **Sun** — LONG RUN + 30-min Tonal accessory. Race week (W52): race day.

**Daily time budget contract:** Mon = 0, Tue-Sat ∈ [45, 75] min inclusive, Sun ≥ 60 min (open-ended). **Strength floor:** every Tue-Sun non-rest day carries ≥ 30 min of Tonal lifting (six lifting sessions per week). Race-eve Sat / race-day Sun helpers and the entire race-week taper are exempt. Long runs constrained to Sat/Sun. The enforcer pads strength up to 30 by stealing from cardio first, then run; if neither has room, the day's total grows and `"Tonal"` is appended to `equipment_list`.

The HR Zone targeting mode supports four zone models (`five_zone_max` default, `friel_7_zone`, `coggan_5_zone`, `polarized_3_zone`) from a Settings dropdown. Per-model tables live in `artifacts/command-center/src/lib/run-target.ts` (`HR_ZONE_MODEL_DEFS`).

## Artifacts

- `artifacts/api-server` (`/api`, port 8080) — Express + Drizzle + Postgres.
- `artifacts/command-center` (`/`, web) — React + Vite (wouter, shadcn/ui, recharts, react-hook-form + zod).
- `artifacts/mockup-sandbox` (`/__mockup`) — design preview only.
- `lib/visual-themes` — shared palette data (5 themes + token→CSS-var map). Imported by command center (`src/lib/visual-themes.ts`, re-exported under `Theme*` aliases) and sandbox (`src/components/mockups/_shared/palettes.ts`). Edit colors here only.
- `tests/e2e` (`@workspace/e2e-tests`) — Playwright spec(s) driving live dev workflows via the shared proxy. Run with `pnpm --filter @workspace/e2e-tests run test:e2e`. NOT wired into root `pnpm run test` (needs running workflows + Chromium).

## Pages

- `/` Dashboard — mission status, weekly snapshot, body mass, today's mission, recent activity, equipment usage.
- `/today` Today's mission with three quick actions (Crushed It / Log Actual / Skipped). Before campaign start, shows a "Pre-Launch — Campaign starts in N days" countdown card. Powered by `daysUntilStart` + `firstSession` on `/api/plan/today`.
- `/plan` 52-week plan grouped by phase. Header carries **Update Starting Pace** (mm:ss dialog with both starting and goal-ending pace fields → `POST /api/planner/applied/starting-pace` + `backfillPaceTargetCards()`). Weekly summary cards render a per-program completion ratio breakdown when 2+ programs overlap (`PlanWeek.programs`); same shape on `/api/plan/weeks/:week` and the dashboard per-program block (with campaign-to-date `adherencePct`). Two reset controls:
  - **Reset Entire Plan** (typing `RESET PLAN`) — TRUNCATEs `plan_weeks`/`plan_days` AND demotes every applied config to draft (clears `last_applied_at` + `applied_*`). Workouts have `plan_day_id` detached but survive (re-bound by the post-merge backfill); measurements/race results/checklist untouched. Undoable for ~30s via `POST /api/plan/reset` returning `undoToken` → `POST /api/plan/reset/undo`.
  - **Full Reset** (Danger Zone, typing `WIPE EVERYTHING`) — TRUNCATEs every mutable table AND clears `last_applied_at` + `applied_*` on every config. No undo. Saved config rows themselves (name, blocks, entries, isActive) are preserved.
- `/plan/:week` Week detail with 7 day cards. Each non-rest card has Crushed It / Log Actual / Skipped. Sass copy in `src/lib/sass.ts`; mutation logic in `src/hooks/use-mission-actions.tsx`. Skipped workouts excluded from adherence/completion/mileage.
- `/log` Workouts list with equipment filter + Log Workout dialog. Modality picker (Cardio/Strength) + Equipment picker grouped by modality. Modality auto-inferred from equipment if blank, never overwriting explicit choice. Persisted on `workouts.modality`.
- `/measurements` Body weight trend + check-in dialog.
- `/races` Race history — every `race_results` row newest first with finish time / placement / felt rating / notes / per-kind badge. Inline edit + delete. Powered by `GET /api/race-results`, `PATCH/DELETE /api/race-results/:raceDate`.
- `/equipment` Per-equipment session counts and recent activity.

## Data

- **Empty-plan invariant:** plan + days seeded only from the most-recently-applied planner config via `pnpm --filter @workspace/scripts run seed`. On a fresh install (no applied config) `plan_weeks` and `plan_days` stay EMPTY. Post-merge `cleanup-orphan-plan-rows` enforces this (TRUNCATEs when no `last_applied_at IS NOT NULL` exists); follow-up `check-orphan-plan-rows` is a CI-style guard that exits non-zero if orphan rows exist with no applied config. Every plan-driven UI surface (`/`, `/today`, `/plan`, `/plan/:week`) renders the shared `EmptyPlanState` "Open Phase Planner" CTA → `/planner`. `/api/plan/overview` and `/api/dashboard/summary` carry a required `hasPlan: boolean`. Full Reset preserves saved config rows so re-applying from /planner is one-click recovery. Legacy `.local/data/plan.json` is still regenerated for out-of-band tooling but doesn't drive the seed.
- **Naming:** `/plan` and `/dashboard` headers and the sidebar nav label read from `overview.activeConfigName` / `summary.activeConfigName` (falling back to "Workout Plan"). Race-only subtitles still gate on `raceKind`.
- **Tables (lib/db):** `plan_weeks`, `plan_days`, `workouts`, `body_measurements`, `race_results`, `race_week_checklist` (default item state + user-added custom items, distinguished by `is_custom` + nullable `label`), `planner_configs`, `reset_undo_snapshots`.
- **Seed** reseeds plan_weeks/plan_days, wipes `workouts`, preserves `body_measurements` and `reset_undo_snapshots`.
- **plan_days minute breakdown:** `strength_min`, `cardio_min`, `run_min` (+ `seed_*` mirrors). `cardio_min` is non-running cross-train only; treadmill/outdoor running lives in `run_min`. API exposes `totalMin` for the TOTAL · LIFT · CARDIO · RUN tile via `<PlannedBreakdown>`. Backfilled by `backfill-plan-day-minutes` (runs on every merge).
- **race_results** (one row per `race_date`): finish time, overall+total placement, 1-5 felt rating, notes, captured `race_kind` (snapshotted at write time so PR comparisons survive Phase Planner re-applies), `recorded_at` / `updated_at`. `/api/race-week` embeds the row as `raceResult` after `racePassed` flips true; carries `previousBest` (signed `deltaSeconds`) and `isPersonalRecord` so the saved-result card renders a "PR!" badge. Wiped by Full Reset.
- **Workout↔plan_day linking:** `plan_day_id` linked at log time. Legacy rows retro-linked by `backfill-workout-plan-day` (scores `session_type` matches +2, `equipment` +1; ties → lowest `source_entry_index`). Idempotent, runs on every merge. Adherence/completion queries are a straight join on `plan_day_id`. Orphans (no plan_day on their date) are valid quick-logged off-plan rows and never credit completion; `/api/workouts/unlinked-count` powers a "N unlinked — review" filter in the /log header. Post-merge `check-workout-orphans` exits non-zero if any workout has `plan_day_id IS NULL` while a plan_day exists on its date.
- **equipment_list chip rail** on `plan_days` (+ `seed_equipment_list` mirror): ordered set of every machine used that day. **Contract:** scalar `equipment` column always equals `equipment_list[0]` (primary machine) so back-compat reads agree with the chip rail's lead. PATCH on `/api/plan/:date` collapses the chip rail to `[equipment]` when the runner edits the scalar. Backfilled by `backfill-plan-day-equipment` (idempotent, runs on every merge).

## Device sync (Apple Health bridge — no device APIs)

The honest sync story, surfaced in Settings → Connections. There are NO OAuth
"connect your Tonal/Peloton" flows because those devices have no public API.

- **Workouts (automatic):** Tonal, Peloton (Bike/Row/Tread) and the treadmill
  all write workouts to **Apple Health**. An **Apple Shortcut** on the runner's
  iPhone reads recent Health workouts and `POST`s them to
  `POST /api/workouts/import` as `{ token, workouts: [...] }`. The route maps
  Apple Health activity types → equipment/modality, dedupes on `source_key`
  (idempotent — safe to re-run), and links each session to the matching
  `plan_day`. Auth is the bearer `NUTRITION_TOKEN` secret (shared with the
  nutrition ingest). This is THE sync — there is no server-side device fetch.
- **Nutrition (automatic):** the same Apple-Health-Shortcut pattern feeds the
  nutrition ingest with the shared `NUTRITION_TOKEN`.
- **Tonal Strength Score (manual):** app-only, not exposed by Apple Health or
  any API. Entered by hand (current + goal) on `/goals`; the recomp dashboard
  tracks it toward the target. Surfaced in Settings → Connections as the manual
  channel.
- **Peloton:** intentionally NO unofficial Peloton member-API fetch (it's
  unofficial, brittle, and unsupported). Peloton already writes to Apple Health,
  so the bridge above covers Peloton rides/runs with no separate integration.

## Stack

- pnpm workspaces, Node 24, TypeScript 5.9
- Express 5, Drizzle ORM, Postgres
- Zod (`zod/v4`), `drizzle-zod`
- OpenAPI codegen via Orval (`pnpm --filter @workspace/api-spec run codegen`)
- React 18 + Vite, wouter, @tanstack/react-query, shadcn/ui, recharts, date-fns

## Key commands

- `pnpm run typecheck` — typecheck everything (validation step).
- `pnpm run test` — run every workspace package's `test` script (validation step).
- `pnpm --filter @workspace/api-server run test` — just the api-server vitest suite
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks/zod from `lib/api-spec/openapi.yaml`
- `pnpm --filter @workspace/db run push` — push schema (dev)
- `pnpm --filter @workspace/scripts run seed` — reseed plan + baseline measurements

## Deployment notes

- Personal-use app: no auth/authz layer; do not expose the published URL publicly.
- CORS is permissive by default — restrict via env if needed.
- "Today" is computed in UTC; tasks near midnight may shift by a day.

See the `pnpm-workspace` skill for monorepo conventions.
