# Pinned versions and chain constants (ENV-001)

**Rule:** exact versions only. No `latest`, no `^`, no `~`, anywhere — in this file, in manifests or in CI. Changing a pin means editing this file and re-running the acceptance checks of every task that depends on it.

**Verified:** 2026-09-22 (V-IDs refer to `docs/planning/verification-log.md`), re-confirmed for library versions on 2026-09-23 via `npm view` / `pip index versions`.
**Re-check before use:** anything marked ⏱ moves quickly — re-verify at the task that consumes it.

---

## 1. Contract toolchain

| Component | Pin | Source | Notes |
|---|---|---|---|
| Foundry | **v1.8.3** | V-101 | Install: `curl -L https://foundry.paradigm.xyz \| bash` then `foundryup --install v1.8.3`. The Book also serves `https://getfoundry.sh/install` |
| solc | **0.8.37** | V-102 | Set in `foundry.toml`, not via system solc |
| `evm_version` | **cancun** | V-103 | Portable to Amoy, and avoids Foundry issue #16960 (`forge script` vs Base rejecting the Osaka `CLZ` opcode; fixed after v1.8.3). Base Sepolia supports Cancun, Prague and Osaka (V-87) |
| OpenZeppelin Contracts | **v5.7.0** (`cab19933c33c2ad1d4c7a84864a3601dddfd16f3`) | V-100 | Vendored as plain files, **not a submodule**: `bash impl/scripts/install-deps.sh`. `impl/contracts/lib/` is git-ignored, so a clean clone runs that script. `SafeERC20`, `utils/ReentrancyGuard`, `Ownable2Step` verified present; pragma ^0.8.20 |
| forge-std | **v1.16.2** (`bf647bd6046f2f7da30d0c2bf435e5c76a780c1b`) | ENV-003 | Same install script |
| Solidity pragma | `^0.8.24` in sources | — | Compiled with 0.8.37; the floor keeps OZ and transient-storage options open |
| Slither | 0.11.6 ⏱ | V-106 | Optional (CONTRACT-016, E1): `uv tool install slither-analyzer` |
| Aderyn | v0.6.8 ⏱ | V-106 | Optional (CONTRACT-016, E1) |

**Foundry test configuration:** `[fuzz] runs = 256`; `[invariant] runs = 256, depth = 500, fail_on_revert = false` (V-104 defaults, stated explicitly).

## 2. ERC-8004

| Item | Pin | Source |
|---|---|---|
| ABI + interface source | `erc-8004/erc-8004-contracts` @ **`b9e466c250744a7e06b13dff9d3c2844ed64f825`** | V-50 |
| ABI copies | committed under `impl/contracts/abi/erc8004/` (REG-001) | — |

**Deployed registries on Base Sepolia** (UUPS proxies; **owner is a single EOA `0x547289319C3e6aedB179C0b8e8aF0B5ACd062603`, so they can be upgraded at any time** — V-97):

| Registry | Address |
|---|---|
| Identity | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| Reputation | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |
| Validation | `0x8004Cb1BF31DAf7788923b405b754f57acEB4272` (README calls it "still under active update") |

Same-ABI mocks are the default substrate (DF-14); REG-008 checks conformance, and REG-005/007 (E2) touch the live ones. **Re-verify `getVersion()` and the selectors on the day of use (V-139).**

## 3. Chain and token constants

| Item | Value | Source |
|---|---|---|
| Network | Base Sepolia | — |
| Chain ID | **84532** (`0x14a34`) | V-80 |
| CAIP-2 id | `eip155:84532` | V-62 |
| RPC | `https://sepolia.base.org` — **HTTP only, no WebSocket: poll for events** ⏱ | V-83 |
| Explorers | `https://sepolia.basescan.org`, `https://base-sepolia.blockscout.com` | V-84 |
| Test USDC | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | V-81 |
| USDC decimals | **6** (so `$0.25` = `250000` atomic units) | V-81 |
| USDC EIP-712 domain | name **`"USDC"`**, version **`"2"`** (not "USD Coin") | V-81 |
| EIP-3009 | `transferWithAuthorization`, `receiveWithAuthorization` (`to == msg.sender`), `authorizationState` | V-81 |
| Local chain | Anvil, chain id **31337**, fixed test mnemonic (test-only, never funded) | ENV-004 |
| Confirmations | **1** local / **3** testnet; `safe` tag documented as the stronger option | DF-23, V-17 |

