# AgentTrust
### Reputation-Gated, Validation-Triggered Escrow for Autonomous AI-Agent Payments

**Module:** EC8204 — Blockchain and Cyber Security
**Institution:** Department of Electrical & Information Engineering, Faculty of Engineering, University of Ruhuna
**Deliverable:** Group project — 3-minute presentation + working implementation
**Group size:** 4 members
**Platform:** Base Sepolia testnet (EVM) · Solidity · ERC-8004 · x402

---

## 0. Quick Reference

### 0.1 What to type into the class Google Sheet

> **AgentTrust — Reputation-Gated, Validation-Triggered Escrow for Autonomous AI-Agent Payments (x402 + ERC-8004)**

If the sheet has a short field, use: **AgentTrust — Secure Escrow for AI-Agent Payments**

### 0.2 File naming (from the assignment PDF)

The PDF requires `GP_XX_Task_name in short_name.ppt`, e.g. `GP_01_Gem_Fraud_Detection.ppt`.

Yours becomes: **`GP_XX_AgentTrust.ppt`** — replace `XX` with your assigned group number. Submit to ELMS, one submission per group.

### 0.3 Deadline warning

The PDF states **31/09/2026**. September has 30 days, so that date does not exist. Email the module coordinator to confirm, and **plan for 29 September 2026** so you are safe either way. Every date in the plan in §15 assumes this.

### 0.4 One-sentence pitch (memorise this)

> AI agents now pay each other autonomously with stablecoins, but the protocol they use is pay-first-and-hope; we built an on-chain escrow that only releases money against a cryptographic proof of delivery, and we prove it by reproducing five published attacks and showing they fail.

---

## 1. Executive Summary

Autonomous AI agents have started transacting with each other over HTTP using stablecoins, primarily through the **x402** protocol (Coinbase, whitepaper May 2025), which revives the dormant HTTP `402 Payment Required` status code so that a machine can pay for an API call inline, with no human, no account and no API key.

The economic layer arrived before the trust layer. x402 in its base form is **pay-first, hope-for-delivery**: the buyer's signature authorises a transfer of funds to a merchant address, but it does not bind that payment to a specific resource, does not confirm the service was delivered, and carries no notion of counterparty reputation. Two 2026 security papers document concrete, measured exploits of exactly these gaps.

**AgentTrust** is a smart-contract trust layer that wraps agent-to-agent payments with three mechanisms:

1. **An entry gate** — before a single rupee moves, the buyer's contract reads the seller agent's portable reputation from the **ERC-8004 Reputation Registry** and refuses to transact with unknown, low-scoring, or Sybil-clustered agents.
2. **Resource-bound escrow** — funds are locked in a neutral contract against the hash of one canonical request, with a nonce burned atomically in the same transaction, so a payment cannot be replayed, duplicated, or redirected to a different service.
3. **A validation-triggered release** — money moves to the seller only when an independent validator posts a passing attestation to the **ERC-8004 Validation Registry**, with a deadline-based refund path protecting the buyer if delivery never happens.

The distinguishing contribution — and the reason this fits a module called *Blockchain and Cyber Security* rather than just *Blockchain* — is the **attack/defence harness**: a reproducible test suite that runs published x402 attacks against both a vanilla endpoint and AgentTrust, and produces a results table showing which ones are blocked and by which mechanism.

---

## 2. The Problem

### 2.1 Machine-to-machine payment is real and growing fast

- **x402** was published by Coinbase in May 2025. It lets a server answer a request with HTTP 402 plus a price quote; the client signs a stablecoin transfer (typically USDC) and retries; a *facilitator* settles it on-chain and the server releases the resource.
- Adoption figures from the paper *"Free-Riding the Agentic Web"* (arXiv 2605.30998): transaction volume grew **from roughly 725 transactions in May 2025 to approximately 50 million by the end of 2025**, with the abstract reporting **130 million all-time transactions** and integration into Google Cloud, Cloudflare and Stripe.
- Governance moved to the **x402 Foundation** (Coinbase and the Linux Foundation, with Cloudflare, Google, Visa, AWS, Circle, Anthropic and Vercel involved). This is standards-track infrastructure, not a weekend experiment.

### 2.2 The trust layer did not arrive with it

When two AI agents from different operators transact, neither has an account with the other, neither can sue the other, and there is no shared intermediary. That creates four unanswered questions:

| Question | Status in vanilla x402 |
|---|---|
| Will the seller actually deliver after being paid? | No guarantee — no escrow |
| Can one payment be reused for many requests? | Yes, in measured practice |
| Is the buyer paying for the resource they asked for? | Signatures are resource-agnostic |
| Is this seller trustworthy at all? | No portable reputation |

### 2.3 Why the stakes are not theoretical

Settlement and trust bugs in machine-money infrastructure are historically among the most expensive failures in the industry. Chainalysis reported in August 2022 that **US$2 billion had been stolen across 13 cross-chain bridge hacks**, accounting for **69% of all funds stolen that year to that point**. Bridges failed for the same underlying reason x402 is vulnerable: value moved on the basis of a message whose binding to the intended action was too weak.

The difference now is that the counterparties are **autonomous software running unattended at machine speed**. A human notices being charged twice. An agent making thousands of calls per hour does not.

> **Framing line for your slides:** we automated the payment before we automated the trust.

---

## 3. Attack Surface — What Actually Breaks Today

These come from two peer-reviewable sources: *"Five Attacks on x402 Agentic Payment Protocol"* (arXiv 2605.11781 — Zelin Li, Qin Wang, Zhipeng Wang), which identified **11 vulnerabilities across five classes**, and *"Free-Riding the Agentic Web"* (arXiv 2605.30998), which formalises five broken security invariants with measurements.

| ID | Attack | Mechanism | Reported impact |
|---|---|---|---|
| **A1** | Revert-grant under optimistic execution | Server grants the resource before on-chain settlement finalises; the settlement then reverts | Service delivered, never paid |
| **A2** | Cross-boundary replay | The HTTP payment payload is reusable because nothing burns it atomically on-chain | Measured **248 grants from a single payment** on a live endpoint |
| **A3** | Cross-resource substitution | Signature authorises an amount to a merchant, not a specific resource — "pay for a, get b" | Buyer charged for a service they did not receive |
| **A4** | Probabilistic service duplication | No atomic nonce lock; concurrent requests race the same payment | Multiple grants per payment |
| **A5** | Allowance overdraft | Dynamic "up-to" pricing lets the seller draw more than quoted, or the buyer consume more than paid | Up to **100% resource leakage** |
| **A6** | Sybil server-selection | Agent discovery ranks endpoints with no identity cost | **5 Sybil endpoints captured 60.2%** of agent traffic |

Read A2 and A6 out loud in the presentation. "One payment, 248 free API calls" and "five fake servers captured 60% of all agent traffic" are the two numbers that make an examiner sit up.

---

