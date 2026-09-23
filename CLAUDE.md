# CLAUDE.md — AgentTrust (EC8204 group project)

Project instructions for Claude Code sessions in this repository. **`task.md` is the authoritative plan and progress tracker.** This file holds the rules; it deliberately carries no task statuses.

---

## 1. Project and academic context

**AgentTrust — Reputation-Gated, Validation-Triggered Escrow for Autonomous AI-Agent Payments.**
An on-chain escrow that binds an agent-to-agent payment to one canonical HTTP request, gates it on portable ERC-8004 reputation, and releases funds only against a validator attestation, plus an attack/defence harness that runs published x402 attacks against a labelled vulnerable baseline and against AgentTrust.

- Module: **EC8204 Blockchain and Cyber Security**, Department of Electrical & Information Engineering, University of Ruhuna.
- Deliverable: a 3-minute, 5-slide presentation (`GP_XX_AgentTrust`, submitted to ELMS) plus a working implementation and a public repository.
- Planning target: **Tue 29 Sep 2026**, unconfirmed. The assignment PDF states `31/09/2026`, which is not a real date (V-01). ADMIN-001 confirms the real deadline; ADMIN-002 confirms the group number and whether `.ppt` or `.pptx` is required.
- Team: **one implementer** (the user, wearing blueprint roles A–D) with Claude. Teammates handle admin, faucets, references, the deck, submission and rehearsal.
- Chain: **Base Sepolia (84532)**, testnet only.

## 2. Source of truth and precedence

1. **The user's latest instruction** in the session.
2. **Accepted decisions** — `docs/planning/design-findings.md` (DF-01…DF-24), any ADRs in `docs/adr/`, and the decisions section of `task.md`.
3. **This file** for process rules, and `task.md` for what work exists and its state.
4. **The blueprint**, `docs/AgentTrust_EC8204_Project_Blueprint.md`.

Rules:
- The blueprint is the **scope baseline, not a correctness baseline**. Its code samples, interfaces, security claims, citations, figures and schedule contain verified errors. Every known error is recorded in `docs/planning/design-findings.md` and `docs/planning/blueprint-coverage.md`.
- **Never edit the blueprint.** Corrections live beside it.
- Any external fact used in code, docs or slides must cite a **V-ID** from `docs/planning/verification-log.md`, or be labelled UNRESOLVED or HYPOTHESIS. Fast-moving facts (versions, addresses, registry state, faucet limits) are re-checked by the task that uses them.
- Requirements and their coverage live in `docs/planning/requirements-register.md` and `docs/planning/blueprint-coverage.md`. Nothing is dropped silently: a requirement is either implemented, corrected, documented, deferred or explicitly out of scope, always with a task ID.

## 3. Current phase

**Planning is complete. Implementation is NOT authorized.**

Claude must not create product code, scaffold the project, install toolchains or dependencies, initialise git, create wallets, request faucet funds, deploy contracts, send transactions, run attacks or benchmarks, publish anything or contact anyone — **until the user explicitly authorizes a specific task**.

Authorization is per task (or per named batch). It is recorded in the task's `Authorized:` field and in the authorization log in task.md §14 (PLAN-009). "Plan approved" is not implementation authorization.

## 4. Scope

- **CORE-P0** (committed floor, ≈46 implementer-hours): contracts + same-ABI mocks + tests; canonical request-hash spec with cross-language vectors; seller with payer-authenticated delivery and an atomic claim; deterministic buyer; FastAPI validator; local end-to-end happy and refund paths; the **A2 and A3** evaluation against labelled fixtures; Base Sepolia deployment and verification; README, limitations, results, demo video, deck, rehearsal.
- **CORE-P1** (≈5 h, if gate G2 is on time): feedback lifecycle and posting, validator evidence store and payer retrieval, seed reputation fixtures, gas snapshot, threat-model doc, claims audit, A3 seller-side.
- **EXTENDED-E1** (hardening): EIP-712 signed quote, CI, fuzz/invariant breadth, adversarial suite, static analysis, restart journal, recovery drills, full testnet E2E, architecture doc, reproduction guide, ADRs.
- **EXTENDED-E2** (evaluation breadth): A4, A6, A5, A1, derived scenarios, pinned-upstream baseline, live ERC-8004 registries, latency study, dashboard, LangGraph/LiteLLM buyer, docker-compose, LSP binaries.
- **STRETCH (deferred):** Kafka, Kubernetes, Keycloak, validator staking/slashing, k-of-n validators, gasless `fundWithAuthorization`, optimistic release with a challenge window, pull-payment withdrawal, dashboard attack console.
- **Excluded:** mainnet, real funds, attacks against third-party endpoints, legal enforceability, fiat rails, MEV, request/response privacy.

