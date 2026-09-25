# Limitations

What AgentTrust does not do, and where the evidence stops. Each entry names the finding
(`DF-*`), the verification note (`V-*`) or the measurement gap it comes from, so a reader
can check it rather than take it on trust.

---

## 1. Trust assumptions that remain

### The selected validator has to be honest
Release requires a passing attestation from **one** validator — the one the buyer chose
from the seller's offered set. If that validator lies, it can attest to a result it never
checked, and the seller is paid. The escrow rejects a validator that is the payer, the
payee, or the agent's owner or operator, and the buyer picks from a set it trusts; that
is the whole of the defence. *(DF-06, DF-07.)*

The blueprint's original phrasing — "at least one honest validator" — does not fit a
scheme with single-validator acceptance, and was corrected. **k-of-n validators and
validator staking or slashing are deferred** (STRETCH).

### A seller colluding with its validator is not addressed
If the seller and the validator are the same party in practice, the attestation means
nothing. Nothing on-chain can distinguish that from an honest pair. The mitigations are
social and partial: the buyer chooses the validator, and the escrow refuses the obvious
self-attestation cases. *(DF-07.)*

### The ERC-8004 registries can be upgraded by one key
All three registries on Base Sepolia are UUPS proxies owned by a **single EOA** (V-97).
A malicious upgrade could forge attestations or reputation wholesale. This is why the
default test substrate is same-ABI mocks and why `impl/scripts/check-erc8004-abi.sh`
re-checks the pinned ABI against what is deployed. It is a trust assumption, not a
solved problem. *(V-97, V-139.)*

---

## 2. What "correct" means here, and what it does not

### Validation covers deterministic fixtures, not quality
The validator re-derives the answer from the request bytes and compares hashes. That
works because the paid routes are **deterministic transforms with no randomness, clock,
network or model**. It says a seller ran the agreed computation; it says nothing about
whether an answer is good, useful or true.

Nothing here generalises to an LLM response or any other non-reproducible output. A
system paying for those would need a different validation model entirely. *(DF-08.)*

### "Validator-escrowed delivery", not "proof of delivery"
Payment requires the result to exist **outside the seller**, deposited with the validator
before any byte reaches the buyer. That is a real property and it is tested. It is not a
proof that the buyer received anything: the bytes could still be lost in transit, and the
buyer's own retrieval of the stored evidence (`VAL-006`) **was not built**. The honest
phrasing is "attested, validator-escrowed delivery of a correct deterministic result".
*(DF-08.)*

---

## 3. The reputation gate has a real cost

### It refuses honest newcomers, by design
The gate counts feedback from clients **the buyer** already trusts. A seller with no
shared history is refused — exactly as a Sybil is, and for the same reason. That is the
price of not counting cheap addresses, and it is the intended trade-off rather than a
bug. `BlueprintCorrectedTest.test_A6_AnHonestNewcomerIsRefusedForTheSameReason` pins it.
*(DF-09.)*

The blueprint's alternative — "at least 3 distinct attesters and at least 5 entries" —
is satisfied by five addresses that endorse each other at no cost, and **cannot be
computed on the real ERC-8004 ABI at all**, since `getSummary` requires a non-empty
client list and returns no distinct-attester count (V-96).

### Reading reputation costs gas that grows with history
`getSummary` walks every feedback entry of every listed client. Measured: **~19,500 gas
fixed plus ~8,589 gas per entry**, linear to 100 entries
(`evidence/CONTRACT-005/gas-vs-history.txt`). At the deployed 250,000-gas ceiling, a
trusted client with more than about **26 entries for one agent is dropped from the
gate** — its opinion silently stops counting.

Raising the ceiling raises the cost of every `fund()`. Lowering it below
`MIN_REPUTATION_READ_GAS` is refused, because a ceiling low enough to starve every read
would switch the gate off while leaving it looking applied. This is a property of
ERC-8004's read, not of the escrow. *(DF-09.)*

**A6 confirmed this from the other side.** Rather than measuring the read, it asked
whether `fund()` succeeds as an honest seller accumulates ratings: fundable at 26
entries, refused at 28 with `ReputationTooLow`. `fund()` grew **8,588 gas per entry**
against the ~8,589 measured on the read — two paths sharing no code, agreeing to within
one gas. The practical consequence is worth stating plainly: **a seller can be rated
into invisibility**, and nothing in the protocol stops a would-be competitor from doing
the rating.

### The gate cannot see conduct, only reputation
An agent that earns genuine feedback from a buyer's trusted clients is admitted, and
stays admitted when it starts misbehaving — measured, not argued (A6, H-A6-5). At the
moment of the check, an honest seller and a patient attacker are the same thing. The
only remedy is a trusted client revoking, which is retrospective: whatever the agent was
paid before that stays paid. This is why A6 is reported as **Mitigated** rather than
**Blocked**.

---

## 4. Timing windows that can cost someone money

