#!/usr/bin/env bash
# CONTRACT-017 — deploy the escrow and record it properly.
#
# `forge script` knows the block it simulated against, not the block its broadcast
# landed in, so the JSON it writes has block 0 on a fresh chain. This wrapper runs
# the script and then fills in what only the receipt knows: the real block, the
# deployment transaction hash and the deployer. DEPLOY-001/002/003 need those.
#
#   impl/scripts/deploy.sh local                     # anvil, unlocked account 0
#   impl/scripts/deploy.sh testnet <keystore-account> <sender>
#
# A raw private key is never an argument: local uses anvil's unlocked accounts and
# testnet uses a keystore account name.
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
command -v forge >/dev/null || { echo "forge not found; run impl/scripts/install-deps.sh (ENV-003)" >&2; exit 2; }
command -v jq >/dev/null || { echo "jq not found" >&2; exit 2; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MODE="${1:-local}"

case "$MODE" in
  local)
    RPC="${RPC_URL:-http://127.0.0.1:8545}"
    # Anvil's first account, a well-known public test address with no real funds.
    SIGNER=(--unlocked --sender 0xf39Fd6e51aad88F6F4ce6aB8827279cfffb92266)
    ;;
  testnet)
    RPC="${RPC_URL:?set RPC_URL}"
    ACCOUNT="${2:?usage: deploy.sh testnet <keystore-account> <sender>}"
    SENDER="${3:?usage: deploy.sh testnet <keystore-account> <sender>}"
    SIGNER=(--account "$ACCOUNT" --sender "$SENDER")
    : "${IDENTITY_REGISTRY:?set the three ERC-8004 registry addresses for a testnet deploy}"
    ;;
  *) echo "usage: deploy.sh local|testnet ..." >&2; exit 2;;
esac

CHAIN_ID=$(cast chain-id --rpc-url "$RPC")
cd "$ROOT/impl/contracts"

GIT_COMMIT="$(git -C "$ROOT" rev-parse HEAD)" \
  forge script script/Deploy.s.sol --rpc-url "$RPC" --broadcast "${SIGNER[@]}" "${@:4}"

RECEIPTS="$ROOT/impl/contracts/broadcast/Deploy.s.sol/$CHAIN_ID/run-latest.json"
OUT="$ROOT/deployments/$CHAIN_ID.json"
[ -f "$RECEIPTS" ] || { echo "no broadcast receipts at $RECEIPTS" >&2; exit 1; }

ESCROW=$(jq -r '.escrow' "$OUT")
TX=$(jq -r --arg a "$ESCROW" '.transactions[] | select((.contractAddress // "") | ascii_downcase == ($a | ascii_downcase)) | .hash' "$RECEIPTS" | head -1)
BLOCK=$(cast receipt "$TX" blockNumber --rpc-url "$RPC")
DEPLOYER=$(jq -r '.transactions[0].transaction.from' "$RECEIPTS")

jq --argjson block "$BLOCK" --arg tx "$TX" --arg deployer "$DEPLOYER" --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
   '.block = $block | .deployTx = $tx | .deployer = $deployer | .deployedAt = $ts' "$OUT" > "$OUT.tmp"
mv "$OUT.tmp" "$OUT"

echo
echo "deployments/$CHAIN_ID.json:"
jq . "$OUT"

# A deployment nobody checked is a deployment that might not work.
echo
echo "smoke check:"
printf '  owner             %s\n' "$(cast call "$ESCROW" 'owner()(address)' --rpc-url "$RPC")"
printf '  minTtl/maxTtl     %s / %s\n' \
  "$(cast call "$ESCROW" 'minTtl()(uint64)' --rpc-url "$RPC")" \
  "$(cast call "$ESCROW" 'maxTtl()(uint64)' --rpc-url "$RPC")"
printf '  grace             %s\n' "$(cast call "$ESCROW" 'grace()(uint64)' --rpc-url "$RPC")"
printf '  passThreshold     %s\n' "$(cast call "$ESCROW" 'PASS_THRESHOLD()(uint8)' --rpc-url "$RPC")"
printf '  token allowed     %s\n' "$(cast call "$ESCROW" 'tokenAllowed(address)(bool)' "$(jq -r '.token' "$OUT")" --rpc-url "$RPC")"
printf '  identityRegistry  %s\n' "$(cast call "$ESCROW" 'identityRegistry()(address)' --rpc-url "$RPC")"

bash "$ROOT/impl/scripts/export-abi.sh"
