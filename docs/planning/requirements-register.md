# Requirements Register — AgentTrust

Every requirement extracted from the blueprint, plus the ones the design necessarily implies. Nothing is dropped silently: each row has a type, a source and at least one task.

**Classes:** FR functional · SR security/trust · IR integration · ER evaluation · OR operational · AR academic/presentation · OPT optional · RISK (register in `task.md` §10).
**Types:** **E** explicit in the blueprint · **D** derived (necessary, not stated) · **C** correction to the blueprint · **O** optional.
**Tiers:** CORE-P0 · CORE-P1 · E1 · E2 · STRETCH · MANUAL (human task).
Facts cite `verification-log.md`; decisions cite `design-findings.md`.

---

## FR — Functional

| ID | Type | Requirement | § | Notes / corrections | Tasks | Tier |
|---|---|---|---|---|---|---|
| FR-01 | E | Discovery through the ERC-8004 Identity registry; the agent card resolves to a service endpoint | §5.1(1), §10.1 | Buyer must check the card's origin against the host it talks to (DF-04) | REG-002, REG-006, AGENT-002 | P0 |
| FR-02 | E→C | Reputation gate blocks funding of unqualified sellers | §1(1), §5.1(2), §9.2 | Trust-anchored gate; blueprint rule kept only as a mock comparison (DF-09) | SPEC-003, CONTRACT-005, CONTRACT-011, REG-003 | P0 |
| FR-03 | E→C | A canonical request hash computed identically on every side | §5.1(3), §9.1 | Computed on-chain; raw bytes; configured origin; full canonicalisation rules (DF-04) | SPEC-001, CONTRACT-004, AGENT-001, API-003, VAL-003 | P0 |
| FR-04 | E | Escrow locks the exact amount against one request, burning a payer nonce in the same transaction | §1(2), §5.1(4), §9.2 | `quotedMax` removed (DF-04) | CONTRACT-004, CONTRACT-011 | P0 |
| FR-05 | E | The seller serves only after the funded state is confirmed, and refuses a mismatched resource | §5.1(5), §11.1, §11.2 | Confirmation policy explicit (DF-23); 409 on mismatch | API-003, SPEC-002 | P0 |
| FR-06 | E→C | An independent validator attests delivery in the Validation registry | §1(3), §5.1(6) | Keyed by a bound `requestHash`, not `jobId` (DF-06) | SPEC-003, API-006, VAL-001…004, CONTRACT-007 | P0 |
| FR-07 | E→C | Release only against a passing attestation; deadline refund; permissionless refund pays only the payer | §5.1(7), §9.2, §9.3 | Snapshot + grace; no early refund on "fail" (DF-05) | CONTRACT-007, CONTRACT-008, CONTRACT-011, INT-002 | P0 |
| FR-08 | E→C | Feedback is written back to the Reputation registry after completion | §5.1(8), §11.1 | Buyer-direct, tagged, with job reference; no escrow-routed feedback (DF-21) | SPEC-004, AGENT-003, REG-003 | P1 |
| FR-09 | E | Guarded four-state machine: None → Funded → Released \| Refunded | §5.2 | Plus a validation-recorded flag (DF-05) | CONTRACT-004, CONTRACT-013 | P0 |
| FR-10 | E→C | Administrative gate configuration with events | §9.2 | Bounded floors only; `Ownable2Step`; no fund movement (DF-12) | CONTRACT-010, CONTRACT-013 | P0 |
| FR-11 | E | Events and custom errors for every transition (typed selectors for the harness) | §9.2, §9.3 | — | CONTRACT-004, CONTRACT-007, CONTRACT-008, SEC-002 | P0 |
| FR-12 | E→C | Mock registries implementing the same interfaces, built first | §10.3 | Same **real** ERC-8004 ABI (DF-14) | REG-001…004, REG-008 | P0 |
| FR-13 | E | Harness runs each attack against both targets and emits `results.json` | §12.1 | Manifest + schema (evaluation-plan §7) | SEC-002, EVAL-004 | P0 |
| FR-14 | E | Attack scripts A1–A6 | §12.2 | A2+A3 are P0; A4/A6/A5/A1 are E2 (§12.3 MVP rule) | SEC-003…008, API-008, API-010 | P0/E2 |
| FR-15 | E | React dashboard showing live escrow state and an attack console | §8.1, §14.1 | Read-only view is E2; console is STRETCH | DASH-001, DASH-002 | E2/STRETCH |
| FR-16 | E→C | Buyer agent completing quote → hash → fund → retry | §8.1, §14.1 | Deterministic core is P0; LangGraph/LiteLLM layer is E2 (DF-24) | AGENT-001…003, AGENT-005, AGENT-006 | P0/E2 |
| FR-17 | E→C | Seller API with an HTTP 402 quote | §11.2, §14.1 | x402 v2 wire format with a project scheme; no stock middleware (DF-03) | SPEC-002, API-001, API-002 | P0 |
| FR-18 | E | Demo commands for both targets with grant/payment counters | §18 | Counters count executions (DF-17); narrative corrected (DF-13) | AGENT-006, SEC-002, PRES-003 | P0 |
| FR-19 | D | One execution per funded job across retries, restarts, concurrency and processes | — | DF-01 | SPEC-002, API-005 | P0 |
| FR-20 | D | Payer-authenticated retry | — | DF-02 | SPEC-001, SPEC-002, API-004 | P0 |
| FR-21 | D/C | One validation request bound per job, with mutual validator consent | — | DF-06 | SPEC-003, CONTRACT-007, API-006 | P0 |
| FR-22 | C | Settlement timing: snapshot, deadline + grace, TTL bounds | §9.2 | DF-05, DF-22 | SPEC-003, CONTRACT-007, CONTRACT-008, CONTRACT-010 | P0 |
| FR-23 | D | Deterministic service fixtures, including equal-priced siblings for A3 | — | Enables validator recomputation (DF-08) | API-001 | P0 |
| FR-24 | D | Labelled vulnerable baseline fixtures; optional pinned-upstream baseline | §12.1 | DF-18 | API-008, API-010, API-009 | P0/E2 |
| FR-25 | D | Validator evidence intake and store; payer retrieval | — | DF-08; retrieval is P1 | VAL-002, VAL-006 | P0/P1 |
| FR-26 | O | Seller-signed EIP-712 quote verified on-chain | — | DF-04 | SPEC-005, CONTRACT-006 | E1 |
| FR-27 | E | Validator runs as an independent process | §8.1, §14.1 | Python FastAPI (user decision) | VAL-001 | P0 |
| FR-28 | E→C | Facilitator component ("x402 settle") | §8.1, §8.2 | Only in the baseline/upstream path; the AgentTrust flow has no facilitator (DF-03) | API-009 | E2 |

