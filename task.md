# task.md — AgentTrust execution plan and progress tracker

**This file is the plan of record.** `CLAUDE.md` holds the rules; this holds the work and its state. Supporting documents: `docs/planning/` (requirements-register · blueprint-coverage · verification-log · design-findings · evaluation-plan · skills-inventory).

- **Statuses:** `TODO` · `IN_PROGRESS` · `BLOCKED` · `DONE` · `DEFERRED`. `[x]` is used only for DONE.
- **Tiers:** `CORE-P0` (committed floor) · `CORE-P1` · `EXTENDED-E1` · `EXTENDED-E2` · `STRETCH` (parked, status DEFERRED).
- **Authorized:** every implementation task starts `Authorized: no`. Plan approval is **not** implementation authorization; the user authorizes tasks individually or as a named batch (logged in §14).
- **Hats:** A contracts · B registry/trust/validator · C agents/integration · D security/evaluation/narrative · **U** the single implementer (wears A–D) · **TM** teammates.
- **Dates:** planning completed Tue 22 Sep 2026. Target submission Tue 29 Sep 2026 (unconfirmed — ADMIN-001).

---

## 1. Objective and success criteria

**Objective.** Build and evidence a reputation-gated, validation-triggered escrow that binds an agent-to-agent payment to one canonical HTTP request, and measure it against reproductions of published x402 attacks using a control/treatment harness whose raw data is published.

**Must-have success criteria (the project is a success if all of these hold):**

| # | Criterion | Verified by |
|---|---|---|
| S1 | The escrow implements the corrected design (on-chain resource binding, trust-anchored gate, bind-once validation, snapshot + grace settlement, TTL bounds) and `forge test` is green, including deadline/grace/TTL boundary tests and a funds-conservation invariant | CONTRACT-011, CONTRACT-013 |
| S2 | One canonical-hash specification, with shared vectors passing in Solidity, TypeScript **and** Python | SPEC-001, VAL-003, CONTRACT-011 |
| S3 | A funded job is served **exactly once** to the authenticated payer, end to end locally, with release on attestation and refund after deadline + grace | INT-001, INT-002, API-005 |
| S4 | **A2 and A3** evaluated against both a labelled fixture and AgentTrust, ≥10 runs each, with `results.json`, a results table and an explicit coverage denominator | SEC-003, SEC-004, EVAL-004, EVAL-005 |
| S5 | Contracts deployed **and verified** on Base Sepolia, with address and explorer link recorded — or, if funds never arrive, a documented local-only demo stating that plainly | DEPLOY-001…003 |
| S6 | README, limitations, verified references, and a local demo reproducible from a clean clone | DOC-001, DOC-004, DOC-005 |
| S7 | 45-second demo video and a five-slide deck rehearsed to ≤ 3:00, submitted per ADMIN-002/005 | PRES-003, PRES-004, PRES-005 |

**Nice-to-have (only after the gates):** A4, A6, A5, A1; pinned-upstream baseline; live ERC-8004 registries; dashboard; LangGraph buyer; CI; signed quote; latency study.

**Explicit non-goals:** mainnet or real funds; attacks on third-party endpoints; validator collusion resistance; judging content quality beyond deterministic fixtures; legal enforceability; fiat rails; MEV; request/response privacy.

---

## 2. Current status and planning decisions

**Status (2026-09-23, 08:30):** **gate G1 reached a day early.** **29 of 134 tasks DONE** — planning (PLAN-001…006, 008), foundation (ENV-001…005, ENV-013), specs (SPEC-001), the ERC-8004 registry layer (REG-001…004, REG-008) and the **complete escrow** (CONTRACT-001/002/004/005/007/008/010/011/013/017).

Local suite: **154 Solidity tests + 45 TypeScript tests**, all green; 6 invariants at 256 runs × depth 500; **97.55% line coverage** on `AgentTrustEscrow.sol`; the pinned ABI matches the deployed Base Sepolia registries (65/65 selectors).

**Nothing is deployed to a public chain and nothing has been measured.** No transaction has been sent to Base Sepolia, no wallet funded, no attack run. Every number above is a local test or a read-only chain query. The escrow deploys and smoke-checks on a local Anvil (`impl/scripts/deploy.sh local`).

The §6 security review of the payment path found a **HIGH** — `refund()` was fail-open on a validation read that ran out of gas, and a job holding a genuine passing attestation could be refunded to the buyer. It was reproduced, fixed and pinned by tests, along with eight further findings (§14).

Next on the critical path is the seller service: **API-001…005** and **AGENT-001**, toward gate **G2 on Fri 25 Sep 23:59**.

Still blocking: **PLAN-007** sign-off on D1–D6 (defaults apply meanwhile), and **ENV-006/007** wallets and faucet ETH — the seller and validator need ETH as well as the deployer, or DEPLOY-001…003 cannot run.

**Decisions the user already made**

| # | Decision |
|---|---|
| U1 | Target Tue 29 Sep 2026, unconfirmed; ADMIN-001 confirms |
| U2 | One implementer with Claude; teammates cover admin, faucets, references, deck, submission, rehearsal |
| U3 | Validator in Python FastAPI, with an independent canonical-hash implementation |
| U4 | LangGraph + LiteLLM buyer is EXTENDED-E2, demo only; measurements always use the deterministic buyer |
| U5 | Git root = workspace root; repository private until the DOC-009 pre-publication review |
| U6 | Skills: vendored superpowers subset without the session hook; Trail of Bits ×4, Cyfrin `solidity`, Context7 at project scope; OpenZeppelin skills and pr-review-toolkit skipped |

**Decisions awaiting sign-off (PLAN-007, by Wed 23 Sep 12:00).** Defaults in `design-findings.md` apply unless the user objects.

| ID | Decision | Findings | Gates work |
|---|---|---|---|
| D1 | x402 v2 wire format with the project scheme `agenttrust-escrow`; no stock middleware on escrowed routes; honest interoperability wording | DF-03 | SPEC-002, API-002 |
| D2 | "One grant" = one execution per funded job; payer-signed retry; atomic claim keyed by (chainId, escrow, jobId) | DF-01, DF-02 | SPEC-002, API-004/005 |
| D3 | `resourceHash` computed on-chain over the canonical fields plus amount/token/chain; `quotedMax` removed; EIP-712 signed quote deferred to E1 | DF-04 | SPEC-001, CONTRACT-004 |
| D4 | Bind-once `requestHash`; snapshot of the first timely pass; refund only after deadline + grace; no early refund on "fail"; on-chain TTL bounds | DF-05, DF-06, DF-22 | SPEC-003, CONTRACT-007/008/010 |
| D5 | Trust-anchored reputation gate; blueprint gate kept only as a mock-only comparison; buyer-direct feedback | DF-09, DF-21 | SPEC-003/004, CONTRACT-005 |
| D6 | Labelled vulnerable baselines; upstream claims need a pinned-upstream run; narrative and novelty claims narrowed | DF-18, DF-19 | API-008, SEC-002/003/004, PRES-001 |

**Relationship to the blueprint.** It remains the scope baseline. Its registry interfaces, x402 SDK usage, settlement timing, Sybil gate, quote binding, A2/A4 test layers, several cited figures and its schedule are corrected — each with a DF entry and a task, none dropped silently (`blueprint-coverage.md`).

---

## 3. Scope tiers

| Tier | Contents | Effort |
|---|---|---|
| **CORE-P0** (≈46 h) | Contracts + same-ABI mocks + tests; canonical hash + cross-language vectors; seller with payer-authenticated delivery and atomic claim; deterministic buyer; FastAPI validator; local happy + refund E2E; **A2 + A3** vs labelled fixtures; Base Sepolia deploy + verification; README, limitations, results, demo video, deck, rehearsal | ≈46 h |
| **CORE-P1** | Feedback lifecycle + posting; validator evidence store + payer retrieval; seed reputation fixtures; gas snapshot; threat-model doc; claims audit; A3 seller-side | ≈5 h |
| **EXTENDED-E1** | EIP-712 signed quote; CI; fuzz/invariant breadth; adversarial suite; static analysis; restart journal; recovery drills; full testnet E2E; architecture doc; reproduction guide; ADRs; claim lease/crash tests | ≈12 h |
| **EXTENDED-E2** | A4, A6, A5, A1; derived scenarios; pinned-upstream baseline; live registries; latency study; dashboard; LangGraph/LiteLLM; docker-compose; LSP binaries; skill follow-ups | — |
| **STRETCH** | Kafka, Kubernetes, Keycloak, staking/slashing, k-of-n validators, gasless funding, optimistic release, pull-payment, attack console | — |

Tier order is binding: **no E1 before G2, no E2 before G3.** Each gate's cut list (§11) removes P1 first, then simplifies P0.

---

## 4. Skill preparation status

Installed and verified 2026-09-22 (details: `docs/planning/skills-inventory.md`; facts V-120…V-124).

| Package | Scope | Version / SHA | Hooks / MCP |
|---|---|---|---|
| building-secure-contracts@trailofbits | project | 1.2.2 @ 32e34f81 | none |
| entry-point-analyzer@trailofbits | project | 1.0.4 @ 32e34f81 | none |
| spec-to-code-compliance@trailofbits | project | 2.0.2 @ 32e34f81 | none |
| differential-review@trailofbits | project | 1.1.4 @ 32e34f81 | none |
| solidity@solskill | project | @ d17bda02 | none |
| context7@claude-plugins-official | project | @ c447c32 | 1 remote MCP |
| superpowers subset (7 skills) | vendored `.claude/skills/` | @ b36e0829 | none (hook deliberately excluded) |

All 27 vendored files hash-match upstream. Gaps with documented fallbacks: Foundry invariants, API/integration testing, docs/ADRs, CI, LSP binaries. Follow-ups: SKILL-001…003, ENV-010 (both E2).

---

## 5. Requirement traceability

Full register: `docs/planning/requirements-register.md` (102 requirements; every one maps to ≥1 task, with a reverse index). Section-by-section disposition of the blueprint: `docs/planning/blueprint-coverage.md`.

| Class | Count | P0 coverage |
|---|---|---|
| FR functional | 28 | 21 |
| SR security/trust | 15 | 13 |
| IR integration | 8 | 7 |
| ER evaluation | 10 | 7 |
| OR operational | 13 | 7 |
| AR academic/presentation | 20 | 13 (rest MANUAL) |
| OPT optional | 8 | 0 (E2/STRETCH by design) |

Requirements with no P0 task are deliberate and listed at the end of the register.

---

## 6. Architecture and interface decisions

Decisions and their rationale: `docs/planning/design-findings.md`. Parameter values marked **PROPOSED** are fixed in SPEC-001/002/003.

### 6.1 Escrow surface

| Function | Caller | Preconditions | Effect | Events / errors |
|---|---|---|---|---|
| `fund(payeeAgentId, token, amount, methodHash, uriHash, bodyHash, nonce, ttlSeconds, validator, gatePolicy)` | buyer | token allowlisted; amount > 0; TTL within bounds; nonce unused for this payer; gate passes; validator acceptable (not the agent's owner/operator, not the payer) | derives `resourceHash` and `jobId`; snapshots payee and validator; burns the nonce; pulls tokens and checks the balance delta; state → Funded | `JobFunded` · `ZeroAmount`, `TokenNotAllowed`, `TtlOutOfBounds`, `ReplayedNonce`, `JobAlreadyExists`, `ReputationTooLow`, `InvalidValidator`, `TransferAmountMismatch` |
| `bindValidation(jobId, salt)` | payee | state Funded; nothing bound yet; registry entry for the derived hash has `agentId == job.payeeAgentId` and `validator == job.validator` | stores `requestHash` | `ValidationBound` · `NotPayee`, `AlreadyBound`, `RequestMismatch` |
| `confirmValidation(jobId)` | anyone | bound; registry shows a pass with `lastUpdate ≤ deadline` | snapshots the pass into the job | `ValidationRecorded` · `NotValidated` |
| `release(jobId)` | anyone | state Funded; a recorded pass, or one recordable now | state → Released; transfers to the snapshotted payee | `JobReleased` · `BadState`, `NotValidated` |
| `refund(jobId)` | anyone | state Funded; `now > deadline + GRACE`; no recorded pass and none recordable | state → Refunded; transfers to the payer | `JobRefunded` · `BadState`, `DeadlineNotReached`, `ValidationExists` |
| `setGateFloors`, `setTokenAllowed`, `setTtlBounds`, `setGrace` | owner (`Ownable2Step`) | bounded ranges | configuration only | `GatesUpdated`, `TokenAllowed`, … |
| views | anyone | — | `jobs(jobId)`, `consumedNonce(payer,nonce)`, `previewResourceHash(...)`, `previewJobId(...)` | — |

**No administrative function can move escrowed funds** — an invariant test (CONTRACT-013).

### 6.2 Derivations (authoritative text in SPEC-001, with shared vectors)

```
resourceHash = keccak256(abi.encode(
    RESOURCE_TYPEHASH, methodHash, uriHash, bodyHash, amount, token, block.chainid))
jobId        = keccak256(abi.encode(
    JOB_TYPEHASH, block.chainid, address(this), payer, payee, resourceHash, nonce))
requestHash  = keccak256(abi.encode(
    VALIDATION_TYPEHASH, block.chainid, address(this), jobId, resourceHash, salt))
```

`methodHash = keccak256(bytes(METHOD))` uppercase; `uriHash = keccak256(bytes(canonicalUri))` built from the seller's **configured origin** (never the `Host` header) with normalised scheme/host/port, percent-encoding and sorted query parameters; `bodyHash = keccak256(rawBodyBytes)` captured before parsing. Amounts are atomic units (USDC has 6 decimals, V-81).

EIP-712 domain for off-chain messages: `{name: "AgentTrust", version: "1", chainId, verifyingContract: escrow}`; structs `DeliveryRequest`, `DeliveryReceipt`, `EvidenceAccess` — **defined with their digest vectors in SPEC-001**, carried on the wire per SPEC-002. `DeliveryReceipt` includes the seller's **`salt`**, so the validator can derive `requestHash` itself.

### 6.3 State machine

`None → Funded → Released | Refunded`, plus a `validationRecorded` flag and a bound `requestHash` inside the Funded state. Every transition is guarded and emits an event; a job leaves Funded exactly once (invariant).

**Job fields:** payer · payee (snapshot) · payeeAgentId · validator · token · amount · resourceHash · requestHash · deadline · state · validationRecorded · fundedAt.

### 6.4 ERC-8004 usage (pinned ABI, REG-001)

| Call | Who | When |
|---|---|---|
| `getAgentWallet` / `ownerOf` | escrow | at `fund()`, to snapshot the payee |
| `getSummary(agentId, trustedClients, "agenttrust", "")` | escrow | at `fund()`, per trusted client, bounded list |
| `isAuthorizedOrOwner` | escrow | at `fund()`, to reject a validator tied to the agent |
| `validationRequest(validator, agentId, requestURI, requestHash)` | **seller** (owner/operator) | after the result is deposited |
| `validationResponse(requestHash, 0–100, responseURI, responseHash, "agenttrust")` | **validator** | once, before the deadline |
| `getValidationStatus(requestHash)` | escrow, validator | at bind, confirm, release, refund |
| `giveFeedback(agentId, value, 2, "agenttrust", …)` | **buyer** | after release or refund |

Registry reads are wrapped so a revert ("unknown", "clientAddresses required") is treated as "no data" (V-98).

### 6.5 HTTP protocol (SPEC-002)

- **402** carries `PAYMENT-REQUIRED` (base64 JSON) in x402 v2 shape: `scheme: "agenttrust-escrow"`, `network: "eip155:84532"`, `asset`, `amount` (atomic), `payTo`, `maxTimeoutSeconds`, `extra: {escrow, sellerAgentId, acceptedValidators[], minDeadlineMargin, quoteId, expiry, canonicalVersion}`.
- **Retry** carries `PAYMENT-SIGNATURE` (base64 JSON): `{jobId, fundTxHash, signature}` over `DeliveryRequest{jobId, resourceHash, sellerOrigin, expiry, clientNonce}`.
- **Success** returns the resource plus `PAYMENT-RESPONSE` `{jobId, executed|replayed, responseHash, evidenceId}` and `Cache-Control: no-store`.
- **Errors:** 402 missing/invalid payment · 403 signature not from the payer · 409 `resource_mismatch` / `already_delivered` / `claim_in_progress` · 425 not enough confirmations · 410 deadline margin too small · 503 chain unreachable (fail closed).

### 6.6 Claim store (API-005)

Key `(chainId, escrow, jobId)`. States `CLAIMED → RESULT_STORED → SERVED`, with `FAILED → CLAIMED` retry (bounded) and `FAILED_FINAL`. Bytes may only be sent from `RESULT_STORED`/`SERVED`; the result is persisted before any bytes go out; lease takeover only when no result exists. Metrics per job: `executions_completed`, `distinct_results`, `http_2xx`, `replays_served`, `aborted_executions`.

### 6.7 Validator (VAL-*)

`POST /evidence` (seller-signed `DeliveryReceipt`, including the salt, + response bytes) → verify the signature, re-derive the canonical hash **in Python**, check the on-chain job, recompute the deterministic fixture output. The validator then derives `requestHash` from the salt and **waits until the escrow reports that exact hash bound to the job** (`jobs(jobId).requestHash`) before posting one `validationResponse` and calling `release()`. If the binding never appears before the deadline it posts nothing and logs the reason, and the job refunds. `GET /evidence/{jobId}` (payer-signed `EvidenceAccess`) returns the stored bytes — **P1 (VAL-006)**; until it exists, the delivery claim uses the narrower wording (DF-08).

### 6.8 PROPOSED parameter defaults

`MIN_TTL` 10 min · `MAX_TTL` 24 h · `GRACE` 15 min · pass threshold `response ≥ 100` · `maxTrustedClients` 10 · gate floors: `minDistinctTrusted ≥ 1` · `CONFIRMATIONS` 1 local / 3 testnet · `MAX_EXEC_ATTEMPTS` 3 · `REPLAY_POLICY` idempotent.

### 6.9 Results data

`results.json` + run manifest schema: `docs/planning/evaluation-plan.md` §7. No measured number is ever typed by hand into docs or slides.

---

## 7. Dependencies and critical path

**Headline path — the A2/A3 evidence:**
`ENV-001/002/003 → SPEC-001 → SPEC-002 → REG-001…004 + REG-008 → CONTRACT-001/002 → CONTRACT-004/005 → CONTRACT-017 → ENV-004 (seeding half) + ENV-005/013 → AGENT-001 → API-001…005 → API-008 → AGENT-002 → SEC-002 → SEC-003 + SEC-004 → EVAL-004/005 → PRES-003 → PRES-002 → PRES-004 → ADMIN-005`

**ENV-004 splits in two:** the chain-up half (deterministic accounts, block time) needs only ENV-002 and runs Wednesday morning; the seeding half (deploy mocks, MockUSDC and the escrow, write `deployments/local.json`) depends on CONTRACT-002/017 and REG-002…004.

**Settlement path (needed for the working demo, runs alongside):**
`SPEC-003 → CONTRACT-007/008/010 → CONTRACT-011/013 → API-006 → VAL-001…004 → AGENT-003 → INT-001/002`

**Deployment path (needs faucet funds):** `CONTRACT-017 → DEPLOY-001 → DEPLOY-002 → DEPLOY-003`

**Start immediately (not implementation):** ENV-006 wallets (U, offline), ENV-007 faucets (TM), ADMIN-001…003, PRES-001 outline.

**Most likely to overrun:** API-003, API-005, INT-001 — first candidates for simplification under the G2 cut rule.

---

## 8. Phases and tasks

Legend per task: `Status · Authorized · Tier · Est · Hat/agent`. Hats: U = implementer (wearing A–D), TM = teammates. Agents are the dev-assistant roles from CLAUDE.md §6.

### Phase 0 — Planning governance (PLAN)

### PLAN-001 — Read the blueprint; extract and classify requirements

- [x] **Status:** DONE · **Authorized:** n/a · **Tier:** CORE-P0 · **Est:** — · **Hat/agent:** U(D) · lead
- **Objective:** Read all 1,078 lines and turn them into a classified requirement register with dispositions.
- **Refs:** whole blueprint · all REQ IDs
- **Evidence:** `docs/planning/requirements-register.md` (102 requirements), `docs/planning/blueprint-coverage.md` (81 headings, 18 tables, 11 code blocks, 10 checklist items, 4 reference groups, front matter, footer — all dispositioned).

### PLAN-002 — Verify planning-critical external facts

- [x] **Status:** DONE · **Authorized:** n/a · **Tier:** CORE-P0 · **Est:** — · **Hat/agent:** U(D) · lead
- **Objective:** Check every fact the plan depends on, and record source, method, status and impact.
- **Evidence:** `docs/planning/verification-log.md`, V-01…V-139, including live read-only `eth_call`/`eth_getCode` against Base Sepolia, `npm view`, `gh api` and the papers' full texts. Contradicted items: V-22, V-64, V-71, V-72, V-95, V-99, V-01.

### PLAN-003 — Prepare vetted project-local skills

- [x] **Status:** DONE · **Authorized:** yes (planning session) · **Tier:** CORE-P0 · **Est:** — · **Hat/agent:** U · skills-workflow
- **Objective:** Inspect, then install only justified skills at project scope, with no hooks and no unnecessary privileges.
- **Evidence:** six plugins enabled at project scope (`claude plugin list --json`); 27 superpowers files vendored at `b36e0829`, every `git hash-object` matching; `.claude/settings.json` contains only `enabledPlugins` + `extraKnownMarketplaces`; rejected candidates recorded with reasons in `docs/planning/skills-inventory.md`.

### PLAN-004 — Write CLAUDE.md

- [x] **Status:** DONE · **Authorized:** n/a · **Tier:** CORE-P0 · **Est:** — · **Hat/agent:** U · lead
- **Evidence:** `CLAUDE.md` — precedence, planning-only phase with an explicit prohibition, scope tiers, corrected architecture, agent roles and collaboration rules, skills map, version policy, per-language standards, secrets/testnet rules, evidence standards, the 8-step workflow with per-task authorization and stop-at-gate, session resumption, environment notes.

### PLAN-005 — Write task.md and the supporting planning documents

- [x] **Status:** DONE · **Authorized:** n/a · **Tier:** CORE-P0 · **Est:** — · **Hat/agent:** U · lead
- **Evidence:** this file plus `design-findings.md` (DF-01…DF-24), `evaluation-plan.md`, `requirements-register.md`, `blueprint-coverage.md`, `verification-log.md`, `skills-inventory.md`.

### PLAN-006 — Specialist review of the merged plan

- [x] **Status:** DONE · **Authorized:** n/a · **Tier:** CORE-P0 · **Est:** — · **Hat/agent:** U · all agents
- **Evidence:** §14 lists every finding raised and how it was resolved, including the Plan-agent critique that corrected the effort arithmetic, the settlement rules and the critical-path order, and the adjudications recorded for the agents-backend draft.

### PLAN-007 — User sign-off on the six blocking decisions (D1–D6)

- [ ] **Status:** TODO · **Authorized:** n/a (user action) · **Tier:** CORE-P0 · **Est:** 0.25 h · **Hat/agent:** U + TM
- **Objective:** Accept, amend or reject D1–D6 before the code they govern is written.
- **Refs:** §2 · DF-01…DF-06, DF-09, DF-18, DF-19, DF-21, DF-22
- **Depends:** —
- **Steps:** 1) Read §2 and the six DF entries. 2) Record accept/amend per decision. 3) If amended, update the DF and the affected tasks before starting them.
- **Acceptance:** each of D1–D6 has an explicit outcome recorded in §14; any amendment is reflected in the DF and in the dependent task entries.
- **Verify:** §14 shows six outcomes with a date. **Deadline:** Wed 23 Sep 12:00, else defaults apply and that fact is logged.
- **Risks:** silence blocks nothing (defaults apply), but a late reversal invalidates work already done — hence the deadline.

