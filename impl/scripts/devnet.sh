#!/usr/bin/env bash
# ENV-004 (chain-up half): a deterministic local chain with named roles.
#
#   bash impl/scripts/devnet.sh                 # instant mining (functional runs)
#   BLOCK_TIME=2 bash impl/scripts/devnet.sh    # 2s blocks, to mimic Base for latency work
#   bash impl/scripts/devnet.sh --accounts-only # print the role table and exit
#
# The mnemonic below is the public Foundry/Hardhat test mnemonic. It is intentionally
# well known, must never hold real funds, and is allow-listed in the pre-commit hook.
set -euo pipefail
MNEMONIC="test test test test test test test test test test test junk"
CHAIN_ID="${CHAIN_ID:-31337}"
PORT="${PORT:-8545}"
ACCOUNTS=15
BLOCK_TIME="${BLOCK_TIME:-0}"

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
out="$root/deployments/local-accounts.json"
command -v anvil >/dev/null || { echo "anvil not found; see docs/specs/versions.md (ENV-003)"; exit 1; }

# Role layout used by fixtures, tests and the attack harness.
roles=(deployer buyer seller validator trustedClient1 trustedClient2 trustedClient3 \
       trustedClient4 trustedClient5 sybilOwner1 sybilOwner2 sybilOwner3 sybilOwner4 \
       sybilOwner5 honestNewcomer)

write_accounts() {
  echo "{" > "$out"
  echo "  \"_comment\": \"ENV-004 deterministic roles from the public test mnemonic. Local only; never funded on a real network.\"," >> "$out"
  echo "  \"chainId\": $CHAIN_ID," >> "$out"
  echo "  \"roles\": {" >> "$out"
  local i=0 last=$((ACCOUNTS - 1))
  for r in "${roles[@]}"; do
    addr=$(cast wallet address --mnemonic "$MNEMONIC" --mnemonic-index "$i")
    sep=","; [ "$i" -eq "$last" ] && sep=""
    printf '    "%s": { "index": %d, "address": "%s" }%s\n' "$r" "$i" "$addr" "$sep" >> "$out"
    i=$((i + 1))
  done
  echo "  }" >> "$out"
  echo "}" >> "$out"
}

write_accounts
if [ "${1:-}" = "--accounts-only" ]; then
  echo "wrote ${out#"$root"/}"
  cast wallet address --mnemonic "$MNEMONIC" --mnemonic-index 0 >/dev/null  # sanity
  python3 -c "import json;d=json.load(open('$out'));[print(f'  {k:16} #{v[\"index\"]:2}  {v[\"address\"]}') for k,v in d['roles'].items()]"
  exit 0
fi

args=(--mnemonic "$MNEMONIC" --accounts "$ACCOUNTS" --chain-id "$CHAIN_ID" --port "$PORT")
[ "$BLOCK_TIME" != "0" ] && args+=(--block-time "$BLOCK_TIME")
echo "anvil: chain $CHAIN_ID, $ACCOUNTS accounts, block time ${BLOCK_TIME}s, port $PORT"
echo "roles written to ${out#"$root"/}"
exec anvil "${args[@]}"
