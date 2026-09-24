# EVAL-001 — the frozen measurement protocol, and whether the runs followed it

The protocol is `evaluation-plan.md` §5–§6, written in the planning phase on
2026-09-22, **before any measurement existed**. That is the pre-registration EVAL-001
asks for, and it is not restated here.

What was missing was the other half: a check that the runs actually obeyed it. This
document is that check, performed on 2026-09-24 against the 13 recorded runs in
`impl/attacks/results/` (all at commit `bd5b431d`, all `dirty: false`).

**Deviations are listed, not corrected after the fact.** Nothing below re-ran a
measurement or changed a recorded number.

---

## Conformance

| §6 requirement | Recorded runs | Verdict |
|---|---|---|
| N ≥ 10 runs per (attack × target × configuration) for MVP attacks | A2: 11 configurations, `runs = 10` in every one | ✔ |
| A3: 100 rounds per direction (§5) | both targets, `rounds = 100` | ✔ |
| Seeds fixed and recorded | `seed = 1` in all 13 manifests; the harness derives its body text from a seeded PRNG | ✔ |
| Wilson 95% interval for proportions | reported for replay success and substitution rate | ✔ |
| Median for counts | reported | ✔ |
| IQR, min and max for counts | **was missing**; added from the same recorded runs, no re-run | ✔ *(corrected 2026-09-24)* |
| Bootstrap 95% interval for latency medians | no latency headline is reported from these runs | n/a |
| One target per run | one target process per invocation | ✔ |
| Never report a single run as a headline number | every headline is over 10 runs or 100 rounds | ✔ |

## Deviations

**D1 — no warm-up run was discarded.** §6 says "One warm-up run per configuration is
discarded and recorded as such." It was not done and not recorded, so run 1 of each
configuration carries whatever cold-start cost exists.

*Effect on the published numbers: none that can be argued.* The reported metrics are
counts — executions, distinct results, 2xx responses, substitutions — and a cold cache
does not change whether work was executed. It would matter for latency, which these
runs do not report. The measured dispersion is zero in every configuration, including
run 1, which is what one would expect if there were no warm-up effect; that is
consistent with the deviation being harmless, not proof of it.

**D2 — isolation is per job, not per run.** §6 says "the claim store, the chain state
and the registries are reset between runs". In practice the harness starts one target
process per invocation and executes all ten runs inside it, so the claim store persists
across runs within a configuration, and the chain and registries are never reset at all.

*Effect on the published numbers: none.* Claim-store counters are keyed by
`(chainId, escrow, jobId)` and every run funds a fresh job under a fresh payer nonce, so
one run's rows cannot be read by another. The A2 counters are read per ticket, not in
aggregate. But the protocol text describes a stronger reset than the code performs, and
a reader comparing the two would be right to object, so the text is wrong and the code
is what happened.

**D3 — the protocol was pre-registered but never checked until now.** Freezing
parameters is only half of what EVAL-001 promised; nothing verified that a later run
used them. This document plus the manifest's `params` block is that check, and it is
repeatable: every parameter §6 constrains is recorded in each manifest.

## Changes that would require a re-run

Any change to `runs`, `rounds`, `replays`, `concurrency`, `seed`, `variant`,
`replayPolicy` or `sellerProcesses` — all of which are recorded per run in
`manifest.json` — invalidates the affected configuration and requires re-running it.
Adding a *derived* statistic over recorded data, as the IQR correction above did, does
not.