## 4. Threat Model

State this explicitly — a named threat model is one of the fastest ways to gain marks in a security module.

### 4.1 Assets

- Buyer's stablecoin balance
- Seller's compute and API capacity
- The integrity of the reputation signal
- Availability of the payment channel

### 4.2 Adversaries

| Adversary | Capability | Goal |
|---|---|---|
| **Malicious seller agent** | Controls its own endpoint and responses | Take payment without delivering; overcharge beyond quote |
| **Malicious buyer agent** | Can replay payloads, issue concurrent requests | Obtain service without paying; reuse one payment many times |
| **Sybil operator** | Can cheaply register many agent identities and cross-endorse them | Capture discovery traffic, then defect |
| **Network observer / front-runner** | Sees the mempool and HTTP traffic | Grief transactions, burn nonces, reorder settlement |

### 4.3 Trust assumptions (be honest about these — examiners probe them)

- The underlying chain (Base Sepolia) provides correct ordering and finality.
- At least one honest validator exists and is economically motivated to attest truthfully.
- The buyer and seller agents can each read the chain.
- **We do not solve** validator collusion, oracle-level truth of the delivered content's *quality*, or key compromise at the agent's wallet. Say this out loud; scoping honesty reads as maturity, not weakness.

### 4.4 Out of scope

Legal enforceability, fiat on/off-ramps, MEV on the settlement transaction, and privacy of request contents. Note them as future work.

---

## 5. The Solution — End to End

### 5.1 Narrative walkthrough

1. **Discovery.** The buyer agent finds a seller agent through the **ERC-8004 Identity Registry**. Each agent is an ERC-721 token whose URI resolves to an "agent card" describing its services and endpoint.
2. **Gate.** Before any money moves, `AgentTrustEscrow.fund()` reads the seller's score from the **ERC-8004 Reputation Registry** and reverts if the agent is below threshold, has too little feedback, or has feedback from too few *distinct* attesters. *(Defends A6.)*
3. **Canonical quote.** The seller returns an HTTP 402 with a price. The buyer canonicalises method, URI, body, price, token and chain ID into a single `resourceHash`. *(Defends A3, A5.)*
4. **Escrow.** The buyer funds the escrow with the **exact quoted amount**, binding it to that `resourceHash` and burning a payer-scoped nonce in the **same transaction**. *(Defends A2, A4.)*
5. **Delivery.** Only after the `Funded` state is confirmed on-chain does the seller serve the resource. *(Defends A1 — no optimistic grant.)*
6. **Validation.** An independent validator checks delivery and posts a passing attestation to the **ERC-8004 Validation Registry**, keyed by `jobId`.
7. **Release.** `release()` verifies the attestation and transfers funds to the seller. If no passing attestation arrives before the deadline, `refund()` returns the money to the buyer.
8. **Feedback.** Completion writes reputation feedback back to the registry, closing the loop and strengthening the gate for the next transaction.

### 5.2 State machine

```
                 fund()                    release()
   [ None ] ───────────────► [ Funded ] ──────────────► [ Released ]
                                  │
                                  │  refund()  (only after deadline)
                                  └───────────────────► [ Refunded ]
```

Four states, three transitions, no loops. Every transition is guarded. Keep it this simple — a state machine you can draw on one slide is a state machine you can defend in questions.

---

## 6. Why Blockchain Is Genuinely Required

**This is the single most important section for your grade.** Examiners' first instinct with any blockchain project is "why not a database?" Answer it before they ask.

### 6.1 The three properties a database cannot supply here

| Property needed | Why a centralised DB fails |
|---|---|
| **Neutral escrow between mutually distrusting parties** | Escrow requires a custodian neither party controls. If the buyer's operator hosts the database, the seller has no reason to trust it, and vice versa. There is no natural trusted third party between two arbitrary autonomous agents from different organisations. |
| **Portable, censorship-resistant reputation** | A reputation score that lives inside one company's database is worthless to an agent from another company, and can be silently edited by whoever runs it. Cross-organisational portability with no trusted host is an explicit ERC-8004 design goal. |
| **Automated settlement conditioned on a verifiable attestation** | The release of funds must be an atomic, deterministic consequence of a verifiable condition, executable by either party, with no operator able to withhold or reverse it. That is a smart contract, not a cron job. |

### 6.2 The one-sentence version for the viva

> A Postgres audit log can *record* a dispute between two parties who distrust each other; it cannot *arbitrate* one, because someone has to own the database, and whoever owns it is a party to the dispute.

### 6.3 The honesty test

Also say what blockchain does *not* fix here: it cannot judge whether the delivered API response was *good*, only whether an attestation says it was delivered. Volunteering the limitation is a strength.

---

## 7. Prior Art and Honest Novelty Positioning

**Do not claim to be first.** This space is crowded, and an examiner who knows it will penalise an overclaim far more heavily than a modest, accurate claim.

### 7.1 What already exists

| Project | What it does | How AgentTrust differs |
|---|---|---|
| **PayCrow** | Trust-informed escrow: locks USDC on Base, releases on HTTP 2xx + JSON-schema check; 4-source trust scoring | Release is a **shallow HTTP check**, not a registry attestation; trust score is proprietary, not portable |
| **x402r** | Escrow + per-arbiter dispute resolution via deterministic proxy contracts | Focused on **refunds and arbitration**, not on pre-transaction reputation gating |
| **presidio-hardened-x402** (arXiv 2604.11430) | Pre-signing PII/policy/replay filter | **Not escrow, not reputation** — a request filter. The paper itself notes prior analyses "name the gap" but "deliver no implementation" |
| **Arbitova** | LLM-majority-vote arbitration escrow | Arbitration by model vote rather than registry attestation |
| **switchboard** | Solidity `AgentEscrow` with timeout/refund | Escrow primitive only; no reputation gate, no ERC-8004 |
| **Vouch** | Counterparty risk scoring on Base Sepolia | Scoring only, not settlement |
| **Nevermined** | `PaymentsVault` escrow wired into x402 | Commercial platform integration |
| **x402 `batch-settlement`** | Official escrow scheme in the protocol | Efficiency-oriented, not adversarial-defence-oriented |
| **ERC-8004 reference implementations** — ChaosChain `trustless-agents-erc-ri`, `nuwa-protocol/nuwa-8004`, Ava Labs boilerplate | Registry contracts themselves | These are the substrate you build on, not competitors |

### 7.2 Your defensible contribution — claim exactly this and no more

> Escrow for agent payments already exists. Our contribution is threefold: **(1)** the release trigger is a cryptographic attestation in the ERC-8004 Validation Registry rather than a shallow HTTP status check; **(2)** the entry gate uses portable ERC-8004 reputation with a distinct-attester requirement that resists Sybil clusters; and **(3)** we ship a reproducible attack harness that runs published x402 exploits against both a vanilla endpoint and our contract, and measures which are blocked and by which mechanism. To our knowledge no existing project provides that security evaluation.

