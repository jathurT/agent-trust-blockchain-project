# Blueprint Coverage Matrix — AgentTrust

Every element of `docs/AgentTrust_EC8204_Project_Blueprint.md` and what happens to it. Nothing is left without a disposition.

**Inventory (computed with a fence-aware scan, 2026-09-22):** 81 headings · 18 tables · 11 code blocks (3 Solidity, 1 JavaScript, 2 bash, 5 diagram/tree) · 1 checklist with 10 items · 4 reference groups · front matter · footer note. The `#` lines inside the §14.2 and §18 code fences are shell comments, not headings.

**Dispositions:** **Implement** (build it) · **Correct** (build it differently; a DF explains why) · **Verify** (check before use) · **Document** (write it up) · **Present** (goes in the deck/demo) · **Admin** (manual human task) · **Defer** (extended or stretch) · **Context** (framing; no work item).

**Classification:** Explicit (blueprint requirement) · Derived · Correction · Optional.

**Summary:** Implement 24 · Correct 27 · Document 11 · Present 10 · Admin 6 · Defer 9 · Verify 5 · Context 21 (elements may carry two dispositions; the count is by row).

---

## Front matter and §0

| Element | Content | Disposition | Class | Tasks | Notes |
|---|---|---|---|---|---|
| Title + subtitle (L1–2) | Project name and framing | Context/Present | Explicit | PRES-001, DOC-001 | Name kept |
| Front matter (L4–8) | Module, institution, deliverable, group size 4, platform | Context/Admin | Explicit | ADMIN-001…003 | Team reality differs: one implementer (task.md §12) |
| §0 Quick Reference | Section wrapper | Context | Explicit | — | — |
| §0.1 Google Sheet text | Exact registration wording | Admin | Explicit | ADMIN-003 | Use verbatim |
| §0.2 File naming | `GP_XX_AgentTrust.ppt`, ELMS, one per group | Admin/Verify | Explicit | ADMIN-002, PRES-005 | `.ppt` vs `.pptx` unconfirmed (V-03) |
| §0.3 Deadline warning | `31/09/2026` does not exist; plan for 29 Sep | Admin/Correct | Explicit→Correction | ADMIN-001 | Invalid date confirmed (V-01); schedule rebuilt (task.md §11) |
| §0.4 One-sentence pitch | "…reproducing five published attacks and showing they fail" | Correct/Present | Correction | PRES-001, SEC-012 | Conflicts with Slide 5's "six"; claim must match what was evaluated (DF-19) |

## §1–§2 Framing and problem

| Element | Content | Disposition | Class | Tasks | Notes |
|---|---|---|---|---|---|
| §1 Executive Summary | Three mechanisms + harness | Context/Correct | Explicit | DOC-001, PRES-001 | "Cryptographic proof of delivery" narrowed (DF-08) |
| §2 The Problem | Wrapper | Context | Explicit | — | — |
| §2.1 Adoption | x402 May 2025; 725→50M; 130M; Foundation membership | Verify/Correct | Correction | DOC-005, PRES-001 | 725→50M **UNRESOLVED** (V-22); 130M is Dune-sourced (V-21); membership wrong as written (V-72); whitepaper date verified (V-60) |
| §2.2 Table: four unanswered questions | Gap framing | Present | Explicit | PRES-001 | Still accurate |
| §2.3 Stakes + Chainalysis | $2B/13 bridges/69% | Present | Explicit | DOC-005 | Verified (V-31) |
| §2.3 Framing line | "we automated the payment before we automated the trust" | Present | Explicit | PRES-001 | Keep |

## §3 Attack surface

