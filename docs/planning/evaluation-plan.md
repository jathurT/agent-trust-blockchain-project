# Evaluation Plan — AgentTrust attack/defence harness

**Status: PLANNED. Nothing has been measured.** Every "expected" value here is a **HYPOTHESIS** that the run may refute. Facts cite `verification-log.md`; decisions cite `design-findings.md`; tasks cite `task.md`.

---

## 1. Purpose

Run reproductions of published x402 attacks against two targets — a labelled vulnerable **baseline fixture** and the **AgentTrust** stack — and report, with raw data, which attacks each configuration stops, which it only bounds, and which it does not stop at all.

## 2. Principles (binding)

1. **Hypotheses, not promises.** No result is written down before it is measured. A refuted hypothesis is a finding and is published as one.
2. **Labelled baselines.** The control is a fixture that reproduces conditions described in a specific paper section. It is never called "vanilla x402", and never presented as upstream behaviour (DF-18). Claims about upstream require a run against pinned `@x402/express@2.26.0` (API-009).
3. **Never weaken a baseline.** Baseline configuration is fixed before the first run and recorded in the manifest. If it changes, every earlier result is re-run or discarded, and the change is described in the results narrative.
4. **Everything is reproducible.** Seeds, run counts, concurrency, versions, chain and block, commit hash and raw logs are recorded for every run.
5. **Report failures.** Partial, inconclusive and contradicting outcomes are reported with the same prominence as successes.
6. **Comparability caveats.** Our numbers are not comparable to the papers' numbers unless the setup matches, and the differences are stated wherever a paper figure is quoted.
7. **Ethics.** All attacks run against our own endpoints, on a public testnet, with valueless tokens, against vulnerabilities already published in preprints (§12.4 of the blueprint; SEC-011).

## 3. Definitions

| Term | Definition |
|---|---|
| **Payment** | One funded escrow job (AgentTrust), or one payment authorization (baseline) |
| **Execution** | One run of the paid handler that produced a result. **The headline A2 metric** (DF-01, DF-17) |
| **Distinct result** | Number of byte-distinct results produced for one payment |
| **HTTP 2xx** | Count of successful protected responses, including idempotent replays |
| **Replay served** | A 2xx that re-served stored bytes without executing |
| **Grant** | Used only when quoting the papers; here it always maps to *execution* unless stated |
| **Leakage ρ (seller-side)** | 1 − settled_value / delivered_value (V-26) |
| **Overcharge (buyer-side)** | settled_value − quoted_value for a delivered resource |
| **Sybil capture** | Share of buyer selections won by Sybil-controlled sellers under a given gate |
| **Defence coverage** | attacks with outcome ≠ "Not evaluated" out of the **6 defined** attacks, reported per outcome category |
| **Outcome categories** | **Blocked (structural)** — a named mechanism makes success impossible and a test asserts the rejection or revert · **No failures observed (N=…, 95% CI …)** — nothing succeeded, but the evidence is statistical, which is the honest label for probabilistic attacks like A4 and A1 · **Mitigated-to-bound** — succeeds only beyond a stated bound, e.g. reorg depth > k · **Not blocked** — succeeds · **Not evaluated** — not run, or inconclusive |

## 4. Environments and targets

| Environment | Use |
|---|---|
| **Mode A — local Anvil (default)** | All bulk and repeated runs. Offline, deterministic accounts, mock registries, MockUSDC. Block time set to 2 s for latency realism, instant for functional runs |
| **Mode B — Anvil fork of Base Sepolia at a pinned block (E2)** | Runs that need real USDC or the live registries (API-009, REG-005) |
| **Base Sepolia (smoke only)** | One end-to-end job plus gas receipts. Never bulk runs (public RPC limits, V-83) |

| Target | What it is |
|---|---|
| `fixture-a2a3` (**CORE**) | Deliberately vulnerable seller: EIP-3009-style authorization checked off-chain, **no idempotency** (reproduces 2605.11781 Table 2 conditions, V-13) and **resource-agnostic** authorization (reproduces 2605.30998 §4.1, V-24). Labelled in code, logs and results |
| `fixture-a1a4a5` (**E2**) | Adds: optimistic grant before confirmations (A1, V-15), non-atomic check-then-act idempotency (A4, V-25), `upto`-style allowance (A5, V-26) |
| `agenttrust` (**CORE**) | The full stack: escrow + gate + payer-signed retry + atomic claim + validator attestation |
| `upstream-exact` (**E2**) | Pinned `@x402/express@2.26.0`, `exact` scheme, in-process facilitator, Mode B. Used only to state what upstream does today (V-65, V-135) |