Point (3) is the real novelty and the reason this belongs in a cyber-security module. Existing projects ship READMEs; you ship measurements.

---

## 8. System Architecture

### 8.1 Component diagram (redraw this in your slides)

```
┌──────────────────┐                          ┌──────────────────┐
│   BUYER AGENT    │                          │  SELLER AGENT    │
│  LangGraph +     │ ── 1. GET /resource ───► │  x402-paywalled  │
│  LiteLLM         │ ◄── 2. HTTP 402 quote ── │  API (Express)   │
└────────┬─────────┘                          └────────▲─────────┘
         │                                             │
         │ 3. canonicalise → resourceHash              │ 6. deliver
         │                                             │   (only after Funded)
         ▼                                             │
┌─────────────────────────────────────────────────────────────────┐
│                   BASE SEPOLIA (EVM testnet)                    │
│                                                                 │
│   ┌───────────────────────┐        ┌──────────────────────┐     │
│   │  AgentTrustEscrow     │◄──────►│ ERC-8004 Reputation  │     │
│   │  fund / release /     │  gate  │ Registry             │     │
│   │  refund               │        └──────────────────────┘     │
│   │                       │        ┌──────────────────────┐     │
│   │   4. funds locked     │◄──────►│ ERC-8004 Validation  │     │
│   │   7. release on       │trigger │ Registry             │     │
│   │      attestation      │        └──────────────────────┘     │
│   └───────────────────────┘        ┌──────────────────────┐     │
│                                    │ ERC-8004 Identity    │     │
│            USDC (test)             │ Registry (ERC-721)   │     │
│                                    └──────────────────────┘     │
└─────────────────────────────────────────────────────────────────┘
         ▲                                             ▲
         │ 5. verify delivery, attest                  │
┌────────┴─────────┐                          ┌────────┴─────────┐
│   VALIDATOR      │                          │   FACILITATOR    │
│   Go / FastAPI   │                          │   x402 settle    │
└──────────────────┘                          └──────────────────┘
                            │
                            ▼
                   ┌──────────────────┐      ┌──────────────────┐
                   │  Kafka event bus │ ───► │ React dashboard  │
                   └──────────────────┘      └──────────────────┘
```

### 8.2 Why this architecture suits your team

The design deliberately exercises the stack a backend-heavy team already knows: Solidity for the trust core, but Go/FastAPI microservices for the validator and facilitator, Kafka for event streaming, Kubernetes for deployment, and LangGraph/LiteLLM for the agents themselves. The blockchain is the *trust primitive*, not the whole system — which is exactly how it works in industry, and exactly what makes this look like engineering rather than a tutorial.

---

## 9. Smart Contract Design

### 9.1 Canonical request hashing

The `resourceHash` is what welds money to intent. Compute it identically on both sides:

```solidity
resourceHash = keccak256(abi.encode(
    keccak256(bytes(method)),        // "POST"
    keccak256(bytes(uri)),           // "https://seller.example/v1/summarise"
    keccak256(requestBody),          // exact bytes of the body
    priceAtomicUnits,                // 250000 == 0.25 USDC (6 decimals)
    token,                           // USDC address
    block.chainid                    // 84532 for Base Sepolia
));
```

Including `token` and `chainid` prevents cross-chain and cross-asset substitution. Including the price prevents the seller from re-quoting after the fact.

### 9.2 The escrow contract

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20}     from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20}  from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable}    from "@openzeppelin/contracts/access/Ownable.sol";

/*//////////////////////////////////////////////////////////////
                    ERC-8004 REGISTRY INTERFACES
    Adapt these to the exact ABI of the reference implementation
    you deploy — ERC-8004 is a draft and the ABI has changed.
//////////////////////////////////////////////////////////////*/

interface IIdentityRegistry {
    function ownerOf(uint256 agentId) external view returns (address);
}

interface IReputationRegistry {
    /// @return score              aggregate score, 0–10000 basis points
    /// @return feedbackCount      total feedback entries
    /// @return distinctAttesters  number of UNIQUE addresses that gave feedback
    function getSummary(uint256 agentId)
        external view returns (uint64 score, uint64 feedbackCount, uint64 distinctAttesters);

    function submitFeedback(uint256 agentId, bytes32 jobId, uint8 rating) external;
}

interface IValidationRegistry {
    /// @return status 0 = none, 1 = pending, 2 = passed, 3 = failed
    function getValidation(bytes32 jobId)
        external view returns (uint8 status, address validator, uint64 validatedAt);
}