Tier order is binding: no E1 work before G2, no E2 work before G3. Each gate's cut list in task.md §11 removes P1 first, then simplifies P0.

## 5. Architecture (as decided, not as drawn in the blueprint)

Buyer agent → seller API (Express) → `AgentTrustEscrow` on Base Sepolia → validator (FastAPI) → ERC-8004 registries (same-ABI mocks first, live registries as extended work).

1. **Discovery.** The buyer resolves an agent through the Identity registry: `agentURI` → agent card → endpoint origin, and checks that origin against the seller it is talking to.
2. **Quote.** The seller answers `402` using the **x402 v2 wire format** (`PAYMENT-REQUIRED`, CAIP-2 `eip155:84532`, PaymentRequirements) with the **project-specific scheme `agenttrust-escrow`**. This is not interoperable with stock x402 clients or facilitators, and must never be described as "x402-compliant" (DF-03).
3. **Gate + fund.** `fund()` computes the `resourceHash` **on-chain** from the canonical request fields plus amount, token and chain; enforces a **trust-anchored reputation gate** (buyer-supplied trusted clients, bounded); burns a payer-scoped nonce atomically; snapshots the payee (`agentWallet` → `ownerOf`) and the mutually agreed validator; enforces TTL bounds.
4. **Delivery.** The buyer retries with a **payer-signed** `PAYMENT-SIGNATURE`. The seller re-derives the hash from the raw bytes and its configured origin, checks the funded job (payee, amount, token, validator, deadline margin, confirmations), then takes an **atomic claim** and executes **once**.
5. **Validation.** The seller deposits a signed receipt plus the response bytes with the validator and files one `validationRequest`; the payee binds that `requestHash` to the job once. The validator re-derives the hash independently in Python, recomputes the deterministic fixture output, and posts `validationResponse`.
6. **Settlement.** `release()` requires a snapshotted passing attestation whose `lastUpdate ≤ deadline`, and has no deadline of its own. `refund()` is allowed only after **deadline + grace** with no recorded pass. There is no early refund on "fail", because a pending request is indistinguishable from a 0 response (V-99).
7. **Feedback.** The buyer writes feedback directly to the Reputation registry with the project tag; there is no escrow-routed feedback (DF-21).

Known unresolved decisions and their alternatives: `docs/planning/design-findings.md`. Six of them (D1–D6) need the user's sign-off in PLAN-007; the rest apply by default.

## 6. Dev-assistant agents (distinct from the human roles A–D)

| Agent | Owns | Never touches |
|---|---|---|
| `contracts-protocol` | SPEC-001/003/005, CONTRACT-*, REG-*, DEPLOY-* | service code, harness |
| `agents-backend` | SPEC-002, API-*, AGENT-*, VAL-*, INT-* | contracts, evaluation claims |
| `security-eval` | SPEC-004, SEC-*, EVAL-*, threat model, evaluation plan | production code paths (reviews them instead) |
| `delivery-completeness` | PLAN-*, ADMIN-*, ENV-*, DASH-*, DOC-*, PRES-*, STRETCH-*, SKILL-* | contract/service internals |
| `skills-workflow` | skills, CI hygiene, reproducibility | everything else |

Collaboration rules:
- **One writer per area per session.** Two agents must not edit the same files concurrently.
- A change to a spec (SPEC-001/002/003/004) **must** update the shared vectors and every implementation of them (Solidity, TypeScript, Python) in the same task.
- `security-eval` reviews every contract change and every payment-path service change before it is marked DONE.
- No agent marks a task DONE. The agent reports evidence; the session lead updates `task.md` after the acceptance criteria pass.
- No agent runs testnet transactions, deployments, faucet requests or attacks without explicit user authorization for that task.
- Agents write drafts to the scratchpad, never to the repository, unless the task's expected files say otherwise.

