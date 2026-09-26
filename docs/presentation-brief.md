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

## Visual design system

**Technical, calm, and confident — a security result, not a crypto pitch.** The numbers
are the design: every slide has one figure that dominates, and everything else exists to
frame it. Slides are *looked at*, not read — the speaker carries the argument, so
on-slide text stays sparse.

Every colour below was **computed, not chosen by eye** — run through a
colour-blindness validator and WCAG contrast checks against the exact slide
backgrounds. The figures are given so the choices can be defended if anyone asks.

### The one rule everything follows

> **Orange is always the baseline. Blue is always AgentTrust.** On every slide, in every
> chart, without exception.

The audience learns it on slide 2 and reads every later slide faster because of it. The
"baseline" changes by attack — the vulnerable fixture for A2–A5, the blueprint's own
gate for A6, a zero-confirmation policy for A1 — but it is *always orange*.

**Why not red for the baseline?** Red reads as "critical error", and the fixture is not
failing — it is doing exactly what it was built to show. Orange says *the vulnerable
one* without shouting, and it validates far better against blue for colour-blind
viewers.

Outcome status (Blocked / Mitigated) uses **separate green and amber pills with an icon
and a word** — never the orange/blue series colours, so "which system" and "what
happened" can never be confused.

### Theme — pick by the room, not by taste

| | when | background |
|---|---|---|
| **Dark — recommended** | screen, TV, or a projector in a dimmed room | deep navy `#0f172a` |
| **Light** | a projector in a **lit** room that can't be dimmed | white `#ffffff` |

Dark slides look sharper and more technical, and every colour clears contrast on navy
with room to spare. But under room lighting a projector washes dark slides into murky
grey. **Check the room before deciding** — the palette below is specified for both.

### Colour tokens

| role | dark theme | light theme | notes |
|---|---|---|---|
| slide background | `#0f172a` | `#ffffff` | |
| primary text | `#f8fafc` · 17.1:1 | `#0f172a` · 17.9:1 | titles, hero figures, body |
| secondary text | `#94a3b8` · 7.0:1 | `#475569` · 7.6:1 | subtitles, labels |
| muted / captions | `#64748b` · 3.8:1 | `#64748b` · 4.8:1 | sources, footnotes only |
| **AgentTrust** | **`#3987e5`** · 4.9:1 | **`#2a78d6`** · 4.4:1 | the defended system |
| **Baseline** | **`#d95926`** · 4.6:1 | **`#eb6834`** · 3.2:1 | whatever is being compared against |
| hairlines, gridlines | `#1e293b` | `#e2e8f0` | recessive — barely there |

Contrast ratios are against that theme's own background. Orange vs blue was validated
for colour-blind separation: **CVD ΔE 24.7 light / 26.8 dark**, against a target of 8 —
safe for protan, deutan and tritan viewers.

**Text never wears the series colour.** A number printed in blue is harder to read than
the same number in white or navy beside a blue mark. Colour goes on the *mark* (bar,
dot, pill, underline); the words stay in the text tokens.

### Status pills

The coverage table's outcomes. Always **icon + word**, never colour alone.

| outcome | icon | fill | text | outline (light theme) |
|---|---|---|---|---|
| **Blocked** | ✓ | green `#0ca30c` | dark `#0f172a` | `#15803d` |
| **Mitigated** | ◐ (half-filled circle) | amber `#fab219` | dark `#0f172a` | `#b45309` |

**Light theme needs the outline — this was measured, not assumed.** Amber on a white
slide is **1.83:1**, close to invisible as a filled shape. Text inside the pill is fine
(9.7:1), but the pill's *edge* vanishes. A 2px `#b45309` outline (5.0:1) fixes it; the
green pill gets `#15803d` (also 5.0:1) so the two read as a matched pair. On the dark
theme no outline is needed — both fills clear 3:1 on navy.

**A4 and A5 get a small secondary tag, `by construction`,** in muted text beside the
green pill. They are blocked because there was nothing to attack, not because a defence
held — the tag is the honest version of the badge, and it pre-empts the obvious question.

### Typography

- **IBM Plex Sans** for everything, **IBM Plex Mono** for literal identifiers
  (`ReputationTooLow`, `resourceHash`, `fund()`). One family, technical in feel, free
  under the OFL. Fallback: the system sans (`Segoe UI` / `Helvetica`).
