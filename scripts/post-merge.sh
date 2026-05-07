#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db push
# Backfill strength_min / run_min and re-bucket legacy cardio_min values
# after the schema push, so existing plan_day rows pick up the new
# breakdown columns introduced by task #74. Idempotent — safe to re-run.
pnpm --filter @workspace/scripts run backfill-plan-day-minutes
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
# completion. Fail the merge if one shows up. Read-only, idempotent.
pnpm --filter @workspace/scripts run check-workout-orphans
# Backfill race_results.race_kind on legacy rows logged before task #265
# captured the kind at write time. Looks up the plan_day at race_date and
# runs the shared detectRaceKind helper so PR badges light up retroactively
# once a runner accumulates more than one result of the same kind.
# Idempotent — safe to re-run.
pnpm --filter @workspace/scripts run backfill-race-result-kind
