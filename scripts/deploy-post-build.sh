#!/bin/bash
# Deploy-time post-build hook wired into .replit [deployment.postBuild].
# Autoscale runs this ONCE per publish in the build container (NOT per
# request and NOT per autoscale instance), after the artifact builds
# have completed and BEFORE traffic cuts over to the new revision.
# The build container has the deployment's DATABASE_URL in scope, so
# the schema push + backfill sequence runs against the PRODUCTION
# database. Non-zero exit fails the deploy loudly (set -e).
#
# Keep this hook thin — the actual sequence lives in run-backfills.sh
# so the dev post-merge path and the prod deploy path cannot drift.
set -e
"$(dirname "$0")/run-backfills.sh"
# Preserve the prior prune behavior so the deployed image stays small.
pnpm store prune
