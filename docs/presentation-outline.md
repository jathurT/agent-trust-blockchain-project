# PRES-001 — Five-slide outline

Three minutes, five slides, one presenter. The spoken script below is **391 words**,
counted rather than estimated — a first draft came out at 440, which is about three and
a half minutes. Recount after any edit; the time limit is what decides the cuts.

Count it with:

```bash
python3 - <<'EOF'
import io, re
s = io.open("docs/presentation-outline.md", encoding="utf-8").read()
q = re.findall(r'^> "(.*?)"$', s, re.M | re.S)
c = [len(re.sub(r"\s+", " ", x.replace(">", "")).split()) for x in q]
print(c, sum(c))
EOF
```

Every number carries its source. Where the blueprint's §17 script used a figure that
verification could not support, the correction is stated under the slide rather than
silently applied — the same figures appear in the deck's speaker notes, so the
presenter knows why a familiar number is missing.

---

## Slide 1 — Agents are already paying each other (0:00–0:25)

**Visual:** two agent icons and one coin; the figure **130,000,000** large.

> "AI agents already pay each other. One protocol, x402, reports a hundred and thirty
> million transactions all-time, and it is embedded in Google Cloud, Cloudflare and
> Stripe. As of the twenty-second of September this year its own dashboard showed
> seventy-five million transactions in thirty days. Machine money is here, and it is
> growing."

- 130M all-time and the three integrations: **V-21**, attributed — it is arXiv
  2605.30998's claim, sourced from Dune, not a figure this project measured.
- 75.41M / 30 days: **V-74**, x402.org, viewed 2026-09-22. It changes daily, so the
  date is spoken, not implied.
- **Cut from §17:** "725 transactions in May 2025 to around 50 million". That is
  **V-22, UNRESOLVED** — not in the paper, no primary source found. It is not used.

## Slide 2 — The payment layer shipped before the trust layer (0:25–1:05)

**Visual:** the six-attack table, A2 and A3 highlighted.

> "But payment arrived before trust. x402 is pay first, hope for delivery. A 2026 audit
> of three SDKs and four live endpoints found eleven vulnerabilities. In its strongest
> round, replaying one payment across a thousand concurrent requests bought two hundred
> and forty-eight grants of the resource against a single on-chain settlement. A second
> paper shows why: the signature names an amount, but not a resource. Pay for one
> endpoint, take another — a hundred times out of a hundred. Bridge hacks cost two
> billion dollars in 2022 for the same reason: value moved on a message that was not
> bound to the action it paid for."

- Eleven vulnerabilities in five classes: **V-11**, and they belong to **one** paper
  (arXiv 2605.11781), not to "two papers" as §17 says.
- 248 grants against 1 settlement: **V-12** — the strongest round of 1,000 concurrent
  replays against a live **Base Sepolia testnet** endpoint. Both qualifiers are spoken.
- 100/100 cross-resource substitutions: **V-24** (arXiv 2605.30998, F1).
- $2bn bridge losses: **V-31** (Chainalysis, 2022).
- **Cut from §17:** "five fake servers captured 60% of all agent traffic". That is A6,
  it comes from an LLM discovery-ranking experiment rather than an escrow gate, and
  **this project did not evaluate it**. Claiming it on slide 2 and not showing it on
  slide 5 is the overclaim an examiner will find first.

## Slide 3 — What AgentTrust adds (1:05–1:40)

**Visual:** five boxes — buyer, seller, escrow, validator, ERC-8004 registries.

> "AgentTrust adds three things. A **gate**: we read the seller's ERC-8004 reputation
> before any money moves, and only from attesters the buyer named in advance, so a ring
> of fresh addresses cannot vouch for itself. **Resource-bound escrow**: the contract
> derives the hash of one exact request — method, URI, body, amount, token, chain — and
> burns the payer's nonce in the same transaction. And a **validation trigger**: funds
> release only against an independent validator's attestation, and refund after the
> deadline if none arrives."

- The third clause is **DF-08's wording**: attested, validator-escrowed delivery of a
  correct *deterministic* result. Not "proof of delivery", and not a judgement of
  quality — the honesty beat on slide 5 says so.
- **Nothing on this slide claims to be first, and the script must not start.** The x402
  specification already defines an escrow scheme with capture and refund deadlines
  (`auth-capture`, V-143), and ERC-8183 defines job escrow with an evaluator and expiry
  refund. "AgentTrust adds three things" describes the system; it is not a priority
  claim. If asked, the answer is: the escrow is not the new part — the **reputation gate
  at funding time** and **release against a validator attestation** are (DF-19).