**Treatment configuration** is fixed for all measured runs: `REPLAY_POLICY=idempotent`, `CONFIRMATIONS=1` (Mode A) or `3` (testnet), gate v2, `GRACE` per SPEC-003. Any variant is reported side by side, never substituted.

---

## 5. Attack specifications

Order of work: **A2 and A3 first (CORE-P0)**; then A4, A6, A5, A1 (E2), only after gate G3.

### A2 — Replay across the HTTP/chain boundary (CORE-P0, SEC-003)

- **Source.** arXiv 2605.11781 §4.3 (V-12, V-13). Reported: 248 HTTP grants against 1 settlement in the strongest of 1,000 concurrent replays on a testnet endpoint; with no idempotency, n=50 replays produced 50 grants.
- **Attacker.** Can observe or possess one valid payment artefact (baseline: the payment header; AgentTrust: the public `jobId` from `JobFunded`, plus — in the strong variant — a captured signed retry). No keys.
- **Prerequisites.** SPEC-002, API-003/004/005, API-008, AGENT-002, SEC-002.
- **Procedure.** Fund/pay once. Replay the protected request N times (N = 50 sequential, then 50 concurrent, then 200 concurrent), across 2 seller processes for the AgentTrust target. Variants: (a) replay with the original payer signature, (b) replay with no signature, (c) replay from a different client identity.
- **Metrics.** executions_completed, distinct_results, http_2xx, replays_served, on-chain settlements, revert selectors observed, and **unauthorized_2xx** — protected responses served to a connection that is not the payer. This last one matters: under idempotent replay a captured signed retry (the acknowledged residual in DF-02) would leave executions at 1 while still handing the content to an attacker, so without it the run could read as "Blocked" while the attacker was served.
- **Success (attack).** executions_completed > 1 for one payment.
- **Hypotheses.** Baseline: executions ≈ N (H-A2-1). AgentTrust: executions = 1, unsigned replays refused with 403, signed replays served idempotently as replays, and a second `fund()` with the same nonce reverts `ReplayedNonce` (H-A2-2); variant (c) reports `unauthorized_2xx` separately, and it is **expected to be non-zero only when the attacker replays a captured payer signature** (H-A2-3, the DF-02 residual). **Falsified if** any run shows executions > 1 on AgentTrust — which would be a genuine finding about the claim store.
- **Reporting note.** Our N is our own; do not present it as "248".

### A3 — Cross-resource substitution (CORE-P0, SEC-004; seller-side part SEC-013, P1)

- **Source.** arXiv 2605.30998 §4.1 (V-24): a signature minted for resource A accessed an equal-priced B in 100/100 rounds, because the authorization does not bind the resource.
- **Attacker.** (i) *Buyer-side*: funds/pays for cheap-or-equal resource A and requests B. (ii) *Seller-side*: serves content for B against a job funded for A.
- **Prerequisites.** SPEC-001 (hash + vectors), API-003, CONTRACT-004; seller-side additionally VAL-003, CONTRACT-007.
- **Procedure.** 100 rounds per direction over an equal-price sibling pair (fixtures expose `/v1/summarise` and `/v1/classify` at the same price), plus a body-mutation case and a query-reordering case that must **not** false-positive.
- **Metrics.** substitutions_served / attempts; rejection codes; for the seller-side case, the validator's response value and whether release succeeded.
- **Success (attack).** Any substituted resource served, or payment released for a substituted result.
- **Hypotheses.** Baseline: 100/100 substitutions served (H-A3-1). AgentTrust: 0/100, refused with 409 `resource_mismatch`; seller-side substitution yields a failing attestation and no release before the deadline (H-A3-2). Canonicalisation edge cases produce 0 false rejections (H-A3-3).

### A4 — Concurrent duplication (E2, SEC-005)

- **Source.** arXiv 2605.30998 §4.2 (V-25): 50 rounds × 20 concurrent requests produced duplicate delivery in 6% of rounds.
- **Attacker.** Fires concurrent requests inside the verify→settle window with one payment.
- **Prerequisites.** API-010 (check-then-act fixture), API-005, INT-004.
- **Procedure.** 50 rounds × {10, 20, 50} concurrent requests per target; AgentTrust runs across 2 seller processes sharing one claim store.
- **Metrics.** rounds with executions > 1; max executions per round; 409 vs replay distribution.
- **Hypotheses.** Baseline shows duplicates in a non-zero fraction of rounds, in the same order as the paper (H-A4-1). AgentTrust: 0 rounds with executions > 1 (H-A4-2).