### An unsnapshotted pass can be erased
ERC-8004 attestations are **repeatable**: a validator can overwrite its own verdict. The
escrow snapshots the first passing attestation, after which an overwrite cannot un-pay a
released job. But until someone calls `confirmValidation` or `release`, a validator that
changes its mind erases the pass — and the **seller cannot snapshot its own**. The
mitigation is that the validator releases immediately after attesting, which makes the
window small rather than closing it. *(DF-05, DF-15, V-94.)*

### There is no early refund on a failing attestation
A validation request that is merely *pending* reads identically to a response of `0` on
the read the escrow uses, so an early-fail rule would let anyone refund the moment the
seller filed its request and take the service for free. A failing outcome waits for the
deadline plus grace.

A refinement worth stating precisely: `getSummary` on the Validation registry **does**
distinguish the two, because it filters on a stored `hasResponse` flag — but it loops
over every validation the agent has ever had, so it cannot be called from a settlement
path under the bounded-loop rule. The decision stands on **gas cost**, not on
impossibility. *(DF-05, V-99, V-99a.)*

### A validator that never answers costs the seller the work
This is the residual A5 exposes, and it deserves stating on its own rather than as a
footnote to a result. Pre-funding removes the published `upto` leak — the buyer cannot
consume compute that was never escrowed, so ρ measured 0.00 against the fixture's 0.98.
But it does not remove the seller's exposure; it **moves** it.

A job whose validator never attests is **delivered and then refunded**. The seller did
the work, the buyer got the bytes, and after `deadline + grace` the money goes back to
the buyer. The loss is identical to A5's in size and direction — only the cause has
changed, from "the buyer ran out of allowance" to "the validator did not answer".

That path is exercised by INT-002 but its **rate was not measured**, because it depends
on validator liveness rather than on anything the protocol controls. A deployment that
cares about this needs validator redundancy — k-of-n attestation is named as future work
and is not built. *(DF-10, H-A5-3.)*

### A reorg deeper than the confirmation policy takes the payment back
The seller waits `k` confirmations before it executes. A reorg of depth `d > k` removes
the funding transaction after the work has been handed over, and the seller has
delivered for nothing. Measured at 20 trials per cell: at `k=3` the job survived every
reorg through depth 3 (**0/20** revert-grants)
and lost the payment at depth 5 (**20/20**).
Serving with no confirmation wait at all loses it at every depth tested.

**No value of `k` closes this.** A deeper reorg defeats any policy, so the claim is
*mitigated up to depth k* and never "blocked" (DF-11). Raising `k` trades the risk
against latency: every confirmation is a block the buyer waits through. Base's unsafe
head can reorg; the `safe` tag is stronger and far slower. The choice is a deployment
parameter, and whichever value is picked, the residual belongs to the seller.

### `requestHash` squatting is unbounded against a mempool watcher
The salt that makes a validation request unguessable is secret only until the seller
**broadcasts** `validationRequest`. From that moment an adversary watching the mempool
can front-run and squat the hash — for gas only, repeatedly, against every retry. Random
salts defeat a *blind* squatter outright; only a mempool watcher can follow.

There is no contract fix: the escrow cannot file the request itself without operator
rights on the agent NFT, which would also let it transfer the NFT. The seller has a
finite retry budget folded into `minDeadlineMargin`, and stops rather than delivering
work it cannot get attested. *(DF-06, corrected by the CONTRACT-007 security review.)*

---

## 5. Funds that can get stuck

### A blacklisted or paused payee strands the escrow
USDC can freeze an address. Once a passing attestation is recorded, `refund()` is
forbidden and `release()` reverts at the token — so the money stays in the contract with
no way out. There is deliberately **no administrative sweep**, because an owner able to
move escrowed funds would defeat the point. A pull-payment `withdraw(to)` would fix it
and is **deferred** (STRETCH-008). *(DF-16.)*

### Stray tokens are unrecoverable
Same cause. Anything sent to the escrow outside `fund()` cannot be retrieved.

### `renounceOwnership` is one step
It is inherited from OpenZeppelin's `Ownable` and is not overridden. It cannot strand
funds — settlement reads no setting except the grace each job snapshotted at funding —
but it freezes configuration permanently. Recorded rather than removed, and pinned by
`AdminTest.test_RenouncingOwnershipDoesNotStrandFunds`.

---

## 6. Operational scope

### One host, one claim store
"One execution per funded job" holds across **processes on one host**, because SQLite in
WAL mode gives one writer at a time against a shared database file. It does **not** hold
across hosts. A multi-host seller would need a different claim store; measured across two
processes only (`evidence/API-005/multiproc.log`).

### Delivery confidentiality depends on TLS
The payer-signed retry stops anyone who merely read `jobId` from the chain. It does not
stop an attacker who can read the buyer's traffic in flight: such an attacker captures a
valid header. TLS is assumed for any real deployment and is **not** provided by this
code. *(DF-02.)*