## SR — Security and trust

| ID | Type | Requirement | § | Notes | Tasks | Tier |
|---|---|---|---|---|---|---|
| SR-01 | E | Payer-scoped nonces (anti-griefing) | §9.3 | Same-nonce retry rule for clients (DF-12) | CONTRACT-004, CONTRACT-014, AGENT-004 | P0 |
| SR-02 | E | Domain-separated `jobId` (chain id + contract address) | §9.3 | Cross-deployment replay test | CONTRACT-004, CONTRACT-014 | P0 |
| SR-03 | E | Checks-Effects-Interactions plus `ReentrancyGuard` | §9.3 | Malicious-token test | CONTRACT-007, CONTRACT-008, CONTRACT-014 | P0 |
| SR-04 | E→C | Exact-amount escrow; no open-ended allowance | §9.2, §9.3 | `quotedMax` removed (DF-04) | CONTRACT-004 | P0 |
| SR-05 | E→D | Named threat model: assets and adversaries | §4.1, §4.2 | Adds `jobId` observer, colluding validator, registry upgrader, malicious token | SEC-001, DOC-003 | P1 |
| SR-06 | E→C | Trust assumptions stated honestly | §4.3 | Corrected (DF-07) | SEC-001, DOC-004 | P1 |
| SR-07 | E | Explicit non-goals: validator collusion, content quality, key compromise | §4.3, §6.3 | — | SEC-001, DOC-004, PRES-001 | P0 |
| SR-08 | E | Out of scope: legal, fiat, MEV, privacy | §4.4 | — | DOC-004 | P0 |
| SR-09 | D | Token allowlist and balance-delta check | — | DF-12 | CONTRACT-002, CONTRACT-004, CONTRACT-014 | P0 |
| SR-10 | D | No administrative path can move escrowed funds | — | DF-12; invariant | CONTRACT-010, CONTRACT-013 | P0 |
| SR-11 | D | Confirmation policy and fail-closed RPC handling | — | DF-23 | SPEC-002, API-003 | P0 |
| SR-12 | D | Payee snapshot at funding (`agentWallet` → `ownerOf`) | — | DF-12 | CONTRACT-004, CONTRACT-014 | P0 |
| SR-13 | D | Secrets handling; testnet only | — | CLAUDE.md §11 | ENV-005, ENV-013, DOC-009 | P0 |
| SR-14 | D | `Cache-Control: no-store` on paid responses | — | Paper mitigation M5 (V-17) | API-007 | P0 |
| SR-15 | E | Ethics and scope statement for the attacks | §12.4 | — | SEC-011, PRES-002 | P0 |