### PLAN-008 — Final consistency checks of the planning package

- [x] **Status:** DONE · **Authorized:** n/a · **Tier:** CORE-P0 · **Est:** — · **Hat/agent:** U · lead
- **Evidence:** checks recorded in §14: file presence, no product code outside `.claude/`, status vocabulary, `[x]` only on DONE, ID integrity, requirement coverage, attack coverage, skills state.

### PLAN-009 — Maintain the authorization log and stopping points

- [ ] **Status:** TODO · **Authorized:** n/a (process) · **Tier:** CORE-P0 · **Est:** ongoing · **Hat/agent:** U · lead
- **Objective:** Record every authorization the user grants, and stop at each gate by default.
- **Refs:** CLAUDE.md §3, §13 · §11, §14
- **Steps:** 1) Before starting a task, confirm it is authorized. 2) Append to the §14 authorization log: date, scope, who granted it. 3) At each gate, stop and report.
- **Acceptance:** no task is ever marked IN_PROGRESS without a matching log line.
- **Verify:** the log in §14 covers every DONE implementation task.

### Phase 1 — Academic admin (ADMIN; manual, no implementer coding hours)

### ADMIN-001 — Confirm the deadline and presentation date

- [ ] **Status:** TODO · **Authorized:** n/a · **Tier:** CORE-P0 · **Est:** 0.25 h · **Hat/agent:** TM
- **Objective:** Get the real submission deadline and the presentation date from the module coordinator.
- **Refs:** §0.3 · AR-03 · V-01 (31/09/2026 does not exist)
- **Steps:** 1) Email/ask the coordinator, quoting the PDF's date. 2) Ask whether the presentation is on the submission date. 3) Record both in §13 and adjust §11 if earlier.
- **Acceptance:** a confirmed date is recorded, or "no answer by Thu 24" is recorded and the 29 Sep plan stands.
- **Risks:** an earlier date collapses the schedule → freeze to P0 immediately and record the demo right after G3a (R-09).

### ADMIN-002 — Confirm the group number and required file format

- [ ] **Status:** TODO · **Authorized:** n/a · **Tier:** CORE-P0 · **Est:** 0.1 h · **Hat/agent:** TM
- **Objective:** Resolve `GP_XX` and whether `.ppt` or `.pptx` is required.
- **Refs:** §0.2 · AR-02 · V-03
- **Acceptance:** the exact filename is recorded in §13 and used by PRES-002/005.
- **Risks:** `.ppt` (legacy binary) may need an export step from the generated `.pptx` — PRES-002 covers it.

### ADMIN-003 — Register the topic in the class sheet

- [ ] **Status:** TODO · **Authorized:** n/a · **Tier:** CORE-P0 · **Est:** 0.1 h · **Hat/agent:** TM
- **Objective:** Register early to avoid a topic clash, using the §0.1 wording.
- **Refs:** §0.1 · AR-01 · R-13
- **Acceptance:** the sheet shows the entry; a screenshot is filed under `evidence/ADMIN-003/`.

### ADMIN-004 — Create the GitHub repository

- [ ] **Status:** TODO · **Authorized:** n/a (user action) · **Tier:** CORE-P0 · **Est:** 0.25 h · **Hat/agent:** U
- **Objective:** Create the remote repository, **private**, and add it as `origin`.
- **Refs:** §16 · AR-08, OR-10 · U5
- **Depends:** ENV-002
- **Steps:** 1) `gh repo create <name> --private`. 2) Add the remote, push the initial commit. 3) Publication scope is decided later by DOC-009.
- **Acceptance:** the repository exists, is private, and contains the initial commit with no secrets.
- **Risks:** accidental early publication of the blueprint's personal notes → keep private until DOC-009.

### ADMIN-005 — Submit the deck to ELMS

- [ ] **Status:** TODO · **Authorized:** n/a · **Tier:** CORE-P0 · **Est:** 0.25 h · **Hat/agent:** TM
- **Refs:** §0.2, §16 · AR-02 · Depends: PRES-002, PRES-005, ADMIN-002
- **Acceptance:** one submission per group, correctly named, before the confirmed deadline; a confirmation screenshot is filed.

### Phase 2 — Foundation (ENV)

### ENV-001 — Pin toolchain and library versions

- [x] **Status:** DONE · **Authorized:** yes (2026-09-23) · **Tier:** CORE-P0 · **Est:** 0.5 h · **Hat/agent:** U(A) · delivery-completeness
- **Objective:** Record exact versions for every tool and library, so nothing floats. **Documentation only — no installs.**
- **Refs:** §14.1, §22 · IR-01/03/07, OR-08 · V-63, V-81, V-100…V-108
- **Skill:** Context7 for current docs / fallback: the verification log
- **Depends:** —
- **Steps:** 1) Write `docs/specs/versions.md`: Foundry v1.8.3, solc 0.8.37, `evm_version = cancun`, OZ v5.7.0, Node 22.17, pnpm 9.15, Python 3.12, uv, viem 2.56.8, express 5.2.1, vitest, `@x402/*` 2.26.0 (baseline only), ERC-8004 ABI @ `b9e466c`, Slither 0.11.6, Aderyn 0.6.8. 2) Note each version's V-ID and re-check date. 3) Record chain facts: chainId 84532, USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e` (6 dp, EIP-712 name "USDC" v"2"), registry addresses, explorers, RPC (HTTP-only).
- **Files:** `docs/specs/versions.md`
- **Acceptance:** every dependency the plan names appears with an exact version and a V-ID; no floating specifier (`latest`, `^`, `~`) on any dependency pin. *Refinement during execution:* Solidity `pragma ^0.8.x` is allowed because solc is pinned to 0.8.37 separately, so the check excludes pragma lines.
- **Verify:** `grep -nE '(latest|[~^][0-9])' docs/specs/versions.md | grep -viE 'pragma'` → only the rule sentence → `evidence/ENV-001/acceptance.txt`
- **Risks:** a version moves mid-project → the pin file is the single place to change, and dependent acceptance checks re-run.

### ENV-002 — Private git init, ignore rules, layout, secret scan

- [x] **Status:** DONE · **Authorized:** yes (2026-09-23) · **Tier:** CORE-P0 · **Est:** 0.5 h · **Hat/agent:** U(C) · delivery-completeness
- **Objective:** Turn the workspace into a private repository with the agreed layout and a pre-commit secret check.
- **Refs:** App. B · OR-10, SR-13 · DF-20 · U5
- **Depends:** ENV-001
- **Steps:** 1) `git init`; default branch `main`. 2) `.gitignore`: `.env*`, `node_modules/`, `out/`, `cache/`, `broadcast/`, `*.key`, `keystore/`, `__pycache__/`, `.venv/`, `impl/attacks/results/**/raw/`. 3) Create the directory skeleton (CLAUDE.md §8) with `.gitkeep` files only. 4) Add a pre-commit hook that greps for private-key and mnemonic patterns and blocks the commit. 5) First commit: planning docs + CLAUDE.md + task.md + `.claude/`. 6) Decide whether `/mnt/d` is workable (DF-20 trigger).
- **Files:** `.gitignore`, `.githooks/pre-commit`, directory skeleton
- **Acceptance:** `git status` clean after the first commit; the hook blocks a test commit containing a fake `0x`-64-hex key; no `.env` is tracked.
- **Verify:** the hook rejects a staged dummy secret (exit 1) → `evidence/ENV-002/acceptance.txt`; commit `6295e71`, 51 files
- **Risks:** DrvFs slowness/locking → if `pnpm install` later exceeds 5 min or lock tests fail, move to ext4 and re-clone (R-06).

### ENV-003 — Install Foundry and OpenZeppelin (pinned)

- [x] **Status:** DONE · **Authorized:** yes (2026-09-23) · **Tier:** CORE-P0 · **Est:** 0.5 h · **Hat/agent:** U(A) · contracts-protocol
- **Objective:** Make `forge`, `anvil` and `cast` available at the pinned version, with OZ vendored as a pinned submodule.
- **Refs:** §14.2 · IR-07 · V-101, V-109
- **Depends:** ENV-001, ENV-002
- **Steps:** 1) `curl -L https://foundry.paradigm.xyz | bash` then `foundryup --install v1.8.3`. 2) `forge init impl/contracts --no-git` (project lives under `impl/`, not the repo root); delete the `Counter.*` template files. 3) Install dependencies **vendored, not as submodules** — `bash impl/scripts/install-deps.sh` (pinned OZ v5.7.0, forge-std v1.16.2). 4) Record `forge --version` and the dependency commits. *Refinement during execution:* the submodule route registered a path relative to `impl/contracts` in the root `.gitmodules` and checked nothing out, so `lib/` is git-ignored and re-created by the script.
- **Acceptance:** `forge --version` shows v1.8.3; OZ reports 5.7.0 in its own `package.json`; a probe importing `SafeERC20`, `ReentrancyGuard` and `Ownable2Step` compiles under solc 0.8.37 + `evm_version=cancun`; the install script re-creates `lib/` from empty.
- **Verify:** `forge --version`; `grep version impl/contracts/lib/openzeppelin-contracts/package.json`; `forge build --use 0.8.37 --evm-version cancun` → `evidence/ENV-003/acceptance.txt`
- **Risks:** the installer may move (the Book now shows `getfoundry.sh/install`); `foundry.paradigm.xyz` worked on 2026-09-23. Vendored deps are git-ignored, so a clean clone needs the install script — DOC-006 checks exactly that.

### ENV-004 — Local Anvil environment (mode A) and deterministic accounts

- [x] **Status:** DONE · **Authorized:** yes (2026-09-23) · **Tier:** CORE-P0 · **Est:** 1 h · **Hat/agent:** U(C) · agents-backend
- **Objective:** One command brings up a deterministic local chain with roles, MockUSDC and mock registries.
- **Refs:** §14.2, §19 · OR-05/09 · DF-20, DF-23
- **Depends:** ENV-002 (chain-up half); CONTRACT-002, CONTRACT-017, REG-002…004 (seeding half)
- **Steps:** 1) `impl/scripts/devnet.sh`: `anvil --chain-id 31337 --block-time <0|2> --accounts 15 --mnemonic <fixed test mnemonic>`. 2) Assign indices: 0 deployer, 1 buyer, 2 seller, 3 validator, 4–8 trusted clients, 9–13 Sybil owners, 14 honest newcomer. 3) Deploy MockUSDC + mocks + escrow, mint USDC to the buyer, write `deployments/local.json`. 4) `CONFIRMATIONS=1` locally. 5) Document the reset procedure.
- **Files:** `impl/scripts/devnet.sh`, `deployments/local.json`
- **Acceptance:** a cold `devnet.sh` yields identical addresses across runs; the buyer holds USDC; block time is configurable (0 for functional runs, 2 s for latency).
- **Verify:** run twice, `diff` the two `deployments/local.json` → identical → `evidence/ENV-004/`
- **Risks:** the fixed test mnemonic must never hold real funds — it is documented as a test-only mnemonic.

### ENV-005 — Configuration and secrets

- [x] **Status:** DONE · **Authorized:** yes (2026-09-23) · **Tier:** CORE-P0 · **Est:** 0.5 h · **Hat/agent:** U(C) · agents-backend
- **Objective:** One configuration scheme for all three languages, with no secret ever in the repository.
- **Refs:** §14.2 · SR-13 · CLAUDE.md §11
- **Depends:** ENV-002
- **Steps:** 1) `.env.example` with **names only**: `RPC_URL`, `CHAIN_ID`, `ESCROW_ADDRESS`, `USDC_ADDRESS`, `IDENTITY/REPUTATION/VALIDATION_REGISTRY`, `SELLER_ORIGIN`, `SELLER_AGENT_ID`, `CLAIMS_DB_PATH`, `CONFIRMATIONS`, `REPLAY_POLICY`, `VALIDATOR_URL`, `TRUSTED_CLIENTS`, `ACCEPTED_VALIDATORS`, `ETHERSCAN_API_KEY`, `LITELLM_BASE_URL`. 2) Keys via keystore (`cast wallet import`) or env, never committed. 3) A loader per language that fails fast on a missing variable.
- **Acceptance:** every service refuses to start with a clear error when a required variable is missing; `git grep -nE "0x[a-fA-F0-9]{64}"` finds nothing.
- **Verify:** start each service with an empty env → clear failure → `evidence/ENV-005/`

### ENV-006 — Create the four testnet wallets

- [ ] **Status:** TODO · **Authorized:** n/a (user action, offline) · **Tier:** CORE-P0 · **Est:** 0.25 h · **Hat/agent:** U
- **Objective:** Buyer, seller, validator and deployer keys, created by the user, never shown to Claude.
- **Refs:** §14.2 · OR-01 · CLAUDE.md §11
- **Steps:** 1) `cast wallet new` ×4, or keystore imports. 2) Store securely outside the repo. 3) Record **public addresses only** in `deployments/wallets.md`. 4) Keep the seller's agent owner, `agentWallet` and service key as one address (REG-006); if they are ever split, provision and fund a fifth key.
- **Acceptance:** four addresses recorded; no private key appears in the repo, chat or evidence.
- **Risks:** seller and validator both need ETH because the flow has five transactions (DF-06).

### ENV-007 — Faucet funding

- [ ] **Status:** TODO · **Authorized:** n/a (manual) · **Tier:** CORE-P0 · **Est:** 0.5 h spread · **Hat/agent:** TM
- **Objective:** Fund deployer, seller and validator with Base Sepolia ETH, and the buyer with test USDC — **starting immediately**, because faucets rate-limit.
- **Refs:** §14.2 · OR-02 · V-86
- **Depends:** ENV-006
- **Steps:** 1) Circle faucet: 20 USDC per address per 2 h → buyer. 2) ETH: QuickNode (no mainnet balance needed, 1 claim/12 h), CDP (account), Alchemy (needs ≥0.001 mainnet ETH). 3) Repeat across days; record balances.
- **Acceptance:** by **Thu 24 18:00**, deployer ≥ 0.02 ETH, seller ≥ 0.01, validator ≥ 0.01, buyer ≥ 5 test USDC.
- **Verify:** `cast balance` per address → `evidence/ENV-007/`
- **Risks:** faucets dry or gated → local-only demo (R-02); Amoy only after DEPLOY-005.

### ENV-008 — Continuous integration

- [ ] **Status:** TODO · **Authorized:** no · **Tier:** EXTENDED-E1 · **Est:** 1.5 h · **Hat/agent:** U(A) · skills-workflow
- **Objective:** A GitHub Actions workflow running contract tests, TypeScript tests, Python tests and cross-language vector conformance.
- **Refs:** OR-08, IR-05 · Depends: CONTRACT-011, AGENT-001, VAL-003
- **Steps:** 1) `foundry-rs/foundry-toolchain@v1` pinned to v1.8.3 → `forge fmt --check`, `forge build`, `forge test`. 2) pnpm + vitest; uv + pytest. 3) A job asserting the same vectors pass in all three languages.
- **Acceptance:** CI is green on the main branch and fails when a vector is altered in one language only.
- **Verify:** a deliberately broken vector fails CI → `evidence/ENV-008/`

### ENV-009 — docker-compose local stack

- [ ] **Status:** DEFERRED · **Authorized:** no · **Tier:** EXTENDED-E2 · **Est:** 1.5 h · **Hat/agent:** U(C)
- **Objective:** One-command anvil + seller + validator + (dashboard) for reproduction on another machine.
- **Refs:** §14.1, OR-09 · Depends: INT-001
- **Risks:** DrvFs bind-mount performance; the claim database must stay on a Linux volume (DF-20).

### ENV-010 — LSP binaries and code-intelligence plugins

- [ ] **Status:** DEFERRED · **Authorized:** no · **Tier:** EXTENDED-E2 · **Est:** 0.5 h · **Hat/agent:** U
- **Objective:** Install `typescript-language-server` and `pyright`, then enable the matching plugins.
- **Refs:** skills-inventory §5 · Risks: global npm installs; only worth it if TypeScript work grows.

### ENV-011 — Anvil mode B: Base Sepolia fork at a pinned block

- [ ] **Status:** DEFERRED · **Authorized:** no · **Tier:** EXTENDED-E2 · **Est:** 1 h · **Hat/agent:** U(B)
- **Objective:** Fork mode giving real USDC and the live ERC-8004 registries locally, pinned for reproducibility.
- **Refs:** V-81, V-97 · Depends: ENV-013 · Enables: REG-005, API-009
- **Steps:** 1) `anvil --fork-url $RPC_URL --fork-block-number <pinned>`. 2) Impersonate a USDC holder or manipulate storage to fund the buyer. 3) Record the block number in the run manifest.
- **Acceptance:** `getVersion()` on the forked registries returns the expected value; the buyer holds USDC.
- **Risks:** public-RPC rate limits during fork sync (V-83) → cache and pin.

### ENV-013 — RPC, verifier and LLM keys; network liveness

- [x] **Status:** DONE · **Authorized:** yes (2026-09-23) · **Tier:** CORE-P0 · **Est:** 0.25 h · **Hat/agent:** U(C)
- **Objective:** Confirm the chain is reachable and decide which verifier path to use.
- **Refs:** §14.2 · OR-03, IR-03 · V-80, V-83, V-85
- **Steps:** 1) `cast block-number --rpc-url https://sepolia.base.org` and `cast chain-id`. 2) Decide Blockscout (no key) vs Etherscan V2 (key needed); store any key in `.env`. 3) Note that events are polled (no WebSocket).
- **Acceptance:** chain id 84532 confirmed on the day; the verifier choice is recorded in `docs/specs/versions.md`.
- **Verify:** command output → `evidence/ENV-013/`

### Phase 3 — Specifications (SPEC)

### SPEC-001 — Canonical request hash, typed data and shared vectors

- [x] **Status:** DONE · **Authorized:** yes (2026-09-23) · **Tier:** CORE-P0 · **Est:** 2.5 h · **Hat/agent:** U(A) · contracts-protocol
- **Objective:** Define, once and unambiguously, every byte that is hashed — and publish vectors that all three languages must reproduce. **This gates every component.**
- **Refs:** §9.1 · FR-03, FR-20, IR-05 · DF-04, DF-02 · V-81
- **Skill:** `solidity@solskill`, `spec-to-code-compliance` / fallback: Context7 (EIP-712, keccak)
- **Depends:** ENV-001
- **Steps:** 1) Write `docs/specs/canonical-hash.md` with: method uppercased ASCII; URI built from the **configured origin** (lowercase scheme/host, default port omitted, no fragment), path percent-encoding normalised (uppercase hex, unreserved decoded), query parameters **sorted by (key, value)** — this fully determines the order, so the original order of duplicate keys is *not* preserved (a deliberate choice: it makes the rule unambiguous across languages) — empty query → no `?`; body = exact bytes before parsing, with `Content-Encoding` rejected in v1 and the media type recorded but not hashed; price as an atomic-unit integer; token address; chainId; typehash constants. 2) Define `RESOURCE_TYPEHASH`, `JOB_TYPEHASH`, `VALIDATION_TYPEHASH` and the EIP-712 domain plus `DeliveryRequest`, `DeliveryReceipt`, `EvidenceAccess`. 3) Write `impl/vectors/canonical-v1.json`: ≥15 cases — simple GET; POST with JSON body; empty body; binary body; unicode path; percent-encoding variants; duplicate query keys supplied in two different input orders that must hash **identically**; default vs explicit port; uppercase host; trailing slash; large body; price edge values; wrong-token variant; plus jobId, requestHash and the three digests per case. 4) State the versioning rule (`canonicalVersion` travels in the 402). 5) Write the **minimal TypeScript reference implementation** of the hashes next to the Solidity one, so both can be checked at G1; AGENT-001 later packages it rather than re-implementing it.
- **Files:** `docs/specs/canonical-hash.md`, `impl/vectors/canonical-v1.json`
- **Acceptance:** (a) every vector carries inputs and all expected outputs; (b) two independent implementations (Solidity and TypeScript) reproduce 100% of them; (c) ambiguities from §9.1 (origin, query order, raw body) are each resolved explicitly in the text.
- **Verify:** `forge test --match-contract CanonicalHashTest` (4 pass) and `pnpm -C impl/packages/core test` (38 pass) and `pnpm typecheck` (exit 0) and `gen-vectors.py --check` → `evidence/SPEC-001/acceptance.txt`
- **Risks:** URI normalisation disagreements between libraries → the vectors, not the libraries, are authoritative; mismatches are fixed in the spec first (R-05).

### SPEC-002 — HTTP protocol: 402, payer-signed retry, claim semantics, confirmations

- [ ] **Status:** TODO · **Authorized:** no · **Tier:** CORE-P0 · **Est:** 0.75 h · **Hat/agent:** U(C) · agents-backend
- **Objective:** Fix the wire format and the delivery rules so buyer, seller and harness agree.
- **Refs:** §11.1, §11.2 · FR-05, FR-17, FR-19, FR-20, SR-11, SR-14, IR-04 · DF-01, DF-02, DF-03, DF-17, DF-23 · V-62, V-63
- **Depends:** SPEC-001
- **Steps:** 1) Write `docs/specs/http-protocol.md` covering §6.5 of task.md in full: 402 body and headers, retry payload, success response, error codes and their meanings. 2) Define "one grant" = one execution; idempotent replay only for the authenticated payer; `REPLAY_POLICY` values. 3) Define the confirmation policy and fail-closed behaviour. 4) State the honest interoperability sentence verbatim (DF-03). 5) Define the seller's check order, with the claim taken last.
- **Files:** `docs/specs/http-protocol.md`
- **Acceptance:** every error code has a trigger and an expected client action; the seller's check order is unambiguous; the interoperability wording is quotable as-is.
- **Verify:** API-003/004/005 tests reference this document section by section → `evidence/SPEC-002/`

### SPEC-003 — Settlement, validation binding and the reputation gate

