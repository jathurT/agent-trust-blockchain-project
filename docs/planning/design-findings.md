# Design Findings — AgentTrust

Gaps, errors and ambiguities found in the blueprint during planning (2026-09-22), each with a **PROPOSED decision**. Facts cite `verification-log.md` (V-IDs). Tasks cite `task.md`.

**Status of these decisions.** Everything here is PROPOSED and applies by default. Six groups touch money, delivery or public claims and need the user's explicit sign-off before the code they govern (PLAN-007):

| Group | Findings | Gates |
|---|---|---|
| **D1** | DF-03 | SPEC-002, API-002 |
| **D2** | DF-01, DF-02 | SPEC-002, API-004, API-005 |
| **D3** | DF-04 | SPEC-001, CONTRACT-004 |
| **D4** | DF-05, DF-06, DF-22 | SPEC-003, CONTRACT-007/008/010 |
| **D5** | DF-09, DF-21 | SPEC-003/004, CONTRACT-005 |
| **D6** | DF-18, DF-19 | API-008, SEC-002/003/004, PRES-001 |

Once accepted, each becomes an ADR under `docs/adr/` (DOC-008). The blueprint is never edited; these findings are the correction layer.

---

## DF-01 — A burned nonce does not stop repeated HTTP requests

- **Blueprint:** §5.1(4), §9.2 `fund()`, §9.3 "State-machine CAS in one transaction", §12.2 (A2 "Second call reverts `ReplayedNonce()`"; A4 "Exactly 1 succeeds; 49 revert"), §18.
- **Analysis.** `consumedNonce[payer][nonce]` prevents funding the same job twice. It says nothing about how many times the seller serves a request carrying an already-funded `jobId`. The published A2 result is an **HTTP-layer** failure: the server granted repeatedly because it had no idempotency at the boundary (V-12, V-13), and the paper's own mitigation M3 is an atomic single-use claim of the pay-id/resource pair (V-17). A4 is likewise a race inside the verify→settle window (V-25). So the blueprint's A2/A4 expectations test the wrong layer, and nothing in the design currently prevents repeated delivery.
- **PROPOSED decision.**
  - **"One grant" = one *execution* per funded job**, across retries, restarts, concurrent requests and multiple seller processes.
  - The result is persisted; a repeated **authenticated payer** request re-serves the stored bytes (idempotent replay) and never re-executes.
  - The claim is **atomic**, keyed by `(chainId, escrowAddress, jobId)`, and is taken **only after every check in DF-04/DF-02 passes**.
  - Storage: SQLite in WAL mode, one host, `BEGIN IMMEDIATE` per transition; the database path is configurable and must not sit on `/mnt/*` (DF-20).
  - Reported metrics separate **executions**, **distinct results** and **2xx responses** per payment.
  - Multi-host sellers are out of scope and documented as such (Redis/Postgres is future work).
- **Alternatives.** On-chain claim (a `claim()` transaction before serving): globally safe across hosts, but adds a transaction and a confirmation wait to every delivery — rejected for latency and gas. Cache-only idempotency: loses the crash guarantee.
- **Validation tasks.** SPEC-002, API-005 (concurrency, multi-process and crash tests), SEC-003 (A2), SEC-005 (A4), EVAL-004.
- **Residual risk.** A single-host claim store is a single point of failure; a compromised seller can always re-execute voluntarily (it only harms itself).
- **Group:** D2.

## DF-02 — `jobId` is public, so it cannot be a bearer token

- **Blueprint:** §11.2 (`X-AgentTrust-Job` header alone authorises delivery).
- **Analysis.** `JobFunded` is emitted on a public chain, so any observer learns `jobId` as soon as funding lands. With the DF-01 claim in place, whoever presents the `jobId` first consumes the single execution: an observer can steal the paid result, or simply burn the buyer's grant. The blueprint's own threat model already includes a network observer (§4.2).
- **PROPOSED decision.** The retry must carry a **payer signature** over an EIP-712 `DeliveryRequest{jobId, resourceHash, sellerOrigin, expiry, clientNonce}`; the seller verifies `signer == job.payer`, `expiry ≤ job.deadline`, and that `clientNonce` is unused. EOA signers only (ERC-1271 is future work). Delivery over TLS is an explicit deployment assumption.
- **Alternatives.** Encrypting the response to the payer's key (stronger, but key management and demo cost are not worth it now — future work).
- **Validation tasks.** SPEC-001 (struct + digest vectors), SPEC-002 (wire), API-004, SEC-009 (front-run scenario).
- **Residual risk.** An attacker who captures a signed retry **in transit** can still race it. TLS mitigates this; idempotent replay means the payer still gets its result, so the loss is confidentiality, not payment integrity. Documented in the threat model and limitations.
- **Group:** D2.

## DF-03 — Stock x402 middleware plus escrow charges the buyer twice

