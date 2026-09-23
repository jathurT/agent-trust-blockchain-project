#!/usr/bin/env python3
"""REG-008 — check the same-ABI mocks against the pinned ERC-8004 ABI.

The mocks are the default test substrate, so the risk is that one of them quietly
becomes easier to satisfy than the real registry. This compares every function and
event the mocks expose against `impl/contracts/abi/erc8004/*.abi.json` and fails on
any member that is shared but differs in signature, outputs or state mutability.

Two kinds of difference are allowed, and both have to be declared here rather than
discovered: OMITTED members (upstream surface AgentTrust never calls) and ADDED
members (mock-only helpers). Anything else is a failure.

Usage: python3 impl/scripts/check-mock-conformance.py
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ABI_DIR = ROOT / "impl" / "contracts" / "abi" / "erc8004"
CONTRACTS = ROOT / "impl" / "contracts"

# Upstream members the mocks deliberately do not implement.
OMITTED = {
    "Identity": {
        # UUPS proxy and Ownable surface: the mocks are plain contracts.
        "UPGRADE_INTERFACE_VERSION()", "proxiableUUID()", "upgradeToAndCall(address,bytes)",
        "owner()", "renounceOwnership()", "transferOwnership(address)", "initialize()",
        # EIP-712 introspection; the mock inherits EIP712 but does not expose the getter.
        "eip712Domain()",
    },
    "Reputation": {
        "UPGRADE_INTERFACE_VERSION()", "proxiableUUID()", "upgradeToAndCall(address,bytes)",
        "owner()", "renounceOwnership()", "transferOwnership(address)", "initialize(address)",
        # Feedback responses and bulk reads: nothing in AgentTrust calls them (DF-21).
        "appendResponse(uint256,address,uint64,string,bytes32)",
        "getResponseCount(uint256,address,uint64,address[])",
        "readAllFeedback(uint256,address[],string,string,bool)",
    },
    "Validation": {
        "UPGRADE_INTERFACE_VERSION()", "proxiableUUID()", "upgradeToAndCall(address,bytes)",
        "owner()", "renounceOwnership()", "transferOwnership(address)", "initialize(address)",
    },
}

# Mock-only members. Each one needs a reason, and none may be called by production code.
ADDED = {
    "Identity": {},
    "Reputation": {
        "distinctClientsUnfiltered(uint256)":
            "SEC-007 gate-v1 comparison model; cannot be computed on the real ABI (DF-09)",
    },
    "Validation": {},
}

# Members whose behaviour is intentionally different, with the difference stated.
BEHAVIOUR_DIFFS = {
    "getVersion()": 'returns "2.0.0-mock" instead of "2.0.0", so a mock can never be '
                    "mistaken for the live registry",
}

MOCKS = {
    "Identity": "MockIdentityRegistry",
    "Reputation": "MockReputationRegistry",
    "Validation": "MockValidationRegistry",
}


def render_type(entry: dict) -> str:
    t = entry["type"]
    if t.startswith("tuple"):
        inner = ",".join(render_type(c) for c in entry["components"])
        return f"({inner}){t[5:]}"
    return t


def signature(entry: dict) -> str:
    return f"{entry['name']}({','.join(render_type(i) for i in entry['inputs'])})"


def index(abi: list[dict], kind: str) -> dict[str, dict]:
    return {signature(e): e for e in abi if e.get("type") == kind}


def forge_abi(contract: str) -> list[dict]:
    out = subprocess.run(
        ["forge", "inspect", contract, "abi", "--json"],
        cwd=CONTRACTS, capture_output=True, text=True, check=True,
    )
    return json.loads(out.stdout)


def main() -> int:
    failures: list[str] = []
    for name, mock in MOCKS.items():
        upstream = json.loads((ABI_DIR / f"{name}Registry.abi.json").read_text())
        actual = forge_abi(mock)

        up_fns, mk_fns = index(upstream, "function"), index(actual, "function")
        up_evs, mk_evs = index(upstream, "event"), index(actual, "event")

        missing = sorted(set(up_fns) - set(mk_fns) - OMITTED[name])
        extra = sorted(set(mk_fns) - set(up_fns) - set(ADDED[name]))
        shared = sorted(set(up_fns) & set(mk_fns))

        for sig in missing:
            failures.append(f"{name}: mock is missing {sig}")
        for sig in extra:
            failures.append(f"{name}: mock adds undeclared {sig}")

        for sig in shared:
            u, m = up_fns[sig], mk_fns[sig]
            if [render_type(o) for o in u["outputs"]] != [render_type(o) for o in m["outputs"]]:
                failures.append(f"{name}.{sig}: outputs differ")
            if u["stateMutability"] != m["stateMutability"]:
                failures.append(
                    f"{name}.{sig}: stateMutability {u['stateMutability']} vs {m['stateMutability']}"
                )

        for sig in sorted(set(up_evs) & set(mk_evs)):
            u, m = up_evs[sig], mk_evs[sig]
            if [(i["indexed"], render_type(i)) for i in u["inputs"]] != \
               [(i["indexed"], render_type(i)) for i in m["inputs"]]:
                failures.append(f"{name}: event {sig} differs (indexing or types)")

        print(
            f"{name}: {len(shared)} shared functions identical, "
            f"{len(OMITTED[name] & set(up_fns))} omitted, {len(ADDED[name])} added"
        )
        for sig, why in ADDED[name].items():
            print(f"    added   {sig} — {why}")
        for sig, why in BEHAVIOUR_DIFFS.items():
            if sig in shared:
                print(f"    differs {sig} — {why}")

    if failures:
        print("\nFAIL:")
        for f in failures:
            print(f"  {f}")
        return 1
    print("\nPASS: mocks match the pinned ERC-8004 ABI on every shared member")
    return 0


if __name__ == "__main__":
    sys.exit(main())
