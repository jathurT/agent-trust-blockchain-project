# AgentTrust — presentation brief

**Everything needed to build the deck, in one file.** Self-contained on purpose: no
repository access required. Every number below came from a recorded measurement, and
the "do not claim" rules are as important as the content.

- **Deliverable:** 5 slides + backup slides, **3 minutes**, one presenter
- **Filename:** `GP_20_AgentTrust` — the assignment PDF writes `.ppt`; `.pptx` is
  almost certainly fine, and if the coordinator insists, PowerPoint's
  *Save As → PowerPoint 97-2003* produces the legacy file in one step
- **Module:** EC8204 Blockchain and Cyber Security, Dept. of Electrical & Information
  Engineering, University of Ruhuna
- **Spoken script:** 391 words ≈ 3:02 at 129 wpm. The script is the constraint; if a
  slide needs more words than are below, cut the slide, not the timing.

## Design direction

Technical but not corporate. Dark or light both fine. **The numbers are the design** —
every slide has one figure that should dominate, and the body text exists to frame it.
Slides are looked at, not read: the speaker script carries the argument, so on-slide
text is deliberately sparse below. Monospace for anything that is a literal identifier
(`ReputationTooLow`, `resourceHash`).

---

# Slide 1 — Agents are already paying each other

**Dominant figure:** `130,000,000`

**On-slide text**
- 130M all-time transactions on x402
- Embedded in Google Cloud, Cloudflare, Stripe
- 75.41M in 30 days *(x402.org, 22 Sep 2026)*

**Visual:** two agent icons exchanging a coin. Keep it abstract; avoid stock-photo robots.

**Speaker script (53 words)**
> "AI agents already pay each other. One protocol, x402, reports a hundred and thirty
> million transactions all-time, and it is embedded in Google Cloud, Cloudflare and
> Stripe. As of the twenty-second of September this year its own dashboard showed
> seventy-five million transactions in thirty days. Machine money is here, and it is
> growing."

**Sourcing:** 130M and the three integrations are *a paper's claim* (arXiv 2605.30998,
sourced from Dune), not something this project measured — attribute it. The 30-day
figure is x402.org's own dashboard and changes daily, so the date must be spoken.

---

# Slide 2 — The payment layer shipped before the trust layer

**Dominant figure:** `248 → 1`

**On-slide text**
- One payment, replayed → **248 grants, 1 settlement**
- Pay for one endpoint, take another → **100 / 100**
- 11 vulnerabilities, 5 classes *(2026 audit of 3 SDKs, 4 live endpoints)*

**Visual:** the six-attack table with A2 and A3 highlighted. Or a single diagram: one
payment token fanning out into many served responses.

**Speaker script (106 words)**
> "But payment arrived before trust. x402 is pay first, hope for delivery. A 2026 audit
> of three SDKs and four live endpoints found eleven vulnerabilities. In its strongest
> round, replaying one payment across a thousand concurrent requests bought two hundred
> and forty-eight grants of the resource against a single on-chain settlement. A second
> paper shows why: the signature names an amount, but not a resource. Pay for one
> endpoint, take another — a hundred times out of a hundred. Bridge hacks cost two
> billion dollars in 2022 for the same reason: value moved on a message that was not
> bound to the action it paid for."

**Sourcing:** 248 grants = arXiv 2605.11781, strongest round of 1,000 concurrent
replays against a **testnet** endpoint — both qualifiers belong in the speech. The 11
vulnerabilities belong to **that one paper**, not to two. 100/100 = arXiv 2605.30998.
$2bn = Chainalysis 2022.

**This slide is the first place to cut.** Dropping the bridge-hack sentence buys ~12
seconds and weakens nothing measured.

---

# Slide 3 — What AgentTrust adds

**Dominant element:** a five-box flow — **buyer → seller → escrow → validator → ERC-8004 registries**

**On-slide text**
- **Gate** — read the seller's reputation before any money moves
- **Resource-bound escrow** — funds lock to the hash of *one exact request*
- **Validation trigger** — release only against an independent attestation