## IR — Integration

| ID | Type | Requirement | § | Notes | Tasks | Tier |
|---|---|---|---|---|---|---|
| IR-01 | E | Pin the ERC-8004 version and commit the ABI | §10.2 | `@b9e466c` (V-50) | REG-001, ENV-001 | P0 |
| IR-02 | E→C | Evaluate reference implementations before depending on one | §10.2 | nuwa-8004 is outdated; its "79/79" badge is not evidence (V-50) | REG-001 | P0 |
| IR-03 | E | Verify every address and endpoint before hard-coding it | §11.3, §22 | V-81, V-97, V-69 | ENV-001, ENV-013, REG-001 | P0 |
| IR-04 | E→C | x402 integration | §11.2, §14.1 | v2 wire format, project scheme, no stock middleware on escrowed routes (DF-03) | SPEC-002, API-002, API-009 | P0 |
| IR-05 | D | One canonicalisation spec with shared vectors across Solidity, TypeScript and Python | — | DF-04; independence is deliberate | SPEC-001, AGENT-001, VAL-003, ENV-008 | P0 |
| IR-06 | E | ABI export and a deployments file | App. B | — | CONTRACT-017, DEPLOY-003 | P0 |
| IR-07 | E | OpenZeppelin pinned | §14.1 | v5.7.0 (V-100) | ENV-003 | P0 |
| IR-08 | E | Real-registry integration timeboxed, with a mock fallback | §10.3, §15, §19 | Live registries exist but are single-key upgradeable (V-97) | REG-005, REG-007 | E2 |

## ER — Evaluation

| ID | Type | Requirement | § | Notes | Tasks | Tier |
|---|---|---|---|---|---|---|
| ER-01 | E→C | Defence coverage | §13(1) | Denominator = attacks evaluated of the 6 defined; four outcome categories | EVAL-005 | P0 |
| ER-02 | E→C | Grants per payment under A2 | §13(2) | Counted as executions (DF-17) | SEC-003, EVAL-004 | P0 |
| ER-03 | E→C | Resource leakage under A5 | §13(3) | Both directions (DF-10) | SEC-006 | E2 |
| ER-04 | E→C | Sybil traffic capture under A6 | §13(4) | Our own selection model; not comparable to 60.2% (V-14) | SEC-007 | E2 |
| ER-05 | E | Gas for fund/release/refund, in gas and USD at a stated price | §13(5) | Must total all five transactions (DF-06) | EVAL-002 | P1 |
| ER-06 | E | Latency overhead versus the baseline | §13(6) | Per-stage timestamps; confirmation dominates | EVAL-006, EVAL-003 | P0/E2 |
| ER-07 | E | Results table | §12.3 | Includes "Not evaluated" rows | EVAL-004, EVAL-005 | P0 |
| ER-08 | D | Repeated runs, concurrency levels, variability, raw logs, manifests | — | evaluation-plan §6–7 | SEC-002, EVAL-001 | P0 |
| ER-09 | E | A2 + A3 minimum viable evaluation first | §12.3, §19 | — | SEC-003, SEC-004 | P0 |
| ER-10 | D | Hypotheses distinguished from results; failures reported | — | CLAUDE.md §12 | EVAL-004, SEC-012 | P0 |

## OR — Operational

