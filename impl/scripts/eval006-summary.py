#!/usr/bin/env python3
"""EVAL-006 — per-stage durations across the recorded local end-to-end runs.

Reads `evidence/EVAL-006/all-timings.ndjson` (every run's stages, tagged with
`evalRun`) and prints the table that goes into `docs/results.md`. Nothing is typed by
hand: if a number changes, it is because a run changed.

These are **local devnet** latencies with `confirmations = 0` and Anvil's instant
mining. They are not Base Sepolia numbers and must never be quoted as such: on Base
Sepolia a 2-second block time alone dominates every figure below.
"""

from __future__ import annotations

import json
import statistics
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "evidence" / "EVAL-006" / "all-timings.ndjson"

# The stage boundaries worth reporting, in the order they happen.
SPANS = [
    ("services_up", "purchase_begin", "harness idle before the purchase"),
    ("purchase_begin", "delivered", "quote, gate, fund, signed retry, delivery"),
    ("delivered", "validator_decided", "evidence deposit, binding, attestation"),
    ("validator_decided", "released", "release transaction"),
    ("purchase_begin", "verified", "whole paid job, end to end"),
]


def main() -> int:
    if not SRC.exists():
        print(f"no timings at {SRC}", file=sys.stderr)
        return 2

    by_run: dict[int, dict[str, int]] = defaultdict(dict)
    for line in SRC.read_text().splitlines():
        if not line.strip():
            continue
        rec = json.loads(line)
        by_run[rec["evalRun"]][rec["stage"]] = rec["atMs"]

    runs = sorted(by_run)
    print(f"runs: {len(runs)}")
    print()
    print("| Stage | What happens | median | min | max | n |")
    print("|---|---|---:|---:|---:|---:|")
    for start, end, what in SPANS:
        durations = [
            by_run[r][end] - by_run[r][start]
            for r in runs
            if start in by_run[r] and end in by_run[r]
        ]
        if not durations:
            print(f"| `{start}` → `{end}` | {what} | — | — | — | 0 |")
            continue
        print(
            f"| `{start}` → `{end}` | {what} "
            f"| {statistics.median(durations):.0f} ms "
            f"| {min(durations)} ms | {max(durations)} ms | {len(durations)} |"
        )
    print()
    print(
        "`validator_decided` → `released` is small because it is not the release "
        "latency: the validator calls `release()` itself immediately after attesting "
        "(DF-15), so by the time the buyer polls, the transaction is already mined. "
        "That span measures the buyer noticing, not the chain settling — the release "
        "itself is inside `delivered` → `validator_decided`."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
