#!/usr/bin/env bash
# INT-002 — the refund paths, end to end.
#
#   anvil --port 8545 --chain-id 31337 &
#   bash impl/scripts/deploy.sh local
#   bash impl/scripts/e2e-refund.sh
#
# Moves the chain clock with evm_increaseTime, which is a devnet facility -- on Base
# Sepolia the wait is real.
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RPC="${RPC_URL:-http://127.0.0.1:8545}"

cast block-number --rpc-url "$RPC" >/dev/null 2>&1 || {
  echo "no chain at $RPC. Start one: anvil --port 8545 --chain-id 31337 &" >&2
  exit 2
}
cd "$ROOT/impl/agents/buyer"
npx tsx src/e2e/refund.ts
