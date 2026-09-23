G3b gate check — PASS
=====================
date:   2026-09-23T09:10:02Z
commit: 606c575322e1096930ba3224fa1ca9cfc34ef37c
chain:  anvil 31337 at block 1109

| criterion                                  | result |
|--------------------------------------------|--------|
| validator path                             | 64 pytest tests |
| release end to end, locally                | INT-001 ok: buyer -250000, payee +250000, attestation 100 |
| refund end to end, locally                 | INT-002 ok: no-attestation and failing-attestation both refund; a timely pass is refused |
| Python vectors pass                        | 34 of 34, first run |

== suites ==
| package | tests |
|---|---|
| impl/contracts (Solidity) | 154 + 6 invariants |
| impl/packages/core | 87 |
| impl/agents/seller | 76 |
| impl/agents/buyer | 8 |
| impl/attacks | 10 |
| impl/validator (Python) | 64 |
| **total** | **399** |

## A real bug the gate check found

The first G3b run failed one seller test: a job with too little time left was served
instead of refused. The cause was not the test. The seller measured the deadline margin
as `job.deadline - Date.now()/1000` — a **chain-written deadline minus a local clock**,
which is the wrong subtraction. INT-002's `evm_increaseTime` had moved the chain an hour
ahead of the wall clock and made the two disagree loudly; on a real chain they differ by
seconds, and the error **fails open**: a seller whose clock lags the chain believes there
is more time left than there is, and delivers work it cannot get attested.

`ChainClient.blockTimestamp()` was added and `verifyRequest` now uses it. A test warps
the chain forward without touching the local clock and asserts the seller notices, which
a wall-clock implementation would not.

## What this does and does not show

It shows the whole path works on a local chain: quote, gate, fund, deliver, deposit the
artefact with the validator, file and bind the validation request, attest independently
in Python, release — and the two refund routes when that does not happen.

It shows nothing about **Base Sepolia**: nothing is deployed to a public chain and no
transaction has been sent there. It is **not** the A2/A3 evaluation either — that is
G3a's SEC-002/003/004, which runs the attacks against the labelled fixture and against
AgentTrust and reports both with a run manifest. Every number here is an acceptance test.