- **Two typefaces maximum.** No display fonts, no script, no serif.

| element | size (16:9, 13.33″ × 7.5″) | weight |
|---|---|---|
| hero figure | **96–140 pt** | SemiBold 600 |
| slide title | 36–40 pt | SemiBold 600 |
| on-slide body | 24–28 pt | Regular 400 |
| chart labels | 18–20 pt | Regular 400 |
| sources, captions | 14–16 pt | Regular 400, muted |

**Nothing below 14 pt** — it is unreadable from the back of a lecture room. Hero figures
use proportional numerals; tables use **tabular** numerals so columns align.

### Layout

- **16:9**, margins of about **0.6″** (≈ 6%) on every side, a 12-column grid.
- **One idea per slide.** Title top-left; hero figure left or centre; one supporting
  visual right. At most **~20 words** of on-slide text.
- **White space is the design.** An empty third of a slide is not wasted — it is what
  makes the hero figure land.
- Align everything to the grid. Nothing floating, nothing centred-by-eye.

### Iconography

Simple **line icons, 2 px stroke**, from one consistent open-source set — **Lucide** or
**Phosphor**. Use them sparingly and only where they carry meaning: an agent (`bot` or
`cpu`), a payment (`coins`), the escrow (`vault` or `shield`), the validator
(`badge-check`), the registry (`database`). Icons match the text colour, never a series
colour.

### Motion

**One build per slide, at most** — and use it where the reveal *is* the argument: show
the baseline's number first, pause, then AgentTrust's. That beat carries slides 2, 4
and 5. Transitions: a 200 ms fade or none. No fly-ins, spins, bounces or zooms.

### Accessibility

- **Never colour alone.** Every orange/blue mark carries a word — *Baseline* /
  *AgentTrust* — and every status pill an icon and a word.
- **Grayscale test:** view the finished deck in grayscale. Any slide that stops making
  sense was relying on colour; add a label.
- Contrast: body text ≥ 4.5:1, graphics ≥ 3:1 — every token above already clears it.

### Check the finished deck against this

Before presenting, go through every slide once:

- [ ] Orange is the baseline and blue is AgentTrust **everywhere** — no slide swaps them
- [ ] Every coloured mark also has a word on it; every status pill has an icon and a word
- [ ] Viewed in **grayscale**, every slide still makes sense
- [ ] One hero figure per slide, and it is the largest thing on it
- [ ] No text below 14 pt; nothing printed in the orange or blue series colours
- [ ] Light theme only: the amber and green pills have their darker outlines
- [ ] A1 and A6 say **Mitigated**, never Blocked; A4 and A5 carry `by construction`
- [ ] The left pane of the demo is labelled as a deliberately vulnerable fixture
- [ ] Nothing from the *Avoid* list below made it in

### Avoid — these make a security talk look like a crypto advert

- Glowing coins, Bitcoin or Ethereum logos, isometric "blockchain cubes"
- Circuit-board, hexagon-mesh or falling "matrix code" backgrounds; neon gradients
- Padlocks on every slide; stock photos of humanoid robots
- Pie and donut charts, 3D charts, dual axes, rainbow palettes
- Gradients, photos or textures behind text; drop shadows; bevels
- Red for the baseline (see the one rule, above)

---

# Slide 1 — Agents are already paying each other

**Dominant figure:** `130,000,000`

**On-slide text**
- 130M all-time transactions on x402
- Embedded in Google Cloud, Cloudflare, Stripe
- 75.41M in 30 days *(x402.org, 22 Sep 2026)*

**Visual.** The figure **130,000,000** as a hero at ~120 pt, left-aligned in the
upper-left two-thirds, in the primary text colour — not a series colour. Beneath it, in
secondary text at 24 pt: *all-time x402 transactions*. On the right third, a small,
quiet diagram: two agent icons (Lucide `bot`) linked by a line with a coin (`coins`)
travelling between them — line icons only, 2 px stroke, no glow. The number is the
slide; the icons are a footnote to it.

**Build:** none. This slide should land in one beat.

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

**Visual.** Two stacked beats, each a hero pair.

- **Top:** `248` in **orange** and `1` in **blue**, at ~110 pt, joined by a thin arrow
  and labelled beneath in secondary text: *grants of the resource* → *on-chain
  settlement*. The gap in size between the two numbers is the whole argument.
