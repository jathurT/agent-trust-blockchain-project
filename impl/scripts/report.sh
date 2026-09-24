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

# docs/results.md carries the same tables inline so it reads as one document. That copy
# used to be made by hand, and a change to the generator silently left it behind — which
# is precisely the drift the generated file exists to prevent. It is now spliced in
# between the markers, so there is still only one source.
python3 - "$ROOT/docs/results.md" "$ROOT/docs/results.tables.md" <<'PY'
import io, sys

target, source = sys.argv[1], sys.argv[2]
begin = "<!-- The tables below are generated. Edit impl/attacks/src/aggregate.ts, not this file. -->"
doc = io.open(target, encoding="utf-8").read()
tables = io.open(source, encoding="utf-8").read().rstrip() + "\n"
head, marker, _ = doc.partition(begin)
if not marker:
    sys.exit(f"{target} has no generated-tables marker")
io.open(target, "w", encoding="utf-8").write(head + begin + "\n\n" + tables)
PY

if [ "${1:-}" = "--check" ]; then
  if git -C "$ROOT" diff --exit-code -- docs/results.tables.md docs/results.chart.svg docs/results.md; then
    echo "tables, chart and results.md match the recorded runs"
  else
    echo "docs/results.tables.md, the chart or docs/results.md differs from what the runs say" >&2
    exit 1
  fi
fi
