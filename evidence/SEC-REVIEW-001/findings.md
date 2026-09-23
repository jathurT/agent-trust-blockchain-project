# Security review — escrow payment path (CONTRACT-004/005/007/008)

Run 2026-09-23 under CLAUDE.md §6, which requires an independent `security-eval` review
of every contract change before it is marked DONE. The reviewer worked read-only against
commit `beb3214`, wrote 20 probe tests in a scratch Foundry project, and reproduced the
findings marked CONFIRMED rather than reasoning about them.

Every CONFIRMED finding below was **independently re-verified in this repository** before
being acted on. The HIGH one was reproduced here first: `refund{gas: 5_000_000}` on a job
holding a genuine passing attestation paid the buyer 250,000 atomic units and set the job
to `Refunded`.

## Fixed in this change

| # | Sev | Finding | Fix | Test |
|---|---|---|---|---|
| 1 | **HIGH** | `refund()` was **fail-open** on a validation read that ran out of gas. `getValidationStatus` returns the validator-supplied `tag`, and the registry copies the whole struct to memory, so the read costs what the tag's author chose — ~30k for this project's tag, ~14M at 200 KB. The wrapper caught *every* failure as "no validation", so a caller capping gas could refund a delivered, attested job. Reproduced both by the reviewer and here | An out-of-gas sub-call returns **0 bytes**; the registry's `require(…,"unknown")` returns a 100-byte `Error(string)`. The ambiguous case now reverts `ValidationReadFailed`. Deliberately **no gas cap**: the cost is incurred inside the registry either way, and a cap would turn "supply more gas" into "this job can never be read", stranding the money | `test_StarvingTheValidationReadCannotRefundAnAttestedJob`, `test_TheSameJobStillReadsCorrectlyWithEnoughGas`, `test_AGenuinelyUnknownRequestStillReadsAsNoValidation` |
| 2 | MEDIUM | The agent's **payout wallet could be its own validator**. `isAuthorizedOrOwner` misses it, because once `setAgentWallet` is used the wallet is neither owner nor operator — so bind, attest 100, release, with no independent party anywhere | `_requireAcceptableValidator` also rejects `validator == payee` | `test_TheAgentsPayoutWalletCannotBeItsOwnValidator` |
| 3 | MEDIUM | `setGrace` was the **one owner setter that reached an already-funded job**: set it to 0 and a job about to be attested refunds; set it to `type(uint64).max` and `deadline + grace` overflows so `refund()` reverts for every job — permanently, since `renounceOwnership` is one step | Each job **freezes `grace` at funding time**, the setter is forward-looking only, and it is bounded by `MAX_GRACE` (30 days) | `test_ShorteningGraceDoesNotOpenTheValveOnAFundedJob`, `test_ALargeGraceCannotFreezeAnExistingJob` |
| 4 | MEDIUM | A validator-sized `tag` makes `release()` and the views cost 14–30M gas, so services polling them read "not validated" | Same root cause as #1; the behaviour is now correct at any gas level that can complete the read, and the cost is a documented limitation rather than a silent failure | covered by #1's tests |
| 5 | LOW | A **successful** read carrying `valueDecimals > 18` underflowed `18 - decimals` *outside* the try/catch, panicking and making the agent unfundable by anyone | `_readSummary` treats an out-of-range `decimals` as no data | `test_AMalformedReputationAnswerDoesNotBrickFunding` |
| 6 | LOW | The `totalCount == 0` comment claimed only "a policy that asks for nothing" reaches it; `minAvgValue = 0` is a real threshold | Comment corrected; `minCountFloor` deployed at 1 | — |
| 7 | LOW | The truncation comment had the direction **backwards** — a negative average is reported high, which favours the seller, not the buyer | Comment corrected, with the reachability note | — |
| 8 | LOW | A fresh deployment left every gate floor at 0, so the reputation gate was **off** until someone sent a second transaction — which would have made any A6 result unreproducible | `Deploy.s.sol` sets the floors inside the broadcast and serialises them; `deploy.sh` prints them in the smoke check | `deployments/*.json`, `evidence/CONTRACT-017/` |
| 9 | LOW | `GAS_AFTER_READ` was documented as fund's tail but was ~3× too small (measured 290k, set 100k) | Raised to 320,000 with the measurement recorded. Does **not** open the gate bypass either way | — |

Also fixed while in the area: `_recordPass` performed a **second** `_readValidation` purely
to fill the event, doubling the exposure of #1. `_isPassing` now returns the attestation
with the verdict, so each settlement reads once.

## Recorded, not fixed

| # | Finding | Disposition |
|---|---|---|
| 10 | The salt does not bound `requestHash` squatting: it is public from the moment the payee broadcasts `validationRequest`, so a mempool-watching adversary can squat every retry for ~171k gas each | No contract fix exists — the escrow cannot file the request without operator rights, which DF-06 forbids. **DF-06's residual-risk wording corrected**; the mitigations are a seller-side retry budget folded into SPEC-002's `minDeadlineMargin`. The mempool race itself is UNRESOLVED: reasoned about and the on-chain half reproduced, but confirming it needs a live node |
| 11 | A timely pass nobody snapshotted can be revoked after the deadline | DF-05's known residual, already pinned by `test_AnOverwriteBeforeTheSnapshotDoesLoseThePass`. **DF-05 sharpened**: the seller cannot snapshot before the validator responds, so DF-15's "release immediately" is load-bearing, not an optimisation. DOC-004 |
| — | Blacklisted or paused payee strands funds | DF-16, already accepted; pull-payment is STRETCH-008 |
| — | `payer == payee` self-dealing costs gas only and cannot mint reputation | Accepted; EVAL must exclude self-funded jobs from any completed-jobs count |

## Checked and found sound

Every path out of `Funded` (only two writers, both `nonReentrant`, both effects-before-transfer,
mutually exclusive by construction); double payment unreachable; the registry interfaces are
all `view` so Solidity emits `STATICCALL` and an upgraded registry can lie but not re-enter;
both gate gas-starvation defences genuinely closed, with the per-iteration `gasleft()` check
forcing the callee to receive the full ceiling; gate arithmetic including duplicate rejection,
entry weighting, overflow headroom and negative floors; `bindValidation` unsubvertible beyond
#2 and #10; NFT transfer between fund and bind degrades to a refund rather than paying the
wrong party; all six setters read only inside `fund()` except `setGrace` (#3); `SafeERC20`
throughout with a strict-equality balance delta; payer-scoped nonce burned atomically.

## Process note

The reviewer observed a mutation (`job.state = State.Released;` deleted) in the working tree
mid-review. That was this session's CONTRACT-013 mutation testing running against the same
file the reviewer was reading, and it was restored within a minute — but CLAUDE.md §6 says one
writer per area per session, and mutation testing writes. Mutations must be run against a copy,
or while no review is in flight.