### No LLM agent layer
The buyer is deterministic, by design: every measurement uses it. The LangGraph and
LiteLLM buyer is demo narrative only and was **not built** (EXTENDED-E2). Nothing in the
security argument depends on it. *(DF-24.)*

### Nothing is deployed to a public chain
Every number in this repository comes from a local Anvil. No transaction has been sent to
Base Sepolia, no wallet funded, no contract verified on a block explorer. **Latency, gas
and confirmation behaviour do not transfer.** The deployment is blocked on funded wallets
(ENV-006/007).

### Mocks, not the live registries
Tests run against same-ABI mocks of the three ERC-8004 registries. Their conformance to
the pinned upstream ABI is checked mechanically, and the pinned ABI was checked against
the deployed implementations (65/65 selectors, `evidence/REG-001/`). But **fork tests
against the live registries were not run** (REG-005), and no agent was registered on the
live Identity registry (REG-007).

---

## 7. What the evaluation does and does not establish

### The baseline is a fixture, not upstream x402
The comparison target is a deliberately vulnerable server **written for this project**.
It reproduces the conditions the published papers describe. It is **not** the `@x402/*`
packages and is **not** evidence about anyone else's implementation. Establishing
anything about upstream would require running against a pinned upstream version — that is
API-009, and it **was not done**. *(DF-18.)*

### All six were evaluated; four were blocked and two were bounded

| attack | status |
|---|---|
| A1 revert-grant (reorg) | **Evaluated — mitigated up to depth k, never blocked.** Measured at depths 1, 2, 3, 5 against policies k = 0, 1, 3: the cliff is exactly `d > k`. Serving optimistically (k=0) loses the payment at every depth. No confirmation policy can close this window; a deeper reorg defeats any k. |
| A4 concurrent duplication | **Evaluated — 0 of 150 rounds duplicated**, against **50 of 50 at every concurrency level** (10, 20 and 50 concurrent requests; 150 of 150 overall) on a fixture that has the window. Weaker evidence than it looks: AgentTrust has no verify→settle window to race, so zero was expected by construction rather than won under pressure. |
| A5 allowance overdraft | **Evaluated — ρ = 0 against the fixture's 0.98.** But this is a refusal rather than a defence: AgentTrust does not price `upto` at all. And the residual is real — a job whose validator never attests is delivered and then refunded, so the seller carries the same loss by another route. That path is exercised by INT-002, not counted as a rate. |
| A6 Sybil selection | **Evaluated — Mitigated, not blocked.** The ring is refused on-chain, but an attacker that earns genuine trusted feedback is admitted on the same evidence an honest seller presents, and is refused only once those clients revoke. See below. The published 60.2% figure is still **not** reproduced — it came from an LLM discovery-ranking experiment, and nothing here is comparable to it. |

Coverage is **6 of 6**. Two of them — A4 and A5 — are blocked structurally rather than by a defence that could have failed, and two — A1 and A6 — are *bounded* rather than blocked. The denominator travels with the number, and so do the qualifiers.

### "Blocked (structural)" covers two different claims, and the weaker one is worth naming
Four rows carry that label and they do not all mean the same thing.

**A2 and A3 are blocked by a mechanism that could have failed.** For A2 it is the atomic
claim store keyed by `(chainId, escrow, jobId)` plus the payer-signed retry; for A3 it is
the `resourceHash` the escrow computes on-chain. Both are asserted by unit tests as well
as measured, and both were under genuine pressure — 4,440 replay attempts and 100
substitution rounds had real opportunities to get through.

**A4 and A5 are blocked because there was nothing there to attack.** AgentTrust has no
verify→settle window for A4's race to exploit, and no shared allowance for A5 to drain,
because every job is pre-funded at an exact price. The zeros were not won; they follow
from the design not having the feature the attack needs. That is a weaker kind of
evidence and is worth saying before someone asks — the measurements are more
interesting as a demonstration that the *fixtures* reproduce the published conditions
than as proof that AgentTrust withstands them.

Neither kind of claim extends to an attacker doing something these runs did not attempt,
and neither is a proof.

### The A3 zero depends on its control
A server that refused everything would also serve 0 of 100 substitutions. The result
means "bound" rather than "broken" only because the correct request succeeded in all 100
rounds and every one-byte mutation was refused. If that control ever regresses, the
headline number stops meaning what it says.

---

## 8. Known unresolved facts

Some things this project uses are recorded as **UNRESOLVED** rather than verified, and
are not relied on for any claim: the "725 → 50M" adoption figure often quoted for x402;
the exact phrases attributed to arXiv 2604.11430; numeric rate limits on the public Base
Sepolia RPC; and whether ERC-8004 exists on Polygon Amoy, which matters only if the
testnet fallback is ever triggered. The full list is
`docs/planning/verification-log.md`.