/// @title  AgentTrustEscrow
/// @notice Resource-bound, reputation-gated, validation-triggered escrow
///         for autonomous agent-to-agent payments over x402.
contract AgentTrustEscrow is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    /*//////////////////////////////////////////////////////////
                                TYPES
    //////////////////////////////////////////////////////////*/

    enum State { None, Funded, Released, Refunded }

    struct Job {
        address payer;
        address payee;
        uint256 payeeAgentId;
        address token;
        uint256 amount;
        bytes32 resourceHash;   // binds funds to ONE canonical request
        uint64  deadline;
        State   state;
    }

    /*//////////////////////////////////////////////////////////
                                STORAGE
    //////////////////////////////////////////////////////////*/

    IIdentityRegistry   public immutable identity;
    IReputationRegistry public immutable reputation;
    IValidationRegistry public immutable validation;

    uint64 public minScore;               // e.g. 6000 = 60.00%
    uint64 public minFeedback;            // e.g. 5
    uint64 public minDistinctAttesters;   // e.g. 3  <-- Sybil-cluster resistance

    mapping(bytes32 => Job) public jobs;

    /// @dev Nonces are scoped PER PAYER. A global nonce set would let any
    ///      observer front-run and burn your nonce as a griefing attack.
    mapping(address => mapping(bytes32 => bool)) public consumedNonce;

    /*//////////////////////////////////////////////////////////
                            EVENTS & ERRORS
    //////////////////////////////////////////////////////////*/

    event JobFunded(
        bytes32 indexed jobId,
        address indexed payer,
        uint256 indexed payeeAgentId,
        bytes32 resourceHash,
        uint256 amount,
        uint64  deadline
    );
    event JobReleased(bytes32 indexed jobId, address validator, uint256 amount);
    event JobRefunded(bytes32 indexed jobId, uint256 amount);
    event GatesUpdated(uint64 minScore, uint64 minFeedback, uint64 minDistinctAttesters);

    error ReplayedNonce();
    error JobAlreadyExists();
    error ReputationTooLow();
    error NotValidated();
    error DeadlineNotReached();
    error DeadlinePassed();
    error BadState();
    error AmountExceedsQuote();
    error ZeroAmount();

    constructor(
        address _identity,
        address _reputation,
        address _validation,
        uint64  _minScore,
        uint64  _minFeedback,
        uint64  _minDistinctAttesters
    ) Ownable(msg.sender) {
        identity             = IIdentityRegistry(_identity);
        reputation           = IReputationRegistry(_reputation);
        validation           = IValidationRegistry(_validation);
        minScore             = _minScore;
        minFeedback          = _minFeedback;
        minDistinctAttesters = _minDistinctAttesters;
    }

    /*//////////////////////////////////////////////////////////
                                FUND
    //////////////////////////////////////////////////////////*/

    /// @notice Lock the exact quoted amount against ONE canonical request.
    /// @dev Defends A2 (replay), A3 (cross-resource), A4 (duplication),
    ///      A5 (overdraft) and A6 (Sybil selection).
    function fund(
        uint256 payeeAgentId,
        address token,
        uint256 amount,
        uint256 quotedMax,
        bytes32 resourceHash,
        bytes32 nonce,
        uint64  ttlSeconds
    ) external nonReentrant returns (bytes32 jobId) {
        if (amount == 0) revert ZeroAmount();

        // --- A5: allowance overdraft ---------------------------------
        // Escrow an EXACT amount. Never grant an open-ended allowance that
        // a dynamic "up-to" price can drain.
        if (amount > quotedMax) revert AmountExceedsQuote();

        // --- A6: Sybil server-selection ------------------------------
        // Gate on portable reputation AND on the number of DISTINCT
        // attesters, so a ring of self-endorsing Sybils cannot manufacture
        // a passing score by voting for each other.
        (uint64 score, uint64 count, uint64 distinct) = reputation.getSummary(payeeAgentId);
        if (score < minScore || count < minFeedback || distinct < minDistinctAttesters) {
            revert ReputationTooLow();
        }

        address payee = identity.ownerOf(payeeAgentId);

        // --- A2 / A4: replay and duplication -------------------------
        // Domain-separated job id. The nonce is burned in the SAME
        // transaction that moves the money, so there is no TOCTOU window
        // for concurrent requests to race.
        jobId = keccak256(abi.encode(
            block.chainid, address(this), msg.sender, payee, resourceHash, nonce
        ));

        if (consumedNonce[msg.sender][nonce]) revert ReplayedNonce();
        if (jobs[jobId].state != State.None)  revert JobAlreadyExists();
        consumedNonce[msg.sender][nonce] = true;

        uint64 deadline = uint64(block.timestamp) + ttlSeconds;

        jobs[jobId] = Job({
            payer:        msg.sender,
            payee:        payee,
            payeeAgentId: payeeAgentId,
            token:        token,
            amount:       amount,
            resourceHash: resourceHash,   // --- A3: bound to THIS resource
            deadline:     deadline,
            state:        State.Funded
        });

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        emit JobFunded(jobId, msg.sender, payeeAgentId, resourceHash, amount, deadline);
    }

    /*//////////////////////////////////////////////////////////
                               RELEASE
    //////////////////////////////////////////////////////////*/

    /// @notice Pay the seller ONLY against a passing attestation.
    /// @dev Defends A1: there is no optimistic grant. The seller serves
    ///      after Funded is final, and is paid after delivery is attested.
    function release(bytes32 jobId) external nonReentrant {
        Job storage j = jobs[jobId];
        if (j.state != State.Funded)   revert BadState();
        if (block.timestamp > j.deadline) revert DeadlinePassed();

        (uint8 status, address validator, ) = validation.getValidation(jobId);
        if (status != 2) revert NotValidated();     // 2 == passed

        j.state = State.Released;                    // effects before interaction
        IERC20(j.token).safeTransfer(j.payee, j.amount);

        emit JobReleased(jobId, validator, j.amount);
    }

    /*//////////////////////////////////////////////////////////
                                REFUND
    //////////////////////////////////////////////////////////*/

    /// @notice Buyer's safety valve. No passing attestation before the
    ///         deadline means the money comes home. Anyone may call it —
    ///         the funds can only ever go back to the original payer.
    function refund(bytes32 jobId) external nonReentrant {
        Job storage j = jobs[jobId];
        if (j.state != State.Funded)      revert BadState();
        if (block.timestamp <= j.deadline) revert DeadlineNotReached();

        j.state = State.Refunded;
        IERC20(j.token).safeTransfer(j.payer, j.amount);

        emit JobRefunded(jobId, j.amount);
    }

    /*//////////////////////////////////////////////////////////
                                ADMIN
    //////////////////////////////////////////////////////////*/

    function setGates(uint64 _score, uint64 _feedback, uint64 _distinct) external onlyOwner {
        minScore             = _score;
        minFeedback          = _feedback;
        minDistinctAttesters = _distinct;
        emit GatesUpdated(_score, _feedback, _distinct);
    }
}
```

### 9.3 Design decisions worth defending in questions

| Decision | Reason |
|---|---|
| Payer-scoped nonces | A global nonce set is griefable: an observer front-runs your `fund()` and burns your nonce, denying service at no cost to themselves |
| `jobId` includes `chainid` and `address(this)` | Domain separation — a payload valid on one deployment is invalid on another, killing cross-chain replay |
| Checks-Effects-Interactions + `ReentrancyGuard` | State is written before every token transfer; belt and braces against a malicious ERC-20 |
| `refund()` is permissionless | Liveness — the buyer's agent may be offline; anyone can trigger the refund, but funds can only return to `j.payer` |
| Custom errors, not `require` strings | Cheaper gas and, more usefully, the revert reason is a typed selector you can assert on in the attack harness |
| Exact `amount` with `quotedMax` ceiling | Structurally forecloses the overdraft class rather than monitoring for it |
| `distinctAttesters` in the gate | Score alone is Sybil-forgeable; distinct attesters raise the cost of manufacturing reputation |

### 9.4 Foundry test skeleton

```solidity
// test/AgentTrustEscrow.t.sol
// forge test -vvv

function test_A2_ReplayIsRejected() public {
    bytes32 nonce = keccak256("n1");
    vm.startPrank(buyer);
    escrow.fund(SELLER_ID, address(usdc), 250_000, 250_000, resourceHash, nonce, 1 hours);

    // Second use of the same nonce by the same payer must revert.
    vm.expectRevert(AgentTrustEscrow.ReplayedNonce.selector);
    escrow.fund(SELLER_ID, address(usdc), 250_000, 250_000, resourceHash, nonce, 1 hours);
    vm.stopPrank();
}

function test_A3_CrossResourceSubstitutionIsRejected() public {
    // Funds bound to resource A cannot be released by an attestation for B.
    bytes32 jobA = _fund(resourceHashA, keccak256("nA"));
    validationRegistry.setPassed(_jobIdFor(resourceHashB, keccak256("nB")));

    vm.expectRevert(AgentTrustEscrow.NotValidated.selector);
    escrow.release(jobA);
}