### A5 — Allowance overdraft / resource leakage (E2, SEC-006)

- **Source.** arXiv 2605.30998 §4.4 (V-26): ρ = 97.76% in a 50-request burst, → 100% in the deterministic variant; **the seller bears the loss**.
- **Attacker.** (i) Buyer consuming unpaid compute under `upto` pricing. (ii) Seller drawing more than quoted.
- **Prerequisites.** API-010 (`upto` fixture), CONTRACT-004.
- **Procedure.** Burst of 50 requests against a small allowance on the baseline; the same workload against AgentTrust, where each job is pre-funded at an exact price. Also attempt a seller over-draw on both.
- **Metrics.** ρ = 1 − settled/delivered; overcharge; delivered-but-refunded jobs (the honest-seller residual, DF-10).
- **Hypotheses.** Baseline ρ ≫ 0 (H-A5-1). AgentTrust ρ = 0 while the validator is healthy, and over-draw is structurally impossible (H-A5-2). Under an unhealthy validator, AgentTrust's seller-side residual is non-zero and must be reported (H-A5-3).

### A6 — Sybil server selection and the reputation gate (E2, SEC-007)

- **Source.** arXiv 2605.11781 §4.5 (V-14): an LLM ranking experiment where five Sybils raised selection share to 60.2%. **Not an escrow gate**, so our numbers are not comparable.
- **Attacker.** Registers 5 agents with distinct owner addresses that cross-endorse each other (each receives feedback from the other four), then transacts.
- **Prerequisites.** REG-003/009 (seed fixtures), CONTRACT-005, SPEC-003/004.
- **Procedure.** Population: H honest sellers with trusted-client feedback, 5 Sybils with ring feedback, plus N newcomers with no history. Buyer selection ranks by gate-eligible score. Configurations: (a) no gate, (b) **gate v1** (blueprint rule: score ≥ 6000, count ≥ 5, distinct ≥ 3 over *all* feedback; mock-only), (c) **gate v2** (trusted clients only). Then an **honest-then-defect** Sybil that earns genuine trusted feedback before defecting. Measure gas for `fund()` as feedback history grows (V-99).
- **Metrics.** Sybil capture share; `fund()` outcomes (`ReputationTooLow` vs success); false-refusal rate for honest newcomers; gas versus history size.
- **Hypotheses.** No gate: Sybils capture a large share (H-A6-1). **Gate v1 admits the ring** — each Sybil shows 4 distinct attesters ≥ 3 and ≥ 5 entries, so the blueprint's gate is expected to *fail* (H-A6-2, DF-09). Gate v2 refuses the ring (H-A6-3) **but also refuses honest newcomers** at a measurable rate (H-A6-4), and cannot stop an honest-then-defect Sybil (H-A6-5).

### A1 — Revert-grant under optimistic execution (E2, SEC-008)

- **Source.** arXiv 2605.11781 §3.1.1/§4.2 (V-15): grant before k confirmations, then a reorg removes the payment; simulated revert-grant probability 4.70–5.18%.
- **Attacker.** Benefits from a reorg of depth d after being served.
- **Prerequisites.** API-010 (optimistic fixture), `anvil_reorg` (V-107), SPEC-002 confirmation policy.
- **Procedure.** For d ∈ {1, 2, 3, 5} and policy k ∈ {0, 1, 3}: fund, serve per policy, then `anvil_reorg(d)`, and check whether the job survives and whether the service was delivered unpaid. 50 trials per cell.
- **Metrics.** revert-grant rate per (d, k); added latency per k.
- **Hypotheses.** Baseline (k=0) shows a non-zero rate at every depth (H-A1-1). AgentTrust is **mitigated up to depth k** and fails for d > k (H-A1-2) — reported as a bound, never as "blocked" (DF-11).

### Derived scenarios (E2, SEC-009)

Not from the papers; they test our own design: `jobId` front-running (DF-02), late attestation plus delayed release (DF-05), validator fail→pass flip racing a refund (DF-15), `requestHash` squatting (DF-06), tiny-TTL free service (DF-22), unauthenticated evidence retrieval (DF-08).

---

## 6. Measurement protocol