- [ ] **Status:** TODO · **Authorized:** no · **Tier:** CORE-P0 · **Est:** 0.75 h · **Hat/agent:** U(A) · contracts-protocol
- **Objective:** Pin down the money rules: what binds a validation, when release is possible, when refund is possible, and what the gate computes.
- **Refs:** §5.1(2)(6)(7), §9.2 · FR-02, FR-06, FR-07, FR-21, FR-22 · DF-05, DF-06, DF-09, DF-22, DF-23 · V-93, V-94, V-99
- **Depends:** SPEC-001, REG-001
- **Steps:** 1) Write `docs/specs/settlement.md`: requestHash derivation and the bind-once rule; the pass predicate (`response ≥ 100`, `lastUpdate ≤ deadline`, validator and agent match); snapshot semantics; refund predicate (`now > deadline + GRACE` and no recordable pass); why there is no early refund on "fail" (pending ≡ 0). 2) Gate: `getSummary` per trusted client, bounded list, distinct/count/average thresholds, owner floors, the mock-only v1 comparison. 3) TTL bounds and the seller's deadline margin. 4) Enumerate the boundary cases that CONTRACT-011 must test.
- **Files:** `docs/specs/settlement.md`
- **Acceptance:** every case in the table — attest before/after deadline, release before/after deadline, refund before/at/after deadline+grace, overwrite after a snapshot, competing release/refund in one block, squatted requestHash — has a defined outcome.
- **Verify:** each row maps to a named test in CONTRACT-011 → `evidence/SPEC-003/`

### SPEC-004 — Feedback lifecycle

- [ ] **Status:** TODO · **Authorized:** no · **Tier:** CORE-P1 · **Est:** 0.5 h · **Hat/agent:** U(B) · security-eval
- **Objective:** Define who writes feedback, in what shape, and how the gate consumes it.
- **Refs:** §5.1(8), §11.1 · FR-08, FR-02 · DF-21, DF-09 · V-93
- **Depends:** SPEC-003
- **Steps:** 1) Buyer-direct `giveFeedback` after release or refund: tag `agenttrust`, value in bps with `valueDecimals = 2`, `feedbackHash` committing to (chainId, escrow, jobId, outcome), `feedbackURI` → evidence. 2) One feedback per job; revocation and duplicates handled by per-client averaging. 3) Seed-fixture shape for demos and gate tests. 4) State why escrow-routed feedback is rejected.
- **Files:** `docs/specs/feedback.md`
- **Acceptance:** a reader can tell, from a feedback entry alone, which job it refers to and whether the payment completed.
- **Verify:** REG-009 seeds validate against this shape → `evidence/SPEC-004/`

### SPEC-005 — EIP-712 seller-signed quote

- [ ] **Status:** DEFERRED · **Authorized:** no · **Tier:** EXTENDED-E1 · **Est:** 0.5 h · **Hat/agent:** U(A) · contracts-protocol
- **Objective:** Make the 402 offer authenticated end to end, so amount, resource, validator and expiry are signed by the seller's payee wallet.
- **Refs:** §9.2 · FR-26 · DF-04 · Depends: SPEC-001, SPEC-002 · Enables: CONTRACT-006
- **Acceptance:** struct, domain and vectors defined; the buyer can verify the quote offline before funding.
- **Risks:** if cut, the limitation is stated in DOC-004 and on the slide.

### Phase 4 — Registries (REG)

### REG-001 — Pin the ERC-8004 ABI and record the deployed addresses

- [x] **Status:** DONE (2026-09-23) · **Authorized:** yes (user, "ok", 2026-09-23) · **Tier:** CORE-P0 · **Est:** 0.5 h · **Actual:** ~0.9 h · **Hat/agent:** U(B) · contracts-protocol
- **Objective:** Freeze the exact registry ABI the escrow codes against, and record where the live registries are.
- **Refs:** §10.1, §10.2 · IR-01, IR-02, FR-12 · DF-14 · V-50, V-90…V-99
- **Skill:** `spec-to-code-compliance`, Context7 (`erc-8004-contracts`) / fallback: the ERC text
- **Depends:** ENV-001, ENV-003
- **Steps:** 1) Fetch the three registry interfaces at `erc-8004-contracts@b9e466c` and commit the ABI JSON to `impl/contracts/abi/erc8004/`. 2) Write minimal Solidity interfaces covering only what the escrow uses (§6.4). 3) Record the Base Sepolia addresses and the caveat that a single EOA can upgrade them (V-97). 4) Note the awkward behaviours mocks must copy (V-98, V-99).
- **Files:** `impl/contracts/abi/erc8004/*.json`, `impl/contracts/src/interfaces/IERC8004*.sol`, `docs/specs/versions.md` (addresses)
- **Acceptance:** the committed ABI matches the pinned commit ✔ (generated by compiling the pinned sources, not transcribed); the escrow compiles against the interfaces ✔; the caveats are written down ✔ (`impl/contracts/abi/erc8004/README.md`, interface header).
- **Verify:** `bash impl/scripts/check-erc8004-abi.sh` → **65/65 selectors present** in the deployed implementations at block 47,179,723, all three proxies at `getVersion()` "2.0.0" → `evidence/REG-001/abi-conformance.log` (V-140).
- **Outcome:** ABI JSON generated from `erc-8004-contracts` commit `b9e466c` with solc 0.8.37 (`via_ir` — upstream does not fit the stack without it) and extracted with `jq -S`: Identity 32 functions, Reputation 18, Validation 15. `src/interfaces/erc8004/IERC8004.sol` declares the subset the escrow binds to. Two findings worth carrying: `getAgentWallet(uint256)` is selector `0x00339509`, so solc emits `PUSH3` and a naive `PUSH4` scan gives a false negative; and `_lastId++` means **the first agent registered has id 0** (V-141), so `payeeAgentId == 0` must never be an "unset" sentinel.
- **Risks:** a live upgrade changes behaviour → re-run `check-erc8004-abi.sh` on the day of use (V-139).

### REG-002 — MockIdentityRegistry (real ABI)

- [x] **Status:** DONE (2026-09-23) · **Authorized:** yes (user, "ok", 2026-09-23) · **Tier:** CORE-P0 · **Est:** 0.5 h · **Actual:** ~0.6 h · **Hat/agent:** U(B) · contracts-protocol
- **Objective:** An ERC-721 identity mock faithful enough that switching to the live registry changes only configuration.
- **Refs:** §10.1, §5.1(1) · FR-01, FR-12 · DF-14 · V-92
- **Depends:** REG-001
- **Steps:** 1) `register(agentURI)` minting sequential agent ids. 2) `agentWallet` metadata with `setAgentWallet`/`getAgentWallet`, **cleared on transfer**. 3) `isAuthorizedOrOwner`. 4) Test helpers for seeding.
- **Acceptance:** transferring an agent clears its wallet ✔; the escrow's payee resolution works against it ✔ (interface-binding test). One criterion as written is **wrong about upstream** and was corrected rather than implemented: `getAgentWallet` does *not* return zero until set — upstream sets it to the registrant inside `register()`, and it returns zero only *after* a transfer. The mock follows upstream (V-92, V-97).
- **Verify:** `forge test --match-path test/MockRegistries.t.sol` → 25 passed → `evidence/REG-002/forge-test.log` (whole suite: 37 Solidity tests).
- **Outcome:** `src/mocks/MockIdentityRegistry.sol`, built on OZ `ERC721URIStorage` + `EIP712`, reproduces upstream's external surface, revert **strings** (`"Not authorized"`, `"reserved key"`, `"bad wallet"`, `"expired"`, `"deadline too far"`, `"invalid wallet sig"`), events and the real EIP-712 `AgentWalletSet` check with an ERC-1271 fallback — so `setAgentWallet` is a genuine signature check, not a stub. It does **not** inherit `IIdentityRegistry` (ERC721 already declares `ownerOf`/`tokenURI`/`getApproved`/`isApprovedForAll` and Solidity will not merge the declarations); the tests drive every member through the interface instead, which catches selector drift at run time, and REG-008 compares the ABIs.

### REG-003 — MockReputationRegistry (real ABI)

- [x] **Status:** DONE (2026-09-23) · **Authorized:** yes (user, "ok", 2026-09-23) · **Tier:** CORE-P0 · **Est:** 0.5 h · **Actual:** ~0.5 h · **Hat/agent:** U(B) · contracts-protocol
- **Objective:** Reproduce the reputation semantics the gate depends on, including the parts that make naive gating impossible.
- **Refs:** §9.2, §10.1 · FR-02, FR-08, FR-12 · DF-09, DF-14, DF-21 · V-93, V-96, V-98, V-99
- **Depends:** REG-001
- **Steps:** 1) `giveFeedback(agentId, int128 value, uint8 valueDecimals, tag1, tag2, endpoint, feedbackURI, feedbackHash)` rejecting the agent's owner/operator. 2) `getSummary(agentId, clients[], tag1, tag2)` that **reverts on an empty client list** and averages per entry. 3) `revokeFeedback`, `getClients`, `readAllFeedback`. 4) A clearly-labelled **non-standard** helper `distinctClientsUnfiltered(agentId)` used only by the gate-v1 comparison in SEC-007.
- **Acceptance:** empty-client calls revert ✔; owner **and operator** feedback reverts ✔; averaging matches the reference ✔ (WAD normalisation → mean → rescale to the modal `valueDecimals`, transcribed from upstream); the v1 helper is marked non-standard in code and docs ✔.
- **Verify:** `forge test --match-path test/MockRegistries.t.sol` → `evidence/REG-002/forge-test.log`.
- **Outcome:** `src/mocks/MockReputationRegistry.sol`. `readAllFeedback`, `appendResponse` and `getResponseCount` are **not implemented** — nothing in AgentTrust calls them (DF-21) — and the omission is declared in `check-mock-conformance.py` rather than left to be discovered. `getSummary` is split into `_accumulate`/`_modeDecimals` purely to fit the stack without `via_ir`; the arithmetic and iteration order are upstream's. A test pins the fact the gate design turns on: **`count` counts feedback entries, not distinct clients**, so one client leaving three reviews returns 3. `test_crossEndorsingSybilsPassGateV1AndFailTheTrustAnchoredGate` demonstrates DF-09 at registry level — five mutually-endorsing addresses satisfy "distinct ≥ 3, count ≥ 5" and contribute nothing to a trusted-client query.
- **Risks:** drifting from the real averaging rule → REG-008 compares against the pinned ABI and behaviour notes.

### REG-004 — MockValidationRegistry (real ABI)

- [x] **Status:** DONE (2026-09-23) · **Authorized:** yes (user, "ok", 2026-09-23) · **Tier:** CORE-P0 · **Est:** 0.5 h · **Actual:** ~0.5 h · **Hat/agent:** U(B) · contracts-protocol
- **Objective:** Reproduce validation semantics exactly, including the pending≡0 ambiguity that drives DF-05.
- **Refs:** §10.1, §5.1(6) · FR-06, FR-21, FR-12 · DF-05, DF-06, DF-14 · V-94, V-98, V-99
- **Depends:** REG-001
- **Steps:** 1) `validationRequest` restricted to the agent's owner/operator, **setting `lastUpdate`**, with a globally unique `requestHash`. 2) `validationResponse` restricted to the named validator, 0–100, **repeatable**. 3) `getValidationStatus` reverting on an unknown hash. 4) No `hasResponse` getter — the ambiguity is deliberate.
- **Acceptance:** a second `validationRequest` with the same hash reverts ✔ — the test squats a hash *from a different account, for a different agent*, which is the real attack; a pending request is indistinguishable from a 0 response ✔ **on a per-request read**; responses can be overwritten ✔.
- **Verify:** `forge test --match-path test/MockRegistries.t.sol` → `evidence/REG-002/forge-test.log`.
- **Outcome:** `src/mocks/MockValidationRegistry.sol`. `hasResponse` is stored exactly as upstream stores it and, exactly as upstream, is **not** exposed by `getValidationStatus` — so the ambiguity is reproduced rather than simulated. **Finding (V-99a):** while transcribing `getSummary` it turned out that path *does* filter on `hasResponse`, so pending and a real 0 **are** distinguishable in aggregate; it loops over every validation the agent has ever had, so it is unusable from a settlement path. DF-05's decision is unchanged but its justification was corrected from "the distinction does not exist" to "reading it costs unbounded gas", and SEC-012 must catch any doc or slide that still says "indistinguishable" unqualified. A test pins both halves.

### REG-005 — Fork tests against the live Base Sepolia registries

- [ ] **Status:** DEFERRED · **Authorized:** no · **Tier:** EXTENDED-E2 · **Est:** 3 h timebox · **Hat/agent:** U(B) · contracts-protocol
- **Objective:** Prove the escrow works against the real deployed registries, pinned to a block.
- **Refs:** §10.2, §10.3 · IR-08, OPT-06 · V-97 · Depends: ENV-011, CONTRACT-007
- **Steps:** 1) `forge test --fork-url $RPC_URL --fork-block-number <pinned>`. 2) Register a test agent, file a validation request, respond as the validator, release. 3) Timebox 3 h; on expiry, record the reason and stay on mocks (§10.3 fallback).
- **Acceptance:** either a green fork test with the block recorded, or a written go/no-go with the blocker.
- **Risks:** registry upgrade or RPC limits; Validation registry is explicitly unstable (V-97).

### REG-006 — Agent cards and registration fixtures

- [ ] **Status:** TODO · **Authorized:** no · **Tier:** CORE-P0 · **Est:** 0.25 h · **Hat/agent:** U(B) · contracts-protocol
- **Objective:** Give the buyer something real to discover: agent cards whose endpoint origin can be checked.
- **Refs:** §5.1(1), §10.1 · FR-01 · DF-04
- **Depends:** REG-002
- **Steps:** 1) JSON cards for seller and validator (name, endpoint origin, services, price hints, validator policy). 2) Serve them statically; register agents with `agentURI` pointing at them. 3) Document the origin-matching rule. 4) **Set the agent owner, its `agentWallet` and the seller service key to one address** — otherwise `validationRequest` (owner/operator) and `bindValidation` (payee) come from different keys and both need funding (ENV-006/007).
- **Acceptance:** `agentURI` resolves to a card whose origin equals the seller the buyer talks to; a mismatched card is rejected by AGENT-002; owner == `agentWallet` == seller key is asserted in the fixture setup.
- **Verify:** buyer discovery test → `evidence/REG-006/`

### REG-007 — Live testnet registration, feedback and validation

- [ ] **Status:** DEFERRED · **Authorized:** no · **Tier:** EXTENDED-E2 · **Est:** 1.5 h · **Hat/agent:** U(B)
- **Objective:** Register the seller and validator agents on the real registries and run one job through them.
- **Refs:** §10.2 · OPT-06, IR-08 · Depends: REG-005, ENV-007, explicit user authorization
- **Risks:** costs testnet ETH and exposes the demo to registry upgrades; only after the core is green.

### REG-008 — Mock conformance against the pinned ABI and the deployed registries

- [x] **Status:** DONE (2026-09-23) · **Authorized:** yes (user, "ok", 2026-09-23) · **Tier:** CORE-P0 · **Est:** 0.5 h · **Actual:** ~0.4 h · **Hat/agent:** U(B) · contracts-protocol
- **Objective:** Make sure "mock" never means "wrong": same selectors, same revert behaviour.
- **Refs:** §10.3 · FR-12, IR-01 · DF-14 · V-98, V-99, V-139
- **Skill:** `spec-to-code-compliance`
- **Depends:** REG-002…004
- **Steps:** 1) Compare each mock's function selectors against the pinned ABI; fail on any mismatch. 2) Assert the behavioural quirks: empty-client revert, unknown-hash revert, owner-feedback ban, repeatable responses, `lastUpdate` set at request, wallet cleared on transfer. 3) Read-only `eth_call` against the deployed registries to confirm the selectors still exist on the day.
- **Acceptance:** a selector or behaviour mismatch fails ✔; the live-selector check is recorded with its date ✔ (2026-09-23, block 47,179,723).
- **Verify:** `python3 impl/scripts/check-mock-conformance.py` → **PASS**, 41 shared functions identical across the three mocks → `evidence/REG-008/mock-conformance.log`; `bash impl/scripts/check-erc8004-abi.sh` → `evidence/REG-001/abi-conformance.log`.
- **Deviation from the step list:** the ABI comparison is a Python script diffing `forge inspect <Mock> abi` against the pinned JSON, not a Solidity `RegistryConformance` test — structural JSON diffing in Solidity would be far weaker. The behavioural quirks are asserted in `test/MockRegistries.t.sol` (25 tests) and the live check is `check-erc8004-abi.sh`. All three run without a network except the last.
- **Outcome:** the script compares functions *and events*, and allows only **declared** differences: omitted upstream members (proxy/Ownable surface, `readAllFeedback`, `appendResponse`, `getResponseCount`), added mock-only members (`distinctClientsUnfiltered`, with its reason), and `getVersion()` returning `"2.0.0-mock"` so a mock can never be mistaken for the live registry. It earned its place immediately: it caught the `NewFeedback` event declaring `feedbackIndex` as indexed and `indexedTag1` as non-indexed, the opposite of upstream.

### REG-009 — Seed reputation fixtures

- [ ] **Status:** TODO · **Authorized:** no · **Tier:** CORE-P1 · **Est:** 0.5 h · **Hat/agent:** U(B) · security-eval
- **Objective:** Labelled, reproducible reputation data for the demo and for gate tests.
- **Refs:** §5.1(2) · FR-02, FR-08 · DF-09, DF-21
- **Depends:** REG-003, SPEC-004
- **Steps:** 1) Honest sellers with feedback from trusted clients. 2) A five-agent Sybil ring cross-endorsing (each receives from the other four). 3) An honest newcomer with no history. 4) One seeding script, deterministic, labelled as fixture data.
- **Acceptance:** re-running the seed yields identical registry state; the ring's per-agent distinct attesters = 4 (the arithmetic behind DF-09).
- **Verify:** seed then query `getSummary` for each population → `evidence/REG-009/`

### Phase 5 — Contracts (CONTRACT)

### CONTRACT-001 — Foundry project configuration

- [x] **Status:** DONE · **Authorized:** yes (2026-09-23) · **Tier:** CORE-P0 · **Est:** 0.5 h · **Hat/agent:** U(A) · contracts-protocol
- **Objective:** A reproducible compile and test setup pinned to the chosen compiler and EVM version.
- **Refs:** §14.1 · IR-07 · V-102, V-103, V-104
- **Depends:** ENV-003
- **Steps:** 1) `foundry.toml`: `solc = "0.8.37"`, `evm_version = "cancun"`, optimizer settings, remappings for OZ and the ERC-8004 interfaces, `fs_permissions` for reading `impl/vectors/`. 2) `[fuzz] runs = 256`; `[invariant] runs = 256, depth = 500, fail_on_revert = false`. 3) `forge fmt` config.
- **Acceptance:** `forge build` and `forge test` run on an empty suite; `forge fmt --check` passes.
- **Verify:** `forge config` output recorded → `evidence/CONTRACT-001/`
- **Risks:** `cancun` chosen for portability and to sidestep the Foundry CLZ issue (V-103); revisit only with a recorded reason.

### CONTRACT-002 — MockUSDC and adversarial token mocks

- [x] **Status:** DONE · **Authorized:** yes (2026-09-23) · **Tier:** CORE-P0 · **Est:** 1 h · **Hat/agent:** U(A) · contracts-protocol
- **Objective:** A token that behaves like Base Sepolia USDC, plus tokens that misbehave in the ways the escrow must survive.
- **Refs:** §9.2, §11.3 · SR-09, FR-24 · DF-12 · V-81
- **Skill:** `token-integration-analyzer`
- **Depends:** CONTRACT-001
- **Steps:** 1) MockUSDC: 6 decimals, EIP-712 domain name "USDC" version "2", EIP-3009 `transferWithAuthorization` and `receiveWithAuthorization` (the latter enforcing `to == msg.sender`), `authorizationState`, mint helper. 2) Adversarial mocks: fee-on-transfer, returns-false, reentrant-on-transfer, always-reverting (blacklist simulation). 3) Document what each is for.
- **Acceptance:** MockUSDC's domain separator matches the real formula for chainId 31337; the EIP-3009 nonce cannot be reused; each adversarial mock triggers its intended failure path in CONTRACT-014.
- **Verify:** `forge test --match-contract MockUSDC` → `evidence/CONTRACT-002/`

### CONTRACT-004 — Escrow state machine and `fund()`

- [x] **Status:** DONE (2026-09-23) — security review passed, see §14 · **Authorized:** yes (user, "ok", 2026-09-23) · **Tier:** CORE-P0 · **Est:** 1.5 h · **Hat/agent:** U(A) · contracts-protocol
- **Objective:** The core state machine with on-chain resource binding, payer nonce, payee snapshot and TTL bounds.
- **Progress (2026-09-23):** `impl/contracts/src/AgentTrustEscrow.sol` + `test/Fund.t.sol`, **31 tests passing** (`evidence/CONTRACT-004/forge-test.log`). All six acceptance criteria are covered: replayed nonce reverts; a failed transfer leaves the nonce unconsumed *and* the buyer can then reuse it; a 1% fee-on-transfer token reverts `TransferAmountMismatch`; TTL bounds are enforced both ways plus a 256-run fuzz inside them; the derivations are checked against **every** shared hashing vector, with the contract deployed at the vector's escrow address on the vector's chain so the job id is comparable too; and the payee is the agent wallet when set, the owner after a transfer, and stays snapshotted if the agent moves mid-job. Extra coverage beyond the criteria: nonces are payer-scoped, the validator may not be the payer, zero, the agent's owner or its **operator**, funding an unknown agent reverts, and a re-entrant token's callback is asserted with `vm.expectCall` before showing the guard stopped it.
- **Refs:** §5.1(4), §5.2, §9.2, §9.3 · FR-03, FR-04, FR-09, FR-11, SR-01, SR-02, SR-04, SR-09, SR-12 · DF-04, DF-12, DF-22
- **Skill:** `solidity@solskill`, `building-secure-contracts`
- **Depends:** SPEC-001, SPEC-003, CONTRACT-001/002, REG-001…004
- **Steps:** 1) `Job` struct (§6.3) and storage; `consumedNonce[payer][nonce]`. 2) `fund(...)` per §6.1: validate token allowlist, amount, TTL bounds, validator acceptability; derive `resourceHash` and `jobId`; resolve and snapshot the payee via `getAgentWallet`‖`ownerOf`; burn the nonce; `safeTransferFrom` with a **balance-delta check**; write state; emit `JobFunded`. 3) Custom errors and events per §6.1. 4) `previewResourceHash`/`previewJobId` views for clients and tests. 5) Checks-Effects-Interactions + `ReentrancyGuard`.
- **Files:** `impl/contracts/src/AgentTrustEscrow.sol`
- **Acceptance:** (a) funding twice with one nonce reverts `ReplayedNonce`; (b) a failed transfer reverts the whole call and leaves the nonce unconsumed; (c) a fee-on-transfer token reverts `TransferAmountMismatch`; (d) TTL outside bounds reverts; (e) the derived hashes match SPEC-001 vectors; (f) the payee is the agent wallet when set, the owner otherwise.
- **Verify:** `forge test --match-contract Fund -vvv` → `evidence/CONTRACT-004/`
- **Risks:** gate gas growth with the trusted-client list → bounded list, measured in EVAL-002.

### CONTRACT-005 — Trust-anchored reputation gate