**Speaker script (83 words)**
> "AgentTrust adds three things. A **gate**: we read the seller's ERC-8004 reputation
> before any money moves, and only from attesters the buyer named in advance, so a ring
> of fresh addresses cannot vouch for itself. **Resource-bound escrow**: the contract
> derives the hash of one exact request — method, URI, body, amount, token, chain — and
> burns the payer's nonce in the same transaction. And a **validation trigger**: funds
> release only against an independent validator's attestation, and refund after the
> deadline if none arrives."

**If asked "why a blockchain?"** — the prepared answer:
> A Postgres audit log can *record* a dispute between two parties who distrust each
> other; it cannot *arbitrate* one, because someone has to own the database, and
> whoever owns it is a party to the dispute.

**If asked "is this new?"** — the x402 specification already defines an escrow scheme
with capture and refund deadlines (`auth-capture`), and ERC-8183 defines job escrow with
an evaluator. **Do not claim to be first.** What is different is the *reputation gate at
funding time* plus *release against a validator attestation*.

---

# Slide 4 — The demo

**Visual:** pre-recorded 45-second split screen, cropped to the two counters.
Left pane captioned **"deliberately vulnerable fixture — not upstream x402"**.

**On-slide text**
| | fixture | AgentTrust |
|---|---|---|
| executions per payment | **50** | **1** |

**Speaker script (70 words)**
> "On the left, a fixture we wrote to reproduce the published replay conditions. It is
> labelled, and nothing here was run against anyone else's service. One payment, fifty
> replays, fifty executions. On the right, the same attacker against AgentTrust: one
> payment, fifty replays, one execution. Every replay still gets two hundred OK and the
> stored bytes — nothing is refused — but the work runs once. Ten runs each way."

**The caption must carry the distinction the counters make.** A 2xx is *not* an
execution: AgentTrust answers every replay with 200 and the stored bytes, and the work
runs once. "Requests blocked" would be the wrong caption — nothing is blocked, and that
is the point.

---

# Slide 5 — What we measured, and what we did not

**Dominant figure:** `6 / 6`

**On-slide text** — the coverage table, all six rows, with the qualifiers **on the
slide** and not hidden in the notes:

| attack | outcome |
|---|---|
| A1 revert-grant (reorg) | **Mitigated to depth k** — a deeper reorg still wins |
| A2 replay | **Blocked (structural)** |
| A3 cross-resource substitution | **Blocked (structural)** |
| A4 concurrent duplication | **Blocked (structural)** |
| A5 allowance overdraft | **Blocked** — for the measured direction |
| A6 Sybil selection | **Mitigated** — ring refused; an earned reputation still admits |

Plus one line: *Testnet only, valueless tokens, our own services, published
vulnerabilities, no third-party targets.*

**Speaker script (79 words)**
> "All six evaluated. Four blocked structurally, two bounded — a reorg deeper than our
> confirmation policy still wins, and a patient attacker who earns real feedback still
> gets past the gate. The gate finding is the one worth your time: the original design
> admitted all five Sybils and refused all ten honest newcomers. What none of it shows
> is whether the answer was good. As agents transact without us, the escrow has to be as
> automated as the payment."

---

# The measured results, in full

All on a local devnet (Anvil, chain 31337). 14 recorded runs, each with a committed
manifest recording commit hash, tool versions, chain, block, parameters and seed.

## A2 — replay

One payment, then N replays of the same payment artefact. 10 runs per configuration.

| target | requests/run | **executions/run** | runs |
|---|---|---|---|
| fixture | 50 | **50** | 10 |
| fixture | 200 | **200** | 10 |
| AgentTrust | 50 | **1** | 10 |
| AgentTrust | 200 | **1** | 10 |

- Replay attempts that caused an extra execution: **3,460 of 3,950** (fixture) vs
  **0 of 4,440** (AgentTrust)
- Responses served on a **forged** signature: **500 of 500** vs **0**
- Zero variance: every one of the ten runs per configuration produced the same count

**Mechanism:** an atomic claim store keyed by `(chainId, escrow, jobId)`, plus a
payer-signed delivery request.

## A3 — cross-resource substitution