## 7. Skills

Inventory, versions, privileges and fallbacks: `docs/planning/skills-inventory.md`.

| Situation | Use |
|---|---|
| Writing Solidity, Foundry tests, fuzz/invariants, `forge script` | `solidity@solskill` (invoke explicitly) |
| Contract security review, token integration (USDC/EIP-3009), entry points | `building-secure-contracts@trailofbits`, `entry-point-analyzer@trailofbits` |
| Checking code against a spec or the ERC-8004 ABI | `spec-to-code-compliance@trailofbits` |
| Reviewing a diff before DONE | `differential-review@trailofbits`, `/code-review`, `requesting-code-review` |
| Any failing test or surprising behaviour | `systematic-debugging` (root cause before fix) |
| Writing any feature or fix | `test-driven-development` |
| Before claiming anything is done | `verification-before-completion` |
| Library/API details (Foundry, OZ, viem, wagmi, x402, LangGraph, ERC-8004) | Context7 MCP — never guess an API |
| Security pass on pending changes | `/security-review` |
| Charts and the dashboard | `dataviz`, `frontend-design` |
| The deck | `anthropic-skills:pptx` |

Where a vendored superpowers skill's own workflow conflicts with this file, **this file wins**; references inside them to non-vendored superpowers skills do not apply. Adding, updating or removing a skill requires inspection, a recorded SHA in the inventory, and a note in task.md §14.

## 8. Repository layout (PROPOSED — confirmed by ENV-002)

Git root is the workspace root, and the repository stays **private** until DOC-009 decides what is published (the blueprint contains personal notes; the planning docs contain candid critiques).

```
CLAUDE.md · task.md · README.md
docs/            planning/ · specs/ · adr/ · threat-model.md · architecture.md · results.md · <blueprint>
impl/            contracts/ · packages/core/ · agents/seller/ · agents/buyer/ · validator/ · attacks/ · dashboard/ · vectors/
deployments/     evidence/<TASK-ID>/     .github/workflows/
```

## 9. Versions and compatibility

- Pin exact versions in `docs/specs/versions.md` (ENV-001) and in lockfiles. **No floating tags, no `@latest`.**
- Current pins: Foundry **v1.8.3**, OpenZeppelin **v5.7.0**, solc **0.8.37**, `evm_version = cancun`, `@x402/*` **2.26.0** (baseline only), viem 2.56.8, express 5.2.1 (V-100…V-103, V-63, V-108).
- The ERC-8004 ABI is pinned to `erc-8004/erc-8004-contracts@b9e466c`, with the ABI JSON committed (REG-001). The live registries are upgradeable by a single key (V-97), so mocks implementing the **same ABI** are the default test substrate and REG-008 checks conformance.
- Record any version change in `docs/specs/versions.md` and re-run the affected acceptance checks.

## 10. Engineering standards

**Solidity.** Checks-Effects-Interactions plus `ReentrancyGuard`; custom errors, not require-strings; NatSpec on every external function; events for every state transition; `SafeERC20`; `Ownable2Step`; no admin path that can move escrowed funds; bounded loops (the trusted-client list is capped); no unbounded external reads inside `fund()` beyond that cap.

**TypeScript.** Strict mode; amounts as `bigint` in atomic units (never floats or JS numbers); viem for chain access; raw request bytes captured before any parsing; no secrets in logs; structured JSON logs with a run id.

**Python (validator).** Typed, `pydantic` models, `pytest`; the canonical hash is implemented **independently** from the TypeScript version and validated against the shared vectors — that independence is the point.

**Testing.** Tests before implementation. Every task names the tests that must exist and pass. Shared vectors in `impl/vectors/` are the single source of truth for hashing across all three languages. Never weaken a test or a baseline to make a result look better; if a result contradicts the hypothesis, report it.

**Debugging.** Reproduce, find the root cause, then fix. No speculative fixes, no `sleep`-based waits in tests, no disabling tests.