| Element | Content | Disposition | Class | Tasks | Notes |
|---|---|---|---|---|---|
| §3 intro | "two peer-reviewable sources… 11 vulnerabilities" | Correct | Correction | DOC-005, SEC-012 | The 11/five-classes figure is from 2605.11781 alone (V-11) |
| §3 Table: A1–A6 | Attack IDs, mechanisms, reported impact | Correct/Implement | Explicit→Correction | SEC-003…008, evaluation-plan §5 | Per-attack attribution fixed; A2 context (V-12), A6 is a ranking experiment (V-14), A5 direction reversed (V-26, DF-10); the papers' I-B, III, F4, F5 are recorded as uncovered |
| §3 closing advice | "Read A2 and A6 out loud" | Present | Explicit | PRES-001 | Only with corrected framing |

## §4 Threat model

| Element | Content | Disposition | Class | Tasks | Notes |
|---|---|---|---|---|---|
| §4.1 Assets | Balance, capacity, reputation integrity, availability | Implement/Document | Explicit | SEC-001, DOC-003 | Kept |
| §4.2 Table: adversaries | Seller, buyer, Sybil operator, observer/front-runner | Correct/Document | Explicit→Derived | SEC-001 | Adds `jobId` observer (DF-02), colluding validator (DF-07), registry upgrader (V-97), malicious token (DF-12) |
| §4.3 Trust assumptions | Chain finality; "at least one honest validator"; not solving collusion/quality/keys | Correct | Correction | SEC-001, DOC-004 | Corrected per DF-07 |
| §4.4 Out of scope | Legal, fiat, MEV, privacy | Document | Explicit | DOC-004 | Kept; privacy matters for DF-02's residual risk |

## §5 Solution

| Element | Content | Disposition | Class | Tasks | Notes |
|---|---|---|---|---|---|
| §5.1(1) Discovery | Identity registry, agent card | Implement | Explicit | REG-002, REG-006, AGENT-002 | Origin check added (DF-04) |
| §5.1(2) Gate | Score, feedback count, distinct attesters | Correct | Correction | CONTRACT-005, SPEC-003 | Trust-anchored gate (DF-09) |
| §5.1(3) Canonical quote | Hash of method/URI/body/price/token/chain | Correct | Correction | SPEC-001, CONTRACT-004 | Computed on-chain (DF-04) |
| §5.1(4) Escrow | Exact amount, nonce burn | Implement | Explicit | CONTRACT-004 | Plus TTL bounds (DF-22) |
| §5.1(5) Delivery after Funded | No optimistic grant | Implement/Correct | Explicit→Derived | API-003, API-005 | Confirmation policy (DF-23) + claim + payer auth (DF-01/02) |
| §5.1(6) Validation | Validator attests, keyed by jobId | Correct | Correction | API-006, VAL-004, CONTRACT-007 | Keyed by bound `requestHash` (DF-06); evidence deposit (DF-08) |
| §5.1(7) Release/refund | Attestation-triggered release; deadline refund | Correct | Correction | CONTRACT-007, CONTRACT-008 | Snapshot + grace; no early fail refund (DF-05) |
| §5.1(8) Feedback | Completion writes feedback | Correct | Correction | SPEC-004, AGENT-003 | Buyer-direct (DF-21) |
| §5.2 Code block: state machine | Four states, three transitions | Implement/Correct | Explicit | CONTRACT-004, CONTRACT-013 | Adds a validation-recorded flag |

## §6 Why blockchain

| Element | Disposition | Class | Tasks | Notes |
|---|---|---|---|---|
| §6.1 Table: three properties | Present/Document | Explicit | DOC-001, PRES-001 | Argument holds |
| §6.2 Viva sentence | Present | Explicit | PRES-001, PRES-004 | Keep verbatim |
| §6.3 Honesty test | Present/Document | Explicit | DOC-004, PRES-001 | Reinforced by DF-08 |

## §7 Prior art

