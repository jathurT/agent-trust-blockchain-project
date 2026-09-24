# AgentTrust

**When one AI agent pays another over HTTP, what stops the seller from taking the money
and not delivering — and what stops a bystander from spending the buyer's payment?**

The x402 protocol lets a server answer `402 Payment Required` and a client pay inline.
It works, and it leaves two things unhandled. Published measurements of live x402
endpoints found that replaying a single payment header produced **248 HTTP-layer grants
against one on-chain settlement** in the strongest round of 1,000 concurrent requests
(V-12), and that with no idempotency at all **50 replays produced 50 grants** (V-13). A
separate study found that a payment authorization commits to the merchant, the value and
a nonce — but **not to the resource** — so a signature bought for one endpoint accessed
an equal-priced sibling in **100 of 100 rounds** (V-24).

AgentTrust binds the payment to the request, gates it on portable reputation, and
releases it only against an independent attestation.

---

## What it is

An escrow contract on Base Sepolia, three services, and an evaluation harness.

```
buyer ──402──► seller ──────────────────────► AgentTrustEscrow ◄──── validator
  │                                                  │                   │
  │  fund(): binds the request, gates on             │                   │
  │  ERC-8004 reputation, snapshots the payee        │                   │
  │                                                  │                   │
  └──signed retry──► seller: one execution ──► deposits the result ──────┘
                             per funded job          with the validator,
                                                     which re-derives it
                                                     independently and
                                                     releases the money
```

1. **Quote.** The seller answers `402` in the x402 v2 wire format.
2. **Fund.** `fund()` computes a `resourceHash` **on-chain** from the request's method,
   URI and body together with the amount, token and chain — so a payment is valid for
   exactly one request at exactly one price. It also enforces a reputation gate anchored
   on clients *the buyer* trusts, and snapshots the payee.
3. **Deliver.** The buyer retries with a **payer-signed** header. The seller re-derives
   the hash from the raw bytes and its own configured origin, checks the funded job, then
   takes an **atomic claim** and executes **once**.
4. **Attest.** The seller deposits the result with the validator *before* the bytes reach
   the buyer. The validator — written in Python, independently of the seller — recomputes
   the answer, posts an ERC-8004 attestation and calls `release()`.
5. **Refund.** If no passing attestation arrives, the buyer refunds after the deadline
   plus a grace period.

> **On interoperability.** AgentTrust uses the x402 v2 wire format with a
> project-specific scheme, `agenttrust-escrow`. It is **not interoperable** with stock
> x402 clients, servers or facilitators: a client that does not implement this scheme
> cannot pay an AgentTrust seller, and an AgentTrust buyer cannot pay a stock x402
> server. Nothing here should be described as "x402-compliant".

> **On novelty.** The x402 specification already defines an escrow scheme with capture
> and refund deadlines (`auth-capture`, V-143). What is different here is the
> **reputation gate at funding time** and **release against a validator attestation** —
> not the existence of an escrow.

---

## Results

Measured on a local devnet, 13 runs at one commit. Full narrative, controls and limits:
**[`docs/results.md`](docs/results.md)**.

| | vulnerable fixture | AgentTrust |
|---|---|---|
| **A2** executions per payment | 50 requests → **50**; 200 → **200** | **1**, every configuration |
| replay attempts causing an extra execution | 3,460 of 3,950 | **0 of 4,440** |
| responses served on a **forged** signature | **500 of 500** | 0 |
| **A3** substitutions served | **100 of 100** | **0 of 100** |
| false refusals *(the control)* | 0 | **0** |

**Coverage: 2 of the 6 defined attacks.** A1 (reorg), A4 (concurrent duplication),
A5 (allowance overdraft) and A6 (Sybil selection) were **not evaluated** and are reported
as such.

The comparison target is a **deliberately vulnerable fixture written for this project**
(`impl/attacks/src/vulnerable-server.ts`). It is **not** upstream x402, **not** the
`@x402/*` packages, and **not** evidence about anyone else's implementation.

---

## Run it

Needs Node 22, pnpm, Python 3.12 with `uv`, and Foundry. One-time setup:

```bash
bash impl/scripts/install-deps.sh          # vendored Solidity deps, pinned
(cd impl/packages/core   && pnpm install)
(cd impl/agents/seller   && pnpm install)
(cd impl/agents/buyer    && pnpm install)
(cd impl/attacks         && pnpm install)
(cd impl/validator       && uv sync)
```

Start a devnet and deploy:

```bash
anvil --port 8545 --chain-id 31337 &
bash impl/scripts/deploy.sh local          # deploys, smoke-checks, exports ABIs
```

**One paid job, end to end** — buyer, seller, Python validator, escrow, release:

```bash
bash impl/scripts/e2e-happy.sh
```

It prints the job id, the balance deltas, the attestation and per-stage timings, and
exits non-zero if anything is off. The refund paths:

```bash
bash impl/scripts/e2e-refund.sh
```

**One attack run**, against either target:

```bash
cd impl/attacks
npx tsx src/harness.ts --id a2_replay --target fixture    --runs 10 --replays 50
npx tsx src/harness.ts --id a2_replay --target agenttrust --runs 10 --replays 50
npx tsx src/harness.ts --id a3_cross_resource --target agenttrust --rounds 100
```