- **Blueprint:** §11.2 (mounts `paymentMiddleware` *and* requires an escrow-funded job), §11.3, §14.1, §1.
- **Analysis.** In the current SDK the middleware verifies, runs the handler and settles the payment to `payTo` before releasing the response (V-65). Funding the escrow as well means the buyer pays twice (V-68). Pointing `payTo` at the escrow does not help: a plain transfer gives the contract no callback and no `jobId`, and a consumed EIP-3009 nonce proves nothing about who was paid (V-68). Separately, the blueprint's SDK call shape is v1-era and invalid for 2.26.0 (V-63, V-64).
- **PROPOSED decision.**
  - Escrowed routes **do not mount** the stock middleware.
  - The seller returns 402 in the **x402 v2 wire format** (`PAYMENT-REQUIRED`, CAIP-2 `eip155:84532`, PaymentRequirements fields) with the **project scheme `agenttrust-escrow`** (V-62).
  - The buyer funds the escrow itself and retries with `PAYMENT-SIGNATURE = {jobId, fundTxHash, payer signature}`; the seller answers with `PAYMENT-RESPONSE`.
  - **Honest wording, used verbatim:** "AgentTrust speaks the x402 v2 wire format with a project-specific escrow scheme, analogous to the official `auth-capture` escrow scheme (V-47). It is **not** interoperable with the x402.org facilitator or with stock x402 clients."
  - The vanilla baseline is a **separate target** (DF-18).
- **Alternatives.** Gasless funding through USDC `receiveWithAuthorization` with a job-bound nonce, registered as a real custom scheme with an in-process facilitator (V-66, V-67) — the most x402-native option, deferred to STRETCH-006 for time. Using the official `auth-capture` scheme — no public facilitator supports it yet (V-47), so it is future work.
- **Validation tasks.** SPEC-002, API-002, AGENT-002, SEC-012 (claims audit), DOC-001.
- **Residual risk.** Reviewers may expect literal x402 interoperability; the wording above and the related-work section address it directly.
- **Group:** D1.

## DF-04 — `quotedMax` authenticates nothing, and the seller's identity is unbound

- **Blueprint:** §9.1, §9.2 (`amount > quotedMax → AmountExceedsQuote`), §9.3 ("Exact `amount` with `quotedMax` ceiling"), §12.2 A5.
- **Analysis.** The buyer supplies both `amount` and `quotedMax`, so the check constrains the caller against itself — it is not a seller quote and defends nothing. Worse, the blueprint hashes the resource **off-chain** and passes the digest in, so the contract cannot know the funded amount matches the hashed price. Nothing ties the 402 response to the agent being paid either: a man-in-the-middle could substitute `payTo` or the price.
- **PROPOSED decision.**
  - The escrow **computes `resourceHash` on-chain** from `(DOMAIN, methodHash, uriHash, bodyHash, amount, token, chainId)`, so amount, token and chain are structurally bound; `quotedMax` is removed along with `AmountExceedsQuote`.
  - The seller re-derives the same hash from the **raw request bytes** and its **configured origin** (never the `Host` header), and compares it to `job.resourceHash`.
  - Seller identity = the on-chain payee wallet (`getAgentWallet`, falling back to `ownerOf`, V-92), snapshotted at funding; the buyer checks that the agent card's endpoint origin matches the host it is talking to before funding.
  - An **EIP-712 seller-signed quote** (offer binding price, resource, validator and expiry) is **EXTENDED-E1** (SPEC-005/CONTRACT-006). Until it lands, the price table plus the on-chain amount binding apply, and the limitation is stated in the docs.
- **Alternatives.** Keeping the off-chain hash with an on-chain signed quote from day one — more faithful but more work on the critical path.
- **Validation tasks.** SPEC-001, CONTRACT-004, CONTRACT-011, API-003, AGENT-002, SEC-004 (A3).
- **Residual risk.** Without the signed quote, a malicious seller can refuse to serve a correctly funded job (it forfeits payment; the buyer is refunded).
- **Group:** D3.

## DF-05 — Timely attestation plus a late release loses the seller's money

- **Blueprint:** §9.2 `release()` (`if (block.timestamp > j.deadline) revert DeadlinePassed()`), `refund()` (only checks the deadline), §5.1(7), §9.4 `test_RefundAfterDeadline`.
- **Analysis.** Three defects. (1) A validator attests at `deadline − 1`, but the release transaction is mined after the deadline: release reverts forever and the buyer can refund a job that was delivered and attested. (2) `refund()` never looks at the attestation, so a refund succeeds even when a passing attestation exists. (3) ERC-8004 responses are **repeatable** (V-94), so a later response can overwrite an earlier pass, and `validationRequest` itself sets `lastUpdate`, which makes a **pending request indistinguishable from a 0 response** (V-99).
- **PROPOSED decision.**
  - Release requires a **passing attestation whose `lastUpdate ≤ job.deadline`**, and has **no deadline of its own**.
  - A permissionless `confirmValidation(jobId)` **snapshots the first valid pass** into the job, so a later overwrite cannot erase it; `release()` performs the same snapshot implicitly.
  - `refund()` requires `block.timestamp > deadline + GRACE` **and** no recorded pass.
  - **No early refund on "fail"**: because pending ≡ 0 on a per-request read, an early-fail rule would let anyone refund the moment the seller files a request, taking the service for free. A failing outcome simply waits for the deadline.
  - The validator service reads the registry before writing, posts **once**, never responds after the deadline, and calls `release()` immediately after a pass (DF-15).