| Element | Disposition | Class | Tasks | Notes |
|---|---|---|---|---|
| §7.1 Table: nine projects | Correct/Document | Correction | DOC-001, DOC-005 | PayCrow already uses ERC-8004 (V-40); Arbitova wording (V-42); Vouch ambiguous (V-44); switchboard repo unresolved (V-43); **add ERC-8183 (V-49), auth-capture (V-47), ASP (V-32)** |
| §7.2 Novelty claim | Correct | Correction | DOC-001, PRES-002, SEC-012 | "no existing project provides that security evaluation" is too strong (DF-19) |

## §8 Architecture

| Element | Disposition | Class | Tasks | Notes |
|---|---|---|---|---|
| §8.1 Code block: component diagram | Correct/Present | Correction | DOC-002, PRES-002 | Facilitator only on the baseline path (DF-03); Kafka is stretch; validator gains evidence store |
| §8.2 "Why this architecture suits your team" | Context/Correct | Correction | task.md §12 | Written for a 4-person split; one implementer now |

## §9 Smart contract design

| Element | Disposition | Class | Tasks | Notes |
|---|---|---|---|---|
| §9.1 Code block: `resourceHash` | Correct | Correction | SPEC-001 | On-chain derivation, domain tag, full canonicalisation rules (DF-04) |
| §9.2 Code block: `AgentTrustEscrow` (230 lines) | Correct/Implement | Correction | CONTRACT-004…011, REG-001 | Registry interfaces invented (V-95); `quotedMax` removed; release/refund timing fixed; TTL bounds; payee snapshot; token allowlist (DF-04, DF-05, DF-12, DF-22) |
| §9.2 Interfaces block | Correct | Correction | REG-001…004 | Replaced by the pinned real ABI (DF-14) |
| §9.3 Table: seven design decisions | Correct/Document | Explicit→Correction | DOC-008, CONTRACT-014 | Nonce, domain separation, CEI, permissionless refund and custom errors survive; `quotedMax` and "distinctAttesters raise the cost" do not (DF-04, DF-09) |
| §9.4 Code block: Foundry tests | Correct | Correction | CONTRACT-011, SEC-004, SEC-007 | A3, A6 and refund tests assert the wrong things (DF-13) |

## §10 ERC-8004

| Element | Disposition | Class | Tasks | Notes |
|---|---|---|---|---|
| §10.1 Table: three registries | Verify/Implement | Explicit | REG-001…004 | Roles correct; ABI is not (V-93…V-95) |
| §10.2 Version warning + reference list | Verify/Correct | Explicit→Correction | REG-001 | Draft status and history verified (V-90, V-91); nuwa-8004 outdated, "79/79" is a copied badge (V-50); pin `@b9e466c` |
| §10.3 Mocks-first fallback | Implement | Explicit | REG-002…004, REG-008 | Best advice in the blueprint; mocks now use the real ABI (DF-14). Live registries already deployed (V-97) → REG-005/007 |

## §11 x402 integration

| Element | Disposition | Class | Tasks | Notes |
|---|---|---|---|---|
| §11.1 Code block: sequence | Correct | Correction | SPEC-002, AGENT-002 | GET/POST mismatch; release is permissionless; adds confirmations, payer-signed retry, evidence, bind (DF-01…DF-06) |
| §11.2 Code block: middleware sketch | Correct | Correction | API-002, API-003 | v1 API (V-64); double charge (V-68); hashes parsed request; notifies validator too late (DF-03, DF-04, DF-08) |
| §11.3 Table: environment constants | Verify/Correct | Correction | ENV-001, ENV-013 | USDC verified (V-81); chain ID verified (V-80); `base-sepolia` → `eip155:84532`; facilitator operator unstated (V-69); SDK shape (V-63) |

## §12 Attack/defence harness

