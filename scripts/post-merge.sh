#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db push
# Backfill strength_min / run_min and re-bucket legacy cardio_min values
# after the schema push, so existing plan_day rows pick up the new
# breakdown columns introduced by task #74. Idempotent — safe to re-run.
pnpm --filter @workspace/scripts run backfill-plan-day-minutes