**Documentation.** Any behaviour change updates the spec in `docs/specs/` and the affected docs in the same task. Accepted decisions become ADRs (DOC-008). The README opens with the problem statement.

## 11. Secrets, keys and networks

- **Testnet only.** Base Sepolia, valueless tokens. Never mainnet, never real funds.
- Keys are created by the user, offline, and kept out of the repository: `.env` is git-ignored, and keystores are preferred over raw keys. `.env.example` lists variable names only.
- Never print, echo, log or paste a private key, mnemonic or API key — not into chat, not into evidence files, not into commit messages.
- Only public addresses, transaction hashes and contract addresses go into docs, slides and evidence.
- Claude asks for explicit authorization before any on-chain transaction, deployment, faucet request or contract verification, and reports the transaction hash afterwards.
- A secret-scan check runs before the first commit and before publication (ENV-002, DOC-009). If a key is ever exposed, rotate it and purge history before publishing.

## 12. Evidence standards

- **No fabricated measurements.** A number appears in task.md, docs or slides only if it came from a recorded run whose raw log is committed under `evidence/<TASK-ID>/` or `impl/attacks/results/`.
- Every measured run records: commit hash, tool versions, chain and block, configuration, seeds, run count, and raw log paths (the run manifest in SEC-002).
- **Baselines are labelled.** A deliberately vulnerable fixture is always described as such, and is never presented as "vanilla x402" or as upstream behaviour. Claims about upstream require a run against a pinned upstream version (API-009).
- Expected outcomes are **hypotheses** until measured. Failed, partial and inconclusive outcomes are reported, not hidden.
- Security claims name the mechanism and its bound (for example "mitigated up to confirmation depth k"), never "blocked" without evidence.
- Coverage is reported with its denominator: attacks **evaluated** out of the six defined, with outcomes Blocked / Mitigated-to-bound / Not blocked / Not evaluated.

## 13. Task workflow (every implementation session)

1. Read `CLAUDE.md`, then `task.md` (§2 status, §7 critical path, §11 gates).
2. Pick the next **authorized** task whose dependencies are DONE. If it isn't authorized, ask; don't start.
3. Set it `IN_PROGRESS` in task.md (and only it — one task at a time).
4. Implement **only that task's agreed scope**. Scope growth needs a new task, not a bigger one.
5. Run the task's verification commands; check the acceptance criteria one by one; review the listed risks and DFs.
6. Record in task.md §14: files changed, commands run, outcomes, evidence paths, commit hash.
7. Mark `DONE` only if every criterion passes. Otherwise mark `BLOCKED` (with the blocker) or leave it `IN_PROGRESS` with a note on what remains. `[x]` is only ever used for DONE.
8. Stop at the user's requested stopping point. **By default, stop at each gate** (G1, G2, G3a, G3b, G4, G5) for review.

Keep `task.md` current: it is the handover document between sessions.

## 14. Resuming in a new session

1. Read this file, then `task.md` §2 (current status) and §16 (next task).
2. Skim `docs/planning/design-findings.md` for decisions that constrain the task, and `verification-log.md` for any fact it depends on.
3. Run `git status` and `git log --oneline -5`; confirm the working tree matches what task.md claims.
4. Re-check fast-moving facts the task depends on (versions, registry state, faucet limits).
5. Confirm the task is authorized, then follow §13.

## 15. Environment notes

- WSL2, workspace on `/mnt/d` (DrvFs). **Measured 2026-09-23 (ENV-002):** SQLite WAL locking works correctly here, but small-file writes are ~38× slower than ext4. So the repository stays on `/mnt/d`, while `CLAIMS_DB_PATH` defaults to `$HOME/.local/state/agenttrust/` for speed; a `/mnt/` path warns rather than refusing. Move the whole repository to ext4 if `pnpm install` exceeds 5 minutes or a concurrency test fails in a filesystem-shaped way (DF-20).
- Missing tools that ENV-003 installs later: `forge`, `anvil`, `cast`, `solc`, and optionally `slither`/`aderyn`.
- Present: node 22.17, npm, pnpm, python 3.12, uv, go 1.23, docker, gh (authenticated), jq.
- The Base Sepolia public RPC is HTTP-only, so watch events by polling, never by WebSocket subscription (V-83).