function test_A5_OverdraftIsRejected() public {
    vm.prank(buyer);
    vm.expectRevert(AgentTrustEscrow.AmountExceedsQuote.selector);
    escrow.fund(SELLER_ID, address(usdc), 900_000, 250_000, resourceHash, keccak256("n2"), 1 hours);
}

function test_A6_SybilAgentIsGated() public {
    // Agent with a high score but only 1 distinct attester must be refused.
    reputationRegistry.setSummary(SYBIL_ID, 9800, 40, 1);
    vm.prank(buyer);
    vm.expectRevert(AgentTrustEscrow.ReputationTooLow.selector);
    escrow.fund(SYBIL_ID, address(usdc), 250_000, 250_000, resourceHash, keccak256("n3"), 1 hours);
}

function test_HappyPath_ReleaseOnValidation() public {
    bytes32 jobId = _fund(resourceHash, keccak256("n4"));
    validationRegistry.setPassed(jobId);
    escrow.release(jobId);
    assertEq(usdc.balanceOf(seller), 250_000);
}

function test_RefundAfterDeadline() public {
    bytes32 jobId = _fund(resourceHash, keccak256("n5"));
    vm.warp(block.timestamp + 2 hours);
    escrow.refund(jobId);
    assertEq(usdc.balanceOf(buyer), START_BALANCE);
}
```

Every one of these tests is a slide bullet. Run `forge test` live if you have the seconds.

---

## 10. ERC-8004 Integration

### 10.1 What ERC-8004 is

**ERC-8004 "Trustless Agents"** is an Ethereum standard (draft, proposed 13 August 2025) that gives autonomous agents portable, on-chain identity, reputation and validation. It defines **three registries**:

| Registry | Purpose | How AgentTrust uses it |
|---|---|---|
| **Identity Registry** | Each agent is an ERC-721; the token URI resolves to an "agent card" | Resolve `payeeAgentId → payee address`; discovery |
| **Reputation Registry** | Portable feedback about an agent, readable by anyone | The **entry gate** in `fund()` |
| **Validation Registry** | Attestations that a piece of work was performed correctly | The **release trigger** in `release()` |

### 10.2 Version warning — read this on day one

ERC-8004 is a **draft standard that has changed**, including a known v0.4 → v1.0 break. **Pin your version and commit the ABI to your repository.** Do not `npm install` a floating tag two days before submission.

Reference implementations to evaluate on Day 1:
- `erc-8004/erc-8004-contracts` (canonical reference contracts)
- `nuwa-protocol/nuwa-8004` (v1.0, reported 79/79 tests passing)
- ChaosChain `trustless-agents-erc-ri`
- Ava Labs boilerplate (includes testnet deploy scripts)

### 10.3 Fallback if the registries will not deploy cleanly

Write **mock registries** implementing the same three interfaces (`MockIdentityRegistry`, `MockReputationRegistry`, `MockValidationRegistry`) on day one, *before* you try the real ones. Your escrow depends only on the interfaces, so:

- If the real registries deploy — wire them in, and you have a fully standards-native system.
- If they do not — demo against mocks, and state plainly on the slide: *"escrow is registry-agnostic; demonstrated against mock registries implementing the ERC-8004 interfaces."*

This single decision removes the largest schedule risk in the project. Do it first.

---

## 11. x402 Integration and Message Flow

### 11.1 Sequence

```
BUYER                      SELLER                 CHAIN              VALIDATOR
  │                          │                      │                    │
  │──── GET /v1/summarise ──►│                      │                    │
  │◄── 402 + price quote ────│                      │                    │
  │                          │                      │                    │
  │ canonicalise → resourceHash                     │                    │
  │                          │                      │                    │
  │──── reputation.getSummary(sellerAgentId) ──────►│                    │
  │◄─── score / count / distinctAttesters ──────────│                    │
  │     (abort here if gated out — A6 defence)      │                    │
  │                          │                      │                    │
  │──── fund(resourceHash, nonce, amount) ─────────►│                    │
  │◄─── JobFunded(jobId) ───────────────────────────│                    │
  │                          │                      │                    │
  │─ retry request + jobId ─►│                      │                    │
  │                          │─ read job state ────►│                    │
  │                          │◄─ Funded, final ─────│                    │
  │◄──── 200 + resource ─────│  (A1 defence: no optimistic grant)        │
  │                          │                      │                    │
  │                          │                      │◄── attest(jobId) ──│
  │──── release(jobId) ────────────────────────────►│                    │
  │                          │◄── funds transferred │                    │
  │                          │                      │                    │
  │──── submitFeedback(sellerAgentId, jobId) ──────►│                    │
```

### 11.2 Seller-side middleware sketch

```javascript
// seller/index.js — Express + x402
import express from "express";
import { paymentMiddleware } from "@x402/express";
import { escrow } from "./chain.js";

const app = express();

// Standard x402 paywall produces the 402 quote.
app.use(paymentMiddleware({
  "/v1/summarise": { price: "$0.25", network: "base-sepolia" }
}));

// AgentTrust gate: refuse to serve until the escrow is funded and final,
// and until the funded resourceHash matches THIS request. Defends A1 + A3.
app.use("/v1/summarise", async (req, res, next) => {
  const jobId = req.header("X-AgentTrust-Job");
  if (!jobId) return res.status(402).json({ error: "escrow job id required" });

  const job = await escrow.jobs(jobId);
  if (job.state !== 1 /* Funded */) {
    return res.status(402).json({ error: "escrow not funded" });
  }
  if (job.resourceHash !== canonicalHash(req)) {
    return res.status(409).json({ error: "resource mismatch" });   // A3
  }
  req.jobId = jobId;
  next();
});