- **Correction (V-99a, found while building the mock in REG-004).** "Pending is indistinguishable from a 0 response" is exact for `getValidationStatus`, which is what the escrow reads, but it is **not** true of the registry as a whole: `ValidationRegistry.getSummary(agentId, validators, tag)` filters on the stored `hasResponse` flag, so it returns count 0 for a pending request and count 1 for a real 0. That path loops over **every** validation the agent has ever had, so it is unbounded and cannot be called from `release()`/`refund()` (§10 bounded-loop rule). The decision above is unchanged; its justification is now "reading the distinguishing view costs unbounded gas", not "the distinction does not exist". Any sentence in the docs, README or slides that says "indistinguishable" without that qualification is wrong and must be fixed — tracked in SEC-012.
- **Alternatives.** Requiring a non-zero `responseHash` plus the project tag to distinguish a real fail — possible later, but it relies on validator conventions rather than the registry, so early refund stays out of P0. A bounded variant of the `getSummary` idea (an off-chain read by the buyer, with the verdict passed in and re-checked) is an E1 note, not P0: it would let a caller assert "this really failed" without an unbounded on-chain loop.
- **Validation tasks.** SPEC-003, CONTRACT-007, CONTRACT-008, CONTRACT-011 (boundary and same-block race tests), VAL-004, INT-002.
- **Residual risk.** An honest seller whose validator attests late still loses; `GRACE` is the tunable margin — and, since CONTRACT-007, each job **freezes** its grace at funding time, so no later `setGrace` can move an existing job's refund point in either direction. A second residual, sharpened by the security review: the seller cannot snapshot its own pass before the validator responds, and `confirmValidation` is an extra transaction it would have to race, so DF-15's "the validator releases immediately" is not merely an optimisation — it is what keeps the seller's money out of the validator's sole discretion. DOC-004 must say so. Sharper case: the snapshot only protects a pass **once someone has called** `confirmValidation` or `release`. If a timely pass is overwritten before either call, the escrow can no longer see it and a refund succeeds. DF-15 closes this in practice (the validator releases immediately and never re-responds), but the window is real and SEC-009's "validator fail→pass flip" scenario measures it.
- **Group:** D4.

## DF-06 — Attestations are keyed by a squattable `requestHash`, not by `jobId`

- **Blueprint:** §9.2 `IValidationRegistry.getValidation(bytes32 jobId)`, §5.1(6), §10.1.
- **Analysis.** No such function exists (V-95). The registry keys validations by a caller-chosen `requestHash` that is **unique registry-wide**, `validationRequest` may be called **only by the agent's owner or operator**, the response is 0–100 and repeatable, unknown hashes **revert**, and an agent may even name itself as validator (V-94, V-97, V-99). A predictable hash can be squatted by anyone, blocking the seller's request.
- **PROPOSED decision.**
  - `requestHash = keccak256(abi.encode(DOMAIN, chainId, escrow, jobId, resourceHash, sellerSalt))`, with an unpredictable seller salt.
  - After filing `validationRequest`, the **payee binds it once**: `bindValidation(jobId, salt)` re-derives the hash and verifies through the registry that `agentId == job.payeeAgentId` and `validatorAddress == job.validator`. Binding is **once per job**; a squatted hash simply forces a new salt before binding.
  - Release, refund and snapshot all read **only the bound hash**; registry reads are wrapped so a revert is treated as "no validation".
  - **Validator consent is mutual**: the seller proposes acceptable validators in the 402, the buyer picks one it trusts and it is stored in the job at funding; the escrow rejects a validator that is the agent's owner or operator (`isAuthorizedOrOwner`) or the payer. Real independence comes from the buyer's trusted-validator set, not from that check alone.
  - The escrow is **never** granted operator rights on an agent NFT (it would also allow NFT transfer).
- **Correction (security review of CONTRACT-007, 2026-09-23).** The residual risk was recorded as "griefing can force salt retries", which implies a bounded cost. It is not bounded. The salt is only secret until the payee **broadcasts** `validationRequest`; from that moment the hash is public in the mempool, and an adversary watching it can front-run with its own agent for ~171k gas and squat that hash. It can do the same to every retry until the deadline passes and the job refunds — the seller loses a delivered service, the attacker loses only gas. The contract behaves correctly throughout (each squatted entry names the wrong agent and validator, so `bindValidation` refuses it and consumes nothing), which is why this is a protocol-level residual rather than a bug. The mempool step itself is **UNRESOLVED**: it was reasoned about and the on-chain half reproduced, but confirming the race needs a live node, not Foundry.
  No contract fix is available — the escrow cannot file the request itself without operator rights on the agent NFT, which this finding forbids. The mitigations are a **retry budget** in the seller service and folding that budget into SPEC-002's `minDeadlineMargin`, so the seller stops delivering when it can no longer expect to bind in time.