| ID | Type | Requirement | § | Notes | Tasks | Tier |
|---|---|---|---|---|---|---|
| OR-01 | E | Four wallets: buyer, seller, validator, deployer | §14.2 | Created offline by the user | ENV-006 | MANUAL |
| OR-02 | E | Early faucet funding (ETH + test USDC) | §14.2 | Seller and validator also need ETH (DF-06); limits in V-86 | ENV-007 | MANUAL |
| OR-03 | E | Network liveness check | §14.2 | — | ENV-013 | P0 |
| OR-04 | E→C | Fallback network | §14.2, §19 | Amoy is not a drop-in (V-71); feasibility check first | DEPLOY-005, DEPLOY-004 | E2 |
| OR-05 | E | Local Anvil (and fork) as demo backup | §19 | Mode A default, Mode B for fork runs | ENV-004, ENV-011 | P0/E2 |
| OR-06 | E | Deploy **and verify** on Base Sepolia; address + explorer link | §16, §20 | Blockscout or Etherscan V2 (V-85) | DEPLOY-001, DEPLOY-002 | P0 |
| OR-07 | E | `deployments/base-sepolia.json` with addresses and pinned ABIs | App. B | — | DEPLOY-003 | P0 |
| OR-08 | D | Continuous integration | — | forge + vitest + pytest + vectors | ENV-008 | E1 |
| OR-09 | D | Reproducible local environment | §14.1 | Scripts now; docker-compose later | ENV-004, ENV-009, DOC-006 | P0/E1 |
| OR-10 | D | Repository hygiene: private until review, licence, secret scan | — | User decision U5 | ENV-002, DOC-009 | P0 |
| OR-11 | E | Kafka event bus | §8.1, §14.1 | Stretch by the blueprint's own rule | STRETCH-001 | STRETCH |
| OR-12 | E | Kubernetes deployment | §14.1 | Stretch | STRETCH-002 | STRETCH |
| OR-13 | E | Keycloak service identity | §14.1 | Stretch | STRETCH-003 | STRETCH |

## AR — Academic and presentation

| ID | Type | Requirement | § | Notes | Tasks | Tier |
|---|---|---|---|---|---|---|
| AR-01 | E | Register the topic in the class sheet | §0.1 | Exact text supplied | ADMIN-003 | MANUAL |
| AR-02 | E | `GP_XX_AgentTrust` submitted to ELMS | §0.2 | `.ppt` vs `.pptx` unconfirmed (V-03) | ADMIN-002, ADMIN-005, PRES-005 | MANUAL |
| AR-03 | E | Confirm the deadline | §0.3 | `31/09/2026` is invalid (V-01) | ADMIN-001 | MANUAL |
| AR-04 | E→C | One-sentence pitch | §0.4 | "five attacks" vs "six" corrected; claim narrowed (DF-19) | PRES-001, SEC-012 | P0 |
| AR-05 | E | Five slides, three minutes, ≈380 words | §17 | — | PRES-001, PRES-002 | P0 |
| AR-06 | E | 45-second recorded demo; no live network calls | §17, §18 | Narrative corrected (DF-13) | PRES-003 | P0 |
| AR-07 | E | Backup slides: architecture and threat model | §17 | — | PRES-002, DOC-003 | P0/P1 |
| AR-08 | E | Public repository; README opens with the problem | §16, §20 | Public only after DOC-009 | DOC-001, DOC-009, ADMIN-004 | P0 |
| AR-09 | E | Foundry suite green; screenshot in the deck | §16 | — | CONTRACT-011, PRES-006 | P0 |
| AR-10 | E | One-page threat model | §16 | — | SEC-001, DOC-003 | P1 |
| AR-11 | E | References slide with verified identifiers | §16, §22 | Unverified figures removed (DF-19) | DOC-005, PRES-002 | P0 |
| AR-12 | E | Deliver the blockchain justification unprompted | §6, §20 | Keep §6.2 verbatim; add §6.3 honesty | PRES-001, DOC-001 | P0 |
| AR-13 | E→C | Related-work positioning without overclaiming | §7, §20 | ERC-8183, auth-capture, papers' own testbeds (DF-19) | DOC-001, PRES-002, SEC-012 | P0 |
| AR-14 | E | Address the five scoring criteria and extra-credit behaviours | §20 | — | PRES-001, DOC-001, DEPLOY-002 | P0 |
| AR-15 | E→C | CV and interview wording | §21 | Written after results, from measurements only | DOC-007 | P1 |
| AR-16 | E→C | Q&A glossary | App. A | "Attestation" corrected (DF-08) | PRES-004, DOC-003 | P0 |
| AR-17 | E | Honest scoping statements | §4.3, §20 | — | DOC-004, PRES-001 | P0 |
| AR-18 | E→C | Problem evidence with sources | §2, §20 | Only verified figures (V-21, V-22, V-31, V-72) | PRES-001, DOC-005 | P0 |
| AR-19 | E→C | Team roles A–D | §15 | One implementer wearing all hats; teammates on admin/deck | task.md §12 | MANUAL |
| AR-20 | E | Rehearse to 3:00 (target 2:50) | §15, §17 | — | PRES-004 | P0 |