| Element | Disposition | Class | Tasks | Notes |
|---|---|---|---|---|
| §12.1 Code block: directory tree | Implement | Explicit | SEC-002 | Adopted under `impl/attacks/`; `vanilla.ts` renamed to a labelled fixture (DF-18) |
| §12.1 Run commands | Implement | Explicit | SEC-002, AGENT-006 | Kept |
| §12.2 Table: six attack procedures | Correct/Implement | Correction | SEC-003…008 | A2/A4 expectations target the wrong layer; A5 parameter removed (DF-01, DF-10, DF-13) |
| §12.3 Table: results | Correct | Correction | EVAL-004, EVAL-005 | Pre-filled "✓ blocked" replaced by measured outcomes with a denominator |
| §12.3 MVP rule (A2+A3) | Implement | Explicit | SEC-003, SEC-004 | Adopted as the P0 evaluation |
| §12.4 Ethics note | Document/Present | Explicit | SEC-011, PRES-002 | Kept |

## §13 Evaluation metrics

| Element | Disposition | Class | Tasks | Notes |
|---|---|---|---|---|
| §13(1) Defence coverage | Correct | Correction | EVAL-005 | Denominator + four outcome categories |
| §13(2) Grants per payment | Correct | Correction | SEC-003 | Counted as executions (DF-17) |
| §13(3) Resource leakage | Correct | Correction | SEC-006 | Both directions (DF-10) |
| §13(4) Sybil capture | Correct | Correction | SEC-007 | Own selection model (V-14) |
| §13(5) Gas | Implement | Explicit | EVAL-002 | All five transactions (DF-06) |
| §13(6) Latency | Implement | Explicit | EVAL-006, EVAL-003 | Per-stage timestamps |

## §14 Stack and setup

| Element | Disposition | Class | Tasks | Notes |
|---|---|---|---|---|
| §14.1 Table: stack | Verify/Correct | Explicit→Correction | ENV-001, ENV-003 | Versions pinned (V-100…V-103); validator = FastAPI; LangGraph/LiteLLM deferred (DF-24); Kafka/K8s/Keycloak remain stretch |
| §14.1 Scope-discipline note | Context | Explicit | task.md §3 | Adopted as the tier rule |
| §14.2 Code block: day-one checklist | Correct | Correction | ENV-003, ENV-006, ENV-013 | `foundryup --install v1.8.3`; pin OZ `@v5.7.0`; project under `impl/contracts`; wallets created offline by the user (V-101) |
| §14.2 Faucet warning + Amoy fallback | Verify/Correct | Correction | ENV-007, DEPLOY-005 | Faucet limits (V-86); Amoy is **not** a drop-in (V-71) |

## §15 Schedule

| Element | Disposition | Class | Tasks | Notes |
|---|---|---|---|---|
| §15 Week 1 / Week 2 / Week 3 / Buffer (4 tables) | Correct | Correction | task.md §11 | Stale: it assumed a 7 Sep start with Week 3 in progress. Rebuilt as Wed 23 → Tue 29 with gates and cut rules |
| §15 Table: team split A–D | Correct | Correction | task.md §12 | Roles become hats for one implementer; teammates take admin/deck |
| §15 Milestone gates (M1–M3) | Correct | Correction | task.md §11 | Replaced by G1…G5 with explicit cut lists |

## §16 Deliverables checklist (10 items, each tracked)

| Item | Disposition | Tasks |
|---|---|---|
| Topic registered in the sheet | Admin | ADMIN-003 |
| `GP_XX_AgentTrust.ppt` submitted by the deadline | Admin | ADMIN-002, ADMIN-005, PRES-005 |
| Public GitHub repo, README opens with the problem | Implement/Document | ADMIN-004, DOC-001, DOC-009 |
| `AgentTrustEscrow.sol` deployed **and verified** | Implement | DEPLOY-001, DEPLOY-002 |
| Address + explorer link on the final slide | Present | DEPLOY-003, PRES-006 |
| Foundry suite green, screenshot in the deck | Implement/Present | CONTRACT-011, PRES-006 |
| Attack harness with `results.json` and results table | Implement | SEC-002, EVAL-004 |
| 45-second demo video | Present | PRES-003 |
| One-page threat model | Document | SEC-001, DOC-003 |
| References slide with verified IDs | Document/Present | DOC-005, PRES-002 |

