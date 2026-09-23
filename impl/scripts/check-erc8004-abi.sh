#!/usr/bin/env bash
# REG-001 / REG-008 — check the pinned ERC-8004 ABI against the deployed registries.
#
# For every function in impl/contracts/abi/erc8004/*.abi.json, confirm its
# 4-byte selector is dispatched by the implementation behind the Base Sepolia
# proxy. Selectors with leading zero bytes are emitted as PUSH3/PUSH2/PUSH1, so
# the scan accepts any of those encodings (getAgentWallet(uint256) = 0x00339509
# is the real case that forced this).
#
# Read-only: eth_getStorageAt, eth_getCode, eth_call. No transactions.
set -euo pipefail

# Foundry is installed per-user by ENV-003 and is not always on a non-login PATH.
export PATH="$HOME/.foundry/bin:$PATH"
command -v cast >/dev/null || { echo "cast not found; run impl/scripts/install-deps.sh (ENV-003)" >&2; exit 2; }

RPC="${RPC_URL:-https://sepolia.base.org}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ABI_DIR="$ROOT/impl/contracts/abi/erc8004"
# EIP-1967 implementation slot
SLOT=0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc

declare -A PROXY=(
  [Identity]=0x8004A818BFB912233c491871b3d84c89A494BD9e
  [Reputation]=0x8004B663056A597Dffe9eCcC1965A193B7388713
  [Validation]=0x8004Cb1BF31DAf7788923b405b754f57acEB4272
)

SIG_JQ='def typ: if (.type|startswith("tuple"))
         then "(" + ([.components[]|typ]|join(",")) + ")" + (.type[5:])
         else .type end;
[.[] | select(.type=="function") | .name + "(" + ([.inputs[]|typ]|join(",")) + ")"] | sort | .[]'

echo "chain block: $(cast block-number --rpc-url "$RPC")"
fail=0
for name in Identity Reputation Validation; do
  proxy="${PROXY[$name]}"
  impl="0x$(cast storage "$proxy" "$SLOT" --rpc-url "$RPC" | tail -c 41)"
  version=$(cast call "$proxy" 'getVersion()(string)' --rpc-url "$RPC")
  code=$(cast code "$impl" --rpc-url "$RPC")
  total=0; missing=0
  while read -r sig; do
    total=$((total + 1))
    sel=$(cast sig "$sig"); sel="${sel#0x}"
    # PUSH4, or the shortened forms solc uses when leading bytes are zero
    found=0
    for cand in "63$sel" "62${sel#00}" "61${sel#0000}" "60${sel#000000}"; do
      case "$code" in *"$cand"*) found=1; break;; esac
    done
    if [ "$found" -eq 0 ]; then
      echo "  MISSING $name.$sig (0x$sel)"
      missing=$((missing + 1)); fail=1
    fi
  done < <(jq -r "$SIG_JQ" "$ABI_DIR/${name}Registry.abi.json")
  echo "$name $proxy impl=$impl version=$version  $((total - missing))/$total selectors present"
done

[ "$fail" -eq 0 ] && echo "PASS: pinned ABI matches the deployed registries" || echo "FAIL: pinned ABI drifted from the deployed registries"
exit "$fail"