- [x] **Status:** DONE (2026-09-23) — security review passed, see §14 · **Authorized:** yes (user, "ok", 2026-09-23) · **Tier:** CORE-P0 · **Est:** 1 h · **Hat/agent:** U(B) · contracts-protocol
- **Objective:** Gate funding on feedback from clients the buyer actually trusts, with bounded gas.
- **Progress (2026-09-23):** `_enforceGate` in `AgentTrustEscrow.sol` + `test/Gate.t.sol`, **21 tests passing** (`evidence/CONTRACT-005/`). All five acceptance criteria are covered, plus three things the step list did not anticipate:
  - **Gas starvation was a real bypass.** A bounded `try/catch` read means a caller could supply just enough gas that every `getSummary` runs out, is caught, contributes nothing — and the gate waves them through while appearing to have been applied. `_readSummary` now requires `gasleft() >= ceiling * 64/63 + 100k` before each read (EIP-150's 63/64 rule) and reverts `InsufficientGasForReputationRead` rather than deciding on no data. `test_StarvingTheReadsOfGasRevertsInsteadOfSkippingTheGate` pins it.
  - **The same bypass exists from the owner's side**, so `reputationReadGas` has a constant floor `MIN_REPUTATION_READ_GAS` (45,000) enforced in both the constructor and the setter.
  - **Duplicate trusted clients are rejected**, not deduplicated: repeating one address would otherwise lift `distinct` past an owner floor for free.
  The average is entry-weighted, not client-weighted, and normalises each client's `valueDecimals` — both pinned by tests. `FEEDBACK_TAG` is a `constant`, so no admin key can point the gate at a tag the seller controls.
- **Measured (acceptance d):** `getSummary` costs ~19.5k fixed + **~8,589 gas per feedback entry**, linear to 100 entries (`evidence/CONTRACT-005/gas-vs-history.txt`). At the 250k default ceiling a trusted client with more than ~26 entries for one agent is **dropped from the gate**. That is ERC-8004's read cost, not the escrow's, and it is the concrete form of the DF-09 risk — it belongs in DOC-004 and EVAL-002.
- **Scope note:** the gate floors and `setGateFloors` landed here rather than in CONTRACT-010, because the gate cannot enforce "a buyer may be stricter, never weaker" without them. CONTRACT-010 is now bounded ranges for the setters plus the refund grace.
- **Refs:** §1(1), §5.1(2), §9.2, §9.3 · FR-02, SR-10 · DF-09 · V-93, V-96, V-99
- **Depends:** CONTRACT-004, REG-003, SPEC-003
- **Steps:** 1) `GatePolicy{trustedClients[], minDistinct, minCount, minAvgBps}` supplied by the buyer, length-capped by `maxTrustedClients`. 2) Call `getSummary(agentId, [client], "agenttrust", "")` per client **inside a bounded-gas `try/catch`**: `getSummary` iterates every entry belonging to that client (V-99) and history length is attacker-influenced, so a client whose read exceeds the ceiling or reverts contributes nothing instead of bricking `fund()`. Count distinct clients with ≥1 entry; aggregate count and average. 3) Enforce owner floors (a buyer may be stricter, never weaker). 4) Revert `ReputationTooLow` with the failing dimension. 5) Do **not** implement a global-distinct gate: document why (unbounded, inflatable).
- **Acceptance:** (a) a seller with enough trusted feedback passes; (b) the same seller with feedback only from untrusted addresses fails; (c) an over-long client list reverts; (d) gas is recorded against history size; (e) **a trusted client with a very large feedback history does not prevent funding** — that read degrades gracefully and the gate still decides.
- **Verify:** `forge test --match-contract Gate` → `evidence/CONTRACT-005/`
- **Risks:** cold-start refusals are a real cost, measured in SEC-007 and documented in DOC-004.

### CONTRACT-006 — On-chain EIP-712 quote verification

- [ ] **Status:** DEFERRED · **Authorized:** no · **Tier:** EXTENDED-E1 · **Est:** 2 h · **Hat/agent:** U(A) · contracts-protocol
- **Objective:** Require a seller signature over the offer, so price, resource, validator and expiry are authenticated on-chain.
- **Refs:** §9.2 · FR-26 · DF-04 · Depends: SPEC-005, CONTRACT-004
- **Acceptance:** funding with a mismatched or expired quote reverts; the signer must be the resolved payee wallet.

### CONTRACT-007 — `bindValidation`, `confirmValidation` and `release`

- [x] **Status:** DONE (2026-09-23) — security review passed, see §14 · **Authorized:** yes (user, "ok", 2026-09-23) · **Tier:** CORE-P0 · **Est:** 1 h · **Hat/agent:** U(A) · contracts-protocol
- **Objective:** Tie exactly one validation request to a job and pay only against a timely pass.
- **Refs:** §5.1(6)(7), §9.2 · FR-06, FR-07, FR-21, FR-22, SR-03 · DF-05, DF-06, DF-15 · V-94, V-98, V-99
- **Depends:** CONTRACT-004, REG-004, SPEC-003
- **Steps:** 1) `bindValidation(jobId, salt)`: payee-only, once; re-derive `requestHash`; read the registry (revert-safe) and require matching `agentId` and `validator`; store. 2) `confirmValidation(jobId)`: permissionless; record the pass if `response ≥ threshold` and `lastUpdate ≤ deadline`. 3) `release(jobId)`: permissionless; use the recorded pass or record it now; effects before the transfer; pay the snapshotted payee. 4) Events and errors per §6.1.
- **Acceptance:** (a) a pass at `deadline − 1` released at `deadline + 1 h` succeeds; (b) an attestation after the deadline never releases; (c) an overwrite after a snapshot cannot un-release; (d) binding twice reverts; (e) a squatted hash forces a new salt and still binds correctly; (f) release is impossible without a bound hash.
- **Verify:** `forge test --match-contract Settlement -vvv` → `evidence/CONTRACT-007/`

### CONTRACT-008 — `refund()` after deadline plus grace

- [x] **Status:** DONE (2026-09-23) — security review passed, see §14 · **Authorized:** yes (user, "ok", 2026-09-23) · **Tier:** CORE-P0 · **Est:** 0.5 h · **Hat/agent:** U(A) · contracts-protocol
- **Objective:** Give the buyer a safety valve that cannot steal a delivered, attested job.
- **Refs:** §5.1(7), §9.2, §9.3 · FR-07, FR-22 · DF-05 · V-99
- **Depends:** CONTRACT-007
- **Steps:** 1) Permissionless; require `now > deadline + GRACE`, state Funded, no recorded pass and none recordable now. 2) Funds always return to `job.payer`. 3) Emit `JobRefunded`.
- **Acceptance:** (a) refund before deadline+grace reverts; (b) refund with a timely pass reverts `ValidationExists`; (c) refund with a pending-only request (response 0) succeeds after grace — the free-service case is impossible because the pass predicate needs `response ≥ threshold`; (d) refund after a failing response succeeds after grace; (e) funds can never go anywhere but the payer.
- **Verify:** `forge test --match-contract Refund -vvv` → `evidence/CONTRACT-008/`

### CONTRACT-010 — Administrative controls and bounds

- [x] **Status:** DONE (2026-09-23) · **Authorized:** yes (user, "ok", 2026-09-23) · **Tier:** CORE-P0 · **Est:** 0.5 h · **Hat/agent:** U(A) · contracts-protocol
- **Objective:** Configuration without power over user funds.
- **Refs:** §9.2, §9.3 · FR-10, SR-10, FR-22 · DF-12, DF-22
- **Skill:** `entry-point-analyzer`
- **Depends:** CONTRACT-004
- **Steps:** 1) `Ownable2Step`. 2) `setGateFloors`, `setTokenAllowed`, `setTtlBounds`, `setGrace`, each range-checked and event-emitting. 3) No sweep, no pause that could strand funds, no upgrade path.
- **Acceptance:** no owner-reachable path transfers escrowed tokens ✔ — asserted by executing it, not by inspection: `test_NoSetterCanTouchAFundedJob` fires every setter at its extreme against a funded job, then settles it and checks the seller was paid in full and the owner holds nothing; every setter rejects out-of-range values ✔ (both ends for `reputationReadGas`); ownership transfer requires acceptance ✔.
- **Verify:** `forge test --match-contract AdminTest` → **12 tests** → `evidence/CONTRACT-010/forge-test.log`; inventory in `evidence/CONTRACT-010/entry-points.md`.
- **Outcome:** `MAX_TTL_LIMIT` 30 d, `MAX_GRACE` 30 d, `MAX_TRUSTED_CLIENTS_LIMIT` 32, `MAX_DISTINCT_FLOOR` 32, `MAX_COUNT_FLOOR` 1000, `reputationReadGas` in [45k, 5M]. The constructor applies the same bounds, so a deployment cannot sidestep them. The three registry addresses are `immutable` and `PASS_THRESHOLD`/`FEEDBACK_TAG` are `constant`, so no key can repoint the gate or lower the bar for a pass.
- **Recorded, not fixed:** `renounceOwnership` is inherited from `Ownable` and lands in **one step**. It cannot strand funds — settlement reads no setting except the grace each job snapshotted — but it freezes configuration permanently. Pinned by `test_RenouncingOwnershipDoesNotStrandFunds` and listed in the entry-point inventory. Stray tokens are likewise unrecoverable, which is the accepted cost of having no sweep (STRETCH-008).

### CONTRACT-011 — Unit and boundary test suite

- [x] **Status:** DONE (2026-09-23) · **Authorized:** yes (user, "ok", 2026-09-23) · **Tier:** CORE-P0 · **Est:** 1.5 h · **Hat/agent:** U(A) · contracts-protocol
- **Objective:** Cover every state transition, error and boundary — including the corrected versions of the blueprint's tests.
- **Refs:** §9.4 · FR-04, FR-07, FR-09, FR-11, ER-09 · DF-05, DF-13, DF-22 · Gate: **G1**
- **Skill:** `test-driven-development`, `solidity@solskill`
- **Depends:** CONTRACT-004…010, REG-002…004, SPEC-001/003
- **Steps:** 1) Happy path: fund → bind → respond → release, with balances asserted. 2) Refund path after deadline+grace. 3) Corrected §9.4 set: `test_A2_ReplayedNonceRejected`, `test_A3_ResourceHashMismatchIsNotReleasable`, `test_A6_SybilRingUnderTrustAnchoredGateIsRefused` (and a mock-only v1 comparison showing it is **admitted**), `test_RefundBlockedByTimelyPass`. 4) Boundary matrix from SPEC-003 (attest/release/refund around deadline and grace, same-block race, overwrite after snapshot). 5) TTL bounds, token allowlist, zero amount, unknown job. 6) Vector conformance: derived hashes equal `impl/vectors/canonical-v1.json`. 7) Gate robustness: funding succeeds against a trusted client with a bloated feedback history, and against an `agentWallet` that differs from the NFT owner.
- **Acceptance:** every SPEC-003 boundary row has a named passing test; `forge coverage` ≥ 90% lines on `AgentTrustEscrow.sol`; no test is skipped.
- **Verify:** `forge test -vvv && forge coverage --match-contract AgentTrustEscrow` → `evidence/CONTRACT-011/`

### CONTRACT-012 — Fuzz tests

- [ ] **Status:** DEFERRED · **Authorized:** no · **Tier:** EXTENDED-E1 · **Est:** 1 h · **Hat/agent:** U(A)
- **Objective:** Randomised amounts, TTLs, timestamps and nonces around the settlement predicates.
- **Refs:** §14.1 · Depends: CONTRACT-011 · Acceptance: no counterexample after 256 runs per property; any counterexample becomes a unit test.

### CONTRACT-013 — Core invariants

- [x] **Status:** DONE (2026-09-23) · **Authorized:** yes (user, "ok", 2026-09-23) · **Tier:** CORE-P0 · **Est:** 0.5 h · **Hat/agent:** U(A) · contracts-protocol
- **Objective:** Prove the two properties that matter most: money is conserved and no job settles twice.
- **Refs:** §9.3 · SR-10, FR-09 · DF-12
- **Depends:** CONTRACT-011
- **Steps:** 1) Handler with actors (buyer, seller, validator, attacker, owner) performing random legal calls. 2) Invariant A: escrow token balance == sum of amounts of jobs still in Funded. 3) Invariant B: every job leaves Funded at most once. 4) Invariant C: no owner-only call changes any job's balance.
- **Acceptance:** all three hold for 256 runs × depth 500; a deliberately broken build fails them.
- **Verify:** `forge test --match-contract Invariant` → `evidence/CONTRACT-013/`

### CONTRACT-014 — Adversarial contract tests

- [ ] **Status:** DEFERRED · **Authorized:** no · **Tier:** EXTENDED-E1 · **Est:** 1.5 h · **Hat/agent:** U(A)
- **Objective:** Reentrancy, cross-deployment replay, other-payer nonce, identity transfer after funding, requestHash squatting, transfer-reverting token.
- **Refs:** §9.3 · SR-01…SR-03, SR-09, SR-12 · DF-06, DF-12, DF-16 · Depends: CONTRACT-011, CONTRACT-002
- **Acceptance:** each attack is refused by a named mechanism, with the revert selector asserted.

### CONTRACT-015 — Gas snapshot

- [ ] **Status:** TODO · **Authorized:** no · **Tier:** CORE-P1 · **Est:** 0.25 h · **Hat/agent:** U(A)
- **Objective:** Record gas for every escrow entry point, including the five-transaction flow total.
- **Refs:** §13(5) · ER-05 · DF-06 · Depends: CONTRACT-011 · Feeds: EVAL-002
- **Acceptance:** `.gas-snapshot` committed; per-function numbers recorded with the commit hash.

### CONTRACT-016 — Static analysis and security review

- [ ] **Status:** DEFERRED · **Authorized:** no · **Tier:** EXTENDED-E1 · **Est:** 1.5 h · **Hat/agent:** U(A/D)
- **Objective:** Slither and Aderyn plus a Trail of Bits checklist pass over the final contracts.
- **Refs:** §14.1 · Skill: `building-secure-contracts`, `entry-point-analyzer`, `/security-review` · Depends: CONTRACT-011
- **Steps:** install Slither 0.11.6 via `uv tool install slither-analyzer`; triage every finding as fix / justify / accept, recorded in `docs/adr/` or the findings log.
- **Acceptance:** zero unexplained high or medium findings.

### CONTRACT-017 — Deploy script and ABI export

- [x] **Status:** DONE (2026-09-23) · **Authorized:** yes (user, "ok", 2026-09-23) · **Tier:** CORE-P0 · **Est:** 0.75 h · **Actual:** ~0.6 h · **Hat/agent:** U(A) · contracts-protocol
- **Objective:** One script that deploys locally and to testnet, writes addresses, and exports ABIs for the TypeScript and Python clients.
- **Refs:** App. B, §16 · IR-06, OR-07 · Depends: CONTRACT-010, REG-002…004
- **Steps:** 1) `script/Deploy.s.sol` deploying mocks (or wiring live registry addresses) plus the escrow with constructor parameters from env. 2) Write `deployments/<network>.json` (addresses, block, commit, constructor args). 3) Export ABIs to `impl/packages/core/abi/`. 4) Keystore-based signing; never a raw key on the command line.
- **Acceptance:** a local run produces a working deployment file ✔ (`evidence/CONTRACT-017/local-deploy.log`: escrow at block 2, tx recorded, smoke check reads owner / TTL bounds / grace / PASS_THRESHOLD / token allowlist / registry back off the chain). "Consumed by the services" is **not yet demonstrable** — the seller, buyer and validator do not exist until API-001/AGENT-001/VAL-001, and INT-001 is where that is actually proved.
- **Verify:** `impl/scripts/deploy.sh local` → `evidence/CONTRACT-017/local-deploy.log`
- **Outcome:** `script/Deploy.s.sol` deploys the three mocks plus a mock token when no registry addresses are set, and wires the live ones when they are — refusing a mixture, since a deployment that paired a live registry with a mock would be a trap. Parameters come from the environment with the §6.8 defaults. Signing is by keystore account or Anvil's unlocked accounts; **no private key is ever a command-line argument**.
  `impl/scripts/deploy.sh` wraps it because `forge script` records the block it *simulated* against, not the block the broadcast landed in — on a fresh chain that is block 0. The wrapper patches in the real block, transaction hash, deployer and timestamp from the broadcast receipt, runs the smoke check, and re-exports the ABIs.
  `impl/scripts/export-abi.sh` writes `impl/packages/core/abi/`: the escrow and token from the compiled artifacts, and the three ERC-8004 ABIs copied from the **pinned upstream** files (REG-001) rather than from the mocks, so the same client code drives mocks and live registries.
  `deployments/31337.json` is git-ignored (regenerated on every devnet start); real network files are tracked. `mockRegistries` is recorded in every file and must never be `true` in anything presented as a testnet result.

### CONTRACT-018 — Additional invariants

- [ ] **Status:** DEFERRED · **Authorized:** no · **Tier:** EXTENDED-E1 · **Est:** 1 h · **Hat/agent:** U(A)
- **Objective:** Nonce↔job consistency, bound-hash uniqueness, monotonic state, and "released implies a recorded pass".
- **Depends:** CONTRACT-013

### Phase 6 — Seller (API)

### API-001 — Seller skeleton, deterministic fixtures, price table

- [ ] **Status:** TODO · **Authorized:** no · **Tier:** CORE-P0 · **Est:** 0.75 h · **Hat/agent:** U(C) · agents-backend
- **Objective:** An Express server whose paid routes are deterministic, so a validator can recompute them.
- **Refs:** §11.2, §14.1 · FR-17, FR-23 · DF-08 · V-63(express), V-108
- **Depends:** ENV-005, AGENT-001
- **Steps:** 1) Express 5 with a raw-body capture middleware mounted **before** any JSON parser. 2) Paid routes `/v1/summarise` and `/v1/classify` at the **same price** (the equal-price sibling pair A3 needs), plus a free `/health` and `/.well-known/agent-card`. 3) Deterministic implementations (no randomness, no clock, no LLM): documented transforms over the request body. 4) Price table in configuration, in atomic units.
- **Files:** `impl/agents/seller/src/{server.ts,routes/*.ts,pricing.ts}`
- **Acceptance:** the same request body always produces byte-identical output; both siblings cost exactly the same; the raw body is available unparsed to the hashing layer.
- **Verify:** `pnpm -C impl/agents/seller test -- fixtures` → `evidence/API-001/`

### API-002 — 402 emission in x402 v2 wire format

- [ ] **Status:** TODO · **Authorized:** no · **Tier:** CORE-P0 · **Est:** 0.75 h · **Hat/agent:** U(C) · agents-backend
- **Objective:** Answer unpaid requests with a quote that carries everything the buyer needs, in the v2 shape, without stock settlement.
- **Refs:** §11.2, §11.3 · FR-17, IR-04 · DF-03 · V-62, V-64, V-69
- **Depends:** SPEC-002, API-001
- **Steps:** 1) Build PaymentRequirements per §6.5 with `scheme: "agenttrust-escrow"`, `network: "eip155:84532"`, atomic `amount`, `payTo` = the seller's on-chain payee wallet, and `extra` (escrow, sellerAgentId, acceptedValidators, minDeadlineMargin, quoteId, expiry, canonicalVersion). 2) Base64-encode into `PAYMENT-REQUIRED`; keep a JSON body for humans. 3) **Do not** mount `paymentMiddleware` on these routes. 4) Emit the honest interoperability note in the server's `/` help text and README.
- **Acceptance:** the header decodes to valid v2 PaymentRequirements; `payTo` equals the registry-resolved wallet; no settlement is attempted anywhere in the path.
- **Verify:** `pnpm -C impl/agents/seller test -- quote` → `evidence/API-002/`
- **Risks:** drift from the v2 field names → re-check with Context7 at implementation time.

### API-003 — Raw-body canonical hash and funded-job verification

- [ ] **Status:** TODO · **Authorized:** no · **Tier:** CORE-P0 · **Est:** 1.75 h · **Hat/agent:** U(C) · agents-backend
- **Objective:** Serve only when the chain says this exact request is funded, to this seller, at this price, with an acceptable validator and enough time left.
- **Refs:** §5.1(5), §11.2 · FR-05, SR-11, FR-03 · DF-04, DF-22, DF-23
- **Skill:** `test-driven-development`, `spec-to-code-compliance`
- **Depends:** SPEC-001, SPEC-002, AGENT-001, CONTRACT-004
- **Steps:** 1) Re-derive `resourceHash` from the raw bytes, the **configured origin** and the price table. 2) Read `jobs(jobId)`; check state Funded, `resourceHash` match, `payee == my wallet`, `payeeAgentId == mine`, token and amount, validator ∈ accepted set, `deadline − now ≥ minDeadlineMargin`. 3) Confirmations: require `CONFIRMATIONS` blocks (poll; no WebSocket), fail closed with 425 or 503. 4) Map every failure to the SPEC-002 error code.
- **Acceptance:** (a) a job funded for `/v1/classify` presented at `/v1/summarise` → 409 `resource_mismatch`; (b) a body mutated by one byte → 409; (c) a job with too little time left → 410; (d) RPC down → 503, never a grant; (e) reordered query parameters still match (SPEC-001 canonicalisation).
- **Verify:** `pnpm -C impl/agents/seller test -- verify` (against a local Anvil) → `evidence/API-003/`
- **Risks:** hash mismatches between buyer and seller → vectors are authoritative; debug with `previewResourceHash`.

### API-004 — Payer-signature authentication of retries

- [ ] **Status:** TODO · **Authorized:** no · **Tier:** CORE-P0 · **Est:** 0.5 h · **Hat/agent:** U(C) · agents-backend
- **Objective:** Stop anyone who merely read `jobId` from the chain from consuming the grant.
- **Refs:** §11.2 · FR-20, SR-05 · DF-02
- **Depends:** SPEC-001, SPEC-002, API-003
- **Steps:** 1) Parse `PAYMENT-SIGNATURE`; recover the EIP-712 `DeliveryRequest` signer. 2) Require `signer == job.payer`, `sellerOrigin == my configured origin`, `expiry` in the future and ≤ deadline, `clientNonce` unused. 3) Record the nonce; reject reuse with a distinct code.
- **Acceptance:** (a) a request with no signature → 403; (b) a signature from a non-payer → 403; (c) a replayed `clientNonce` → 409; (d) an expired signature → 403; (e) a signature for another seller's origin → 403.
- **Verify:** `pnpm -C impl/agents/seller test -- auth` → `evidence/API-004/`
- **Risks:** in-transit capture is still possible → TLS assumption, documented (DF-02).

### API-005 — Atomic delivery claim store

