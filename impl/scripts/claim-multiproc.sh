#!/usr/bin/env bash
# API-005 acceptance (a) — one execution per funded job, across **processes**.
#
# A single-process test only shows the code is correct within one event loop. This
# starts two seller processes sharing one claim database and fires N authenticated
# retries at both at once, which is what actually exercises SQLite's cross-process
# write lock.
#
#   anvil --port 8545 --chain-id 31337 &
#   bash impl/scripts/deploy.sh local
#   bash impl/scripts/claim-multiproc.sh 50 2
set -euo pipefail
REQUESTS="${1:-50}"
PROCS="${2:-2}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT/impl/agents/seller"

echo "driving $REQUESTS requests across $PROCS seller processes, one shared claim store"
# tsx rather than node --experimental-strip-types: type stripping does not rewrite
# `.js` specifiers to `.ts`, which is how the whole workspace imports.
npx tsx test/support/multiproc-driver.ts "$REQUESTS" "$PROCS"
