#!/usr/bin/env bash
# Checks that .githooks/pre-commit blocks what it should and allows what it should.
# "We have a secret-scan hook" is not evidence; this is. Run it after any change to
# the hook, and before DOC-009's pre-publication review.
set -uo pipefail

HOOK="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/pre-commit"
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
cd "$tmp" || exit 1
git init -q . && git config user.email t@t && git config user.name t
git commit -q --allow-empty -m base

pass=0; failn=0
# $1 expect: block|allow, $2 path, $3 content
check() {
  local expect=$1 path=$2 content=$3
  mkdir -p "$(dirname "$path")" 2>/dev/null
  printf '%s\n' "$content" > "$path"
  git add -A
  if bash "$HOOK" >/dev/null 2>&1; then got=allow; else got=block; fi
  if [ "$got" = "$expect" ]; then
    pass=$((pass+1)); printf '  ok    %-6s %s\n' "$expect" "$path"
  else
    failn=$((failn+1)); printf '  FAIL  expected %s, got %s: %s\n' "$expect" "$got" "$path"
  fi
  git rm -q --cached -r . >/dev/null 2>&1; rm -rf "$path"
}

# Fixtures are assembled at run time rather than written out, so this file does not
# itself contain a key-shaped literal -- the hook blocks its own test file otherwise,
# which is the hook working correctly.
KEY="0xac0974bec39a17e36ba4a6b4d238ff9"'44bacb478cbed5efcae784d7bf4f2ff80'
HASH="0x93198e50fc83e323656b6ef27f36bd3"'a92e217b65f8eb5c4280518ee56f2ca18'
SLOT="0x360894a13ba1a3210667c828492db98"'dca3e2076cc3735a920a3ca505d382bbc'
PEM="-----BEGIN PRIVATE ""KEY-----"
WORDS="abandon abandon abandon abandon"

echo "must block:"
check block ".env"                  "RPC_URL=https://example"
check block "secrets/id.pem"        "$PEM"
check block "deploy.sh"             "PRIVATE_KEY=$KEY"
check block "notes.md"              "cast send --private-key $KEY 0x00"
check block "run.sh"                "K=$KEY"
check block "evidence/RUN/log.txt"  "using key $KEY"
check block "src/a.ts"              "const mnemonic = '$WORDS'"

echo "must allow:"
check allow ".env.example"                    "RPC_URL="
check allow "impl/vectors/canonical-v1.json"  "{\"h\": \"$HASH\"}"
check allow "impl/contracts/abi/x.abi.json"   "[{\"h\":\"$HASH\"}]"
check allow "impl/scripts/s.sh"               "SLOT=$SLOT"
check allow "src/b.sol"                       "bytes32 constant T = keccak256(\"Foo(uint256 a)\");"
check allow "docs/notes.md"                   "the anvil mnemonic is test test test test test test test test test test test junk"
check allow "evidence/DEPLOY-001/run.log"     "deployTx $HASH"
check allow "deployments/84532.json"          "{\"deployTx\": \"$HASH\"}"

echo "must block even in an exempt path:"
check block "evidence/DEPLOY-001/run.log"     "PRIVATE_KEY=$KEY"
check block "evidence/DEPLOY-001/run.log"     "forge script --private-key $KEY"
check block "impl/vectors/canonical-v1.json"  "$PEM"

echo
echo "$pass passed, $failn failed"
[ "$failn" -eq 0 ]
