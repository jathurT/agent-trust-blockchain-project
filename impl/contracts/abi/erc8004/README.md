# Pinned ERC-8004 ABI (REG-001)

These three files are the ABI AgentTrust compiles against. They are **generated, not
hand-written**: the canonical sources at
`erc-8004/erc-8004-contracts@b9e466c250744a7e06b13dff9d3c2844ed64f825` were compiled with
solc 0.8.37 (`via_ir`, optimizer 200 — upstream does not fit in the stack without it) and
the `abi` field of each artifact was extracted with `jq -S`.

| File | Upstream contract | Entries | Functions |
|---|---|---|---|
| `IdentityRegistry.abi.json` | `IdentityRegistryUpgradeable` | 63 | 32 |
| `ReputationRegistry.abi.json` | `ReputationRegistryUpgradeable` | 35 | 18 |
| `ValidationRegistry.abi.json` | `ValidationRegistryUpgradeable` | 31 | 15 |

`src/interfaces/erc8004/IERC8004.sol` declares the subset the escrow binds to. Every
member in it keeps the upstream signature exactly, so the same interface binds the mocks
in `src/mocks/` and the live registries.

## Checking it against what is actually deployed

```
bash impl/scripts/check-erc8004-abi.sh
```

It resolves the implementation behind each Base Sepolia proxy (EIP-1967 slot), then
confirms every selector in these files is dispatched by that implementation. Selectors
with leading zero bytes are emitted as `PUSH3`/`PUSH2`/`PUSH1` rather than `PUSH4` —
`getAgentWallet(uint256)` is `0x00339509` and is the real case that forced the script to
accept the shortened encodings.

Last run (2026-09-23, block 47,179,723): **65/65 selectors present**, all three proxies
reporting `getVersion() = "2.0.0"` — `evidence/REG-001/abi-conformance.log`.

The registries are UUPS proxies owned by a single EOA (V-97), so this is a check of a
moving target: re-run it on the day any task touches the live registries (V-139).