- **Alternatives.** Binding lazily at release (saves one transaction) — rejected, because refund could then not tell whether a pass exists without trusting a caller-supplied salt. Re-examining this trade-off is an E1 optimisation note.
- **Cost.** The flow needs five transactions per job: `fund`, `validationRequest`, `bindValidation`, `validationResponse`, `release`. Seller and validator both need ETH (ENV-007); gas and latency results must count all five (EVAL-002/003/006).
- **Validation tasks.** SPEC-003, CONTRACT-007, CONTRACT-014 (squatting test), API-006, VAL-004, REG-004/008.
- **Residual risk.** Griefing can force salt retries; a malicious registry owner could upgrade the registry and forge validations (DF-07).
- **Group:** D4.

## DF-07 — "At least one honest validator" does not fit single-validator acceptance

- **Blueprint:** §4.3 trust assumptions; §6.3; §21.3.
- **Analysis.** Release depends on the **one** validator chosen for the job, so an assumption about the existence of some honest validator is irrelevant; what matters is that the selected one is honest. §4.3 also assumes the chain provides finality, yet A1 is precisely a reorg attack (V-15), and the live ERC-8004 registries are upgradeable by a single externally owned account (V-97).
- **PROPOSED decision.** The trust assumptions become:
  1. the **selected** validator is honest for that job (collusion with either side is out of scope and is stated as a limitation);
  2. settlement is final only to the depth of the confirmation policy (DF-23), so A1 is "mitigated up to depth k", never "blocked";
  3. when live registries are used, their owner does not perform a malicious upgrade — mocks avoid this assumption entirely;
  4. the buyer's trusted-client and trusted-validator sets are honest anchors (DF-09).
  k-of-n validators, staking and slashing are named future work.
- **Validation tasks.** SEC-001, DOC-004, PRES-001 (slide wording), SEC-012.
- **Group:** default.

## DF-08 — "Cryptographic proof of delivery" overclaims what the system proves

- **Blueprint:** §0.4 pitch, §1(3), §5.1(6), §17 Slide 3, Appendix A ("Attestation"), §21.1.
- **Analysis.** Release proves that a validator attested; it does not prove the buyer received anything, nor that arbitrary content was "correct". For deterministic fixtures the validator can recompute the expected output, which is a genuine correctness check, but only for those fixtures.
- **PROPOSED decision.**
  - The seller must deposit the response bytes plus a signed `DeliveryReceipt` with the validator before a request is filed, so payment requires the result to exist outside the seller.
  - **Default wording (VAL-006 not yet done):** "funds release only against a validator attestation that the correct deterministic result was produced for this exact request".
  - **Stronger wording (only once VAL-006 ships):** adds "and the payer can always retrieve that result from the validator".
  - Appendix A's "Attestation" definition is corrected accordingly, and SEC-012 audits every public claim against whichever state is real.
- **Validation tasks.** VAL-002, VAL-006, SEC-012, DOC-004, PRES-001.
- **Residual risk.** A colluding seller and validator can attest a result the buyer never received; that is the stated trust assumption (DF-07).
- **Group:** default (wording is checked under D6).

## DF-09 — Five cross-endorsing Sybils satisfy the blueprint's own gate