app.post("/v1/summarise", async (req, res) => {
  const output = await runModel(req.body);
  await notifyValidator(req.jobId, output);   // validator attests → release()
  res.json({ output });
});
```

### 11.3 Environment constants

| Item | Value |
|---|---|
| Network | Base Sepolia |
| Chain ID | 84532 |
| Test USDC | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| x402 facilitator | Coinbase hosted facilitator (`x402.org/facilitator`) |
| SDKs | `@x402/express` (server), `@x402/fetch` (client) |

**Verify every address and endpoint on Day 1 before hard-coding it.** These are fast-moving projects and a wrong address burns a day.

---

## 12. The Attack/Defence Harness — Your Differentiator

This is the part no competing project has, and the part that earns the "Cyber Security" half of the module.

### 12.1 Structure

```
attacks/
├── harness.ts            # runs each attack against both targets, emits results.json
├── targets/
│   ├── vanilla.ts        # plain x402 endpoint, no escrow  (the control)
│   └── agenttrust.ts     # same endpoint behind AgentTrust  (the treatment)
├── a1_revert_grant.ts
├── a2_replay.ts
├── a3_cross_resource.ts
├── a4_duplication.ts
├── a5_overdraft.ts
└── a6_sybil_selection.ts
```

Run as: `npm run attack -- --all --target vanilla` then `--target agenttrust`.

### 12.2 What each attack script does

| ID | Attack procedure | Expected on vanilla | Expected on AgentTrust |
|---|---|---|---|
| **A1** | Trigger a settlement that reverts after the resource is granted | Resource delivered, payment fails | `release()` never fires; seller never served pre-funding |
| **A2** | Capture one payment payload, replay it N times | N grants from 1 payment | Second call reverts `ReplayedNonce()` |
| **A3** | Fund resource A, request resource B | B is served | 409 at middleware; `release()` reverts `NotValidated()` |
| **A4** | Fire 50 concurrent requests against one payment | Multiple grants | Exactly 1 succeeds; 49 revert |
| **A5** | Quote 0.25 USDC, attempt to draw 0.90 | Overdraft succeeds | Reverts `AmountExceedsQuote()` |
| **A6** | Register 5 Sybil agents cross-endorsing each other, then attempt to transact | Sybils win selection | Reverts `ReputationTooLow()` on distinct-attester check |

### 12.3 Results table — build this, it is your best slide

| Attack | Vanilla x402 | AgentTrust | Defence mechanism |
|---|---|---|---|
| A1 Revert-grant | ✗ exploited | ✓ blocked | Two-phase settlement; serve only after `Funded` finality |
| A2 Replay | ✗ exploited (N grants) | ✓ blocked | Atomic payer-scoped nonce burn |
| A3 Cross-resource | ✗ exploited | ✓ blocked | `resourceHash` binding |
| A4 Duplication | ✗ exploited | ✓ blocked | State-machine CAS in one transaction |
| A5 Overdraft | ✗ exploited | ✓ blocked | Exact-amount escrow with `quotedMax` ceiling |
| A6 Sybil selection | ✗ exploited | ✓ blocked | Distinct-attester reputation gate |

**Minimum viable version:** if time is short, ship **A2 and A3 only**, fully working, with real numbers. Two rigorous results beat six hand-waved ones.

### 12.4 Ethics and scope note for your slides

State that all attacks are executed **against your own endpoints on a public testnet with valueless test tokens**, and that the vulnerabilities are already publicly documented in peer-reviewed preprints. This is standard responsible-disclosure framing and it costs one line.

---

## 13. Evaluation Metrics

Numbers turn a demo into a result. Measure and report:

1. **Defence coverage** — attacks blocked / attacks attempted (target: 6/6, minimum 2/2).
2. **Grants per payment** — vanilla vs AgentTrust under A2 (the literature reports 248 on a live endpoint; you want vanilla ≫ 1, AgentTrust = 1).
3. **Resource leakage under A5** — percentage of unpaid compute delivered (literature reports up to 100%; you want 0%).
4. **Sybil traffic capture under A6** — percentage of buyer selections won by Sybil endpoints, gated vs ungated (literature reports 60.2% ungated).
5. **Gas cost** — per `fund` / `release` / `refund`, in gas and in USD at a stated gas price. Be honest if the overhead is material; framing it as "the cost of trust" is a strong answer.
6. **Latency overhead** — added milliseconds per transaction versus vanilla x402. Blockchain confirmation is the dominant term; report it rather than hiding it.

---

## 14. Tech Stack and Environment Setup

### 14.1 Stack

| Layer | Choice | Rationale |
|---|---|---|
| Chain | Base Sepolia (84532) | x402's default network; free faucets; fast blocks |
| Contracts | Solidity 0.8.24+, **Foundry** | Fastest test loop; `vm.expectRevert` is ideal for the attack harness |
| Libraries | OpenZeppelin (`SafeERC20`, `ReentrancyGuard`, `Ownable`) | Audited primitives; do not roll your own |
| Registries | ERC-8004 reference impl (pinned) + mocks | Mocks first, real second — see §10.3 |
| Agents | Node/TypeScript + LangGraph + LiteLLM | Plays to existing LLM-platform experience |
| Seller API | Express + `@x402/express` | Official middleware |
| Validator | Go or FastAPI microservice | Backend strength; independent process = credible independence |
| Events | Kafka | Streams `JobFunded` / `JobReleased` to the dashboard |
| Deploy | Docker + Kubernetes | Demonstrates distributed-systems depth |
| Auth | Keycloak | Agent/service identity off-chain |
| Frontend | React + viem/wagmi | Live escrow state and attack console |

**Scope discipline:** Kafka, Kubernetes and Keycloak are **stretch goals**. They strengthen the CV story but they are not on the critical path to a working demo. Do not touch them until the happy path and two attacks are green.

### 14.2 Day-one setup checklist

```bash
# 1. Toolchain
curl -L https://foundry.paradigm.xyz | bash && foundryup
forge init agenttrust && cd agenttrust
forge install OpenZeppelin/openzeppelin-contracts

# 2. Wallets — generate FOUR: buyer, seller, validator, deployer
cast wallet new

# 3. Fund them from Base Sepolia faucets (Alchemy, QuickNode, Chainlink,
#    Coinbase Developer Platform). Do this EARLY — faucets rate-limit daily.

# 4. Get test USDC on Base Sepolia for the buyer wallet.

