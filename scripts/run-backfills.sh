#!/bin/bash
# Shared data-migration entry point: pushes the latest Drizzle schema
# and runs every idempotent backfill/guard in canonical order against
# the DATABASE_URL the caller has in scope. Called from both
# scripts/post-merge.sh (dev DB after a task agent merge) and from the
# deploy hook in .replit (production DB during publish). Keep this
# file as the SINGLE source of truth for the backfill sequence so the
# two paths cannot drift.
#
# Every step here MUST be:
#   - idempotent (re-run on every merge AND every deploy without harm)
#   - safe against workouts / body_measurements / race_results / checklist
#   - exit non-zero on failure (set -e propagates to the deploy/merge)

set -e

# Drop the legacy marathon race tables BEFORE the schema push. They were removed
# from the schema in the overhaul, but a prod/dev DB that still carries them makes
# the `drizzle-kit push` diff RENAME-AMBIGUOUS (is nutrition_entries/water_logs a
# fresh create, or a rename of a race table?). That question is interactive and
# can't be answered in the non-interactive deploy build, which left the new tables
# uncreated and broke the nutrition-entries backfill. Dropping first makes the
# push purely additive + non-interactive. Idempotent (DROP IF EXISTS) — no-op once
# the tables are gone, so safe on every merge AND every deploy.
pnpm --filter @workspace/scripts run drop-legacy-race-tables

pnpm --filter db push
# Backfill strength_min / run_min and re-bucket legacy cardio_min values
# after the schema push, so existing plan_day rows pick up the new
# breakdown columns introduced by task #74. Idempotent — safe to re-run.
pnpm --filter @workspace/scripts run backfill-plan-day-minutes
# Re-bucket plan_day minutes by SESSION TYPE: AI-authored plans sometimes parked
# a Run/Strength day's minutes in cardio_min, so the session-card headline read
# the wrong (empty) bucket and couldn't line up with the logged actual. Uses the
# same normalizeSessionBuckets rule the live materialize path uses. Conservative
# + idempotent (only moves minutes for a clearly run/strength day whose own
# bucket is empty). Set DRY_RUN=1 to preview.
pnpm --filter @workspace/scripts run backfill-plan-day-buckets
# Backfill the equipment_list chip rail introduced by task #77. Parses the
# description for known machine names in canonical priority order and
# populates equipment_list / seed_equipment_list on rows whose columns are
# still NULL after the schema push. Idempotent — safe to re-run.
pnpm --filter @workspace/scripts run backfill-plan-day-equipment
# Backfill workouts.equipment_list from the scalar on legacy rows.
# Idempotent — safe to re-run.
pnpm --filter @workspace/scripts run backfill-workout-equipment
# Backfill workouts.plan_day_id on legacy rows logged before task #143
# introduced per-plan_day attribution. Picks the best-matching plan_day
# on the workout's date by session_type + equipment so historical
# adherence math on stacked weeks credits the right program.
# Idempotent — safe to re-run.
pnpm --filter @workspace/scripts run backfill-workout-plan-day
# Task #295 guard: after the backfill, no workout that has a matching
# plan_day on its date should be left with plan_day_id IS NULL. The
# /plan + /dashboard adherence queries no longer fall back to date-only
# matching, so any orphan would silently undercount the runner's
# completion. Fail the merge/deploy if one shows up. Read-only, idempotent.
pnpm --filter @workspace/scripts run check-workout-orphans
# Task #361 backfill: retrofit the walk-run coherence fix onto the
# existing applied campaign WITHOUT wiping workouts/measurements.
# Updates seed_description / seed_run_min / seed_distance_mi on every
# walk-run on-ramp plan_day to the new coherent generator output, and
# mirrors into the runtime columns only when they still equal the
# prior seed (no user customization to clobber). Idempotent — safe to
# re-run; no-op when no planner_configs row has been applied.
pnpm --filter @workspace/scripts run backfill-walk-run-coherence
# Task #365 backfill: retrofit the pace-target run cards onto the
# existing applied campaign WITHOUT wiping workouts/measurements.
# Replaces the legacy "Easy aerobic Tread run (X mi, conversational)"
# / "Long aerobic run" / "Tread tempo" / walk-run interval headlines
# with the new "{Kind} run: {min} min @ {pace}/mi (~{dist} mi)"
# sentence and updates seed_pace to reflect the race-distance-offset
# easy/long pace. Mirrors into runtime columns only when they still
# equal the prior seed (no user customization to clobber). Idempotent
# — safe to re-run; no-op when no planner_configs row has been applied.
pnpm --filter @workspace/scripts run backfill-pace-target-cards
# Phase 13: migrate prior nutrition_days totals into the new entries model.
# Inserts one health_sync nutrition_entry (+ water_log) per existing day so all
# history shows up in the entries/history surfaces. Non-destructive +
# idempotent — skips a day that already has a health_sync entry, so it's safe
# on every merge and every deploy.
pnpm --filter @workspace/scripts run backfill-nutrition-entries
# Task #327: enforce the "plan tables stay EMPTY until a Phase Planner
# config has been applied" invariant. Pre-Task #307 databases still
# carry the auto-generated 52-week canonical plan even though
# planner_configs has no last_applied_at row. Wipe those orphan plan
# rows so the /plan UI falls back to the EmptyPlanState CTA on fresh
# installs, exactly like Task #326's Full Reset path. Idempotent —
# leaves applied campaigns untouched.
pnpm --filter @workspace/scripts run cleanup-orphan-plan-rows
# Task #328 guard: after the cleanup, fail loudly if plan_weeks /
# plan_days still carry rows while no planner_configs row has
# last_applied_at IS NOT NULL. Cross-table CHECK constraints aren't
# supported in Postgres without triggers, so this CI-style check ties
# the schema-level shape back to the Task #307 invariant. Read-only,
# idempotent.
pnpm --filter @workspace/scripts run check-orphan-plan-rows