- **Blueprint:** §1(1), §5.1(2), §9.2 gate (`score ≥ 6000`, `count ≥ 5`, `distinct ≥ 3`), §9.3 ("distinctAttesters raise the cost"), §12.2 A6, §13(4).
- **Analysis.** Arithmetic first: in a ring of five Sybil agents with distinct owner addresses, each agent can receive feedback from the **other four**, which gives `distinctAttesters = 4 ≥ 3`; those four can leave more than five entries in total, giving `count ≥ 5` at an arbitrary score. **The ring passes.** ERC-8004 allows any address except the agent's own owner or operators to leave feedback, with no proof of interaction (V-93), so distinct addresses are not independent participants. Separately, the blueprint's `getSummary(agentId)` does not exist: the real one **requires a non-empty client list** and returns no distinct-attester count (V-93, V-95), and the standard's own security note says to filter by trusted reviewers (V-96). Computing a "global distinct attesters" figure on-chain would mean looping over `getClients`, which anyone can inflate, and `getSummary` already loops over every entry, so gas grows with history (V-99).
- **PROPOSED decision.**
  - **Gate v2 (the implemented gate):** the buyer supplies a **bounded trusted-client list**; the escrow calls `getSummary(agentId, trustedClients, "agenttrust", "")`, counts **distinct trusted attesters**, and enforces minimum count, minimum distinct and minimum average, with owner-set floors only (bounded, `Ownable2Step`).
  - **Gate v1 (the blueprint's rule)** is kept **only as a mock-only comparison configuration** for A6; it cannot be computed against the real ABI and is never presented as the product.
  - **A6 is a hypothesis, not a promise.** The expected finding — that v1 admits the ring and v2 refuses it — is written as HYPOTHESIS until SEC-007 measures it.
  - A6 must also measure the **cost**: honest newcomers wrongly refused (cold start), an **honest-then-defect** Sybil that earns trusted feedback before defecting, and gas versus feedback history.
- **Alternatives.** Escrow-verified "paid feedback" — Sybils can transact with themselves for gas only, so it raises cost little (and see DF-21). Stake-weighted reputation — future work.
- **Validation tasks.** SPEC-003, SPEC-004, CONTRACT-005, CONTRACT-011, REG-003/009, SEC-007, EVAL-002.
- **Residual risk.** Trust anchoring moves the problem to who picks the anchors: it is per-buyer policy, it hurts cold-start sellers, and collusion with an anchor defeats it. All three are stated in the limitations.
- **Group:** D5.

## DF-10 — A5's loss direction is reversed in the blueprint

- **Blueprint:** §3 (A5 "seller to draw more than quoted, or the buyer consume more than paid"), §12.2, §13(3).
- **Analysis.** The measured 97.76%→100% leakage is **seller-side**: under `upto` pricing the buyer consumes compute that never settles (V-26). The blueprint's defence (`quotedMax`) addresses the other direction, and that parameter is removed anyway (DF-04).
- **PROPOSED decision.** Evaluate **both directions** and report them separately: (i) seller-side leakage ρ = 1 − settled/delivered, defended by pre-funded exact escrow plus one execution per job (execution only after funds are locked); (ii) buyer-side overcharge, structurally impossible because the seller cannot pull funds and the amount is bound into `resourceHash`. Also report the honest seller-side residual: delivered-but-refunded jobs when validation fails or the validator is down.
- **Validation tasks.** SEC-006, API-010, EVAL-004.
- **Group:** default.

## DF-11 — A1 needs a reorg model, and "blocked" is the wrong claim

- **Blueprint:** §3 (A1), §12.2 ("`release()` never fires"), §12.3 ("✓ blocked").
- **Analysis.** The published attack grants before k confirmations and then a **reorg** removes the payment (V-15). Serving only after `Funded` reduces the window but cannot eliminate it: a reorg deeper than the confirmation policy defeats any k. Base Sepolia's unsafe head can reorg; the `safe` tag is stronger but far slower.
- **PROPOSED decision.** Model reorgs locally with `anvil_reorg` (V-107) and report a table of reorg depth versus confirmation policy, phrased as **"mitigated up to depth k"**. The configuration used is recorded in the run manifest. A1 is EXTENDED-E2.
- **Validation tasks.** SEC-008, SPEC-002 (confirmation policy), EVAL-004.
- **Group:** default.

## DF-12 — Token, admin, payee, nonce and RPC hazards

- **Blueprint:** §9.2, §9.3, §11.3.
- **Analysis and decisions.**
  - **Token allowlist** (USDC plus the mock) set at construction and adjustable only by the owner; `fund()` measures the **balance delta** and rejects fee-on-transfer or rebasing behaviour.
  - **Payee** = `getAgentWallet` else `ownerOf`, **snapshotted at funding**, so transferring the agent NFT afterwards cannot redirect funds (the wallet is cleared on transfer, V-92).
  - **Admin limits:** `Ownable2Step`; the owner may set only bounded floors and the token allowlist; **no admin path can move escrowed funds**, which is an invariant test. Gate floors cannot weaken a buyer's own stricter policy.
  - **Nonce:** payer-scoped, so no one can burn another payer's nonce; a failed `fund()` reverts atomically, leaving the nonce unconsumed; clients **retry with the same nonce** so a pending transaction cannot double-fund.
  - **RPC:** every read is fail-closed — if confirmations cannot be established, the seller does not serve; events are polled, since the public RPC has no WebSocket (V-83).
- **Validation tasks.** CONTRACT-002, CONTRACT-004, CONTRACT-010, CONTRACT-013, CONTRACT-014, API-003, AGENT-004.
- **Group:** default.

## DF-13 — Blueprint code, tests and constants that must not be copied as-is

| Location | Problem | Corrected |
|---|---|---|
| §9.1 hash | Off-chain only; no domain tag; ambiguous URI/body rules | On-chain derivation with a domain tag and a full canonicalisation spec (DF-04, SPEC-001) |
| §9.2 interfaces | `getSummary(agentId)`, `submitFeedback`, `getValidation(jobId)` do not exist (V-95) | Real ERC-8004 ABI, pinned (DF-14) |
| §9.2 `fund` | `quotedMax`; unbounded `ttlSeconds`; payee via `ownerOf` only; no token allowlist | DF-04, DF-22, DF-12 |
| §9.2 `release`/`refund` | Deadline logic inverted; refund ignores attestations | DF-05 |
| §9.4 `test_A3…` | Asserts `NotValidated` for a substitution that the seller should reject at the HTTP layer | Split: seller 409 test (API-003) and validator/attestation test (SEC-013) |
| §9.4 `test_A6…` | Uses a single-attester Sybil, not the five-ring case | Five-ring case under gate v1 and v2 (SEC-007) |
| §9.4 `test_RefundAfterDeadline` | Ignores attestation state | Refund requires deadline + grace and no recorded pass (DF-05) |
| §11.1 | Sequence uses GET while §11.2 serves POST; shows `release()` by the buyer only | Corrected sequence in SPEC-002; release is permissionless and normally called by the validator |
| §11.2 | v1 SDK shape (V-64); hashes the parsed request; notifies the validator after responding | v2 wire format, raw-byte hashing, evidence deposited before the response is released (DF-03, DF-04, DF-08) |
| §11.3 | `base-sepolia`; "Coinbase hosted facilitator"; SDK names | `eip155:84532`; "the x402.org testnet facilitator" (operator unstated); no facilitator on the AgentTrust path (V-62, V-69) |
| §12.2 A4 | "49 revert" | 49 are refused at the claim layer (409/replay), not on-chain (DF-01) |
| §12.2 A5 | `AmountExceedsQuote` | Parameter removed; A5 is evaluated as leakage in both directions (DF-10) |
| §14.1/§14.2 | solc "0.8.24+"; `forge init` at the repo root; `forge install` without a pin | solc 0.8.37, `evm_version=cancun`, Foundry v1.8.3, OZ pinned `@v5.7.0`, project under `impl/contracts` (V-100…V-103) |
| §18 demo | "second call reverts `ReplayedNonce()`" as the A2 defence | Two separate facts: the HTTP replay is refused by the claim; a re-fund attempt reverts `ReplayedNonce` |
| App. B | Flat layout | Layout under `impl/` plus `vectors/`, `evidence/`, `deployments/` (CLAUDE.md §8) |

- **Validation tasks.** CONTRACT-011, API-003, SEC-004/007/013, PRES-003, ENV-001/002/003.
- **Group:** default.

## DF-14 — Registry strategy: real ABI, same-ABI mocks, live registries later

- **Blueprint:** §10.1–§10.3, §15 (Thu 17 Sept "attempt real registries"), §19.
- **Analysis.** The blueprint's "mocks with the same interfaces" is right in spirit, but its interfaces are invented (V-95). Meanwhile the canonical registries are **already deployed on Base Sepolia** (V-97) — unexpected good news — yet they are UUPS proxies owned by a single EOA, the Validation registry is described as unstable, and revert behaviour matters (V-98).
- **PROPOSED decision.**
  - Pin the ABI from `erc-8004-contracts@b9e466c` and commit the ABI JSON plus the deployed addresses (REG-001).
  - Mocks implement **that same ABI**, including the awkward parts: empty-client revert, owner/operator feedback ban, per-client averaging, `agentWallet` cleared on transfer, globally unique `requestHash`, repeatable responses, `lastUpdate` set at request time.
  - **REG-008 (CORE)** checks mock-versus-ABI conformance and compares against the deployed selectors.
  - Live registries are **EXTENDED**: fork tests pinned to a block (REG-005), then optional live registration (REG-007). Deciding to stay on mocks is a legitimate outcome and is stated plainly on the slide, exactly as §10.3 advises.
- **Validation tasks.** REG-001…REG-009.
- **Residual risk.** An upgrade could change live behaviour mid-project; V-139 re-checks on the day of use.
- **Group:** default.

## DF-15 — Validator liveness and the post-deadline overwrite

- **Analysis.** Because responses are repeatable (V-94), an honest validator that re-posts after the deadline would erase a timely pass under a naive rule; a malicious one could flip fail→pass to race a refund.
- **PROPOSED decision.** The validator **reads before writing**, posts **at most one** response per job, **never** responds after the deadline, and calls `release()` immediately after a pass. The escrow's snapshot (DF-05) makes a later overwrite harmless. Restart recovery re-reads chain state and skips jobs that already have a response.
- **Validation tasks.** VAL-004, VAL-005, SEC-009, CONTRACT-011.
- **Group:** default.

## DF-16 — Funds can be stranded by a blocked payee

- **Analysis.** USDC can blacklist or pause. With "no refund once a pass is recorded" (DF-05), a blacklisted payee means `release()` always reverts and `refund()` is forbidden: the funds are stuck.
- **PROPOSED decision.** Accept and **document** the limitation for the project (testnet USDC, short-lived jobs). Pull-payment `withdraw(to)` — credit on release, payee withdraws to an address of its choice — is **STRETCH-008**, and would also reduce transfer-failure risk.
- **Validation tasks.** CONTRACT-014 (a token mock that reverts on transfer), DOC-004.
- **Group:** default.

## DF-17 — Crash semantics and what the metrics actually count

- **Analysis.** A claim in `CLAIMED` with no persisted result after a crash is ambiguous: the response may or may not have reached the buyer.
- **PROPOSED decision.**
  - Persist the result **before** sending bytes. Only `RESULT_STORED`/`SERVED` may send.
  - Re-execution is allowed **only** when no result is stored (lease takeover), and each takeover increments an `aborted_executions` counter.
  - Deterministic fixtures make any re-execution byte-identical, so "distinct results" stays 1.
  - Metrics per payment, all reported: `executions_completed`, `distinct_results`, `http_2xx`, `replays_served`, `aborted_executions`.
  - **A2's headline number is executions per payment**, because that is what "one grant" means (DF-01).
- **Validation tasks.** API-005, SEC-003, EVAL-004.
- **Group:** default (metric definitions are checked under D6).

## DF-18 — Upstream may already be patched, so baselines must be labelled

- **Blueprint:** §12.1 (`targets/vanilla.ts` as "plain x402 endpoint"), §12.3 ("✗ exploited"), §17 Slide 4.
- **Analysis.** The papers reported to Coinbase through HackerOne (V-18), and the current middleware settles before releasing a response (V-65). "Vanilla x402 is exploitable" may therefore be false for pinned upstream 2.26.0 — while remaining true for the published conditions the papers measured.
- **PROPOSED decision.**
  - The default control is a **deliberately vulnerable fixture**, always labelled as "a fixture reproducing the conditions reported in <paper, section>", never as "vanilla x402" or as upstream behaviour.
  - Any claim about upstream requires a run against **pinned `@x402/express@2.26.0`** (API-009, E2); whatever it shows — including "not reproducible" — is reported.
  - Baselines are **never weakened** to obtain a result; every baseline change is recorded in the run manifest and in the results narrative.
- **Validation tasks.** API-008, API-009, API-010, SEC-002/003/004, EVAL-004, SEC-012.
- **Group:** D6.

## DF-19 — Narrative and citation corrections

| Claim (blueprint) | Correction |
|---|---|
| §0.4 "reproducing five published attacks"; §17 Slide 5 "Six published attacks, six blocked" | Inconsistent. Say exactly what was evaluated, with outcomes, and use the coverage denominator (EVAL-005) |
| §17 Slide 2 "Two 2026 papers document eleven vulnerabilities" | The "11 vulnerabilities / five classes" figure belongs to arXiv 2605.11781 alone (V-11) |
| §2.1 "725 transactions in May 2025 → ~50 million by end of 2025" | **UNRESOLVED** (V-22). Do not use it. Use the paper's Dune-sourced 130M with attribution (V-21), or the dated x402.org snapshot (V-74) |
| §2.1 "x402 Foundation — Coinbase and the Linux Foundation, with … Anthropic and Vercel" | Corrected membership: Linux Foundation launch 2026-04-02, operational 2026-07-14; premier members AWS, Circle, Cloudflare, Coinbase, Google, Stripe, Visa; **Anthropic and Vercel are not named** (V-72) |
| §3 attack table (unattributed) | A1/A2/A6 from 2605.11781; A3/A4/A5 from 2605.30998 (V-10…V-28) |
| §3 A2 "248 grants … on a live endpoint" | Strongest round of 1,000 concurrent replays on a **Base Sepolia testnet** endpoint (V-12) |
| §3 A6 "5 Sybil endpoints captured 60.2%" | An LLM discovery-ranking experiment (2,160 decisions), not an escrow gate (V-14). Our A6 uses its own selection model and cannot be compared numerically |
| §3 A5 impact | Seller-side loss, not buyer overcharge (V-26) |
| §7.1 PayCrow "trust score is proprietary, not portable" | PayCrow's score already includes ERC-8004 identity and it has on-chain disputes (V-40) |
| §7.1 Arbitova "LLM-majority-vote" | "AI-arbitrated escrow"; majority vote UNRESOLVED (V-42) |
| §7.1 Vouch | Ambiguous project name (V-44): disambiguate or drop |
| §7.1 (missing) | Add **ERC-8183 Agentic Commerce** (V-49), the official **auth-capture** escrow scheme (V-47) and ASP (V-32) |
| §7.2 "To our knowledge no existing project provides that security evaluation" | Too strong (V-28, V-47, V-49). Use: "Escrow for agent payments exists, and both source papers evaluate their own mitigations. Our contribution is an implementation that binds payment to one canonical request and gates release on an ERC-8004 validation attestation, evaluated against reproductions of the published attacks in a control/treatment harness with the raw data published." |
| §13 targets ("6/6", "AgentTrust = 1", "0%") | Targets are **hypotheses**; report measured values with the denominator and outcome categories |
| §21.1 CV bullet "demonstrated cryptographic mitigation of all six" | Rewrite after results, naming only what was measured (DOC-007) |
| Appendix A "Attestation" | "A signed on-chain claim by the job's chosen validator that a result matching the request was produced and deposited" (DF-08) |

- **Validation tasks.** DOC-001/004/005/007, PRES-001/002, SEC-012.
- **Group:** D6.

## DF-20 — WSL DrvFs performance and SQLite locking

- **Analysis.** The workspace is on `/mnt/d` (DrvFs). Node installs are slow, and POSIX file locking was **assumed** unreliable — which would be fatal for a claim store whose whole purpose is atomicity.
- **Measured on this machine (ENV-002, 2026-09-23).** SQLite WAL with `BEGIN IMMEDIATE` behaves correctly on `/mnt/d`: the second writer is blocked, exactly as on ext4. **The locking failure did not reproduce.** Small-file writes, however, are about **38× slower** (300 files: 0.487 s on `/mnt/d` vs 0.013 s on ext4).
- **PROPOSED decision (revised after measurement).** Keep the repository on `/mnt/d`. `CLAIMS_DB_PATH` still defaults to a Linux-filesystem location (`$HOME/.local/state/agenttrust/`) for **speed** under concurrent claims, but the seller only **warns** when the path is under `/mnt/` instead of refusing to start — a hard refusal is not justified by evidence. Trigger to move the whole repository to ext4: `pnpm install` exceeding 5 minutes, or any concurrency test failing in a way that points at the filesystem.
- **Validation tasks.** ENV-002, ENV-004, API-005.
- **Group:** default.

## DF-21 — The feedback loop was never specified

- **Blueprint:** §5.1(8), §11.1 (`submitFeedback(sellerAgentId, jobId)`), §1.
- **Analysis.** `submitFeedback` does not exist; the real call is `giveFeedback(...)` by any client except the agent's owner or operators, with no proof of interaction, revocable by the giver (V-93). Routing feedback through the escrow would make every entry come from one address, which either counts for nothing under a trusted-client filter or collapses "distinct attesters" to one while letting Sybils farm reputation through the escrow.
- **PROPOSED decision.**
  - **The buyer writes feedback directly** after release or refund: tag `agenttrust`, value in basis points with `valueDecimals = 2`, `feedbackHash` committing to the job, `feedbackURI` pointing at the job evidence. No escrow-routed feedback.
  - The escrow keeps only what it needs for the gate; authenticity is established by the buyer being a trusted client of whoever reads the score, and by the job reference in the feedback.
  - Duplicates and revocations are handled by per-client averaging inside `getSummary`; fabricated feedback from untrusted addresses is filtered by the gate (DF-09).
  - **Seed fixtures** create labelled honest-seller reputation for the demo and gate tests (REG-009).
- **Validation tasks.** SPEC-004, AGENT-003, REG-003/009, SEC-007.
- **Residual risk.** Feedback still proves nothing about a real transaction to an outside reader; only the trusted-client filter does.
- **Group:** D5.

## DF-22 — `ttlSeconds` is unbounded, which lets a buyer take service for free

- **Blueprint:** §9.2 `fund(..., uint64 ttlSeconds)`.
- **Analysis.** A buyer can pass a very small TTL, get served, and then refund because no attestation could possibly land in time. A huge TTL locks the buyer's funds instead.
- **PROPOSED decision.** Enforce `MIN_TTL ≤ ttlSeconds ≤ MAX_TTL` on-chain (owner-adjustable within hard bounds), and have the seller additionally require a **deadline margin** of at least (expected validation time + `GRACE`) before it serves. PROPOSED defaults, fixed in SPEC-003: `MIN_TTL` 10 min, `MAX_TTL` 24 h, `GRACE` 15 min.
- **Validation tasks.** SPEC-003, CONTRACT-004, CONTRACT-010, CONTRACT-011, API-003.
- **Group:** D4.

## DF-23 — The confirmation policy must be an explicit choice

- **Analysis.** On an OP-stack chain, k confirmations on the unsafe head is fast but reorg-exposed; the `safe` tag waits for L1 inclusion (minutes); `finalized` is far slower. The blueprint says "only after the Funded state is confirmed" without defining it, and latency is a reported metric (§13).
- **PROPOSED decision.** `CONFIRMATIONS` is configurable. Defaults: **1** on local Anvil, **3** on testnet (matching the paper's k≥3 guidance for sub-$1 resources, V-17), with the `safe` tag as a documented stronger option. The choice appears in the run manifest, in the latency results and in the A1 table (DF-11).
- **Validation tasks.** SPEC-002, API-003, SEC-008, EVAL-003/006.
- **Group:** default.

## DF-24 — Whether LangGraph and LiteLLM are needed at all

- **Blueprint:** §8.1, §14.1, §15 (Sat 12 Sept).
- **Analysis.** No security property depends on an LLM. Reproducible measurement actively requires a **deterministic** buyer. The blueprint's stack is also mismatched: the official LiteLLM is Python-only, so a TypeScript LangGraph.js buyer would need a LiteLLM proxy to reach it (V-108).
- **PROPOSED decision.** The deterministic buyer is the measured system. A thin LangGraph.js layer that calls the same buyer operations as tools, through a LiteLLM proxy, is **EXTENDED-E2 (AGENT-005)**, used only for demo narration, never for measurements, and requires an API key the user must supply. If it is not built, the limitation is stated; the blueprint requirement is therefore **deferred, not dropped**.
- **Validation tasks.** AGENT-005, DOC-004.
- **Group:** default.