- **Bottom:** `100 / 100` in **orange** at ~64 pt, labelled *paid for one endpoint, took
  another*.

A one-line source strip along the bottom in muted 14 pt: *arXiv 2605.11781 · arXiv
2605.30998 · Chainalysis 2022.*

**Why orange here even though it is not our fixture:** these numbers describe the
vulnerable systems, so they take the baseline colour. It trains the audience on the
colour rule before the demo, where it matters.

**Build:** reveal `248`, then the arrow and `1`.

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

**Visual.** Five rounded rectangles in a single left-to-right row across the middle
of the slide, joined by thin arrows. The **escrow** box is the only filled one — solid
**blue**, white label — because it is the thing being defended; the other four are
outlined in a hairline. Each arrow carries a small numbered step in secondary text:
**① quote · ② gate + fund · ③ deliver · ④ attest · ⑤ release.** A Lucide icon sits above
each box (`bot`, `server`, `vault`, `badge-check`, `database`).

Below the row, the three additions as three short columns, each headed by its icon:
**Gate** (`shield`), **Resource-bound escrow** (`link`), **Validation trigger**
(`badge-check`). Four or five words under each, no more.

**Build:** the row appears first; the three columns appear together on the second
click, as the speaker names them.

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

**Framing the video.** Put a thin **orange** bar (6 px) above the left pane and a thin
**blue** bar above the right, each with its label in white text on the bar:
**BASELINE — deliberately vulnerable fixture** and **AGENTTRUST**. The colour rule
does the explaining; nobody needs to read which side is which.

Below each pane, the counter as a hero figure at ~96 pt: **`50`** under the left,
**`1`** under the right, with *executions from one payment* in secondary text. If the
video's own counters are too small to read from the back of the room — they will be —
these overlays are what the audience actually reads.

**Build:** the video plays; the two hero counters appear when it ends.

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
| A1 revert-grant (reorg) | **Mitigated to reorg depth 3** (at confirmation policy k=3) |
| A2 replay | **Blocked (structural)** |
| A3 cross-resource substitution | **Blocked (structural)** |
| A4 concurrent duplication | **Blocked (structural)** |
| A5 allowance overdraft | **Blocked** — for the measured direction |
| A6 Sybil selection | **Mitigated** — ring refused; an earned reputation still admits |

Plus one line: *Testnet only, valueless tokens, our own services, published
vulnerabilities, no third-party targets.*

**Visual.** A two-part slide.

- **Left third:** `6 / 6` as a hero figure at ~120 pt in primary text, with *attacks
  evaluated* beneath. Under that, the split that matters, in two lines at 28 pt:
  **4 blocked · 2 bounded**.
- **Right two-thirds:** the coverage table as six rows. Attack name on the left in 20 pt;
  the **status pill** on the right (see *Status pills*). A4 and A5 carry the small
  muted `by construction` tag beside their green pill. The two **Mitigated** rows (A1,
  A6) each get a one-line bound in secondary text directly beneath:
  *a deeper reorg still wins* and *an earned reputation still admits*.
- **Highlight A6** with a thin blue left border on its row — it is the finding worth the
  audience's attention, and the speaker points to it.
- The ethics line sits along the bottom in muted 14 pt.

No zebra striping, no heavy table borders — hairline row dividers in the hairline token
and plenty of row height. The pills carry the colour; the table stays quiet.

**Build:** the hero `6 / 6` appears first, then the table.

**Speaker script (79 words)**
> "All six evaluated. Four blocked structurally, two bounded — a reorg deeper than our
> confirmation policy still wins, and a patient attacker who earns real feedback still
> gets past the gate. The gate finding is the one worth your time: the original design
> admitted all five Sybils and refused all ten honest newcomers. What none of it shows
> is whether the answer was good. As agents transact without us, the escrow has to be as
> automated as the payment."

---

# The measured results, in full

Six attacks, all evaluated. Four blocked, **two bounded** — and the bounds are part of
the result, not a footnote.

| | outcome | the number |
|---|---|---|
| **A1** revert-grant under reorg | Mitigated to depth 3 | k=3 holds at d≤3, fails at d=5 |
| **A2** replay | Blocked (structural) | 50→50 vs **50→1** |
| **A3** cross-resource substitution | Blocked (structural) | 100/100 vs **0/100** |
| **A4** concurrent duplication | Blocked (structural) | 50/50 rounds vs **0/150** |
| **A5** allowance overdraft | Blocked, measured direction | ρ 0.98 vs **0.00** |
| **A6** Sybil selection | Mitigated | v1 admits **5/5**, v2 admits **0/5** |