## OPT — Optional and future work

| ID | Type | Requirement | § | Tasks | Tier |
|---|---|---|---|---|---|
| OPT-01 | E | Validator staking and slashing | §21.3 | STRETCH-004 | STRETCH |
| OPT-02 | E | Batching / optimistic release with a challenge window | §21.3 | STRETCH-007 | STRETCH |
| OPT-03 | D | k-of-n validators | — | STRETCH-005 | STRETCH |
| OPT-04 | D | Gasless `fundWithAuthorization`; registered x402 scheme; auth-capture/x402r | — | STRETCH-006 | STRETCH |
| OPT-05 | D | Pull-payment `withdraw(to)` (DF-16) | — | STRETCH-008 | STRETCH |
| OPT-06 | D | Live ERC-8004 registries on testnet | §10.3 | REG-005, REG-007 | E2 |
| OPT-07 | E | LangGraph + LiteLLM buyer layer | §14.1 | AGENT-005 | E2 |
| OPT-08 | E | Dashboard attack console | §14.1 | DASH-002 | STRETCH |

---

## Reverse index (task prefix → requirements)

| Prefix | Requirements |
|---|---|
| ENV | IR-01, IR-03, IR-07, OR-01…OR-03, OR-05, OR-08…OR-10, SR-13 |
| SPEC | FR-03, FR-05, FR-06, FR-08, FR-17, FR-19…FR-22, FR-26, IR-04, IR-05, SR-11, ER-08 |
| REG | FR-01, FR-02, FR-08, FR-12, IR-01, IR-02, IR-08, OPT-06 |
| CONTRACT | FR-02…FR-04, FR-06, FR-07, FR-09…FR-11, FR-21, FR-22, FR-26, SR-01…SR-04, SR-09, SR-10, SR-12, IR-06 |
| API | FR-05, FR-17, FR-19, FR-20, FR-23, FR-24, FR-28, SR-11, SR-14, IR-04 |
| AGENT | FR-01, FR-03, FR-08, FR-16, FR-18, SR-01 |
| VAL | FR-03, FR-06, FR-25, FR-27 |
| INT | FR-07, OR-05, ER-06 |
| DEPLOY | OR-04, OR-06, OR-07, IR-06 |
| SEC | FR-13, FR-14, SR-05…SR-07, SR-15, ER-01…ER-04, ER-09, ER-10 |
| EVAL | ER-01…ER-08, ER-10 |
| DOC | AR-08, AR-11…AR-15, AR-17, AR-18, SR-06…SR-08, OR-09, OR-10 |
| PRES | AR-04…AR-07, AR-09, AR-12…AR-14, AR-16…AR-18, AR-20, SR-15 |
| DASH | FR-15 |
| STRETCH | OR-11…OR-13, OPT-01…OPT-05, OPT-08 |
| ADMIN | AR-01…AR-03, AR-08 |
| PLAN/SKILL | Governance; skills coverage (see `skills-inventory.md`) |

**Coverage check.** Every requirement above names at least one task. Requirements with no P0 task are deliberate: FR-15 (dashboard), FR-26 (signed quote), FR-28 (facilitator), IR-08 and OPT-01…OPT-08 are extended or stretch, and OR-11…OR-13 are the blueprint's own stretch goals. AR-19 is tracked in `task.md` §12 rather than as a task.
