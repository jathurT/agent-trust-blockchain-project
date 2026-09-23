# G2 gate check — PASS

Run 2026-09-23, two days before the Fri 25 Sep 23:59 deadline.
Commit `239bdb57eb60bcbe9cfcaef081f9472a03bcb90d`

| G2 criterion | Result |
|---|---|
| On Anvil, **exactly one execution per job** (payer auth + claim) | ✔ **measured across two processes**: 50 authenticated retries → 1 execution, 1 distinct result, 49 replays, no 5xx |
| **A2/A3 fixture live** | ✔ labelled vulnerable fixture, 10 tests: 20 replays → 20 grants, and an authorization minted for one sibling accepted for the other |
| **Buyer flow E2E up to delivery** | ✔ 8 tests: discover → quote → gate-check → fund → signed retry → verify, against the real seller and the deployed escrow |

| Suite | Tests |
|---|---|
| `impl/packages/core` | 87 |
| `impl/agents/seller` | 68 |
| `impl/agents/buyer` | 8 |
| `impl/attacks` | 10 |
| `impl/contracts` (unchanged since G1) | 154 + 6 invariants |
| **Total** | **327** |

## What this does and does not show

It shows the payment path works end to end on a local chain: a buyer discovers a seller
through the registry, is quoted, checks the gate before spending anything, funds, proves
it is the payer, and receives a result whose bytes it verifies — and that the seller
executes that job exactly once however many times it is asked.

It shows nothing about **Base Sepolia**: nothing is deployed to a public chain, no
transaction has been sent there, no wallet is funded. It is also **not the A2/A3
evaluation** — that is SEC-002/003/004, which runs the attacks against the labelled
fixture *and* against AgentTrust, reports both, and records a run manifest. The numbers
above are acceptance tests, not results.

## Still outstanding for the milestone

- **ENV-006/007** — wallets and faucet ETH. Nothing can be deployed to Base Sepolia
  without them, and the seller and validator need ETH as well as the deployer.
- **VAL-001…004** — the validator, and with it `release()` end to end (G3b).
- **SEC-002/003/004** — the actual evaluation.