All on a local devnet (Anvil, chain 31337). **22 recorded runs**, each with a
committed manifest fixing the commit hash, tool versions, chain, block, parameters and
seed.

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

## Engineering evidence, if a slide or a question needs it

- **472 tests** across six packages, all passing: Solidity 154 + 6 invariants,
  shared core 87, seller 96, buyer 21, attack harness 32, validator 76
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

# Drawing the results — one visual per attack

For the backup "results detail" slides. Each result has a form that fits its shape, and
the wrong form hides the finding. **Where the number alone is the argument, show the
number** — a bar chart of two bars, or a pie of two slices, is a worse version of two
large figures.

Every chart: **one axis**, orange for the baseline and blue for AgentTrust, a word
label on every mark, hairline gridlines, and no chart junk.

**A1 — a staircase heatmap. The shape *is* the result.**
A 3 × 4 grid: rows are the confirmation policy (**k = 0, 1, 3**), columns the reorg
depth (**d = 1, 2, 3, 5**). Each cell is **blue** where the payment survived and
**orange** where it was lost, with its fraction printed inside in text (`0/20`,
`20/20`) so colour is never the only signal. The blue cells form a staircase that climbs
with k. Draw a thin line along the staircase edge and label it **"mitigated to depth
k"** — that edge is the entire finding, and the audience sees it before anyone explains
it. The k = 0 row is solid orange: serving without waiting loses the payment at every
depth.

**A2 — a hero pair, with an optional unit strip.**
`50 → 50` in orange against `50 → 1` in blue, labelled *executions from one payment*.
If there is room, a strip beneath: fifty small orange dots on the left, a single blue
dot on the right. Fifty against one, drawn as fifty against one, lands harder than any
axis.

**A3 — a hero pair, plus the control.**
`100 / 100` in orange against `0 / 100` in blue, labelled *substitutions served*. Then,
smaller but **not optional**: *false refusals: 0 / 100*. A server that refused
everything would also score zero — the control is what makes the zero mean "bound"
rather than "broken", so it must be on the slide.

**A4 — grouped bars, three pairs.**
Three groups for concurrency **10, 20, 50**; in each, an orange bar for the most
executions the baseline produced in a single round (**10, 20, 50**) and a blue bar for
AgentTrust's (**1**). The orange bars climb with concurrency, the blue ones never move.
Label the value on top of every bar. Caption, in secondary text: *blocked by construction
— there is no verify→settle window to race.*

**A5 — two stacked horizontal bars of 50 deliveries.**
Baseline: **1 settled** (solid orange) and **49 unsettled** (orange outline, hollow).
AgentTrust: **50 settled** (solid blue). Label ρ at the right end of each bar —
**0.98** and **0.00**. Solid versus hollow carries "paid versus unpaid" without a legend.
Caption: *the seller's exposure moves to validator liveness; it does not vanish.*

**A6 — a dot matrix. The most important chart in the deck.**
Three rows, one per gate: **no gate** (neutral grey), **v1 — the original design**
(orange), **v2 — AgentTrust** (blue). Each row is 25 dots in three labelled groups —
**10 honest · 5 Sybil · 10 newcomers** — with a thin bracket around the Sybil group in
every row. **Filled = admitted, hollow = refused.**

Read down the Sybil column and the finding is visible at once: filled, **filled**,
hollow. The original design's gate let every Sybil through and turned away every
newcomer. Annotate the v1 row directly: *admits 5 / 5 Sybils · refuses 10 / 10
newcomers.*

A small strip beneath for the patient attacker, three steps left to right: *earned
trusted feedback* → **admitted** ✓ · *started misbehaving* → **still admitted** ✓ ·
*clients revoked* → **refused** ✗. Title it *the gate reads reputation, not conduct*.

**Gas cliff (A6 detail, optional) — a single line.**
`fund()` gas against feedback entries, 1 to 26: a straight line climbing about 8,600 gas
per entry. At 28 it stops — draw a vertical marker labelled **unfundable past 26 entries**.
One series, one axis, no legend needed.

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