- **Runs.** MVP attacks: **N ≥ 10 independent runs** per (attack × target × configuration); E2 attacks: N ≥ 5. Concurrency sweeps use the levels listed per attack. One warm-up run per configuration is discarded and recorded as such.
- **Statistics.** Report median, IQR, min and max. For proportions (substitution rate, duplicate-round rate, capture share) report the **Wilson 95% interval**. For latency medians, report a bootstrap 95% interval. Never report a single run as a headline number.
- **Isolation.** One target per run; the claim store, the chain state and the registries are reset between runs; seeds are fixed and recorded.
- **Gas (EVAL-002).** `forge test --gas-report` plus `forge snapshot` for `fund`, `bindValidation`, `confirmValidation`, `release`, `refund`, and real testnet receipts for the same functions. USD conversion states the gas price and the ETH/USD source **and date**; the five-transaction flow (DF-06) is totalled, not just `fund`.
- **Latency (EVAL-003/006).** Per-stage timestamps captured inside E2E runs: quote → hash → fund → confirmations → retry → execute → deliver → attest → release. Mode A with 2 s block time for the comparison, plus a small-n testnet sample. Blockchain confirmation is expected to dominate and is reported, not hidden.

## 7. Data formats

**`impl/attacks/results/<runId>/manifest.json`**

```
runId, startedAt, finishedAt, gitCommit, dirty(bool),
target, targetVersion, attackId, configName,
env: {mode, chainId, rpc, blockNumber, blockTime, confirmations},
versions: {foundry, solc, node, pnpm, python, packages{...}},
contracts: {escrow, identity, reputation, validation, token},
params: {n, concurrency, seed, replayPolicy, gate, grace, ttl},
notes
```

**`impl/attacks/results/<runId>/results.json`**

```
runId, attackId, target, config,
metrics: {executions_completed, distinct_results, http_2xx, replays_served,
          unauthorized_2xx, settlements, substitutions_served, attempts, rho, overcharge,
          capture_share, false_refusal_rate, revert_grant_rate, gas{...}, latency_ms{...}},
outcome: "Blocked(structural)" | "NoFailuresObserved" | "Mitigated-to-bound" | "Not blocked" | "Not evaluated",
ci: {metric, n, lower, upper} | null,
bound: "<e.g. reorg depth <= 3>" | null,
hypothesis: "H-A2-2", hypothesisHeld: true|false|null,
rawLogs: ["stdout.log","events.ndjson","http.ndjson","chain.ndjson"]
```

Aggregation (EVAL-004) reads every `results.json` into `docs/results.md`; no number is typed by hand.

## 8. Results table template

| Attack | Baseline (fixture, labelled) | AgentTrust | Mechanism | Outcome | Evidence |
|---|---|---|---|---|---|
| A2 replay | executions/payment = … | … | atomic claim + payer-signed retry (DF-01/02) | … | `results/<runId>` |
| A3 cross-resource | … | … | on-chain `resourceHash` binding (DF-04) | … | … |
| A4 duplication | … | … | atomic claim (DF-01) | … | … |
| A5 leakage ρ | … | … | pre-funded exact escrow (DF-10) | … | … |
| A6 Sybil capture | no gate / v1 / v2 | … | trust-anchored gate (DF-09) | … | … |
| A1 revert-grant | … | … | confirmation policy k (DF-11) | Mitigated-to-bound | … |

Rows that were not run say **Not evaluated**, and the coverage line states the denominator explicitly, e.g. "evaluated 2 of the 6 defined attacks".

## 9. Threats to validity

- Fixtures model published conditions; they are not the upstream implementation (DF-18), so "baseline exploited" describes the fixture unless API-009 ran.
- Mode A removes real network variance and public-mempool adversaries; testnet numbers come from a small sample.
- Mock registries are ABI-faithful but not the deployed contracts; REG-005/008 bound that gap.
- Our A6 selection model is ours, and the capture share is not comparable to the paper's 60.2% (V-14).
- Deterministic fixtures make validation checkable; results do not generalise to non-deterministic services (DF-08).
- A single implementer under time pressure means fewer runs than ideal; N is always stated.

## 10. Ethics and scope (SEC-011)

All attacks target our own endpoints and contracts, on a public testnet, with valueless test tokens. The vulnerabilities are already documented in public preprints (V-10, V-20). No third-party endpoint is attacked, no live facilitator is stressed, and no results are attributed to any vendor's current code unless measured against a pinned version of it.