- [ ] **Status:** TODO · **Authorized:** no · **Tier:** CORE-P0 · **Est:** 2 h · **Hat/agent:** U(C) · agents-backend
- **Objective:** Guarantee one execution per funded job across concurrency, retries, restarts and multiple seller processes.
- **Refs:** §5.1(5), §9.3, §12.2 · FR-19 · DF-01, DF-17, DF-20 · V-13, V-17, V-25 · Gate: **G2**
- **Skill:** `test-driven-development`, `systematic-debugging`
- **Depends:** API-003, API-004, SPEC-002
- **Steps:** 1) SQLite in WAL mode at `CLAIMS_DB_PATH`, defaulting to `$HOME/.local/state/agenttrust/`; **warn loudly if the path is under `/mnt/`** (DF-20 — locking was measured working there, but writes are ~38× slower). 2) Table keyed by (chain_id, escrow, job_id) with the §6.6 columns; a `retry_nonces` table with a UNIQUE constraint. 3) Every transition in one `BEGIN IMMEDIATE` transaction. 4) Persist the result **before** sending bytes; lease takeover only when no result exists. 5) `REPLAY_POLICY=idempotent` default: re-serve stored bytes to the authenticated payer, counted as a replay, never a new execution. 6) Take the claim only after API-003/004 pass.
- **Acceptance:** (a) 50 concurrent authenticated retries across 2 processes → `executions_completed = 1`, `distinct_results = 1`, no 5xx; (b) `kill -9` mid-execution then restart → at most one stored result; (c) a handler exception → FAILED, retry allowed up to `MAX_EXEC_ATTEMPTS`; (d) a `/mnt/` database path produces a startup warning naming the measured slowdown, and the service still runs.
- **Verify:** `pnpm -C impl/agents/seller test -- claim` and `bash impl/scripts/claim-multiproc.sh 50 2` → `evidence/API-005/`
- **Risks:** DrvFs write latency under concurrency (default path avoids it; locking itself measured sound in ENV-002); native SQLite build issues → fall back to `node:sqlite`. Lease/crash edge tests move to E1 if G2 is at risk.

### API-006 — Evidence deposit, `validationRequest` and `bindValidation`

- [ ] **Status:** TODO · **Authorized:** no · **Tier:** CORE-P0 · **Est:** 1 h · **Hat/agent:** U(C) · agents-backend
- **Objective:** Make payment impossible without the result existing outside the seller, and bind exactly one validation request to the job.
- **Refs:** §5.1(6), §11.2 · FR-06, FR-21, FR-25 · DF-06, DF-08
- **Depends:** API-005, VAL-002, CONTRACT-007
- **Steps:** 1) Generate a random salt **first** and compute `requestHash`. 2) Sign a `DeliveryReceipt` that includes the salt and POST it with the response bytes to the validator; store the returned `evidenceId`. 3) Send `validationRequest(validator, agentId, requestURI, requestHash)`. 4) Send `bindValidation(jobId, salt)`; on a squatting revert, regenerate the salt, **re-deposit the corrected receipt** and retry (bounded). 5) Only then release the response to the buyer. 6) Record both transaction hashes in the claim row.
- **Acceptance:** (a) the buyer never receives bytes before the evidence is deposited; (b) a squatted hash is recovered from within 3 attempts; (c) binding happens exactly once per job; (d) failures leave a retryable state, never a double execution.
- **Verify:** `pnpm -C impl/agents/seller test -- evidence` (Anvil) → `evidence/API-006/`
- **Risks:** two extra transactions per job → seller ETH budget (ENV-007), gas in EVAL-002.

### API-007 — Response headers, error mapping, structured logs

- [ ] **Status:** TODO · **Authorized:** no · **Tier:** CORE-P0 · **Est:** 0.25 h · **Hat/agent:** U(C) · agents-backend
- **Objective:** Make responses safe to cache-never, errors machine-readable, and runs measurable.
- **Refs:** §11.2 · SR-14 · V-17 (mitigation M5)
- **Depends:** API-003
- **Steps:** 1) `Cache-Control: no-store` and `Vary` on paid routes. 2) A single error mapper implementing the SPEC-002 table. 3) NDJSON logs with `runId`, `jobId`, decision, timing and outcome — the harness reads these.
- **Acceptance:** every paid response carries `no-store`; every rejection logs a machine-readable reason that the harness can count.
- **Verify:** `pnpm -C impl/agents/seller test -- headers` → `evidence/API-007/`

### API-008 — Labelled vulnerable baseline fixture (A2/A3)

- [ ] **Status:** TODO · **Authorized:** no · **Tier:** CORE-P0 · **Est:** 1 h · **Hat/agent:** U(D) · agents-backend
- **Objective:** A control target that reproduces the published conditions — clearly labelled as a fixture, never as upstream x402.
- **Refs:** §12.1, §12.2 · FR-24 · DF-18 · V-13, V-24
- **Depends:** API-001, CONTRACT-002
- **Steps:** 1) A separate server sharing the fixture handlers. 2) Accept an EIP-3009-style authorization, verify it **off-chain only**, and grant immediately. 3) **No idempotency** (A2 conditions) and **no resource binding** (A3 conditions: the authorization names amount and payee, not the resource). 4) Settle asynchronously against MockUSDC so settlements can be counted. 5) Banner in the code, the logs, the CLI help and the results: "deliberately vulnerable fixture reproducing <paper §>; not upstream x402".
- **Acceptance:** the label appears in code, logs and `results.json`; replaying one authorization N times grants N times; an authorization minted for one sibling resource is accepted for the other.
- **Verify:** `pnpm -C impl/attacks test -- fixture` → `evidence/API-008/`
- **Risks:** being mistaken for upstream → the labelling rule is enforced by SEC-012.

### API-009 — Pinned upstream baseline on an Anvil fork

- [ ] **Status:** DEFERRED · **Authorized:** no · **Tier:** EXTENDED-E2 · **Est:** 3 h · **Hat/agent:** U(D)
- **Objective:** State honestly what pinned upstream `@x402/express@2.26.0` does today under A2 and A3.
- **Refs:** §12.1 · FR-24, FR-28 · DF-18 · V-63, V-65, V-135 · Depends: ENV-011, SEC-002
- **Acceptance:** a run against upstream with an in-process facilitator, reporting whether each attack reproduces — including "does not reproduce", which is a legitimate and interesting result.

### API-010 — Vulnerable fixtures for A1, A4 and A5

- [ ] **Status:** DEFERRED · **Authorized:** no · **Tier:** EXTENDED-E2 · **Est:** 1.5 h · **Hat/agent:** U(D)
- **Objective:** Optimistic pre-confirmation grant (A1), non-atomic check-then-act idempotency (A4), `upto` allowance (A5).
- **Refs:** §12.2 · DF-10, DF-11, DF-18 · V-15, V-25, V-26 · Depends: API-008

### Phase 7 — Buyer (AGENT)

### AGENT-001 — Shared TypeScript core library

- [ ] **Status:** TODO · **Authorized:** no · **Tier:** CORE-P0 · **Est:** 1.25 h · **Hat/agent:** U(C) · agents-backend
- **Objective:** Package the SPEC-001 reference hashing with typed data, ABIs and chain access for buyer, seller and harness.
- **Refs:** §9.1, §14.1 · FR-03, IR-05 · Depends: SPEC-001, CONTRACT-017
- **Steps:** 1) Adopt the SPEC-001 TypeScript reference implementation of canonicalisation and `resourceHash`/`jobId`/`requestHash` (do not re-implement it). 2) EIP-712 helpers for the three structs. 3) Typed contract clients from the exported ABIs (viem 2.56.8), with **polling** watchers. 4) `bigint` atomic amounts everywhere; a decimal-string parser for display only. 5) A vector-conformance test suite.
- **Acceptance:** 100% of `canonical-v1.json` vectors pass; no floating-point arithmetic touches an amount; watchers work over HTTP-only RPC.
- **Verify:** `pnpm -C impl/packages/core test` → `evidence/AGENT-001/`

### AGENT-002 — Deterministic buyer flow

- [ ] **Status:** TODO · **Authorized:** no · **Tier:** CORE-P0 · **Est:** 1.75 h · **Hat/agent:** U(C) · agents-backend
- **Objective:** The measured client: discover, quote, gate-check, fund, wait, retry signed, verify.
- **Refs:** §5.1, §11.1 · FR-01, FR-16, FR-20, SR-01 · DF-02, DF-04, DF-23
- **Depends:** AGENT-001, API-002, CONTRACT-004
- **Steps:** 1) Discovery: resolve `agentURI` → agent card → endpoint origin, and **refuse** if the origin differs from the host being called. 2) Request → parse 402 → verify `payTo` equals the registry-resolved wallet and the price matches the quote. 3) Pre-check the gate off-chain and abort early with a clear reason. 4) `approve` (exact amount) then `fund(...)`, reusing the **same nonce** on retries. 5) Wait `CONFIRMATIONS`. 6) Sign `DeliveryRequest`, retry with `PAYMENT-SIGNATURE`. 7) Verify the response hash against `PAYMENT-RESPONSE`, then persist the job record.
- **Acceptance:** (a) a complete happy path locally; (b) an origin mismatch aborts before funding; (c) a gated seller never receives a funding transaction; (d) a repeated retry after a dropped connection returns the same result without a second execution.
- **Verify:** `pnpm -C impl/agents/buyer test` → `evidence/AGENT-002/`

### AGENT-003 — Refund watcher and feedback posting

- [ ] **Status:** TODO · **Authorized:** no · **Tier:** CORE-P1 · **Est:** 0.75 h · **Hat/agent:** U(C) · agents-backend
- **Objective:** Close the loop: recover funds when delivery fails, and write reputation after completion.
- **Refs:** §5.1(7)(8), §11.1 · FR-07, FR-08 · DF-21 · Depends: AGENT-002, CONTRACT-008, SPEC-004
- **Steps:** 1) Watch jobs; after `deadline + GRACE` with no recorded pass, call `refund`. 2) After release or refund, call `giveFeedback` with the project tag, bps value, and a `feedbackHash` committing to the job. 3) One feedback per job, recorded locally.
- **Acceptance:** a refunded job triggers exactly one refund transaction and one negative feedback; a released job triggers one positive feedback; re-running posts nothing new.
- **Verify:** `pnpm -C impl/agents/buyer test -- lifecycle` → `evidence/AGENT-003/`

### AGENT-004 — Restart journal and retry hardening

- [ ] **Status:** DEFERRED · **Authorized:** no · **Tier:** EXTENDED-E1 · **Est:** 1 h · **Hat/agent:** U(C)
- **Objective:** Survive crashes without double-funding: persist intent before sending, and resume with the same nonce.
- **Refs:** DF-12 · Depends: AGENT-002

### AGENT-005 — LangGraph.js + LiteLLM buyer layer (demo only)

- [ ] **Status:** DEFERRED · **Authorized:** no · **Tier:** EXTENDED-E2 · **Est:** 4 h · **Hat/agent:** U(C)
- **Objective:** Wrap the deterministic buyer's operations as tools behind a small LangGraph agent, for narrative only.
- **Refs:** §8.1, §14.1 · FR-16, OPT-07 · DF-24 · V-108
- **Depends:** AGENT-002, an LLM API key (user-supplied), a LiteLLM proxy
- **Acceptance:** the agent completes one job end to end; **no measurement uses it**, and the docs say so.

### AGENT-006 — Buyer CLI and demo commands

- [ ] **Status:** TODO · **Authorized:** no · **Tier:** CORE-P0 · **Est:** 0.25 h · **Hat/agent:** U(C) · agents-backend
- **Objective:** The commands the demo and the harness call.
- **Refs:** §18 · FR-18 · DF-13 · Depends: AGENT-002
- **Steps:** 1) `buy --resource <path> --amount <atomic>`; `refund --job <id>`; `status --job <id>`. 2) npm scripts `target:vanilla`, `target:agenttrust`, `attack`. 3) Human-readable output with the counters the video shows (executions, payments).
- **Acceptance:** the §18 command names work; output distinguishes executions from 2xx responses.
- **Verify:** run each command against Anvil → `evidence/AGENT-006/`

### Phase 8 — Validator (VAL)

### VAL-001 — FastAPI skeleton, configuration, key handling

- [ ] **Status:** TODO · **Authorized:** no · **Tier:** CORE-P0 · **Est:** 0.5 h · **Hat/agent:** U(B) · agents-backend
- **Objective:** An independent process with its own key, able to read the chain and send two transactions.
- **Refs:** §8.1, §14.1 · FR-27, SR-13 · U3
- **Depends:** ENV-005, CONTRACT-017
- **Steps:** 1) `uv` project, FastAPI, web3.py, pydantic settings. 2) Load the validator key from a keystore or env; never log it. 3) `/health` reporting chain connectivity and the configured escrow and registry addresses.
- **Acceptance:** starts only with a complete configuration; `/health` shows the expected chain id; the key never appears in logs.
- **Verify:** `uv run pytest impl/validator -k health` → `evidence/VAL-001/`

### VAL-002 — Evidence intake

- [ ] **Status:** TODO · **Authorized:** no · **Tier:** CORE-P0 · **Est:** 0.5 h · **Hat/agent:** U(B) · agents-backend
- **Objective:** Accept and authenticate the seller's delivery evidence before any attestation exists.
- **Refs:** §5.1(6) · FR-25 · DF-08 · Depends: VAL-001, SPEC-001
- **Steps:** 1) `POST /evidence` with the seller-signed `DeliveryReceipt` (jobId, resourceHash, responseHash, sellerAgentId, servedAt, **salt**) plus response bytes. 2) Verify the signature against the on-chain payee wallet for `job.payeeAgentId`. 3) Derive and store the expected `requestHash` from the salt. 4) Store content-addressed by `responseHash`; return `evidenceId`. 5) Reject evidence for unknown or non-Funded jobs, or when the derived `resourceHash` does not match the job.
- **Acceptance:** a receipt signed by anyone other than the payee is rejected; a stored bundle is retrievable by `jobId` internally; the stored hash equals the hash of the bytes.
- **Verify:** `uv run pytest impl/validator -k evidence` → `evidence/VAL-002/`

### VAL-003 — Independent checks: Python canonical hash and deterministic recompute

- [ ] **Status:** TODO · **Authorized:** no · **Tier:** CORE-P0 · **Est:** 1 h · **Hat/agent:** U(B) · agents-backend
- **Objective:** Re-derive everything independently — this is why the validator is a separate language.
- **Refs:** §5.1(6) · FR-03, FR-06, IR-05 · DF-08 · Gate: **G3b**
- **Skill:** `test-driven-development`, `spec-to-code-compliance`
- **Depends:** SPEC-001, VAL-002
- **Steps:** 1) Implement the canonicalisation and the three hashes in Python **from the spec, not by porting the TypeScript**. 2) Run the shared vectors in pytest. 3) Check the job on-chain (state, resourceHash, payee, validator, deadline). 4) Recompute the deterministic fixture output from the request body and compare hashes. 5) Decide pass (100) or fail (0) with a reason.
- **Acceptance:** 100% of `canonical-v1.json` passes in Python; a tampered response byte yields a fail decision; a job whose `resourceHash` does not match the evidence yields a fail.
- **Verify:** `uv run pytest impl/validator -k vectors` and `-k decide` → `evidence/VAL-003/`
- **Risks:** a vector mismatch between languages is a **spec** defect first — fix SPEC-001, then both implementations (R-05).

### VAL-004 — Read-before-write `validationResponse` and immediate release

- [ ] **Status:** TODO · **Authorized:** no · **Tier:** CORE-P0 · **Est:** 1 h · **Hat/agent:** U(B) · agents-backend
- **Objective:** Post exactly one attestation, never after the deadline, and settle immediately so a late release cannot strand the seller.
- **Refs:** §5.1(6)(7) · FR-06, FR-22 · DF-05, DF-15 · V-94
- **Depends:** VAL-003, CONTRACT-007
- **Steps:** 1) Poll `jobs(jobId).requestHash` until it equals the hash derived from the evidence salt (bounded wait, stop at `deadline`) — this proves the seller both filed and bound the request. 2) Read `getValidationStatus(requestHash)` (revert-safe); if a response already exists, do nothing. 3) Refuse to respond when `now > deadline`. 4) Send `validationResponse(requestHash, 100|0, responseURI, responseHash, "agenttrust")`. 5) On a pass, immediately call `release(jobId)` and record both transaction hashes. 6) If the binding never appears, log `binding_timeout` and exit without responding.
- **Acceptance:** (a) exactly one response per job even if the intake is retried; (b) no response is sent after the deadline; (c) a pass is followed by a successful release in the same run; (d) a fail posts a response and no release; (e) evidence whose binding never appears yields `binding_timeout`, no response, and a successful refund after grace.
- **Verify:** `uv run pytest impl/validator -k respond` (Anvil) → `evidence/VAL-004/`

### VAL-005 — Downtime and recovery drills

- [ ] **Status:** DEFERRED · **Authorized:** no · **Tier:** EXTENDED-E1 · **Est:** 0.75 h · **Hat/agent:** U(B)
- **Objective:** Prove that a validator restart never double-attests and never attests late.
- **Refs:** DF-15 · Depends: VAL-004

### VAL-006 — Persistent evidence store and payer retrieval

- [ ] **Status:** TODO · **Authorized:** no · **Tier:** CORE-P1 · **Est:** 0.75 h · **Hat/agent:** U(B) · agents-backend
- **Objective:** Let the payer always fetch the result the seller was paid for — the step that upgrades the delivery claim.
- **Refs:** §5.1(6) · FR-25 · DF-08
- **Depends:** VAL-002
- **Steps:** 1) Persist evidence to disk with an index. 2) `GET /evidence/{jobId}` authenticated by a payer-signed `EvidenceAccess`. 3) Return the exact stored bytes plus the seller receipt.
- **Acceptance:** the payer retrieves byte-identical output; anyone else is refused; **if this task is cut, DOC/PRES revert to the narrower wording (DF-08).**
- **Verify:** `uv run pytest impl/validator -k retrieval` → `evidence/VAL-006/`

### Phase 9 — Integration (INT)

### INT-001 — Local happy-path end to end, with per-stage timestamps

- [ ] **Status:** TODO · **Authorized:** no · **Tier:** CORE-P0 · **Est:** 1.75 h · **Hat/agent:** U(C) · agents-backend
- **Objective:** One command that runs discovery → quote → fund → deliver → attest → release on Anvil, and records timings.
- **Refs:** §5.1, §15 M1 · FR-05…FR-07, ER-06 · Gate: **G3b** · Depends: AGENT-002, API-006, VAL-004, ENV-004
- **Steps:** 1) `impl/scripts/e2e-happy.sh` starting the devnet and all services. 2) Run one job; assert the seller's balance increased by exactly the amount and the buyer's decreased by the same. 3) Capture timestamps at each stage into `evidence/INT-001/timings.ndjson` (EVAL-006). 4) Assert exactly one execution and one attestation.
- **Acceptance:** a green run from a cold start; balances exact; one execution; timings recorded for every stage.
- **Verify:** `bash impl/scripts/e2e-happy.sh` → `evidence/INT-001/`
- **Risks:** the most likely task to overrun; orchestration issues are cut first by simplifying to a single-process runner.

### INT-002 — Local refund paths

- [ ] **Status:** TODO · **Authorized:** no · **Tier:** CORE-P0 · **Est:** 0.5 h · **Hat/agent:** U(C) · agents-backend
- **Objective:** Prove the buyer's safety valve in the two realistic failure modes.
- **Refs:** §5.1(7) · FR-07 · DF-05 · Depends: INT-001, CONTRACT-008
- **Steps:** 1) Validator offline: fund, deliver, no attestation → warp past deadline + grace → refund succeeds, buyer made whole. 2) Failing validation: validator responds 0 → refund after grace succeeds. 3) Assert refund is impossible while a timely pass exists.
- **Acceptance:** both refunds succeed with exact balances; the negative case reverts `ValidationExists`.
- **Verify:** `bash impl/scripts/e2e-refund.sh` → `evidence/INT-002/`

### INT-003 — Full Base Sepolia end to end

- [ ] **Status:** DEFERRED · **Authorized:** no · **Tier:** EXTENDED-E1 · **Est:** 1 h · **Hat/agent:** U(C)
- **Objective:** One real paid job on testnet, with all five transaction hashes recorded for the slide.
- **Refs:** §15 M1, §16 · Depends: DEPLOY-003, ENV-007 · Risks: RPC limits, faucet funds.

### INT-004 — Fault injection

- [ ] **Status:** DEFERRED · **Authorized:** no · **Tier:** EXTENDED-E2 · **Est:** 2 h · **Hat/agent:** U(C)
- **Objective:** RPC failure, seller restart mid-delivery, two seller processes, validator restart.
- **Refs:** DF-12, DF-15, DF-17 · Depends: INT-001

### Phase 10 — Deployment (DEPLOY)

### DEPLOY-001 — Deploy to Base Sepolia

- [ ] **Status:** TODO · **Authorized:** no (**needs explicit user authorization**) · **Tier:** CORE-P0 · **Est:** 0.5 h · **Hat/agent:** U(A) · contracts-protocol
- **Objective:** Put the escrow and the same-ABI mocks on testnet, so the deck can show a real address.
- **Refs:** §16, §20 · OR-06 · V-85, V-86 · Gate: **DEPLOY (Thu evening)**
- **Depends:** CONTRACT-017, ENV-007 (funds), G1 passed
- **Steps:** 1) Confirm the deployer balance. 2) `forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast` with keystore signing. 3) Token = the real Circle USDC (V-81) on the allowlist. 4) Record addresses, block and commit.
- **Acceptance:** all contracts deployed; the escrow's constructor parameters match `docs/specs/versions.md`; transaction hashes recorded.
- **Verify:** `cast code <escrow>` non-empty → `evidence/DEPLOY-001/`
- **Risks:** no funds by Thursday → local-only demo, stated plainly (R-02); deployment retried until Mon 12:00.

### DEPLOY-002 — Verify the contracts on an explorer

- [ ] **Status:** TODO · **Authorized:** no · **Tier:** CORE-P0 · **Est:** 0.5 h · **Hat/agent:** U(A) · contracts-protocol
- **Objective:** A verified source listing — §20 calls this an explicit scoring behaviour.
- **Refs:** §16, §20 · OR-06 · V-85
- **Depends:** DEPLOY-001
- **Steps:** 1) Try Blockscout first (no key): `forge verify-contract --verifier blockscout --verifier-url https://base-sepolia.blockscout.com/api/`. 2) Otherwise Etherscan V2 with `chainid=84532` and a key. 3) Record the verified URLs.
- **Acceptance:** the source is readable on at least one explorer; the link is in `deployments/base-sepolia.json` and on the final slide.
- **Verify:** open both URLs; screenshot → `evidence/DEPLOY-002/`
- **Risks:** verifier API changes → two independent paths are planned.

### DEPLOY-003 — Deployment records and smoke test

- [ ] **Status:** TODO · **Authorized:** no · **Tier:** CORE-P0 · **Est:** 0.5 h · **Hat/agent:** U(A) · contracts-protocol
- **Objective:** Make the deployment usable and provable.
- **Refs:** App. B, §16 · OR-07, IR-06 · Depends: DEPLOY-002
- **Steps:** 1) Write `deployments/base-sepolia.json` (addresses, ABIs or ABI hashes, block, commit, explorer links, verified flag). 2) Smoke test: read `jobs(0)` and the gate floors through the deployed contract from the TypeScript client. 3) Note the deployment in the README.
- **Acceptance:** a fresh clone can point its clients at testnet using only this file; the smoke test passes.
- **Verify:** smoke script output → `evidence/DEPLOY-003/`

### DEPLOY-004 — Polygon Amoy deployment (conditional)

