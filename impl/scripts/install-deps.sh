#!/usr/bin/env bash
# Installs the pinned Solidity dependencies as plain files (no git submodules).
# Versions are pinned here and in docs/specs/versions.md (ENV-001).
# Run from anywhere: bash impl/scripts/install-deps.sh
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # -> impl/
cd "$here/contracts"

OZ_TAG="v5.7.0";   OZ_SHA="cab19933c33c2ad1d4c7a84864a3601dddfd16f3"
FS_TAG="v1.16.2";  FS_SHA="bf647bd6046f2f7da30d0c2bf435e5c76a780c1b"

command -v forge >/dev/null || { echo "forge not found; install Foundry v1.8.3 first (see docs/specs/versions.md)"; exit 1; }

echo "installing forge-std $FS_TAG"
rm -rf lib/forge-std
forge install --no-git "foundry-rs/forge-std@$FS_TAG"

echo "installing openzeppelin-contracts $OZ_TAG"
rm -rf lib/openzeppelin-contracts
forge install --no-git "OpenZeppelin/openzeppelin-contracts@$OZ_TAG"

# sanity: the version OZ reports about itself must match the pin
got=$(grep -m1 '"version"' lib/openzeppelin-contracts/package.json | sed 's/[^0-9.]//g')
[ "$got" = "${OZ_TAG#v}" ] || { echo "OZ version mismatch: wanted ${OZ_TAG#v}, got $got"; exit 1; }
echo "ok: OZ $got, forge-std $FS_TAG"
echo "note: these live in impl/contracts/lib/, which is git-ignored — re-run this after a clean clone."