**Contract verification (DEPLOY-002):** Blockscout first, no key — `--verifier blockscout --verifier-url https://base-sepolia.blockscout.com/api/`. Alternative: Etherscan API V2 — `--verifier etherscan --verifier-url "https://api.etherscan.io/v2/api?chainid=84532"` with a key (verification remains available on the free tier). Sourcify path unverified (V-85).

**Faucets (ENV-007, V-86):** Circle 20 USDC per address per chain every 2 h, no login · QuickNode 1 claim / 12 h, no mainnet balance required · CDP 0.0001 ETH per claim, account needed · Alchemy 0.1 ETH/day, requires ≥0.001 mainnet ETH · Chainlink eligibility unverified. **Seller and validator need ETH too, not just the buyer** (the flow has five transactions — DF-06).

## 4. Node / TypeScript

| Package | Pin | Notes |
|---|---|---|
| Node.js | **22.17.0** | Installed (V-109) |
| pnpm | **9.15.9** | Installed (V-109) |
| TypeScript | **7.0.2** ⏱ | Major version; confirm `tsconfig` compatibility at AGENT-001. Pin exactly in `package.json` |
| tsx | **4.23.15** | Script runner |
| viem | **2.56.8** | Chain access; polling watchers only (V-83) |
| express | **5.2.1** | Express 5 — raw-body capture must be mounted before any parser (API-001) |
| vitest | **5.0.1** | Tests |
| supertest | **7.3.0** | HTTP assertions |
| better-sqlite3 | **13.0.3** | Claim store; fall back to `node:sqlite` if the native build fails on WSL (API-005) |
| dotenv | **18.0.3** | Config loading |
| wagmi | **3.7.7** | Dashboard only (DASH-001, E2) |

**Baseline only — never on the AgentTrust path** (DF-03): `@x402/core`, `@x402/evm`, `@x402/express`, `@x402/fetch` all at **2.26.0** (V-63), used solely by API-009's pinned-upstream baseline (E2).

## 5. Python (validator)

| Package | Pin | Notes |
|---|---|---|
| Python | **3.12.3** | Installed (V-109) |
| uv | **0.10.0** | Project and tool manager |
| fastapi | **0.141.1** | Validator service |
| uvicorn | **0.53.0** | ASGI server |
| web3 | **8.0.0** ⏱ | Major version — the v6/v7 API differs; verify call syntax at VAL-001 via Context7 |
| eth-account | **0.14.0** | EIP-712 signing and recovery |
| pydantic | **2.13.5** | Models |
| pydantic-settings | **2.15.0** | Configuration |
| pytest | **9.1.1** | Tests |
| httpx | **0.28.1** | Client |

The canonical hash is implemented **independently** in Python from `docs/specs/canonical-hash.md`, never ported from the TypeScript (VAL-003) — that independence is what makes the vector check meaningful.

## 6. Extended-scope only

| Package | Pin | Used by |
|---|---|---|
| `@langchain/langgraph` | **1.4.17** | AGENT-005 (E2) |
| `@langchain/openai` | **1.5.13** | AGENT-005 (E2) |
| LiteLLM (PyPI) | **1.102.0** | AGENT-005 proxy (E2). **The official LiteLLM is Python-only**; the npm package named `litellm` is a different project and is not used (V-108, DF-24) |

## 7. Claude Code skills

Pinned and recorded in `docs/planning/skills-inventory.md`: Trail of Bits `@32e34f81`, Cyfrin solskill `@d17bda02`, superpowers subset `@b36e0829`, context7 `@c447c32`. Auto-update stays off; any change requires inspection plus a recorded SHA.

## 8. Change policy

1. Edit this file first, with the new version and a reason.
2. Re-run the acceptance checks of every task that names the component.
3. Note the change in `task.md` §14 (Evidence).
4. For anything marked ⏱, re-verify on the day it is used rather than trusting this snapshot.
