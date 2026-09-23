# G1 gate check — PASS

Run 2026-09-23, a day before the Thu 24 Sep 18:00 deadline.
Commit `85f36f7bffccc064680243b4cd363d2ed140508c` · Foundry v1.8.3 · solc 0.8.37 · evm_version cancun

| # | Criterion | Command | Result |
|---|---|---|---|
| 1 | `forge test` green on the same-ABI mocks — fund, gate, bind/snapshot/release, refund, deadline/grace/TTL boundaries | `forge test --no-match-contract InvariantTest` | **154 passed, 0 failed** |
| 2 | REG-008 mock conformance | `python3 impl/scripts/check-mock-conformance.py` | **PASS** — 41 shared functions identical, only declared differences |
| 3 | REG-001 pinned ABI vs the deployed Base Sepolia registries | `bash impl/scripts/check-erc8004-abi.sh` | **65/65 selectors present**, all three at `getVersion()` "2.0.0" |
| 4 | SPEC-001 vectors in TypeScript | `npx vitest run` | **45 passed** |
| 5 | Secret-scan hook self-test | `bash .githooks/test-pre-commit.sh` | **18 passed** (7 must-block, 8 must-allow, 3 must-block-inside-an-exempt-path) |
| 6 | Core invariants | `forge test --match-contract InvariantTest` | **6 invariants hold**, 256 runs × depth 500, 211s |
| 7 | Local deployment and smoke check (beyond the gate) | `bash impl/scripts/deploy.sh local` | escrow live, owner / TTL bounds / grace / PASS_THRESHOLD / token allowlist / registry / **gate floors** all read back |

Line coverage on `AgentTrustEscrow.sol`: **97.55% (199/204)**, against the ≥90% CONTRACT-011 bar — `evidence/CONTRACT-011/coverage.txt`.

## What this does and does not show

It shows the contract layer behaves as specified against faithful copies of the ERC-8004
registries, and that those copies match the ABI actually deployed on Base Sepolia today.

It does **not** show anything about the running system. No service exists yet, nothing has
been deployed to a public chain, no transaction has been sent, no wallet funded, and no
attack has been run. Every number here is a local test or a read-only chain query.

## Note on the raw log

`gate-check.log` contains interleaved output from two runs. The first was interrupted
part-way by a session re-login and resumed afterwards, appending to the same file while
the replacement run was writing to it. The section markers (`== 1.` … `== 6.`) and the
`*_EXIT=` lines below each section are from the clean run and are the authoritative ones;
every one of them is 0. Recorded rather than quietly regenerated, because an evidence file
that has been tidied is worth less than one that says what happened.
