#!/usr/bin/env bash
# INT-001 — the local happy path, end to end, with every service real.
#
#   anvil --port 8545 --chain-id 31337 &
#   bash impl/scripts/deploy.sh local
#   bash impl/scripts/e2e-happy.sh
#
# Writes evidence/INT-001/timings.ndjson and prints a JSON report. The latencies are a
# devnet measurement and must never be quoted as Base Sepolia numbers.
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RPC="${RPC_URL:-http://127.0.0.1:8545}"

cast block-number --rpc-url "$RPC" >/dev/null 2>&1 || {
  echo "no chain at $RPC. Start one: anvil --port 8545 --chain-id 31337 &" >&2
  exit 2
}
[ -f "$ROOT/deployments/31337.json" ] || {
  echo "no deployment. Run: bash impl/scripts/deploy.sh local" >&2
  exit 2
}

cd "$ROOT/impl/agents/buyer"
npx tsx src/e2e/happy.ts