# 5. Verify the network is live
cast block-number --rpc-url https://sepolia.base.org
```

**Faucet warning:** faucets are typically limited to a small amount per day per address. Start collecting testnet funds on **Day 1**, not Day 15. If Base Sepolia faucets are dry, **Polygon Amoy** (chain ID 80002, ~2s blocks, sub-$0.001 fees) is the fallback network — the escrow contract is portable, only the x402 facilitator config changes.

---

## 15. Three-Week Execution Plan

Assumes a start of **Monday 7 September 2026** and submission on **Tuesday 29 September 2026** (one day of margin before the ambiguous 30th).

### Week 1 — Foundation (7–13 September)

| Day | Task | Owner |
|---|---|---|
| Mon 7 | Confirm deadline with coordinator; register topic in Google Sheet; create GitHub repo; all four wallets created and funded from faucets | All |
| Tue 8 | Verify ERC-8004 reference impl deploys; **write the three mock registries first**; verify USDC address and x402 facilitator endpoint | A + B |
| Wed 9 | `AgentTrustEscrow` v1: `fund` / `release` / `refund` compiling with mocks | A |
| Thu 10 | Foundry tests: happy path + refund path green | A |
| Fri 11 | Seller API with `@x402/express` returning a 402 quote; canonical `resourceHash` implemented identically on both sides | C |
| Sat 12 | Buyer agent (LangGraph) completing the quote → hash → fund flow | C |
| Sun 13 | **Milestone 1: one successful paid transaction end to end on testnet** | All |

**Gate:** if Milestone 1 is not met by Sunday night, cut all stretch goals immediately and drive straight for A2 + A3 only.

### Week 2 — Trust layer (14–20 September)

| Day | Task | Owner |
|---|---|---|
| Mon 14 | Reputation gate wired into `fund()`; distinct-attester logic | B |
| Tue 15 | Validator service (Go/FastAPI) posting attestations | B + C |
| Wed 16 | Validation-triggered `release()` working against the registry | A + B |
| Thu 17 | Attempt real ERC-8004 registries; **if not clean by end of day, stay on mocks and move on** | B |
| Fri 18 | Attack harness scaffolding; `vanilla` control target built | D |
| Sat 19 | A2 (replay) and A3 (cross-resource) implemented against both targets | D |
| Sun 20 | **Milestone 2: two attacks reproduced, both blocked, numbers recorded** | All |

### Week 3 — Evidence and delivery (21–27 September)

| Day | Task | Owner |
|---|---|---|
| Mon 21 | A4, A5 implemented | D |
| Tue 22 | A6 Sybil scenario (5 cross-endorsing agents) | B + D |
| Wed 23 | A1 revert-grant scenario | A + D |
| Thu 24 | Gas and latency benchmarks; results table finalised | A |
| Fri 25 | React dashboard; **record the 45-second demo video** | C |
| Sat 26 | Slides drafted from this document | All |
| Sun 27 | **Milestone 3: full rehearsal, timed to 3:00** | All |

### Buffer (28–29 September)

| Day | Task |
|---|---|
| Mon 28 | Second rehearsal; tighten to 2:50; README and repo cleanup |
| Tue 29 | **Submit `GP_XX_AgentTrust.ppt` to ELMS** |

### Team split

| Member | Role | Owns |
|---|---|---|
| **A** | Contracts lead | Solidity, Foundry tests, gas benchmarks |
| **B** | Registry & trust lead | ERC-8004 integration, reputation gate, validator |
| **C** | Agents & integration lead | Buyer/seller agents, x402 middleware, dashboard, demo video |
| **D** | Security lead | Attack harness, threat model, results table, slides |

Because you typically lead teams, take **D** or **A**: D owns the differentiator and the narrative, and is the natural presenter.

---

## 16. Deliverables Checklist

- [ ] Topic registered in the class Google Sheet
- [ ] `GP_XX_AgentTrust.ppt` — 3 minutes, submitted to ELMS by 29 Sept
- [ ] GitHub repository, public, with a README that opens with the problem statement
- [ ] `AgentTrustEscrow.sol` deployed and **verified** on Base Sepolia (verification matters — an unverified contract looks unfinished)
- [ ] Deployed address + block explorer link on the final slide
- [ ] Foundry test suite, all green, screenshot in the deck
- [ ] Attack harness with `results.json` and the results table
- [ ] 45-second demo video (do not risk a live network demo in a 3-minute slot)
- [ ] Threat model, one page
- [ ] References slide with arXiv IDs and standard links

---

## 17. Three-Minute Presentation Storyboard

Three minutes is roughly **380 spoken words**. Five slides. Rehearse with a timer.

### Slide 1 — Hook (0:00–0:25)

> **Visual:** two robot icons exchanging a coin; the number **130,000,000** large on screen.

> "AI agents now pay each other. The x402 protocol went from 725 transactions in May 2025 to around 50 million by the end of that year — 130 million all-time. Machine money is here."

### Slide 2 — The problem (0:25–1:05)

> **Visual:** the six-attack table, with A2 and A6 highlighted.

> "But the payment layer shipped before the trust layer. x402 is pay-first, hope-for-delivery. Two 2026 papers document eleven vulnerabilities. On a live endpoint, researchers turned **one payment into 248 free API calls**. And **five fake servers captured 60% of all agent traffic**. Bridge hacks cost two billion dollars for the same underlying reason: value moved on a message that wasn't properly bound to an action."

### Slide 3 — The solution (1:05–1:40)

> **Visual:** the architecture diagram from §8.1, simplified to five boxes.

> "AgentTrust adds three things. A **gate**: we read the seller's ERC-8004 reputation before any money moves, and we require feedback from distinct attesters, so a Sybil ring can't fake a score. **Resource-bound escrow**: funds lock against the hash of one exact request, with the nonce burned in the same transaction. And a **validation trigger**: money releases only when an independent validator attests delivery on-chain — otherwise it refunds."

### Slide 4 — The demo (1:40–2:30) — *the moment that wins*

> **Visual:** pre-recorded 45-second split screen. Left: vanilla x402 — the replay script fires, counter climbs 1, 2, 3… 50 free calls. Right: same script against AgentTrust — the first succeeds, the second reverts with `ReplayedNonce()`.

> "Left, vanilla x402: one payment, fifty free calls. Right, the identical attack against AgentTrust: the first call is paid, the second reverts on-chain. Same attacker, same script."

### Slide 5 — Results and close (2:30–3:00)

> **Visual:** the six-row results table; deployed contract address; QR code to the repo.

> "Six published attacks, six blocked, each by a named mechanism. Deployed and verified on Base Sepolia. As autonomous agents start transacting at scale, the escrow has to be as automated as the payment — that's what AgentTrust demonstrates."

### Delivery notes

- One presenter. Handovers cost 10 seconds you do not have.
- Do not read the slides. Say the numbers: 248, 60%, 6/6.
- No live network calls. Record the demo.
- Have the architecture diagram and threat model as **backup slides** for questions.

---

## 18. Demo Script (exact commands)

```bash
# Terminal 1 — vanilla control
npm run target:vanilla

# Terminal 2 — AgentTrust
npm run target:agenttrust

# Terminal 3 — the money shot
npm run attack -- --id a2_replay --target vanilla
#   → grants: 50 / payments: 1   ✗ EXPLOITED