- [ ] **Status:** DEFERRED · **Authorized:** no · **Tier:** EXTENDED-E2 · **Est:** 1 h · **Hat/agent:** U(A)
- **Objective:** Only if Base Sepolia is unusable **and** DEPLOY-005 says it is feasible.
- **Refs:** §19 · OR-04 · V-71, V-82

### DEPLOY-005 — Fallback-network feasibility check

- [ ] **Status:** DEFERRED · **Authorized:** no · **Tier:** EXTENDED-E2 · **Est:** 0.5 h · **Hat/agent:** U(A)
- **Objective:** Before trusting the blueprint's fallback, check what Amoy actually requires.
- **Refs:** §14.2, §19 · OR-04 · V-71, V-82, V-132, V-133
- **Steps:** confirm Amoy USDC, faucet availability, EVM version support, and whether any ERC-8004 registry exists there; write a go/no-go.
- **Acceptance:** a written verdict with sources, before any Amoy work starts.

### Phase 11 — Security evaluation (SEC)

### SEC-001 — Threat model v1

- [ ] **Status:** TODO · **Authorized:** no · **Tier:** CORE-P1 · **Est:** 0.25 h (TM drafts) · **Hat/agent:** U(D)+TM · security-eval
- **Objective:** One page naming assets, adversaries, corrected trust assumptions and what is out of scope.
- **Refs:** §4, §16 · SR-05, SR-06, SR-07, SR-08, AR-10 · DF-07, DF-08 · Depends: design-findings.md
- **Steps:** 1) Assets from §4.1. 2) Adversaries: the blueprint's four plus the `jobId` observer, a colluding or malicious validator, the registry upgrader and a malicious token. 3) Corrected assumptions (DF-07). 4) A table mapping threat → mechanism → evaluation task. 5) Uncovered published classes (settlement preemption, HTTP/proxy cache, denial of settlement, hidden-compute pricing) listed as limitations.
- **Acceptance:** fits one page; every mechanism named is one that actually exists in the code or is marked "planned".
- **Verify:** cross-check every row against §6 and the task list → `evidence/SEC-001/`

### SEC-002 — Harness framework, results schema and run manifest

- [ ] **Status:** TODO · **Authorized:** no · **Tier:** CORE-P0 · **Est:** 1.5 h · **Hat/agent:** U(D) · security-eval
- **Objective:** The measurement spine: one command runs an attack against a target and writes machine-readable results nobody has to retype.
- **Refs:** §12.1, §18 · FR-13, ER-08 · evaluation-plan §7 · Depends: API-008, AGENT-006
- **Steps:** 1) `impl/attacks/harness.ts` with `--id <attack> --target <fixture|agenttrust> --runs N --concurrency C --seed S`. 2) Target adapters; service lifecycle; state reset between runs. 3) Collect counters from seller NDJSON logs plus chain events; never from human observation. 4) Write `manifest.json` and `results.json` per the schema; store raw logs alongside. 5) Fail loudly if versions or configuration cannot be captured.
- **Acceptance:** a run produces a complete manifest (commit, versions, chain, config, seed) and results; re-running with the same seed reproduces the counters; a missing version field aborts the run.
- **Verify:** `pnpm -C impl/attacks start -- --id a2_replay --target fixture --runs 2` → `evidence/SEC-002/`

### SEC-003 — A2 replay evaluation

- [ ] **Status:** TODO · **Authorized:** no · **Tier:** CORE-P0 · **Est:** 1.5 h · **Hat/agent:** U(D) · security-eval
- **Objective:** Measure executions per payment on both targets, sequentially and under concurrency.
- **Refs:** §3 A2, §12.2, §13(2) · FR-14, ER-02, ER-09 · DF-01, DF-17, DF-18 · V-12, V-13 · Gate: **G3a**
- **Depends:** SEC-002, API-005, AGENT-002
- **Steps:** 1) Fund/pay once per run. 2) Replay N = 50 sequential, 50 concurrent, 200 concurrent; AgentTrust runs across 2 seller processes. 3) Variants: original signature, no signature, foreign signature. 4) ≥10 runs per configuration. 5) Also attempt a second `fund()` with the same nonce and record the revert selector.
- **Acceptance:** results record executions, distinct results, 2xx, replays and settlements per run, with medians and Wilson intervals; the fixture's label appears in every row; the outcome category is assigned per the evaluation plan.
- **Verify:** `--id a2_replay` for both targets → `impl/attacks/results/`, `evidence/SEC-003/`
- **Hypotheses:** H-A2-1 fixture executions ≈ N; H-A2-2 AgentTrust executions = 1 with unsigned replays refused. **Either may be refuted; the measured value is what gets published.**

### SEC-004 — A3 cross-resource substitution (buyer-side)

- [ ] **Status:** TODO · **Authorized:** no · **Tier:** CORE-P0 · **Est:** 1 h · **Hat/agent:** U(D) · security-eval
- **Objective:** Measure whether a payment for one resource buys another.
- **Refs:** §3 A3, §12.2 · FR-14, ER-09 · DF-04, DF-18 · V-24 · Gate: **G3a**
- **Depends:** SEC-002, API-003, SPEC-001
- **Steps:** 1) Equal-price sibling pair. 2) 100 rounds per target: fund for `/v1/summarise`, request `/v1/classify`. 3) Negative controls: one-byte body mutation; reordered query parameters (must **not** be rejected); correct request (must succeed).
- **Acceptance:** substitution counts with Wilson intervals; zero false rejections on the canonicalisation controls; rejection codes recorded.
- **Verify:** `--id a3_cross_resource` both targets → `evidence/SEC-004/`
- **Hypotheses:** H-A3-1 fixture substitutes 100/100; H-A3-2 AgentTrust 0/100 with 409; H-A3-3 zero false rejections.

### SEC-005 — A4 concurrent duplication

- [ ] **Status:** DEFERRED · **Authorized:** no · **Tier:** EXTENDED-E2 · **Est:** 2 h · **Hat/agent:** U(D)
- **Refs:** §3 A4, §12.2 · DF-01 · V-25 · Depends: API-010, SEC-002
- **Objective:** 50 rounds × {10, 20, 50} concurrency per target; AgentTrust across two processes; measure rounds with more than one execution.

### SEC-006 — A5 overdraft and leakage, both directions

- [ ] **Status:** DEFERRED · **Authorized:** no · **Tier:** EXTENDED-E2 · **Est:** 2.5 h · **Hat/agent:** U(D)
- **Refs:** §3 A5, §13(3) · ER-03 · DF-10 · V-26 · Depends: API-010
- **Objective:** ρ on the `upto` fixture versus pre-funded escrow; seller over-draw attempt; and the honest-seller residual (delivered but refunded).

### SEC-007 — A6 Sybil selection and the gate

- [ ] **Status:** DEFERRED · **Authorized:** no · **Tier:** EXTENDED-E2 · **Est:** 3 h · **Hat/agent:** U(D)
- **Refs:** §3 A6, §12.2, §13(4) · ER-04 · DF-09, DF-21 · V-14 · Depends: REG-009, CONTRACT-005
- **Objective:** Capture share under no gate / gate v1 (mock-only) / gate v2; the five-agent cross-endorsing ring; an honest-then-defect Sybil; false refusals of honest newcomers; gas versus feedback history.
- **Note:** H-A6-2 predicts the **blueprint's own gate admits the ring** — a negative result about the original design, and one of the more interesting findings if it holds.

### SEC-008 — A1 revert-grant under reorgs

- [ ] **Status:** DEFERRED · **Authorized:** no · **Tier:** EXTENDED-E2 · **Est:** 3 h · **Hat/agent:** U(D)
- **Refs:** §3 A1, §12.2 · DF-11 · V-15, V-107 · Depends: API-010
- **Objective:** `anvil_reorg` at depths {1,2,3,5} against confirmation policies {0,1,3}; report "mitigated up to depth k", never "blocked".

### SEC-009 — Derived adversarial scenarios

- [ ] **Status:** DEFERRED · **Authorized:** no · **Tier:** EXTENDED-E2 · **Est:** 2 h · **Hat/agent:** U(D)
- **Refs:** DF-02, DF-05, DF-06, DF-15, DF-22 · Depends: SEC-002
- **Objective:** `jobId` front-running; late attestation with delayed release; validator fail→pass flip racing a refund; requestHash squatting; tiny-TTL free service; unauthenticated evidence retrieval.

### SEC-010 — Security review of the services

- [ ] **Status:** DEFERRED · **Authorized:** no · **Tier:** EXTENDED-E1 · **Est:** 1 h · **Hat/agent:** U(D)
- **Refs:** §20 · Skill: `/security-review`, `differential-review` · Depends: API-007, VAL-004
- **Objective:** Review the seller, buyer and validator for injection, SSRF, secret handling and error leakage; log findings and dispositions.

### SEC-011 — Ethics and scope note

- [ ] **Status:** TODO · **Authorized:** no · **Tier:** CORE-P0 · **Est:** 0.1 h · **Hat/agent:** U(D)
- **Refs:** §12.4 · SR-15 · Depends: —
- **Objective:** One paragraph, used in the README and on a slide: own endpoints, public testnet, valueless tokens, already-published vulnerabilities, no third-party targets.
- **Acceptance:** present in `docs/results.md`, the README and the deck.

### SEC-012 — Claims audit

- [ ] **Status:** TODO · **Authorized:** no · **Tier:** CORE-P1 · **Est:** 0.25 h · **Hat/agent:** U(D)+TM
- **Objective:** Check every public sentence against what was actually measured and built.
- **Refs:** §0.4, §1, §7.2, §13, §17, §21, App. A · ER-10, AR-04, AR-13 · DF-08, DF-18, DF-19
- **Depends:** EVAL-004, EVAL-005
- **Steps:** 1) Walk the README, slides, glossary, CV wording and demo narration. 2) For each claim, find its evidence (V-ID, results row, or task). 3) Fix or delete anything unsupported. 4) Confirm every baseline is labelled a fixture and the delivery wording matches whether VAL-006 shipped.
- **Acceptance:** a checklist where every claim maps to evidence; zero unsupported numbers; the novelty sentence matches DF-19.
- **Verify:** the completed checklist → `evidence/SEC-012/`

### SEC-013 — A3 seller-side substitution via the validator

- [ ] **Status:** TODO · **Authorized:** no · **Tier:** CORE-P1 · **Est:** 0.5 h · **Hat/agent:** U(D) · security-eval
- **Objective:** Show that a seller cannot get paid for delivering the wrong thing.
- **Refs:** §9.4, §12.2 · DF-13 · Depends: VAL-003, CONTRACT-007
- **Steps:** 1) Seller returns the sibling resource's output for a job funded for the other. 2) Validator recomputes and responds 0. 3) Assert no release before the deadline and a successful refund after grace.
- **Acceptance:** release reverts `NotValidated`; refund succeeds after grace; the validator's reason is recorded.
- **Verify:** `--id a3_seller_side` → `evidence/SEC-013/`

### Phase 12 — Measurement (EVAL)

### EVAL-001 — Freeze the measurement protocol

- [ ] **Status:** TODO · **Authorized:** no · **Tier:** CORE-P0 · **Est:** 0.25 h · **Hat/agent:** U(D) · security-eval
- **Objective:** Fix run counts, concurrency levels, statistics and baseline configuration **before** the first measured run, so nothing can be tuned afterwards.
- **Refs:** §13 · ER-08, ER-10 · evaluation-plan §6 · Depends: SEC-002
- **Acceptance:** the frozen parameters are committed and referenced by every manifest; any later change is recorded with a reason and triggers a re-run.

### EVAL-002 — Gas measurements

- [ ] **Status:** TODO · **Authorized:** no · **Tier:** CORE-P1 · **Est:** 0.5 h · **Hat/agent:** U(A)
- **Objective:** Gas for each entry point and for the whole five-transaction flow, locally and on testnet.
- **Refs:** §13(5) · ER-05 · DF-06 · Depends: CONTRACT-015, DEPLOY-003
- **Steps:** 1) `forge test --gas-report` and `forge snapshot`. 2) Real receipts for fund, validationRequest, bindValidation, validationResponse, release. 3) USD at a stated gas price and ETH/USD source **with the date**. 4) Also record gate gas versus trusted-client count and feedback history.
- **Acceptance:** a table with gas per function, the flow total, and an honest USD figure with its assumptions stated.
- **Verify:** gas report + receipts → `evidence/EVAL-002/`

### EVAL-003 — Latency study

- [ ] **Status:** DEFERRED · **Authorized:** no · **Tier:** EXTENDED-E2 · **Est:** 2 h · **Hat/agent:** U(D)
- **Refs:** §13(6) · ER-06 · DF-23 · Depends: EVAL-006
- **Objective:** Fixture versus AgentTrust end-to-end latency at 2 s block time and on testnet, by stage, with confirmation depth as the variable.

### EVAL-004 — Aggregate results into `docs/results.md`

- [ ] **Status:** TODO · **Authorized:** no · **Tier:** CORE-P0 · **Est:** 1 h · **Hat/agent:** U(D) · security-eval
- **Objective:** Turn raw `results.json` files into the tables and charts that go in the README and the deck — with no hand-typed numbers.
- **Refs:** §12.3, §13 · ER-07, ER-10 · Skill: `dataviz` · Depends: SEC-003, SEC-004
- **Steps:** 1) A script that reads every `results.json` and emits `docs/results.tables.md` plus a chart — **generated, never hand-edited**. 2) Include run counts, medians, intervals and the environment. 3) Write the narrative in `docs/results.md` (what held, what did not, what was not evaluated), including the generated tables. 4) Link raw logs for each row.
- **Acceptance:** regenerating reproduces `docs/results.tables.md` byte-for-byte; every number traces to a run id; "Not evaluated" rows are present where true; the narrative contains no hand-typed figures.
- **Verify:** `pnpm -C impl/attacks report` then `git diff --exit-code docs/results.tables.md` → `evidence/EVAL-004/`

### EVAL-005 — Defence coverage table

- [ ] **Status:** TODO · **Authorized:** no · **Tier:** CORE-P0 · **Est:** 0.25 h · **Hat/agent:** U(D)
- **Objective:** State coverage honestly, with its denominator and outcome categories.
- **Refs:** §12.3, §13(1) · ER-01 · DF-18, DF-19 · Depends: EVAL-004
- **Acceptance:** the table names the denominator ("evaluated X of the 6 defined attacks"), uses Blocked / Mitigated-to-bound / Not blocked / Not evaluated, and names the mechanism for each blocked row.

### EVAL-006 — Per-stage timestamps in E2E runs

- [ ] **Status:** TODO · **Authorized:** no · **Tier:** CORE-P0 · **Est:** 0.25 h · **Hat/agent:** U(C)
- **Objective:** Cheap latency evidence captured inside INT-001, so §13(6) has data even if EVAL-003 is cut.
- **Refs:** §13(6) · ER-06 · Depends: INT-001
- **Acceptance:** each stage's duration recorded for ≥10 local runs, with the confirmation setting noted.

### Phase 13 — Dashboard (DASH)

### DASH-001 — Minimal read-only dashboard

- [ ] **Status:** DEFERRED · **Authorized:** no · **Tier:** EXTENDED-E2 · **Est:** 4 h · **Hat/agent:** U(C)
- **Objective:** React + viem view of jobs and their states, plus the results table.
- **Refs:** §8.1, §14.1 · FR-15 · Skill: `frontend-design`, `dataviz` · Depends: CONTRACT-017, EVAL-004
- **Note:** polling only (no WebSocket, V-83).

### DASH-002 — Attack console

- [ ] **Status:** DEFERRED · **Authorized:** no · **Tier:** STRETCH · **Hat/agent:** U(C) · **Refs:** §14.1 · OPT-08

### Phase 14 — Documentation (DOC)

### DOC-001 — README

- [ ] **Status:** TODO · **Authorized:** no · **Tier:** CORE-P0 · **Est:** 0.5 h (TM drafts the problem statement) · **Hat/agent:** U(D)+TM
- **Objective:** Problem first, then what this is, how to run it, and what it does not claim.
- **Refs:** §16, §20 · AR-08, AR-12, AR-13 · DF-03, DF-19 · Depends: INT-001, EVAL-004
- **Steps:** 1) Problem statement with verified figures only. 2) What AgentTrust is, with the honest x402 interoperability sentence. 3) Quickstart: devnet, services, one paid job, one attack run. 4) Results summary linking `docs/results.md`. 5) Deployed addresses and explorer links. 6) Limitations link. 7) Licence and the ethics note.
- **Acceptance:** a reader who has never seen the project can run the local demo from the README alone; every figure cites a V-ID or a results row.
- **Verify:** follow it on a clean clone (DOC-006 formalises this) → `evidence/DOC-001/`

### DOC-002 — Architecture document and corrected diagram

- [ ] **Status:** DEFERRED · **Authorized:** no · **Tier:** EXTENDED-E1 · **Est:** 1 h · **Hat/agent:** U(C)
- **Refs:** §8.1 · Depends: INT-001 · Objective: redraw §8.1 with the facilitator only on the baseline path and the validator's evidence store included.

### DOC-003 — One-page threat model document

- [ ] **Status:** TODO · **Authorized:** no · **Tier:** CORE-P1 · **Est:** 0.25 h · **Hat/agent:** TM
- **Refs:** §16 · AR-10 · Depends: SEC-001 · Objective: the publishable one-pager plus the backup slide.

### DOC-004 — Limitations and honest scoping

- [ ] **Status:** TODO · **Authorized:** no · **Tier:** CORE-P0 · **Est:** 0.25 h (TM drafts) · **Hat/agent:** U(D)+TM
- **Objective:** Say plainly what the system does not do — §20 rewards exactly this.
- **Refs:** §4.3, §4.4, §6.3, §20 · SR-06…SR-08, AR-17 · DF-07, DF-08, DF-09, DF-16, DF-24
- **Depends:** design-findings.md, EVAL-004
- **Steps:** list: single selected validator must be honest; collusion unsolved; content quality only for deterministic fixtures; trust anchors are per-buyer and hurt cold start; mocks unless REG-005/007 ran; fixtures are not upstream; blacklisted payee can strand funds; no multi-host seller; LLM layer absent if AGENT-005 was cut; attacks not evaluated.
- **Acceptance:** every limitation traces to a DF or a measurement gap; nothing is hidden behind vague wording.

### DOC-005 — Verified references list

- [ ] **Status:** TODO · **Authorized:** no · **Tier:** CORE-P0 · **Est:** 1 h · **Hat/agent:** TM
- **Objective:** Every citation checked before it goes on a slide — the blueprint's own closing instruction.
- **Refs:** §22, footer · AR-11, AR-18, IR-03 · DF-19 · Depends: verification-log.md
- **Steps:** 1) Re-open each source and confirm title, authors, identifier and date. 2) Resolve V-22 (drop if still unsourced), V-30 (the quoted phrases), V-43/V-44 (switchboard, Vouch). 3) Add ERC-8183, auth-capture and ASP. 4) Produce `docs/references.md` and the slide list.
- **Acceptance:** zero citations without a working link and a checked date; unresolved items are marked as such or removed.
- **Verify:** link check output → `evidence/DOC-005/`

### DOC-006 — Reproduction guide and clean-clone check

- [ ] **Status:** DEFERRED · **Authorized:** no · **Tier:** EXTENDED-E1 · **Est:** 1.5 h · **Hat/agent:** U(C)
- **Refs:** §16, OR-09 · Depends: DOC-001, SEC-003 · Objective: a fresh clone reproduces the local demo and one attack run from documented commands.

### DOC-007 — Evidence-based CV and interview wording

- [ ] **Status:** TODO · **Authorized:** no · **Tier:** CORE-P1 · **Est:** 0.25 h · **Hat/agent:** U(D)
- **Refs:** §21 · AR-15 · DF-19 · Depends: EVAL-005, SEC-012
- **Objective:** Rewrite the CV bullet to name only what was measured, and prepare the §21.3 answers with the corrected trust assumptions.
- **Acceptance:** no claim in the bullet lacks a results row; "all six" appears only if six were evaluated.

### DOC-008 — ADRs for the accepted decisions

- [ ] **Status:** DEFERRED · **Authorized:** no · **Tier:** EXTENDED-E1 · **Est:** 1 h · **Hat/agent:** U(A)
- **Refs:** CLAUDE.md §10 · Depends: PLAN-007 · Objective: turn accepted D1–D6 and the other DFs into short ADRs under `docs/adr/`.

### DOC-009 — Pre-publication review

- [ ] **Status:** TODO · **Authorized:** no (**user decision required**) · **Tier:** CORE-P0 · **Est:** 0.5 h · **Hat/agent:** U+TM
- **Objective:** Decide what becomes public, and make sure nothing sensitive ships.
- **Refs:** §16 · OR-10, SR-13, AR-08 · U5 · Depends: DOC-001, ADMIN-004
- **Steps:** 1) Secret scan across history (`git log -p | grep -E "0x[a-fA-F0-9]{64}"` and a tool if available). 2) Decide the fate of the blueprint (personal CV and role notes) and the planning critiques: publish, redact or keep private. 3) Add a LICENCE and a `NOTICE` covering the vendored MIT skills. 4) Flip the repository to public only after the user confirms.
- **Acceptance:** no secret in history; the user has explicitly chosen what is published; licences are present.
- **Verify:** scan output + the user's decision recorded in §14 → `evidence/DOC-009/`

### Phase 15 — Presentation (PRES)

### PRES-001 — Five-slide outline (~380 words)

- [ ] **Status:** TODO · **Authorized:** no · **Tier:** CORE-P0 · **Est:** 0.5 h review (TM drafts) · **Hat/agent:** TM+U(D)
- **Objective:** The script, using only verified figures and claims that match what exists.
- **Refs:** §17, §20 · AR-04, AR-05, AR-12, AR-14, AR-18 · DF-08, DF-19 · Depends: design-findings.md, verification-log.md
- **Steps:** 1) Slide 1 hook with attributed adoption figures (V-21/V-74), not the unresolved 725→50M (V-22). 2) Slide 2 problem: attacks attributed per paper (V-11). 3) Slide 3 solution: gate, resource-bound escrow, validation-triggered release — with DF-08 wording. 4) Slide 4 demo. 5) Slide 5 results with the coverage denominator, address, QR. 6) Keep §6.2 verbatim for the "why blockchain" beat.
- **Acceptance:** ≈380 words; every number has a source; no claim outruns the implementation.

### PRES-002 — Build the deck and backup slides

- [ ] **Status:** TODO · **Authorized:** no · **Tier:** CORE-P0 · **Est:** 3 h · **Hat/agent:** TM
- **Refs:** §0.2, §17 · AR-02, AR-05, AR-07 · Skill: `anthropic-skills:pptx` · Depends: PRES-001, ADMIN-002, PRES-006
- **Steps:** 1) Five slides from the outline. 2) Backup slides: architecture, threat model, results detail, limitations, related work (incl. ERC-8183). 3) Export in the required format (convert if `.ppt` is mandatory). 4) File name `GP_XX_AgentTrust`.
- **Acceptance:** opens cleanly, correct filename, backup slides present, every figure sourced.