- The "why a blockchain" answer, kept verbatim from blueprint §6.2 for the viva:
  *a Postgres audit log can record a dispute between two parties who distrust each
  other; it cannot arbitrate one, because someone has to own the database, and whoever
  owns it is a party to the dispute.*

## Slide 4 — The demo (1:40–2:30)

**Visual:** the pre-recorded 45-second split screen (PRES-003, commands in
`docs/demo-script.md`). Left pane captioned **"deliberately vulnerable fixture — not
upstream x402"**. Right pane: AgentTrust.

> "On the left, a fixture we wrote to reproduce the published replay conditions. It is
> labelled, and nothing here was run against anyone else's service. One payment, fifty
> replays, fifty executions. On the right, the same attacker against AgentTrust: one
> payment, fifty replays, one execution. Every replay still gets two hundred OK and the
> stored bytes — nothing is refused — but the work runs once. Ten runs each way."

- 50 → 50 and 50 → 1: `docs/results.md`, 10 runs per configuration.
- **Corrected from §17:** the left pane is never called "vanilla x402", and the defence
  is not "the second call reverts `ReplayedNonce()`". Those are two different layers
  (DF-13): the HTTP replay is absorbed by the claim store, and a second `fund()` for the
  same request is what reverts. Saying the wrong one invites a question that unravels
  the slide.

## Slide 5 — What we measured, and what we did not (2:30–3:00)

**Visual:** the coverage table with all six rows and their outcomes; repository QR.

> "All six evaluated. Four blocked structurally, two bounded — a reorg deeper than our
> confirmation policy still wins, and a patient attacker who earns real feedback still
> gets past the gate. The gate finding is the one worth your time: the original design
> admitted all five Sybils and refused all ten honest newcomers. What none of it shows
> is whether the answer was good. As agents transact without us, the escrow has to be as
> automated as the payment."

- **6 of 6 evaluated.** **Corrected from §17:** it is still not "six blocked". Four are
  blocked structurally; **A1 and A6 are bounded**, and the bounds belong on the slide,
  not in the notes. A1 is mitigated only up to the confirmation depth chosen, and A6
  only against a ring that has not earned real feedback.
- **Two of the four "blocked" are weaker than they sound**, and it is better to own that
  than be asked: A4 and A5 are blocked by construction — there is no verify→settle
  window to race and no allowance to exhaust — rather than by a defence that could have
  failed under pressure.
- **A6 is the one to mention if there is a spare breath**, because it is the only
  finding that is *against* the original design: the blueprint's own gate admitted all
  five Sybils while refusing all ten honest newcomers. And say the bound — the
  implemented gate is **Mitigated, not Blocked**, because an attacker patient enough to
  earn trusted feedback is admitted like anyone else.
- **Corrected from §17:** no deployed Base Sepolia address is shown. The deployment is
  blocked on testnet funds (ENV-006/007); if it lands before the talk, the address and
  explorer link replace the QR's second line, and if it does not, the slide says
  "local devnet" and the presenter says so.
- The closing honesty beat is blueprint §6.3, and it is deliberately the last thing
  said.
- **The ethics line goes on this slide, not in the script** (SEC-011): *testnet only,
  valueless tokens, our own services, published vulnerabilities, no third-party
  targets.* It is one line of slide text, said only if asked — the same wording as
  `README.md` §"Ethics and scope" and `docs/results.md`.

---

## Timing

Measured word counts, at roughly 129 words per minute:

| Slide | Target | Words | Implied |
|---|---|---|---|
| 1 Hook | 0:00–0:25 | 53 | 0:25 |
| 2 Problem | 0:25–1:05 | 106 | 0:49 |
| 3 Solution | 1:05–1:40 | 83 | 0:39 |
| 4 Demo | 1:40–2:30 | 70 | 0:33 |
| 5 Results | 2:30–3:00 | 79 | 0:37 |
| | **3:00** | **391** | **3:02** |

Slide 4 is under its 50-second slot because the video runs for 45 of those seconds and
the presenter should not be talking over all of it. Slide 2 is the longest and is the
first place to cut: the bridge-hack sentence goes without weakening anything measured,
and that alone buys about twelve seconds.

The implied timings assume 129 wpm. **Rehearse with a timer (PRES-004)** — if the
measured pace is slower, cut slide 2 first, then the second sentence of slide 5.

## Delivery notes

- One presenter; a handover costs ten seconds there is no room for.
- Say the numbers rather than reading the slide: 248 against 1, 100 out of 100, 50 to 1,
  two of six.
- No live network calls. The demo is recorded.
- Backup slides: architecture, threat model, the results detail, the limitations, and
  related work — including ERC-8183 and the x402 `auth-capture` scheme, which is where
  the novelty question will come from (V-143).