Pay for `/v1/summarise`, present the payment at `/v1/classify`. Both cost the same, so
price alone cannot tell them apart. 100 rounds each.

| target | substitutions served | false refusals |
|---|---|---|
| fixture | **100 / 100** | 0 |
| AgentTrust | **0 / 100** | 0 |

**The zero only means something because of the control:** a server that refused
everything would also serve 0 substitutions. The correct request succeeded in all 100
rounds.

**Mechanism:** the escrow derives `resourceHash` on-chain from method, URI, body,
amount, token and chain.

## A6 — Sybil ring vs the reputation gate

A registry populated with 10 honest sellers, a ring of 5 cross-endorsing Sybils, and 10
newcomers with no history.

| gate | honest admitted | **Sybils admitted** | newcomers admitted |
|---|---|---|---|
| no gate | 10/10 | **5/5** | 10/10 |
| **v1 — the original design's rule** | 10/10 | **5/5** | **0/10** |
| v2 — implemented | 10/10 | **0/5** | 0/10 |

**The headline is a negative result about the original design.** Its gate
(`score ≥ 6000`, `count ≥ 5`, `distinct ≥ 3` over every client) admitted **all five**
Sybils — a ring of five agents with distinct owners endorses each other for
`distinct = 4` and `count = 8`, at a score it picks for itself — **and refused all ten
honest newcomers**. It imposes the cold-start cost and returns nothing for it.

**The implemented gate refuses the ring, and the chain says so**, not a model: `fund()`
was actually sent. Honest seller funded; Sybil reverted `ReputationTooLow`; newcomer
likewise.

**Two results that bound the claim:**

1. **Patience defeats it.** An agent that earns genuine feedback from the buyer's own
   trusted clients is admitted, *stays* admitted after it starts misbehaving, and is
   refused only once those clients revoke — after the fact. The gate reads *reputation*,
   not *conduct*. This is why the table says Mitigated, not Blocked.
2. **An honest seller can be rated into invisibility.** Past **26** feedback entries
   from one trusted client, `fund()` was refused; 28 reverted `ReputationTooLow`. The
   reputation read runs under a 250,000-gas ceiling, and over it the read is caught and
   reads as *no reputation at all*. It fails closed, so it is safe — but the client's
   opinion stops counting silently, and nothing stops a competitor doing the rating.

**On "capture share" — why there are two numbers, not one.** How often a Sybil gets
picked depends on how the buyer chooses, which is a modelling decision, not a
measurement. Ranking by score gives the ring **100%** with no gate and **100%** under
v1; weighting by score gives **36.5%** and **38.3%**; the implemented gate gives **0%**
under either. The spread between the two rules is the honest measure of how much the
rule is doing. **None of these is comparable to the 60.2% figure in the literature** —
that came from an LLM discovery-ranking experiment, not an escrow gate.

## A4 — concurrent duplication

One payment, N requests fired together, 50 rounds per level.

| target | rounds with a duplicate execution (c=10 / 20 / 50) | max executions in one round |
|---|---|---|
| fixture | **50/50 · 50/50 · 50/50** | 10, 20, 50 |
| AgentTrust | **0/50 · 0/50 · 0/50** | 1 |

**Own the weakness if asked:** AgentTrust has no verify→settle window to race, so zero
was expected *by construction*, not won under pressure. And the fixture's 100% rate is a
function of its 5 ms verify window — it is **not** a reproduction of the published 6%.

## A5 — leakage under `upto` pricing

| target | delivered | settled | **ρ** | seller over-draw |
|---|---|---|---|---|
| fixture | 50 | 1 | **0.98** | succeeded |
| AgentTrust | 50 | 50 | **0.00** | structurally unavailable |

**The original design had this backwards** — its defence capped the *seller's* draw, but
the published loss is the *seller* delivering work that never settles.

**AgentTrust's zero is a refusal, not a defence:** it does not price `upto` at all. And
the exposure does not vanish — a job whose validator never answers is delivered and then
refunded, so the seller carries the same loss by another route. Pre-funding moves the
risk from "the buyer ran out of allowance" to "the validator did not answer".

## A1 — revert-grant under reorg

Work delivered for a payment a reorg then removed, 20 trials per cell:

| policy | d=1 | d=2 | d=3 | d=5 | mitigated up to |
|---|---|---|---|---|---|
| k=0 | 20/20 | 20/20 | 20/20 | 20/20 | **nothing** |
| k=1 | **0/20** | 20/20 | 20/20 | 20/20 | **depth 1** |
| k=3 | **0/20** | **0/20** | **0/20** | 20/20 | **depth 3** |

**This can never be called "blocked."** A reorg deeper than k defeats any k. The cliff
at `d > k` is arithmetic; what the runs establish is that the implementation matches it
— the seller counts confirmations against the funding block, not the tip or the clock.

## Engineering evidence, if a slide or a question needs it

- **469 tests** across six packages, all passing: Solidity 154 + 6 invariants, shared
  core 87, seller 96, buyer 21, attack harness 32, validator 73
- **98.14%** line coverage on the escrow contract
- One paid job end to end on the devnet: **median 1090 ms** over 10 runs
- The validator re-implements the canonical request hash **independently in Python**
  and is checked against shared cross-language vectors — that independence is the point

---

# Hard constraints — things that must not appear

These are not stylistic preferences. Each one is a claim the evidence does not support.

1. **Never call the baseline "vanilla x402" or imply upstream was attacked.** It is a
   deliberately vulnerable fixture written for this project, reproducing conditions two
   published papers describe. Nothing was run against the real `@x402/*` packages or
   anyone else's endpoint. The left pane of the demo must be captioned as a fixture.
2. **Never say "six attacks, six blocked."** All six were evaluated, but only four are
   blocked, and **two are bounded** — A1 to the confirmation depth chosen, A6 to a ring
   that has not earned real feedback. The qualifiers belong on the slide. It is also
   worth owning, rather than being caught by, that A4 and A5 are blocked *by
   construction* — no window to race, no allowance to exhaust — not by a defence that
   could have failed.
3. **Never say A6 or A1 is "blocked."** Both are *mitigated*. The A6 run itself shows a
   patient attacker getting in; no confirmation policy closes A1's window.
4. **Never claim to be first.** An escrow scheme already exists in the x402
   specification; the difference is the reputation gate plus validator-attested release.
5. **Never say "proof of delivery."** The validator attests that the delivered bytes are
   the correct *deterministic* result. It does not judge whether the answer was any
   good, and the buyer's own retrieval of stored evidence was not built.
6. **No deployed contract address** unless the Base Sepolia deployment has actually
   happened by presentation day. If it has not, the slide says "local devnet" and the
   presenter says so. Do not show a placeholder address.
7. **Never present a devnet latency as a testnet number.** Confirmations are 0 and
   blocks mine on demand, so the largest real cost — waiting for blocks — is absent.
8. **The unverified growth figure "725 transactions in May 2025 → 50 million"** is not
   in any source that could be found. Do not use it.

---

# Backup slides

Have these ready; do not present them unless asked.

1. **Architecture** — buyer, seller, escrow, validator, the three ERC-8004 registries,
   and the five transactions a complete job takes
2. **Threat model** — the trust assumptions, stated plainly: the *selected* validator is
   honest; finality is only as strong as the confirmation policy; the live ERC-8004
   registries are upgradeable by a single key
3. **Results detail** — the A2/A3/A6 tables above in full
4. **Limitations** — collusion with a trusted attester is unaddressed; honest newcomers
   are refused by design; a seller can be rated past the gate's gas ceiling; a
   blacklisted payee can strand funds; the claim store is single-host; three of six
   attacks not evaluated
5. **Related work** — the x402 `auth-capture` scheme, ERC-8183 agentic commerce, and the
   two source papers, with the honest statement of what is different here

---

# Delivery notes

- One presenter. A handover costs ten seconds there is not room for.
- Say the numbers rather than reading the slide: **248 against 1**, **100 out of 100**,
  **50 to 1**, **five of five Sybils**, **three of six**.
- No live network calls. The demo is recorded.
- Rehearse with a timer. If the measured pace is slower than 129 wpm, cut the
  bridge-hack sentence on slide 2 first, then the second sentence of slide 5.
