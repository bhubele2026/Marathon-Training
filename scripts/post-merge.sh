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