### PRES-003 — Record the 45-second demo

- [ ] **Status:** TODO · **Authorized:** no · **Tier:** CORE-P0 · **Est:** 1.5 h · **Hat/agent:** U(C)
- **Objective:** The split-screen moment — with a narrative that matches the real defence.
- **Refs:** §17 Slide 4, §18 · AR-06 · DF-01, DF-13 · Depends: SEC-003, AGENT-006
- **Steps:** 1) Left: fixture — one payment, counter climbs. 2) Right: AgentTrust — first request executes, replays are refused (409/replay), and a re-fund attempt reverts `ReplayedNonce`. 3) Caption both panes, including the "deliberately vulnerable fixture" label. 4) 1080p, ≤45 s, cropped to the counters, no audio.
- **Acceptance:** the counters on screen match `results.json`; the labels are legible; nothing in the video implies upstream x402 was attacked.
- **Verify:** the recorded file plus the matching run id → `evidence/PRES-003/`

### PRES-004 — Rehearsals and Q&A preparation

- [ ] **Status:** TODO · **Authorized:** no · **Tier:** CORE-P0 · **Est:** 1 h · **Hat/agent:** U(D)+TM
- **Refs:** §15, §17, §21.3, App. A · AR-16, AR-20 · Depends: PRES-002, PRES-003
- **Steps:** 1) Two timed rehearsals, target 2:50. 2) Q&A drill: why blockchain (§6.2), hardest part, what you would change, the weakness — with corrected trust assumptions (DF-07) and the corrected glossary entry for "attestation" (DF-08). 3) One presenter; no live network calls.
- **Acceptance:** two runs at ≤3:00; answers prepared for the four standard questions plus "is this really x402?" and "did your own gate stop the Sybils?".

### PRES-005 — Submission checklist

- [ ] **Status:** TODO · **Authorized:** no · **Tier:** CORE-P0 · **Est:** 0.25 h · **Hat/agent:** TM
- **Refs:** §0.2, §16 · AR-02 · Depends: PRES-002, DOC-009, ADMIN-002
- **Acceptance:** filename, format, one submission, deadline, repository visibility, contract link, demo video — each ticked with evidence.

### PRES-006 — Deck evidence assets

- [ ] **Status:** TODO · **Authorized:** no · **Tier:** CORE-P0 · **Est:** 0.25 h · **Hat/agent:** U(D)
- **Refs:** §16, §20 · AR-09 · Depends: CONTRACT-011, DEPLOY-002, EVAL-004
- **Objective:** Green `forge test` screenshot, verified-contract link and screenshot, repository QR code, results table image.
- **Acceptance:** all four assets exist and match the final commit.

### Phase 16 — Stretch (all DEFERRED; do not start before G4 and explicit authorization)

### STRETCH-001 — Kafka event bus

- [ ] **Status:** DEFERRED · **Authorized:** no · **Tier:** STRETCH · **Refs:** §8.1, §14.1 · OR-11 · Stream `JobFunded`/`JobReleased` to the dashboard.
### STRETCH-002 — Kubernetes deployment

- [ ] **Status:** DEFERRED · **Authorized:** no · **Tier:** STRETCH · **Refs:** §14.1 · OR-12
### STRETCH-003 — Keycloak service identity

- [ ] **Status:** DEFERRED · **Authorized:** no · **Tier:** STRETCH · **Refs:** §14.1 · OR-13
### STRETCH-004 — Validator staking and slashing

- [ ] **Status:** DEFERRED · **Authorized:** no · **Tier:** STRETCH · **Refs:** §21.3 · OPT-01 · DF-07
### STRETCH-005 — k-of-n validators

- [ ] **Status:** DEFERRED · **Authorized:** no · **Tier:** STRETCH · **Refs:** §21.3 · OPT-03 · DF-07
### STRETCH-006 — Gasless `fundWithAuthorization` and a registered x402 scheme

- [ ] **Status:** DEFERRED · **Authorized:** no · **Tier:** STRETCH · **Refs:** §11 · OPT-04 · DF-03 · V-47, V-66, V-67 · The most x402-native version of the design; evaluate `auth-capture` and x402r at the same time.
### STRETCH-007 — Optimistic release with a challenge window

- [ ] **Status:** DEFERRED · **Authorized:** no · **Tier:** STRETCH · **Refs:** §21.3 · OPT-02
### STRETCH-008 — Pull-payment `withdraw(to)`

- [ ] **Status:** DEFERRED · **Authorized:** no · **Tier:** STRETCH · **Refs:** DF-16 · OPT-05 · Removes the stranded-funds case.

### Phase 17 — Skill follow-ups (SKILL)

### SKILL-001 — Project skill `foundry-invariants`

- [ ] **Status:** DEFERRED · **Authorized:** no · **Tier:** EXTENDED-E2 · **Est:** 1 h · **Hat/agent:** U(A) · Skill: `skill-creator`
- **Objective:** Capture the handler pattern, ghost variables and invariant configuration that this project actually used.
### SKILL-002 — ADR template skill

- [ ] **Status:** DEFERRED · **Authorized:** no · **Tier:** EXTENDED-E2 · **Est:** 0.5 h · **Hat/agent:** U(D)
### SKILL-003 — `.claude/agents/` definitions for the five dev-assistant roles

- [ ] **Status:** DEFERRED · **Authorized:** no · **Tier:** EXTENDED-E2 · **Est:** 0.5 h · **Hat/agent:** U
- **Objective:** Make the CLAUDE.md §6 roles reusable as real subagent definitions.

---

## 9. Testing and security evaluation plan

Full attack specifications, metrics and schemas: `docs/planning/evaluation-plan.md`.

**Test layers**

| Layer | Tool | Scope | Gate |
|---|---|---|---|
| Contract unit + boundary | Foundry | every transition, error and settlement boundary from SPEC-003 | G1 |
| Contract invariants | Foundry | conservation, single terminal transition, no admin drain | G1 |
| Contract fuzz / adversarial | Foundry | amounts, TTLs, timestamps; reentrancy, replay, squatting | E1 |
| Vector conformance | Foundry + vitest + pytest | the same `canonical-v1.json` in three languages | G1 (Sol+TS), G3b (Python) |
| Seller unit | vitest + supertest | quote, verification, auth, claim, headers | G2 |
| Claim concurrency | vitest + a multi-process script | 50 concurrent across 2 processes; crash restart | G2 |
| Buyer | vitest | discovery, funding, retry, refund, feedback | G2 |
| Validator | pytest | vectors, decision logic, read-before-write, release | G3b |
| E2E | scripts on Anvil | happy path with timings; both refund paths | G3b |
| Attack harness | harness + fixtures | A2, A3 (P0); A4, A6, A5, A1 (E2) | G3a |
| Testnet smoke | scripts | deploy, verify, read-back; one real job (E1) | DEPLOY |

**Named invariants:** escrow balance equals the sum of Funded job amounts · each job leaves Funded at most once · refunds pay only the payer and releases only the snapshotted payee · a released job has a recorded timely pass · no owner-only call changes a job balance · a consumed nonce always has a corresponding job.

**Security review checkpoints:** `entry-point-analyzer` after CONTRACT-010 · `differential-review` on every contract diff before DONE · `building-secure-contracts` token checklist at CONTRACT-002/004 · `/security-review` before G1 and before G3b · `spec-to-code-compliance` for REG-008 and for SPEC↔code checks · SEC-012 claims audit before the deck is frozen.

**Definition of done for a security-relevant task:** tests named in the task exist and pass; the relevant DF's residual risk is restated or updated; evidence is committed; a reviewer skill has been run on the diff.

---

## 10. Risks and fallback triggers

| ID | Risk | Likelihood / impact | Trigger | Response | Owner |
|---|---|---|---|---|---|
| R-01 | Schedule overrun (one implementer, ~6 days) | High / High | any gate missed by > 4 h | apply that gate's cut list (§11): P1 first, then simplify P0 | U |
| R-02 | Faucets dry or gated, so no testnet deployment | Medium / Medium | no ETH by Thu 24 18:00 | local-only demo, stated plainly on the slide; retry until Mon 12:00; Amoy only if DEPLOY-005 says feasible (**not** a drop-in, V-71) | TM |
| R-03 | ERC-8004 live registries change or are incompatible | Medium / Low | REG-008 or REG-005 fails | stay on same-ABI mocks and say so (§10.3 fallback, verified feasible) | U(B) |
| R-04 | Public RPC rate limits or outage | Medium / Medium | 429s or timeouts during a run | all bulk runs on Anvil; testnet only for smoke; alternate RPC in `.env` | U(C) |
| R-05 | Canonicalisation mismatch across languages | Medium / High | any vector fails in any language | fix SPEC-001 first, then all implementations; vectors are authoritative | U(A) |
| R-06 | WSL DrvFs slowness or SQLite lock failures | Medium / High | `pnpm install` > 5 min, or a claim lock test fails | DB path off `/mnt/`; if it persists, move the repo to ext4 (DF-20) | U(C) |
| R-07 | A result contradicts the hypothesis | Medium / Low | any run | report it as a finding; never tune a baseline or a treatment to fix it | U(D) |
| R-08 | Claude usage limits interrupt a session | Medium / Medium | rate-limit error | work the critical path first; keep deliverables in the repo, not in scratch space; teammates continue docs/deck | U |
| R-09 | The real deadline is earlier than 29 Sep | Low / High | ADMIN-001 answer | freeze to P0 immediately; record the demo right after G3a; drop all E1/E2 | TM/U |
| R-10 | Secret leakage into git or logs | Low / High | pre-commit hook hit, or a scan finding | rotate the testnet key, purge history before publishing (DOC-009) | U |
| R-11 | Foundry/verifier tooling problems | Medium / Low | `forge script` fails against Base, or verification errors | `evm_version = cancun` (V-103); Blockscout instead of Etherscan; `forge create` instead of a script | U(A) |
| R-12 | Scope creep into stretch work | Medium / High | any stretch task started before G4 | stop; the tier rule is binding (CLAUDE.md §4) | U |
| R-13 | Another group registers the same topic | Low / Medium | sheet check | ADMIN-003 early; our framing is escrow + measured attack evaluation | TM |
| R-14 | Upstream x402 is already patched, weakening the "vanilla is broken" story | Medium / Medium | API-009 shows no reproduction | report it honestly; the fixture result stands on its own terms, and the finding is interesting (DF-18) | U(D) |
| R-15 | Claims outrun evidence in the deck | Medium / High | SEC-012 finds an unsupported sentence | delete or weaken the claim; evidence first (CLAUDE.md §12) | U(D) |
| R-16 | The five-transaction flow costs more gas or latency than expected | Medium / Low | EVAL-002/006 numbers | report honestly as "the cost of trust"; note the STRETCH-006 gasless path as the optimisation | U(A) |

**Blueprint §19 fallbacks, with verified feasibility**

| §19 fallback | Verdict |
|---|---|
| Ship on mock registries | **Feasible** — and now stronger, since the mocks use the real ABI (DF-14) |
| Implement the 402 → sign → settle loop manually | **Partly feasible** — only honest if it emits v2 headers; our design already does its own 402 (DF-03) |
| Polygon Amoy as the fallback network | **Not a drop-in** — needs asset config, RPC, redeploy; ERC-8004 presence unknown (V-71, V-133) |
| Local Anvil fork as demo backup | **Feasible** — mode B, needs RPC access for the fork (ENV-011) |
| Pre-recorded demo video | **Feasible** — and it is the plan regardless (PRES-003) |
| Ship A2 + A3 only | **Feasible** — this is the P0 evaluation |
| Cut all stretch goals | **Feasible** — enforced by the tier rule |

---

## 11. Milestone gates

Each gate is a **default stopping point**: Claude stops and reports for review.

| Gate | When | Acceptance | If missed → cut |
|---|---|---|---|
| PLAN-007 | Wed 23, 12:00 | D1–D6 signed off | proceed on defaults; log it |
| **G1** | Thu 24, 18:00 | `forge test` green on same-ABI mocks for fund, gate, bind/snapshot/release and refund, including deadline/grace/TTL boundaries; REG-008 passes; SPEC-001 vectors pass in Solidity + TypeScript | drop all E1/E2; defer P1 past G3. If > 8 h late: drop CONTRACT-013 (keep unit tests) and move DEPLOY to Saturday |
| **DEPLOY** | Thu evening | contracts deployed and verified; addresses recorded | local-only demo; retry until Mon 12:00 |
| **G2** | Fri 25, 23:59 | exactly one execution per job (payer auth + claim) on Anvil; A2/A3 fixture live; buyer E2E through delivery | drop VAL-006 (and narrow the delivery wording per DF-08), the **feedback half** of AGENT-003 (its refund watcher stays — INT-002 needs it), and SEC-013. If > 8 h late: validator becomes a scripted attester |
| **G3a** | Sat 26, 16:00 | A2 + A3 (buyer-side) on both targets, ≥10 runs each, `results.json` written | runs ≥ 5; the video covers A2 only |
| **G3b** | Sat 26, 23:59 | validator path: release + refund E2E locally; Python vectors pass | release demonstrated via a scripted validator, documented |
| **G4** | Sun 27, 12:00 | ≤ 2 E2 items done or recorded "not evaluated"; demo recorded; results frozen | stop all extended work |
| **G5** | Mon 28, 18:00 | code freeze; clean-clone check; references verified; rehearsal ≤ 3:00 | — |
| Submission | Tue 29 | deck submitted to ELMS | — |

**Day plan (indicative, U-hours)**

| Day | Work | Hours |
|---|---|---|
| Wed 23 | ENV-001…005/013; SPEC-001/002/003; REG-001…004/006/008; CONTRACT-001/002 | ~10 |
| Thu 24 | CONTRACT-004/005/007/008/010/011/013/017 → **G1**; then DEPLOY-001…003 | ~10 |
| Fri 25 | AGENT-001/002/006; API-001…005/007; API-008 → **G2** | ~10 |
| Sat 26 | SEC-002/003/004 → **G3a**; API-006, VAL-001…004, AGENT-003, INT-001/002 → **G3b** | ~10 |
| Sun 27 | EVAL-001/002/004/005/006; PRES-003; **P1 batch** (SPEC-004, REG-009, CONTRACT-015, VAL-006, AGENT-003 feedback, SEC-001, SEC-013, DOC-003, DOC-007) if G3b held; one E2 item only if all of that is green → **G4**; DOC-001/004; SEC-011 (0.1 h) | ~9 |
| Mon 28 | SEC-012, DOC-005/009, PRES-002/006, rehearsals → **G5** | ~6 |
| Parallel (TM) | Wed: ADMIN-001…004, ENV-007 faucets · Thu–Sat: PRES-001 outline, DOC-005 references · Sun–Mon: PRES-002 deck, PRES-005 checklist, rehearsal support | — |
| Tue 29 | ADMIN-005 submission (TM) | — |

**Feasibility.** The blueprint assumed ~21 days × 4 people. What remains is ~6 days × 1 implementer plus teammates: roughly 50–55 U-hours. CORE is ≈51 h (P0 ≈46 + P1 ≈5), so the plan consumes essentially all available capacity and depends on the cut rules being applied without hesitation. Full blueprint scope (six attacks + live registries + dashboard + LLM agent + Kafka/K8s/Keycloak) is **not** achievable by 29 Sep.

---

## 12. Ownership

**Human roles (AR-19)** — the blueprint's A–D are hats worn by one implementer (U); teammates (TM) take everything that does not require the codebase.

| Hat | Area | Task prefixes |
|---|---|---|
| A contracts | Solidity, Foundry, gas, deployment | CONTRACT-*, DEPLOY-*, EVAL-002, SPEC-001/003/005 |
| B registry & trust | ERC-8004, gate, validator | REG-*, VAL-*, SPEC-004, CONTRACT-005 |
| C agents & integration | seller, buyer, E2E, dashboard, video | API-*, AGENT-*, INT-*, ENV-004/005, DASH-*, PRES-003 |
| D security & narrative | threat model, harness, results, claims | SEC-*, EVAL-*, DOC-004/007, PRES-001 |
| **TM** teammates | ADMIN-001…005, ENV-007 faucets, DOC-003/005, PRES-002/005, rehearsal support, drafts for SEC-001/DOC-001/DOC-004 | |

**Dev-assistant agents** (CLAUDE.md §6) are separate from the human roles: `contracts-protocol`, `agents-backend`, `security-eval`, `delivery-completeness`, `skills-workflow`. They draft and review; they never mark a task DONE and never transact without authorization.

---

## 13. Open questions and external dependencies

| ID | Question | Owner | Needed by | Blocks | Default if unanswered |
|---|---|---|---|---|---|
| Q-01 | Real deadline and presentation date? | TM (coordinator) | Thu 24 | schedule | keep 29 Sep |
| Q-02 | Group number and `.ppt` vs `.pptx`? | TM | Sat 26 | PRES-002/005 | `GP_XX_AgentTrust.pptx` plus a converted `.ppt` |
| Q-03 | Is the topic already registered? | TM | Wed 23 | ADMIN-003 | register immediately |
| Q-04 | Teammate availability and names for the hats | U | Wed 23 | §12 | assume TM covers admin/deck only |
| Q-05 | Sign-off on D1–D6 | U | Wed 23 12:00 | SPEC/CONTRACT/API | defaults apply (logged) |
| Q-06 | Confirmation policy for testnet (k = 3 vs `safe`) | U | Fri 25 | API-003, EVAL-006 | k = 3 |
| Q-07 | Validator pass threshold (100 vs ≥80) | U | Thu 24 | SPEC-003 | 100 (binary) |
| Q-08 | LLM API key for AGENT-005 | U | only if E2 reached | AGENT-005 | skip the LLM layer, note it |
| Q-09 | Etherscan V2 key, or Blockscout only? | U | Thu 24 | DEPLOY-002 | Blockscout (no key) |
| Q-10 | GitHub repo name and owner | U | Wed 23 | ADMIN-004 | `agenttrust`, user account, private |
| Q-11 | What may be published (blueprint, planning critiques)? | U | Mon 28 | DOC-009 | publish code + docs; keep the blueprint private |

**External dependencies:** Base Sepolia RPC (HTTP-only, V-83) · Circle, QuickNode, CDP, Alchemy faucets (V-86) · Blockscout or Etherscan V2 (V-85) · npm and PyPI registries · GitHub · the live ERC-8004 registries, single-key upgradeable (V-97) · an LLM API (E2 only) · ELMS and the class sheet.

---

## 14. Evidence, review outcomes and authorization log

**Rules.** Every DONE task records changed files, commands, outcome and evidence path. Measured numbers need a raw log under `evidence/<TASK-ID>/` or `impl/attacks/results/`, plus a run manifest.

### Planning evidence (2026-09-22)

| Task | Evidence |
|---|---|
| PLAN-001 | Blueprint read in full (1,078 lines). Inventory: 81 headings, 18 tables, 11 code blocks, 10 checklist items, 4 reference groups. Outputs: `requirements-register.md` (102 requirements), `blueprint-coverage.md` (every element dispositioned) |
| PLAN-002 | `verification-log.md`, V-01…V-139: three read-only research agents, direct paper reads, live `eth_call`/`eth_getCode` on Base Sepolia, `npm view`, `gh api`, plugin CLI help. Contradictions found: V-01, V-22, V-64, V-71, V-72, V-95, V-99 |
| PLAN-003 | Six plugins at project scope (verified via `claude plugin list --json`), 27 vendored superpowers files with matching `git hash-object` values, `.claude/settings.json` limited to `enabledPlugins` + `extraKnownMarketplaces`; rejected candidates documented |
| PLAN-004 | `CLAUDE.md` |
| PLAN-005 | `task.md` + `design-findings.md` (DF-01…DF-24) + `evaluation-plan.md` + `requirements-register.md` + `blueprint-coverage.md` + `verification-log.md` + `skills-inventory.md` |
| PLAN-006 | Review outcomes below |
| PLAN-008 | Consistency check output recorded below |

### Implementation evidence

| Task | Date | Outcome | Evidence |
|---|---|---|---|
| ENV-001 | 2026-09-23 | `docs/specs/versions.md` written: 54 pinned rows across toolchain, ERC-8004, chain/token, Node, Python, extended scope and skills. Library versions re-confirmed the same day; **web3.py is on 8.x and TypeScript on 7.x**, both flagged as major bumps to re-check at VAL-001/AGENT-001 | `evidence/ENV-001/acceptance.txt` |
| ENV-002 | 2026-09-23 | Private repo on `main`; first commit `6295e71` with 51 files. `.gitignore`, layout skeleton, and a pre-commit hook that refuses private keys, PEM keys and `.env` files while allowing the public Anvil test mnemonic (verified: exit 1 on a staged fake key). **DF-20 measured, not assumed:** SQLite WAL locking works on `/mnt/d` (second writer blocked), but small-file writes are ~38× slower than ext4 — repo stays put, `CLAIMS_DB_PATH` defaults to ext4, and the planned hard refusal became a warning | `evidence/ENV-002/acceptance.txt` |
| ENV-003 | 2026-09-23 | Foundry **v1.8.3** installed (build 2026-09-15, matching the pin) and added to `~/.bashrc`; OpenZeppelin **5.7.0** (`cab19933`) and forge-std **1.16.2** (`bf647bd6`) installed. A probe importing `SafeERC20`/`ReentrancyGuard`/`Ownable2Step` compiles under solc 0.8.37 + `evm_version=cancun`. **Deviation:** the submodule route wrote a path relative to `impl/contracts` into the root `.gitmodules` and checked nothing out, so dependencies are vendored through `impl/scripts/install-deps.sh` with `lib/` git-ignored (re-run from an empty `lib/` verified) | `evidence/ENV-003/acceptance.txt` |

### Implementation evidence — SPEC-001 (2026-09-23)

| Item | Result |
|---|---|
| Spec | `docs/specs/canonical-hash.md` — canonicalisation rules to the byte, three type hashes, three derivations, EIP-712 domain and messages, versioning |
| Vectors | `impl/vectors/canonical-v1.json` — **21 canonicalisation, 9 hashing, 3 typed-data** cases, generated by `impl/scripts/gen-vectors.py` using `cast`, so expected values do not come from either implementation |
| Solidity | `impl/contracts/src/CanonicalHash.sol`; `forge test --match-contract CanonicalHashTest` → 4 passed (all vectors, binding properties, 256 fuzz runs on domain separation) |
| TypeScript | `impl/packages/core/src/canonical.ts`; `pnpm test` → **38 passed**; `pnpm typecheck` → exit 0 |
| Three-way agreement | `cast` (Rust) vs solc 0.8.37 vs viem 2.56.8 all produce identical hashes |
| Ambiguities closed | configured origin rather than `Host`; query sorted by (key,value) with duplicate order not preserved; `+` is a literal plus; raw wire bytes for the body with `Content-Encoding` rejected; amount/token/chainId inside `resourceHash` |
| Python | Deliberately deferred to VAL-003, written from the spec rather than ported, so its agreement is evidence |
| Honesty note | A typecheck first reported clean because it was piped into `tail`; re-run with the exit code checked, it failed with 3 real type errors, which were fixed rather than silenced |

