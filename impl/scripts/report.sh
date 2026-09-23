#!/usr/bin/env bash
# EVAL-004 — regenerate the results tables and chart from the recorded runs.
#
#   bash impl/scripts/report.sh            # regenerate
#   bash impl/scripts/report.sh --check    # regenerate and fail if anything changed
#
# The --check form is the one that matters: it proves the tables in docs/ are what the
# recorded runs actually say, rather than something edited afterwards.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT/impl/attacks"

RESULTS="$ROOT/evidence"
# Prefer the committed evidence over the scratch results directory, so the check runs
# against what is actually published.
SRC="$ROOT/impl/attacks/results"
if [ ! -d "$SRC" ] || [ -z "$(ls -A "$SRC" 2>/dev/null)" ]; then
  SRC="$(mktemp -d)"
  for d in "$RESULTS"/SEC-003/*/ "$RESULTS"/SEC-004/*/; do
    [ -d "$d" ] && cp -r "$d" "$SRC/" || true
  done
fi

npx tsx src/aggregate.ts "$SRC" "$ROOT/docs/results.tables.md"

if [ "${1:-}" = "--check" ]; then
  if git -C "$ROOT" diff --exit-code -- docs/results.tables.md docs/results.chart.svg; then
    echo "tables and chart match the recorded runs"
  else
    echo "docs/results.tables.md or the chart differs from what the runs say" >&2
    exit 1
  fi
fi