## §17–§18 Presentation and demo

| Element | Disposition | Class | Tasks | Notes |
|---|---|---|---|---|
| §17 Slide 1 Hook | Present/Correct | Correction | PRES-001 | Drop the unverified 725→50M (V-22); use attributed figures |
| §17 Slide 2 Problem | Present/Correct | Correction | PRES-001 | "eleven vulnerabilities" belongs to one paper (V-11) |
| §17 Slide 3 Solution | Present/Correct | Correction | PRES-001 | Gate wording per DF-09; delivery wording per DF-08 |
| §17 Slide 4 Demo | Present/Correct | Correction | PRES-003 | Split-screen kept; narrative corrected (claim refusal vs `ReplayedNonce`) |
| §17 Slide 5 Results | Present/Correct | Correction | PRES-002, EVAL-005 | Only measured outcomes with the denominator |
| §17 Delivery notes | Present | Explicit | PRES-004 | One presenter, no live calls, backup slides |
| §18 Code block: demo script | Correct | Correction | AGENT-006, PRES-003 | Commands kept; expected output corrected (DF-13) |

## §19–§22 and appendices

| Element | Disposition | Class | Tasks | Notes |
|---|---|---|---|---|
| §19 Table: seven risks + governing rule | Implement/Correct | Explicit→Correction | task.md §10 | All seven carried into the risk register with feasibility verdicts for each fallback (V-71 for Amoy) |
| §20 Five scoring criteria + extra credit | Present/Document | Explicit | PRES-001, DOC-001, DEPLOY-002 | Directly shapes the deck and the verification requirement |
| §21.1 CV bullet | Correct/Defer | Correction | DOC-007 | Rewritten after results; "all six" only if measured |
| §21.2 Why it reads as more than coursework | Context | Explicit | DOC-007 | — |
| §21.3 Interview answers | Document/Present | Explicit | PRES-004, DOC-007 | Staking/slashing and batching become named future work (OPT-01/02) |
| §22 Protocols and standards | Verify | Explicit | DOC-005 | Add ERC-8183 (V-49); x402 repo moved (V-61) |
| §22 Security literature | Verify/Correct | Correction | DOC-005 | Titles, authors and the 2604.11430 quotes (V-10, V-20, V-30) |
| §22 Tooling | Verify | Explicit | ENV-001 | Versions pinned (V-100…V-107) |
| §22 Related projects surveyed | Verify/Correct | Correction | DOC-005 | See §7.1 row |
| Appendix A Glossary (12 terms) | Document/Correct | Correction | DOC-003, PRES-004 | "Attestation" corrected (DF-08); the rest stand |
| Appendix B Code block: repo structure | Correct | Correction | ENV-002 | Extended: `impl/`, `packages/core`, `vectors/`, `evidence/`, `deployments/`, `docs/specs` |
| Footer note ("re-verify all URLs, addresses and arXiv IDs") | Implement | Explicit | PLAN-002, DOC-005 | Done for planning (verification-log.md); DOC-005 re-checks before submission |

---

## Elements deliberately not carried into P0

| Element | Why | Where it lives |
|---|---|---|
| Kafka, Kubernetes, Keycloak (§8.1, §14.1) | The blueprint's own stretch rule | STRETCH-001…003 |
| Dashboard (§8.1, §14.1) | Not needed for the evidence | DASH-001 (E2) |
| LangGraph + LiteLLM (§14.1) | No security property depends on it (DF-24) | AGENT-005 (E2) |
| A1, A4, A5, A6 (§12.2) | MVP rule: A2+A3 first (§12.3) | SEC-005…008 (E2) |
| Live ERC-8004 registries (§10.2) | Single-key upgradeable; mocks are ABI-identical | REG-005/007 (E2) |
| Facilitator service (§8.1) | Not used by the AgentTrust flow (DF-03) | API-009 (E2) |