### Implementation evidence — foundation and first contracts (2026-09-23)

| Task | Result | Evidence |
|---|---|---|
| ENV-004 | `impl/scripts/devnet.sh`: chain 31337, 15 named roles (deployer, buyer, seller, validator, 5 trusted clients, 5 Sybil owners, honest newcomer) from the public test mnemonic. Two runs produced byte-identical role files; anvil verified serving 15 funded accounts. **Chain-up half only** — seeding waits on CONTRACT-017/REG-002…004 | `evidence/ENV-004/` |
| ENV-005 | `.env.example` (23 names, no values) and a fail-fast loader that reports every problem at once, refuses values shaped like private keys, and warns when `CLAIMS_DB_PATH` sits under `/mnt/`. `REPLAY_POLICY` defaults to `idempotent` | `evidence/ENV-005/` |
| ENV-013 | Live re-check: chain 84532 at block 47,178,984; USDC `"USDC"`/`"2"`/6; all three ERC-8004 registries answering `getVersion()="2.0.0"` — satisfies the V-139 re-check. Verifier: Blockscout first, Etherscan V2 alternative | `evidence/ENV-013/` |
| CONTRACT-001 | `foundry.toml` pinned to solc 0.8.37, `evm_version=cancun`, optimizer 200, `bytecode_hash=none`, fuzz 256, invariant 256×500, CI profile 1024/512, `fs_permissions` for the vectors; `remappings.txt` pinned | `evidence/CONTRACT-001/` |
| CONTRACT-002 | MockUSDC with 6 decimals, EIP-712 domain `"USDC"`/`"2"` asserted against the formula, and EIP-3009 including `receiveWithAuthorization`'s `to == msg.sender` restriction. Four adversarial tokens, each verified to actually misbehave. **8 tests pass** | `evidence/CONTRACT-002/` |

Suite totals after this batch: **12 Solidity tests** and **45 TypeScript tests**, all green.

### Implementation evidence — ERC-8004 registry layer (2026-09-23)

| Task | Result | Evidence |
|---|---|---|
| REG-001 | ABI JSON **generated** by compiling the pinned sources (`erc-8004-contracts` commit `b9e466c`) with solc 0.8.37 + `via_ir`, not transcribed: Identity 32 / Reputation 18 / Validation 15 functions. `src/interfaces/erc8004/IERC8004.sol` declares the subset the escrow binds to. Live check resolved the EIP-1967 implementation behind each proxy and found **65/65 selectors** dispatched, all at `getVersion()` "2.0.0" (block 47,179,723) | `evidence/REG-001/abi-conformance.log`, `impl/scripts/check-erc8004-abi.sh` |
| REG-002/003/004 | Three same-ABI mocks reproducing upstream's revert **strings**, events and awkward behaviours — empty-client revert, owner *and operator* feedback ban, `agentWallet` cleared on transfer, squattable `requestHash`, unexposed `hasResponse`, repeatable responses, real EIP-712 `setAgentWallet` with an ERC-1271 fallback. **25 tests** | `evidence/REG-002/forge-test.log` |
| REG-008 | `check-mock-conformance.py` diffs `forge inspect <Mock> abi` against the pinned JSON for functions *and* events, allowing only declared omissions/additions → **PASS**, 41 shared functions identical | `evidence/REG-008/mock-conformance.log` |

Suite totals after this batch: **37 Solidity tests** and **45 TypeScript tests**, all green.

Three things this batch changed rather than confirmed:

- **V-141 — the first agent registered has id 0.** Upstream does `agentId = $._lastId++` on a zero-initialised counter. The live registry is past that point, so it was easy to miss. `payeeAgentId == 0` must never mean "unset" in CONTRACT-004.
- **V-99a — "pending is indistinguishable from a 0 response" is only true of the read the escrow uses.** `ValidationRegistry.getSummary` filters on the stored `hasResponse` flag, so the two states *are* distinguishable in aggregate; that path loops over every validation an agent has ever had, so it is unusable on a settlement path. DF-05's decision stands, but its justification was corrected from "the distinction does not exist" to "reading it costs unbounded gas", and SEC-012 has to catch any unqualified "indistinguishable" left in the docs or slides.
- **REG-002's acceptance criterion was wrong about upstream.** It asked that `getAgentWallet` "return zero until set"; upstream sets it to the registrant inside `register()` and it returns zero only *after* a transfer. The mock follows upstream and the criterion was corrected, not implemented.

The conformance script paid for itself on first run: it caught `NewFeedback` declaring `feedbackIndex` as indexed and `indexedTag1` as non-indexed, the opposite of upstream — a difference no behavioural test would have noticed and that would have broken any log parsing against the real registry.

**ENV-002 follow-up — the secret-scan hook was being bypassed.** Committing this batch, the hook refused a public EIP-1967 storage slot. Checking why showed the rule ("any `0x` + 64 hex") matches every keccak hash in the repository — 155 in `impl/vectors/canonical-v1.json` alone — and that the SPEC-001 commit, which the hook would have blocked on 154 lines, went in with `--no-verify`, unrecorded. A control that gets bypassed is worse than no control, so the hook was rewritten rather than worked around: it now scans per file, skips the generated hash artifacts by path (`impl/vectors/*.json`, `impl/contracts/abi/*`, `deployments/*.json`), allowlists named public constants (the two EIP-1967 slots, `keccak256("")`), and adds targeted rules for key-shaped assignments and literal `--private-key` arguments. `.githooks/test-pre-commit.sh` now checks the hook itself — **13 cases, 7 that must block and 6 that must pass** — with fixtures assembled at run time, because written literally they made the hook block its own test file. A rescan of the whole history found **no key-shaped content** in any commit. DOC-009 should run the self-test before publication.

A test I got wrong, and what it taught: `test_ReturnsFalseTokenIsCaughtBySafeERC20` failed at first. Reading the installed `SafeERC20` showed the library was right and the **test** was wrong — `safeTransfer` is an internal library call, so `vm.expectRevert` matched the inner token call (which succeeds by returning `false`) instead of the library's revert. Fixed by crossing an external call boundary. Worth remembering for every future `expectRevert` on library code.

### Implementation evidence — the escrow (2026-09-23)

| Task | Result | Evidence |
|---|---|---|
| CONTRACT-004 | `AgentTrustEscrow.sol` + `Fund.t.sol`, **31 tests**. Resource hash derived on-chain, payee snapshotted, payer nonce burned atomically with a strict balance-delta check. Derivations checked against **every** shared hashing vector with the contract deployed at the vector's escrow address on the vector's chain | `evidence/CONTRACT-004/` |
| CONTRACT-005 | Trust-anchored gate + `Gate.t.sol`, **22 tests**. Two gas-starvation bypasses closed (caller-side `gasleft()` pre-check, owner-side `MIN_REPUTATION_READ_GAS`); duplicates rejected, not deduplicated; `FEEDBACK_TAG` a constant | `evidence/CONTRACT-005/`, `gas-vs-history.txt` |
| CONTRACT-007/008 | bind / confirm / release / refund + **35 tests**. Release has no deadline of its own; the first pass is snapshotted; refund needs deadline + grace and no recorded-or-recordable pass | `evidence/CONTRACT-007/`, `evidence/CONTRACT-008/` |
| CONTRACT-011 | `BlueprintCorrected.t.sol` — the §9.4 set, corrected, each test stating what the original asserted and why that was the wrong property | see below |
| CONTRACT-013 | `Invariant.t.sol` — 6 invariants plus an `afterInvariant` liveness check, 256 runs × depth 500 | `evidence/CONTRACT-013/` |
| CONTRACT-017 | Deploy script, deployment record with real block and tx, smoke check, ABI export | `evidence/CONTRACT-017/` |

**Measured (CONTRACT-005 acceptance d).** `getSummary` costs ~19.5k fixed + **~8,589 gas per feedback entry**, linear to 100 entries. At the 250k default ceiling a trusted client with more than ~26 entries for one agent is **dropped from the gate**. That is ERC-8004's read cost, not the escrow's — DOC-004 and EVAL-002.

**The security review (CLAUDE.md §6) found a real HIGH, and it was not theoretical.** `refund()` was **fail-open** on a validation read that ran out of gas: `getValidationStatus` returns the validator-supplied `tag`, the registry copies the whole struct to memory to do it, so the read costs whatever the tag's author chose — ~30k for this project's tag, ~14M at 200 KB. The wrapper caught *every* failure as "no validation". I reproduced it here before fixing: `refund{gas: 5_000_000}` on a job holding a genuine passing attestation paid the buyer 250,000 atomic units and set the job to `Refunded`. The fix distinguishes an out-of-gas sub-call (**0 bytes** of returndata) from the registry's `require(…,"unknown")` (a 100-byte `Error(string)`) and reverts on the ambiguous case. Deliberately **no gas cap** — the cost is incurred inside the registry either way, and a cap would convert "supply more gas" into "this job can never be read again", stranding the money.

Eight further findings were fixed in the same change, three of them worth naming: the agent's **payout wallet could be its own validator** (`isAuthorizedOrOwner` misses it, because a wallet set via `setAgentWallet` is neither owner nor operator); **`setGrace` was the one owner setter that reached an already-funded job**, and at `type(uint64).max` it overflowed `deadline + grace` so `refund()` reverted for every job — permanently, since `renounceOwnership` is a single step; and a **fresh deployment left every gate floor at 0**, so the reputation gate was off until someone sent a second transaction, which would have made any A6 result unreproducible. Full table, including what was checked and found sound: `evidence/SEC-REVIEW-001/findings.md`.

**Mutation testing earned its place twice.** The first version of the invariants asserted only that money was *conserved* — and an escrow that pays the wrong party still holds the right total. Two injected bugs (`release()` paying the payer, `refund()` paying `msg.sender`) passed. Invariants E, F and G exist because of that result and catch both. Against the unit suite, 10 of 12 mutations were caught; the two that were not exposed genuine gaps — no test made the owner's **distinct** floor the binding constraint, and none covered a refund after a snapshotted pass was overwritten in the registry. Both now have tests. `evidence/CONTRACT-013/mutation-testing.txt`.

**Two process notes, neither flattering.** Invariant D was written as an `invariant_` function asserting "at least one job has been funded" — but Foundry checks those after **every** call including the first, so it failed immediately and every time, and I went looking for a contract bug that was not there before moving it to `afterInvariant`. And the first round of mutation results was **contaminated by Foundry's invariant failure cache**, which replays the last failing sequence: runs finishing in 62ms rather than 1s gave it away, and the whole round had to be redone with `cache/invariant` cleared between mutations. Separately, the reviewer observed a mutation live in the working tree while reading the file — mutation testing writes to source, so it must not run while a review is in flight (CLAUDE.md §6, one writer per area).

**`vm.prank` consumption bit three times**, each time producing a confusing failure: an external call placed inside a pranked statement — `escrow.previewRequestHash(...)` in an `expectRevert` argument, `escrow.FEEDBACK_TAG()` as a call argument, `escrow.MAX_GRACE()` in an error selector — consumes the prank, so the call under test runs as the test contract. The fixture now holds `FEEDBACK_TAG` as a constant and the affected tests hoist the read above the prank.

### Review outcomes (PLAN-006)

| # | Source | Finding | Resolution |
|---|---|---|---|
| 1 | Plan-agent critique | The draft's "core" summed to ~96 h, not the claimed 75–80; the MVP floor was likewise understated | Re-tiered into P0 ≈46 h / P1 ≈5 h, with the arithmetic shown per area and stated as consuming nearly all capacity (§3, §11) |
| 2 | Plan-agent critique | A pending validation is indistinguishable from a 0 response, so "timely fail → immediate refund" would hand out free service | Early refund removed; refund needs deadline + grace and no recordable pass (DF-05, CONTRACT-008) |
| 3 | Plan-agent critique | A seller-chosen salt makes `refund()` unable to check for a pass | Bind-once `requestHash` stored in the job; release, refund and snapshot all read it (DF-06, CONTRACT-007) |
| 4 | Plan-agent critique | Repeatable responses let a late overwrite erase a timely pass | Permissionless snapshot of the first valid pass; validator reads before writing and never responds late (DF-05, DF-15) |
| 5 | Plan-agent critique | `ttlSeconds` unbounded → tiny TTL then refund = free service | On-chain TTL bounds plus a seller deadline margin (DF-22) |
| 6 | Plan-agent critique | The critical path put mocks after the escrow and omitted specs, buyer and validator | Path reordered and split into headline vs settlement (§7) |
| 7 | Plan-agent critique | Feedback lifecycle and the gate model were never actually decided | DF-21 (buyer-direct feedback) and DF-09 (trust-anchored gate, v1 as mock-only comparison) added, with SPEC-004 |
| 8 | Plan-agent critique | Gate v1 cannot be computed against the real ABI | v1 is implemented only as a labelled non-standard mock helper for the A6 comparison (REG-003) |
| 9 | Plan-agent critique | "Proof of delivery" overclaims when evidence retrieval is extended scope | DF-08 defines default vs stronger wording, tied to whether VAL-006 ships; SEC-012 audits it |
| 10 | Plan-agent critique | Cut lists only removed extended work, saving no time | Each gate now cuts P1 and then simplifies P0 (§11) |
| 11 | agents-backend draft | DF-08's claim is coupled to a P1 task | Ruling: default wording assumes VAL-006 absent; SEC-012 enforces consistency |
| 12 | agents-backend draft | EIP-712 struct ownership split between two specs | Ruling: SPEC-001 owns structs, domain and digest vectors; SPEC-002 owns wire shapes |
| 13 | agents-backend draft | The flow needs five on-chain transactions | Accepted, with the reason recorded (refund safety); ETH budget, gas and latency consequences noted; an E1 optimisation note added to DF-06 |
| 14 | agents-backend draft | A demo-only `strict` replay mode was proposed | Rejected: one policy (`idempotent`) for measurements and the demo; counters report executions (DF-17) |
| 15 | agents-backend draft | API-003/005 and INT-001 estimates were tight | Raised to 1.75/2/1.75 h; claim lease and crash tests moved to E1 |
| 16 | Independent review (post-merge) | **The validator had no way to learn `requestHash`** — the receipt carried no salt, and the binding is filed after evidence intake, so VAL-004's "read `getValidationStatus`" had no hash to read and unknown hashes revert. The P0 settlement path could not have worked as written | `DeliveryReceipt` now carries the seller's salt; the validator derives `requestHash` and waits for `jobs(jobId).requestHash` to match before responding, with a `binding_timeout` path (§6.2, §6.7, API-006, VAL-002, VAL-004, +0.25 h) |
| 17 | Independent review | **G1 was unachievable**: it required TypeScript vectors on Thursday, but the TypeScript implementation (AGENT-001) was scheduled for Friday | SPEC-001 now includes the minimal TypeScript reference implementation (2 → 2.5 h); AGENT-001 packages it instead of re-implementing (1.5 → 1.25 h) |
| 18 | Independent review | **`validationRequest` (owner/operator) and `bindValidation` (payee) can be different keys**, and only one seller wallet was funded | REG-006 now fixes owner == `agentWallet` == seller key, ENV-006 says to fund a fifth key if they are ever split, and CONTRACT-011 tests the mismatch case |
| 19 | Independent review | **A2 could report "Blocked" while an attacker was served**: under idempotent replay, a captured signed retry yields a 2xx to a non-payer while executions stay at 1 | Added the `unauthorized_2xx` metric to the A2 specification, the hypothesis set (H-A2-3) and the `results.json` schema |
| 20 | Independent review | **Gate gas was bounded by client count but not by feedback entries** — `getSummary` iterates every entry, so a trusted client with a bloated history could push `fund()` past the block gas limit | Per-client reads now run under a bounded-gas `try/catch` and degrade gracefully; CONTRACT-005 acceptance (e) and a CONTRACT-011 test cover it |
| 21 | Independent review | Requirement count stated as 78 in three places; the register defines 102 | Corrected throughout |
| 22 | Independent review | Eleven P0/P1 tasks had no day in the schedule, so P1 was unschedulable | Sunday now names the P1 batch and SEC-011; a teammate row covers PRES-001/005 and the admin work |
| 23 | Independent review | The critical path contradicted declared dependencies (ENV-004 needs contracts; AGENT-001 needs CONTRACT-017) | ENV-004 split into chain-up and seeding halves; CONTRACT-017 inserted into the headline path |
| 24 | Independent review | EVAL-004 demanded a hand-written narrative **and** byte-for-byte regeneration of the same file | Split: `docs/results.tables.md` is generated and diff-checked; `docs/results.md` holds the narrative |
| 25 | Independent review | "Blocked" conflated structural impossibility with "nothing failed in N runs" — misleading for probabilistic attacks (A1, A4) | Outcome categories split into **Blocked (structural)** and **No failures observed (N, 95% CI)** |
| 26 | Independent review | SPEC-001's query rule was self-contradictory ("sorted by key then value with duplicates preserved in order") | Rule fixed to sort by (key, value), with the consequence stated and a vector requiring two input orders to hash identically |
| 27 | Independent review | DF-05's residual risk missed the sharper window: a pass overwritten **before** anyone calls `confirmValidation`/`release` becomes unreadable | Window added to DF-05 and to SEC-009's flip scenario |
| 28 | Independent review | Minor: P0 hours differed between CLAUDE.md (45) and task.md (46); the deliverables checklist lacked S5's local-only fallback; the G2 cut list cut "AGENT-003 feedback" although that task also holds the refund watcher | All three corrected |
| 29 | Lead (session) | Three drafting agents hit a session rate limit, and the scratchpad was cleared overnight, losing their drafts | The lead rewrote the remaining documents directly into the repository. Recorded here because it affects how much independent review the plan received: the contracts, security and delivery sections were **not** independently drafted by separate agents — see the honesty note below |

**Honesty note on the review process.** The intended five-specialist draft-and-review round ran only partially. The skills specialist completed its work, and the agents-backend specialist produced a full draft (its adjudicated findings are rows 11–15). The contracts-protocol, security-eval and delivery-completeness agents were interrupted by a session rate limit, and their scratch drafts were then deleted by an overnight temp cleanup, so the session lead wrote those sections directly, using the same conventions and the earlier Plan-agent critique (rows 1–10). Because that removed the independent eye, a **separate review-only pass was run afterwards over the finished package** (rows 16–28). It found 13 issues, including three high-severity ones — the validator could not learn `requestHash`, gate G1 was unachievable as scheduled, and the validation calls could require two differently-funded seller keys — and all of them are now fixed. What remains unreviewed by a second party is the fix set itself.

### Authorization log (PLAN-009)

| Date | Authorized scope | Granted by | Notes |
|---|---|---|---|
| 2026-09-22 | Planning package only; skills installation | user | Plan approved in plan mode; implementation explicitly withheld |
| 2026-09-22 | Project-scope skill installation (6 plugins + 7 vendored skills) | user | Executed and verified; see PLAN-003 |
| 2026-09-23 | Implementation start — ENV-001, then ENV-002/003, then SPEC-001 ("do that") | user | ENV-001/002/003 DONE; SPEC-001 is next |

---

## 15. Final deliverables checklist

| # | Deliverable | Acceptance | Task |
|---|---|---|---|
| 1 | Topic registered in the class sheet | Entry visible; screenshot filed | ADMIN-003 |
| 2 | `GP_XX_AgentTrust` deck submitted to ELMS | Correct name and format, one submission, before the deadline | ADMIN-002, PRES-002, ADMIN-005 |
| 3 | Public GitHub repository, README opening with the problem | Public after DOC-009; README runs the local demo | ADMIN-004, DOC-001, DOC-009 |
| 4 | `AgentTrustEscrow` deployed **and verified** | Source readable on an explorer; address recorded — **or**, if faucet funds never arrived, a documented local-only demo saying so (S5) | DEPLOY-001, DEPLOY-002 |
| 5 | Address + explorer link on the final slide | Link resolves and matches `deployments/base-sepolia.json`; if undeployed, the slide says so plainly | DEPLOY-003, PRES-006 |
| 6 | Foundry suite green, screenshot in the deck | `forge test` green at the final commit | CONTRACT-011, PRES-006 |
| 7 | Attack harness with `results.json` and a results table | Regenerating from raw data reproduces `docs/results.md` | SEC-002, EVAL-004 |
| 8 | 45-second demo video | ≤45 s, counters match a run id, fixture labelled | PRES-003 |
| 9 | One-page threat model | Fits a page; mechanisms match the code | SEC-001, DOC-003 |
| 10 | References with verified identifiers | Every citation checked; unresolved ones removed or marked | DOC-005 |
| 11 | Limitations document | Every limitation traces to a finding or a measurement gap | DOC-004 |
| 12 | Cross-language vectors | Same vectors pass in Solidity, TypeScript and Python | SPEC-001, VAL-003 |
| 13 | Coverage statement | Denominator explicit; "Not evaluated" rows present | EVAL-005 |
| 14 | Claims audit | Every public claim maps to evidence | SEC-012 |

---

## 16. Next task

**Gate G1 is met, a day early — this is a default stopping point (CLAUDE.md §13).**

| G1 criterion | Status |
|---|---|
| `forge test` green: fund, gate, bind/snapshot/release, refund, deadline/grace/TTL boundaries, on same-ABI mocks | ✔ 154 tests, plus 6 invariants at 256 × 500 |
| REG-008 mock conformance passes | ✔ 41 shared functions identical, only declared differences |
| SPEC-001 vectors pass in Solidity **and** TypeScript | ✔ 4 Solidity + 45 TypeScript |
| (beyond the gate) escrow deploys and smoke-checks locally | ✔ `impl/scripts/deploy.sh local` |

**Next, toward G2 (Fri 25 Sep 23:59): the seller service.**

**API-001** (Express + deterministic fixtures + price table) → **API-002** (402 in x402 v2 shape with the `agenttrust-escrow` scheme) → **API-003** (raw-body hashing and the funded-job checks) → **API-004** (payer-signature auth) → **API-005** (the claim store — one execution per funded job) → **API-008** (the labelled A2/A3 vulnerable fixture). In parallel: **AGENT-001** (the TypeScript core the buyer and seller share) and **SPEC-002**, which API-002/003/004 all depend on.

Two things carry forward from the contract work:

- **SPEC-002 must specify the seller's `bindValidation` retry budget.** The security review established that the salt does not bound `requestHash` squatting — it is public from the moment the seller broadcasts `validationRequest`, so a mempool-watching adversary can squat every retry (DF-06, corrected). The seller needs a budget and a `minDeadlineMargin` that accounts for it.
- **The validator must call `release()` immediately after attesting**, and VAL-004 should treat that as load-bearing rather than an optimisation: the seller cannot snapshot its own pass, so until someone calls `confirmValidation` or `release`, a validator that flips its verdict erases it (DF-05, sharpened).

Still open, and not blocking:
1. **Sign-off on D1–D6** (§2). Defaults are being applied; D3/D4/D5 are now baked into a tested contract, so changing them is rework rather than a tweak.
2. **ENV-006/007** — wallets and faucet ETH. DEPLOY-001…003 needs funds by Thursday evening, and the **seller and validator need ETH too**, not just the deployer. This is the only thing that can still make the testnet deployment slip.