Each run writes `manifest.json` (commit, tool versions, chain, block, parameters, seed),
`results.json` and `raw.ndjson`. It **refuses to run** if any of that cannot be captured,
and a run recorded against a dirty working tree is excluded from the report: its commit
hash does not describe the code that produced it.

**The demo**, as three terminals — the commands are `docs/demo-script.md`:

```bash
cd impl
npm run target:vanilla         # left pane: the labelled vulnerable fixture
npm run target:agenttrust      # right pane: escrow + seller + Python validator
npm run attack -- --id a2_replay --target agenttrust --runs 10 --replays 50
```

`target:vanilla` is blueprint §18's name for the baseline. It is kept so the documented
command runs, and it prints a correction first: the target is a fixture written for this
project, not upstream x402. `npm run target:fixture` is the same thing, named correctly.

A single job from the buyer's side:

```bash
npm run buy    -- --resource /v1/summarise --amount 250000   # atomic units, never a decimal
npm run status -- --job 0x…
npm run refund -- --job 0x…
```

`buy` prints the HTTP status **and** the disposition, because they are different facts:
a retry before settlement gets `200` and the stored bytes with disposition `replayed`,
and the work does not run again.

Regenerate the results tables and chart from recorded runs:

```bash
bash impl/scripts/report.sh --check        # fails if docs/ differs from the runs
```

The tests:

```bash
(cd impl/contracts     && forge test)          # 154 unit and boundary tests + 6 invariants
(cd impl/packages/core && npx vitest run)      # 87
(cd impl/agents/seller && npx vitest run)      # 80
(cd impl/agents/buyer  && npx vitest run)      # 21
(cd impl/attacks       && npx vitest run)      # 32
(cd impl/validator     && uv run pytest)       # 68
```

The buyer, seller, attacks and validator suites drive a **live chain**, so they need the
devnet and deployment above. They fail rather than skip when it is missing: a silently
skipped integration test is how a suite comes to prove nothing.

---

## Deployed addresses

**Nothing is deployed to Base Sepolia yet.** The deployment is blocked on funded wallets
(ENV-006/007); until it happens, this section stays empty rather than carrying a
placeholder. Every measurement in this repository is from a local Anvil.

The **ERC-8004 registries** AgentTrust codes against are already deployed on Base Sepolia
and were verified on-chain (V-97):

| registry | address |
|---|---|
| Identity | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| Reputation | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |
| Validation | `0x8004Cb1BF31DAf7788923b405b754f57acEB4272` |

All three report `getVersion() = "2.0.0"`, and all three are **UUPS proxies owned by a
single EOA**, so they can be upgraded at any time (V-97). Local tests therefore run
against same-ABI mocks by default, and `impl/scripts/check-erc8004-abi.sh` checks the
pinned ABI against what is actually deployed.

---

## Limitations

There are real ones, and they are written down: **[`docs/LIMITATIONS.md`](docs/LIMITATIONS.md)**.

The short version — a single selected validator has to be honest; a seller colluding with
its validator is not addressed; "correctness" means a deterministic fixture recomputes to
the same bytes, not that an answer is good; the reputation gate refuses honest newcomers
by design; four of six attacks were not evaluated.

---

## Layout

```
docs/          specs/ · planning/ · results.md · LIMITATIONS.md
impl/contracts contracts, mocks, tests, deploy script
impl/packages/core  canonical hashing, ABIs, chain client, x402 envelopes
impl/agents/   seller/ · buyer/
impl/validator Python: independent hashing, attestation, release
impl/attacks   the harness and the labelled vulnerable fixture
evidence/      one directory per task; raw logs for every recorded number
```

The specifications, each with the tests that pin it:

| Document | What it fixes |
|---|---|
| [`docs/specs/canonical-hash.md`](docs/specs/canonical-hash.md) | the request hash, with cross-language vectors (SPEC-001) |
| [`docs/specs/http-protocol.md`](docs/specs/http-protocol.md) | the 402 quote, the signed retry, the one-grant rule (SPEC-002) |
| [`docs/specs/settlement.md`](docs/specs/settlement.md) | validation binding, release, refund and the reputation gate (SPEC-003) |
| [`docs/specs/versions.md`](docs/specs/versions.md) | every pinned version |
| [`docs/demo-script.md`](docs/demo-script.md) | the demo commands and what each pane shows |
| [`docs/presentation-outline.md`](docs/presentation-outline.md) | the 386-word talk, with every figure's source |

`task.md` is the plan and the progress record. `CLAUDE.md` holds the working rules.

---

## Ethics and scope

Testnet only, with valueless tokens. Every attack in this repository is run **against
this project's own services on a local chain** — never against a third-party endpoint.
The vulnerable fixture exists solely as a measurement control and is labelled as such in
its source, its logs, its HTTP responses and every manifest it appears in.

The two attack classes reproduced here are already public: arXiv 2605.11781 and
arXiv 2605.30998. Nothing here discloses a new vulnerability in anyone else's software.

## Academic context

Coursework for **EC8204 Blockchain and Cyber Security**, Department of Electrical &
Information Engineering, University of Ruhuna.

## Licence

MIT — see [`LICENSE`](LICENSE).
