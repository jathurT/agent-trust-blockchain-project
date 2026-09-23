#!/usr/bin/env bash
# CONTRACT-017 — export the ABIs the off-chain services bind to.
#
# The seller, buyer and validator all need the escrow ABI, and the buyer and
# validator need the ERC-8004 ones. Exporting them from the compiled artifacts means
# a contract change cannot silently leave a service talking to last week's interface.
# The ERC-8004 files are copies of the pinned upstream ABI (REG-001), not of the
# mocks, so the same client code drives mocks and live registries alike.
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
command -v forge >/dev/null || { echo "forge not found; run impl/scripts/install-deps.sh (ENV-003)" >&2; exit 2; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="$ROOT/impl/packages/core/abi"
mkdir -p "$OUT"

cd "$ROOT/impl/contracts"
forge build --quiet 2>/dev/null || forge build

for c in AgentTrustEscrow MockUSDC; do
  forge inspect "$c" abi --json | jq -S . > "$OUT/$c.abi.json"
  echo "$(jq 'length' "$OUT/$c.abi.json") entries  $c"
done

for r in Identity Reputation Validation; do
  jq -S . "$ROOT/impl/contracts/abi/erc8004/${r}Registry.abi.json" > "$OUT/${r}Registry.abi.json"
  echo "$(jq 'length' "$OUT/${r}Registry.abi.json") entries  ${r}Registry (pinned upstream, REG-001)"
done

echo "exported to impl/packages/core/abi/"
