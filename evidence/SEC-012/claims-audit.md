# SEC-012 — claims audit

Every public sentence that asserts something, checked against what was measured or
built. Walked 2026-09-24 over `README.md`, `docs/results.md`, `docs/LIMITATIONS.md`,
`docs/presentation-outline.md`, `docs/demo-script.md` and `docs/specs/*.md`.

There is no CV wording to audit yet (DOC-007 is P1 and not done) and no deck
(PRES-002 is blocked on ADMIN-002); the slide script stands in for the narration.

---

## 1. Numbers

Every measured figure was recomputed from the recorded runs rather than re-read.

| Claim | Where | Evidence | Verdict |
|---|---|---|---|
| 50 requests → 50 executions (fixture) | README, results.md, demo-script | `a2_replay-fixture-original-50x1`, median 50, IQR 0, range 50–50 over 10 runs | ✔ |
| 200 → 200 (fixture) | README, results.md | `a2_replay-fixture-original-200x200` | ✔ |
| 1 execution, every configuration (AgentTrust) | README, results.md, outline | all 6 AgentTrust A2 configurations, IQR 0 | ✔ |
| 3,460 of 3,950 replay attempts caused an extra execution | README, results.md | recomputed: `extra_executions_total` summed = 3,460; `runs × replays_per_run` summed = 3,950 | ✔ |
| 0 of 4,440 | README, results.md | recomputed: 0 and 4,440 | ✔ |
| 500 of 500 forged signatures served (fixture) | README, results.md | `a2_replay-fixture-forged-50x1` | ✔ |
| 100 of 100 substitutions (fixture), 0 of 100 (AgentTrust) | README, results.md, outline, LIMITATIONS | `a3_cross_resource-*-siblings-100` | ✔ |
| 0 false refusals, both targets | README, results.md | the A3 control | ✔ |
| 13 runs, one commit, none dirty | README, results.md | all 13 manifests: `gitCommit bd5b431d`, `dirty: false` | ✔ |
| whole paid job median 1090 ms | results.md | `evidence/EVAL-006/all-timings.ndjson`, 10 runs | ✔, and labelled devnet-only |
| 443 tests across six packages | task.md, README | 154 + 6, 87, 96, 21, 32, 73 — each run this session | ✔ |
| escrow line coverage 97.55% | task.md | `forge coverage` (CONTRACT-011) | ✔, unchanged |

### Cited, not measured here

| Figure | Where | Attribution | Verdict |
|---|---|---|---|
| 248 grants against 1 settlement | README, outline slide 2 | V-12, with both qualifiers spoken: strongest round, 1,000 concurrent, a **testnet** endpoint | ✔ attributed |
| 50 replays → 50 grants with no idempotency | README | V-13 | ✔ attributed |
| a signature not bound to the resource, 100/100 | README, outline | V-24 | ✔ attributed |
| 11 vulnerabilities in five classes | outline slide 2 | V-11, and stated as **one** paper's finding, not two | ✔ corrected |
| 130M all-time; Google Cloud, Cloudflare, Stripe | outline slide 1 | V-21, stated as the paper's claim | ✔ attributed |
| 75.41M in 30 days | outline slide 1 | V-74, with the as-of date spoken | ✔ attributed |
| $2bn bridge losses, 2022 | outline slide 2 | V-31 | ✔ attributed |
| 60.2% capture at r=5 | LIMITATIONS only | the A6 figure, labelled "not reproduced" and tied to an LLM discovery-ranking experiment | ✔ not used as a result |
| 725 → 50 million | **nowhere**, except a note saying why | V-22, UNRESOLVED | ✔ excluded |

**Zero unsupported numbers.**

## 2. Security claims

| Claim | Bound stated? | Verdict |
|---|---|---|
| A2 "Blocked (structural)" | yes — names the mechanism (atomic claim store keyed by `(chainId, escrow, jobId)` plus the payer-signed retry), and says it is not a proof and does not extend to attacks these runs did not attempt | ✔ |
| A3 "Blocked (structural)" | yes — the on-chain `resourceHash`; and the zero is explicitly said to mean "bound" only because the control succeeded 100/100 | ✔ |
| A1, A4, A5, A6 | reported "Not evaluated" with a reason each, in both results.md and LIMITATIONS | ✔ |
| Coverage | "2 of 6", denominator always present | ✔ |
| Reputation gate | stated as trust-anchored, with the cost stated: honest newcomers are refused by design | ✔ |
| Registry trust | live registries are upgradeable by a single key (V-97), stated as an assumption, not defended | ✔ |

## 3. The four phrasings that were most at risk

1. **"Not upstream x402."** The fixture label is a single exported constant
   (`FIXTURE_LABEL`), carried in the source, the logs, the HTTP responses, every
   manifest and the harness output. The blueprint's `target:vanilla` name still runs,
   and prints `VANILLA_CORRECTION` first. `--target vanilla` is rewritten to `fixture`
   before it can reach a manifest — checked: the smoke run's manifest says
   `"target": "fixture"`. ✔
2. **"Indistinguishable" (V-99a).** Used only of `getValidationStatus`, where a pending
   request and a 0 response genuinely are the same reading. `docs/specs/settlement.md`
   §3 states it that way, and DF-05's justification rests on it. ✔
3. **The novelty claim (V-143, DF-19).** The README says plainly that the x402
   specification already defines `auth-capture`, and that what differs is the reputation
   gate plus validator-attested release. The slide script makes **no** priority claim at
   all; slide 3's notes now carry the caveat so the answer is at the right slide, and the
   backup slides name ERC-8183 and `auth-capture`. ✔
4. **"Validator-escrowed delivery", not "proof of delivery" (DF-08).** No document uses
   "proof of delivery" except to reject it. The validator's own agent card states what it
   does **not** check — whether the answer is useful or worth the price — and a test
   asserts that sentence is present. ✔ **VAL-006 was not built**, and LIMITATIONS says so
   in the same paragraph that makes the delivery claim, so the claim and its gap travel
   together.

## 4. Fixed by this audit

- **Slide 3's notes had no novelty caveat.** It existed in the README and in the
  outline's delivery notes at the end, which is the wrong place to find it when an
  examiner asks during slide 3. Moved to the slide.

Nothing else required a change. One thing deliberately **not** changed: the phrase
"x402-compliant" appears in `http-protocol.md` and on the agent card, inside the sentence
*"Nothing here should be described as x402-compliant"*. A grep for the phrase flags it;
reading it shows it is the denial. A test previously asserted the string was absent and
was wrong to (REG-006).

## 5. Not covered

- The **deck** (PRES-002) does not exist yet. When it does, its text must be walked
  against this checklist — the script is audited, the slides are not.
- **DOC-007** (CV and interview wording) is P1 and not written.
- The **demo narration** is scripted here but not recorded (PRES-003).
