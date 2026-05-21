#!/bin/bash
# Runs after a task agent's branch is merged back into main.
# Installs node modules in the dev environment, then delegates the
# schema push + backfill sequence to scripts/run-backfills.sh — the
# SINGLE source of truth shared with the deploy hook (.replit
# [deployment.postBuild]) so dev and prod data migrations cannot drift.
set -e
pnpm install --frozen-lockfile
"$(dirname "$0")/run-backfills.sh"