npm run attack -- --id a2_replay --target agenttrust
#   → grants:  1 / payments: 1
#   → tx 0x… reverted: ReplayedNonce()   ✓ BLOCKED
```

Record this at 1080p, crop to the two counters, and add a caption. Forty-five seconds, no audio needed — you narrate over it.

---

## 19. Risks and Fallbacks

| Risk | Likelihood | Trigger | Fallback |
|---|---|---|---|
| ERC-8004 reference contracts will not deploy or ABI has changed | **High** | Not clean by Thu 17 Sept | Ship on mock registries implementing the same interfaces; state it plainly on the slide (§10.3) |
| x402 SDK or facilitator endpoint changed | Medium | Blocked on Fri 11 Sept | Implement the 402 → sign → settle loop manually; it is only a signed ERC-20 transfer plus an HTTP retry |
| Testnet faucets dry / rate-limited | Medium | Day 1 | Collect across four wallets over several days; fall back to Polygon Amoy (80002) |
| Base Sepolia congestion or downtime near demo | Low | Any time | Demo video already recorded; local Anvil fork as backup |
| Over-scoping (Kafka/K8s eat the schedule) | **High** | Any slip past a milestone gate | Cut all of §14 stretch goals immediately — they are CV garnish, not the demo |
| Attack harness incomplete | Medium | Sun 20 Sept | Ship A2 + A3 only with rigorous numbers |
| Another group picks the same domain | Low-Medium | Sheet check | Your framing is escrow + attack evaluation; register early and describe it precisely in the sheet |

**The governing rule:** a narrow working demo beats a broad broken one. At every gate, cut scope rather than slip the milestone.

---

## 20. How to Actually Score Well

Marks in a module like this cluster around five things. Address each explicitly:

1. **Problem is real and evidenced.** Cite the transaction-volume figures and the attack papers. Never assert a problem without a source.
2. **Blockchain is justified.** Deliver §6 in one sentence, unprompted, in the presentation. Pre-empting "why not a database?" is worth more than any feature.
3. **It works.** A deployed, verified contract address on the final slide is proof. An unverified contract or a slideware architecture is not.
4. **Security depth.** Named threat model, named attacks, named defences, measured results. This is the module's other half — most groups will ignore it entirely.
5. **Honest scoping.** Say what you did not solve (validator collusion, content quality, key compromise). Examiners reward calibration and punish overclaiming.

**Extra credit behaviours:** verify the contract on Basescan; publish the repo publicly; include the gas cost honestly even if it is unflattering; add one sentence of related-work positioning naming PayCrow and x402r so it is obvious you surveyed the field.

---

## 21. CV and Interview Framing

### 21.1 CV bullet

> **AgentTrust — Secure Escrow for Autonomous AI-Agent Payments** *(University of Ruhuna, 2026)*
> Designed and deployed a reputation-gated, validation-triggered escrow contract for machine-to-machine stablecoin payments on the x402/ERC-8004 stack. Reproduced six published protocol attacks against a control endpoint and demonstrated cryptographic mitigation of all six. Solidity, Foundry, Base Sepolia, TypeScript agents (LangGraph), Go validator service.

### 21.2 Why this reads as more than coursework

It signals four things simultaneously that are rare in an undergraduate project: **standards literacy** (x402, ERC-8004, ERC-721, ERC-20), **smart-contract security** (threat modelling, reentrancy discipline, replay and domain separation), **applied AI-systems engineering** (agent orchestration), and **empirical rigour** (a control group and measured results). The control-versus-treatment structure in particular is a research habit, and interviewers notice it.

### 21.3 Interview answers to prepare

- *"Why blockchain and not a database?"* → §6.2, verbatim.
- *"What was the hardest part?"* → Binding money to intent. A signature that authorises an amount to an address is not the same as authorising a specific piece of work, and closing that gap is what `resourceHash` does.
- *"What would you do differently?"* → Add validator staking and slashing, so an attesting validator has economic skin in the game; right now we assume one honest validator.
- *"What's the weakness?"* → Validator collusion, and the fact that on-chain confirmation adds latency to what is meant to be a sub-second API call. Both are real; batching and optimistic release with a challenge window are the standard answers.

---

## 22. References

**Verify every link and figure before putting it on a slide.** These are fast-moving sources and a wrong citation in a viva is worse than no citation.

### Protocols and standards
- x402 protocol and whitepaper — `x402.org`
- x402 Foundation announcement — Cloudflare blog
- ERC-8004 "Trustless Agents" — `eips.ethereum.org/EIPS/eip-8004`
- Reference implementations — `github.com/erc-8004/erc-8004-contracts`; `nuwa-protocol/nuwa-8004`; ChaosChain `trustless-agents-erc-ri`
- ERC-721, ERC-20, EIP-3009 (transfer with authorisation)

### Security literature
- Li, Z., Wang, Q., Wang, Z. — *Five Attacks on x402 Agentic Payment Protocol*, arXiv **2605.11781**
- Ling, S. et al. — *Free-Riding the Agentic Web*, arXiv **2605.30998**
- *presidio-hardened-x402*, arXiv **2604.11430**
- Chainalysis — *Cross-Chain Bridge Hacks Emerge as Top Security Risk*, 2 August 2022

### Tooling
- Foundry — `book.getfoundry.sh`
- OpenZeppelin Contracts — `docs.openzeppelin.com`
- Base Sepolia docs and faucets — `docs.base.org`; Alchemy, QuickNode, Chainlink, Coinbase Developer Platform faucets
- Polygon Amoy (fallback) — `docs.polygon.technology`
- x402 SDKs — `@x402/express`, `@x402/fetch`

### Related projects surveyed
PayCrow · x402r (`x402r.org`) · Arbitova · switchboard · Vouch · Nevermined · x402 `batch-settlement`

---

## Appendix A — Glossary for the Q&A

| Term | One-line definition |
|---|---|
| **x402** | An open protocol that uses HTTP 402 to let a client pay for an API call inline with stablecoins, no account required |
| **Facilitator** | The service that verifies a payment payload and settles it on-chain on the server's behalf |
| **ERC-8004** | Ethereum draft standard giving autonomous agents on-chain identity, reputation and validation registries |
| **Agent card** | The metadata document an agent's ERC-721 token URI resolves to, describing its services and endpoint |
| **Escrow** | Funds held by a neutral contract, released only when a defined condition is met |
| **Attestation** | A signed on-chain claim that something is true — here, that work was delivered correctly |
| **Sybil attack** | Creating many fake identities to gain disproportionate influence in a system with cheap identity |
| **Replay attack** | Reusing a valid message or payment payload to obtain the same effect more than once |
| **Domain separation** | Including chain ID and contract address in a hash so a message valid in one context is invalid in another |
| **Nonce** | A one-time value burned on use, so the same authorisation cannot be spent twice |
| **TOCTOU** | Time-of-check-to-time-of-use — a race between validating a condition and acting on it |
| **Checks-Effects-Interactions** | Solidity pattern: validate, write state, *then* call out — prevents reentrancy |

---

## Appendix B — Repository Structure

```
agenttrust/
├── README.md                     # problem statement first, then quickstart
├── contracts/
│   ├── src/
│   │   ├── AgentTrustEscrow.sol
│   │   └── mocks/
│   │       ├── MockIdentityRegistry.sol
│   │       ├── MockReputationRegistry.sol
│   │       └── MockValidationRegistry.sol
│   ├── test/AgentTrustEscrow.t.sol
│   └── script/Deploy.s.sol
├── agents/
│   ├── buyer/                    # LangGraph buyer agent
│   └── seller/                   # Express + @x402/express
├── validator/                    # Go or FastAPI attestation service
├── attacks/                      # the harness — see §12
│   ├── harness.ts
│   ├── targets/{vanilla,agenttrust}.ts
│   └── a1..a6_*.ts
├── dashboard/                    # React + viem
├── docs/
│   ├── threat-model.md
│   └── results.md                # the results table + gas/latency numbers
└── deployments/base-sepolia.json # addresses, pinned ABIs
```

---

*Prepared for EC8204 Group Project, University of Ruhuna. Figures and citations sourced from a research survey conducted September 2026 — re-verify all URLs, contract addresses and arXiv identifiers before submission.*
