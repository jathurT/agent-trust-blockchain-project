# Deployments

One JSON file per chain id, written by `impl/scripts/deploy.sh` and read by the seller,
buyer and validator so the addresses live in exactly one place.

| File | Tracked? |
|---|---|
| `84532.json` (Base Sepolia) | yes — DEPLOY-001/002/003 record it, and results reference it |
| `31337.json` (local Anvil) | **no** — regenerated on every devnet start, addresses change each time |
| `local-accounts.json` | yes — the named roles from the public test mnemonic (ENV-004) |

Each file carries the escrow and registry addresses, the constructor parameters that
were actually used, the deploying commit, the deployment transaction and block, and
whether the registries are mocks or the live ones — `mockRegistries` must never be
`true` in anything presented as a testnet result (CLAUDE.md §12).

```
impl/scripts/deploy.sh local
impl/scripts/deploy.sh testnet <keystore-account> <sender>    # needs the three
                                                              # registry addresses set
```

`deploy.sh` finishes with a smoke check against the deployed escrow and re-exports the
ABIs to `impl/packages/core/abi/`, so a contract change cannot leave a service bound to
a stale interface.
