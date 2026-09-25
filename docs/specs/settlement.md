# SPEC-003 — Settlement, validation binding and the reputation gate

The money rules: what binds a validation to a job, when release is possible, when
refund is possible, and what the gate computes.

**Written from the implemented contract, not ahead of it.** CONTRACT-004/005/007/008
were built first, against the decisions in `docs/planning/design-findings.md`; this
document states the rules those contracts enforce and names the test that pins each
one. Where the contract and this document disagree, the contract and its tests are
authoritative and this file is the defect.

Source: `impl/contracts/src/AgentTrustEscrow.sol`. Tests: `test/Settlement.t.sol`,
`test/Refund.t.sol`, `test/Gate.t.sol`.

---

## 1. Constants

| Name | Value | Where |
|---|---|---|
| `PASS_THRESHOLD` | 100 | the only passing response; ERC-8004 allows 0–100 |
| `FEEDBACK_TAG` | `"agenttrust"` | the tag the gate reads and the buyer writes |
| `FEEDBACK_DECIMALS` | 2 | feedback values are in hundredths, so 9500 = 95.00 |
| `MAX_TTL_LIMIT` | 30 days | ceiling on the owner's `maxTtl` |
| `MAX_GRACE` | 30 days | ceiling on `grace`, checked in the constructor and the setter |
| `GAS_AFTER_READ` | 320,000 | gas reserved after the last reputation read, so `fund()` can finish |

`minTtl`, `maxTtl`, `grace`, `maxTrustedClients`, `reputationReadGas`,
`minDistinctFloor`, `minCountFloor` and `minAvgValueFloor` are owner-settable within
those ceilings. **No owner setting can move escrowed funds**, and none can reach a job
that is already funded — see §5.

## 2. Binding: one job, one `requestHash`

ERC-8004 request hashes are unique registry-wide and first-come, so a predictable hash
can be filed by anyone, for any agent, and burned (DF-06). The binding is therefore
salted and checked:

```
requestHash = keccak256(DOMAIN, chainid, escrow, jobId, resourceHash, salt)
```

`bindValidation(jobId, salt)` requires, in order:

1. the job is `Funded` — otherwise `UnknownJob` or `BadState`;
2. `msg.sender == job.payee` — otherwise `NotPayee`;
3. `job.requestHash == 0` — otherwise `AlreadyBound`;
4. the registry already holds that hash, with `validator == job.validator` and
   `agentId == job.payeeAgentId` — otherwise `RequestMismatch`.

So the payee files `validationRequest` on the registry **first**, then binds. A failed
binding consumes nothing: if someone squatted the hash, the payee files again under a
new salt and binds that one.

| Case | Outcome | Test |
|---|---|---|
| payee binds a properly filed request | bound, `ValidationBound` emitted | `test_BindingTiesOneRequestHashToTheJob` |
| anyone other than the payee binds | reverts `NotPayee` | `test_OnlyThePayeeMayBind` |
| payee binds a second time | reverts `AlreadyBound` | `test_BindingTwiceReverts` |
| binding before filing the request | reverts `RequestMismatch` | `test_BindingWithoutFilingTheRequestReverts` |
| request filed naming a different validator | reverts `RequestMismatch` | `test_BindingARequestWithTheWrongValidatorReverts` |
| hash squatted by a third party | payee re-files under a new salt and binds | `test_ASquattedHashForcesANewSaltAndStillBinds` |

## 3. The pass predicate

A job has a pass when **all** of these hold for its bound hash:

- the registry knows the hash (`getValidationStatus` does not revert "unknown");
- `validatorAddress == job.validator`;
- `agentId == job.payeeAgentId`;
- `response >= PASS_THRESHOLD` (that is, exactly 100);
- `lastUpdate <= job.deadline`.

`lastUpdate` is set by `validationRequest` as well as by `validationResponse`, so it
cannot distinguish pending from answered — the **response value** is what does that
(V-99). A job with no bound hash never passes.

### Reading the registry fails closed

`getValidationStatus` returns the validator-supplied `tag` and copies the whole struct
into memory to do it, so the read's cost is set by whoever wrote the tag: ~30k gas for
this project's 10-byte tag, ~14M at 200 KB. A caller supplying a modest gas limit could
make the sub-call run out of gas, have it caught as "no validation", and refund a job
holding a genuine pass — taking delivered, attested work for free. **That was
reproduced before the check existed.**

The two cases are distinguishable in the returndata: an out-of-gas sub-call returns
**zero** bytes; the registry's `require(…, "unknown")` returns a 100-byte
`Error(string)`. An empty revert is `ValidationReadFailed` and propagates. The read is
deliberately **uncapped** — a ceiling would convert "supply more gas" into "this job
can never be read again", stranding the money, and writing a large tag always costs its
author more than reading it costs anyone else.

## 4. Release and refund

### Snapshot

`confirmValidation(jobId)` records a pass into the job (`validationRecorded = true`) and
is permissionless. Once recorded, a later overwrite in the registry cannot take it
back (DF-15). `release()` snapshots implicitly if it has not happened yet, so the
separate call is only needed to freeze a pass that might be overwritten before anyone
settles.

### `release(jobId)`

Permissionless. Requires `Funded` and a pass — snapshotted, or recordable now.
**There is no deadline on this call** (DF-05): a seller that earned its money in time
is paid whenever someone calls, which is what lets the validator release immediately
after attesting. The payee is the address snapshotted at funding, not whoever owns the
agent now.

### `refund(jobId)`

Permissionless, and the money can only go to `job.payer`, so a third party calling it
gains nothing but the gas. Requires `Funded` and:

- `block.timestamp > job.deadline + job.grace` — otherwise `DeadlineNotReached`;
- no snapshotted pass — otherwise `ValidationExists`;
- no *recordable* pass either — a pass earned in time but never snapshotted still
  blocks the refund.

**There is no early refund on "fail."** A request that is merely pending reads as
response 0, exactly like a failing one, so an early-fail rule would let anyone refund
the moment the seller filed its request and take the service for free (DF-05, V-99).

| Case | Outcome | Test |
|---|---|---|
| snapshot a passing attestation | recorded, `ValidationRecorded` emitted | `test_ConfirmingSnapshotsAPassingAttestation` |
| snapshot with no pass | reverts `NotValidated` | `test_ConfirmingWithoutAPassReverts` |
| snapshot before binding | reverts `NotBound` | `test_ConfirmingBeforeBindingReverts` |
| release pays the payee snapshotted at funding | paid in full | `test_ReleasePaysTheSnapshottedPayee` |
| a stranger calls release | still pays the payee | `test_ReleaseIsPermissionlessAndStillPaysThePayee` |
| refund after grace returns the full amount | paid to the payer | `test_RefundReturnsTheMoneyToThePayerAfterGrace` |
| a stranger calls refund | still pays the payer | `test_RefundIsPermissionlessAndAlwaysPaysThePayer` |
| pass at the deadline, release an hour later | releases | `test_APassAtTheDeadlineStillReleasesAnHourLater` |
| attestation after the deadline | never releases | `test_AnAttestationAfterTheDeadlineNeverReleases` |
| overwrite after the snapshot | cannot un-release | `test_AnOverwriteAfterTheSnapshotCannotUnRelease` |
| overwrite before the snapshot | does lose the pass | `test_AnOverwriteBeforeTheSnapshotDoesLoseThePass` |
| release with no bound hash | reverts `NotBound` | `test_ReleaseIsImpossibleWithoutABoundHash` |
| attestation belonging to another job | does not release | `test_AnAttestationOnAnotherJobDoesNotRelease` |
| refund before `deadline + grace` | reverts `DeadlineNotReached` | `test_RefundBeforeDeadlinePlusGraceReverts` |
| refund after grace, nothing filed | refunds | `test_RefundWithNoValidationAtAllSucceeds` |
| refund after grace, request pending only | refunds | `test_RefundAfterAPendingOnlyRequestSucceeds` |
| refund after grace, failing or under-threshold response | refunds | `test_RefundAfterAFailingResponseSucceeds`, `test_RefundAfterAnUnderThresholdResponseSucceeds` |
| refund after grace, pass recorded late | refunds | `test_RefundAfterALatePassSucceeds` |
| refund with a timely pass, snapshotted or not | reverts `ValidationExists` | `test_RefundWithARecordedPassReverts`, `test_RefundWithAnUnrecordedButTimelyPassReverts` |
| refund after the registry flips a snapshotted pass | still blocked | `test_RefundBlockedByASnapshotEvenAfterTheRegistryFlips` |
| release and refund racing | the job leaves `Funded` exactly once | `test_AJobLeavesFundedExactlyOnce`, `testFuzz_EveryJobPaysExactlyOnePartyInFull` |
| settling twice | reverts `BadState` | `test_RefundingTwiceReverts` |
| settling an unknown job | reverts `UnknownJob` | `test_SettlementCallsOnAnUnknownJobRevert` |

## 5. TTL bounds, grace and what the owner cannot do

`fund()` requires `minTtl <= ttlSeconds <= maxTtl`, otherwise `TtlOutOfBounds`. Without
a floor, a buyer could set a one-second TTL, let the deadline pass and refund while
keeping the delivered result — free service (DF-22). The seller independently requires
a **deadline margin** large enough for attestation plus grace before it will deliver
(SPEC-002 §7).

**`grace` is snapshotted into the job at funding.** No setter can reach a funded job:
shortening it cannot open the refund valve early, and lengthening it — including a
`uint64` overflow — cannot freeze an existing job permanently.

| Case | Outcome | Test |
|---|---|---|
| owner shortens grace after funding | the funded job keeps its own | `test_ShorteningGraceDoesNotOpenTheValveOnAFundedJob` |
| owner sets an enormous grace | existing jobs unaffected; `GraceOutOfBounds` above `MAX_GRACE` | `test_ALargeGraceCannotFreezeAnExistingJob` |
| non-owner sets grace | reverts | `test_OnlyTheOwnerSetsGrace` |

## 6. The gate

`fund()` calls `_enforceGate(agentId, gate)` before any money moves. The buyer supplies
`trustedClients` — the attesters it is willing to believe — and thresholds. The
contract reads `getSummary(agentId, [client], FEEDBACK_TAG)` **once per client**.

For each client with `count > 0`:

- `distinct += 1`;
- `totalCount += count`;
- the client's average is normalised to 18 decimals and weighted by its `count`.

Then, with each threshold taken as `max(buyer's value, owner's floor)`:

- `distinct >= minDistinct`, else `ReputationTooLow(Distinct, …)`;
- `totalCount >= minCount`, else `ReputationTooLow(Count, …)`;
- `weightedAverage >= minAvgValue`, else `ReputationTooLow(Average, …)`.

Why trust-anchored rather than counting distinct addresses: five cross-endorsing Sybils
satisfy "distinct ≥ 3, count ≥ 5" for free, because distinct addresses are not
independent parties (DF-09). Naming the attesters moves the trust decision to the buyer,
where it belongs.

Bounds and hygiene:

- `trustedClients.length <= maxTrustedClients`, else `TooManyTrustedClients` — the loop
  must stay bounded;
- a zero address reverts `ZeroTrustedClient`;
- a repeated address reverts `DuplicateTrustedClient` — **rejected, not deduplicated**,
  because repeating one address would otherwise lift `distinct` past an owner floor for
  free;
- before each read, `gasleft()` must exceed `reputationReadGas * 64/63 + GAS_AFTER_READ`,
  else `InsufficientGasForReputationRead`. `getSummary` loops over the agent's whole
  history, so its cost grows without bound; EIP-150 forwards only 63/64 of the remaining
  gas, so without this a starved read could revert inside the `try` and be mistaken for
  "no feedback" — skipping the gate.
- `totalCount == 0` with a positive average threshold reverts rather than passing
  vacuously. `minCountFloor` is deployed at 1 for that reason.

Integer division truncates towards zero, so a negative average is reported very slightly
**high** — at most one hundredth of a point, favouring the seller. Noted rather than
corrected: it is below the resolution the gate is meaningfully set at.

| Case | Outcome | Test |
|---|---|---|
| trusted feedback present | passes | `test_AgentWithTrustedFeedbackPasses` |
| same agent, feedback only from strangers | refused | `test_TheSameAgentFailsWhenTheFeedbackIsFromStrangers` |
| five cross-endorsing Sybils | refused | `test_CrossEndorsingSybilsDoNotHelp` |
| averages with different `decimals` | normalised before weighting | `test_DifferentValueDecimalsAreNormalised` |
| average weighted by entry count | weighted, not a mean of means | `test_AverageIsWeightedByEntryCount` |
| feedback under another tag, or revoked | does not count | `test_FeedbackUnderAnotherTagDoesNotCount`, `test_RevokedFeedbackDoesNotCount` |
| duplicate / zero / over-long client list | reverts | `test_DuplicateTrustedClientReverts`, `test_ZeroTrustedClientReverts`, `test_OverLongClientListReverts` |
| buyer asks for less than the owner floor | the floor wins | `test_ABuyerCannotAskForLessThanTheOwnerFloor` |
| buyer stricter than the floor | the buyer wins | `test_ABuyerMayBeStricterThanTheFloor` |
| very long feedback history | funding still succeeds | `test_AHugeHistoryDoesNotPreventFunding` |
| caller starves the reads of gas | reverts instead of skipping the gate | `test_StarvingTheReadsOfGasRevertsInsteadOfSkippingTheGate` |
| the tag the gate reads | matches `FEEDBACK_TAG` on the contract | `test_TagMatchesTheContract` |
| which dimension failed | named in the revert | `test_CountDimensionIsReported`, `test_AverageDimensionIsReported` |
| negative feedback | can fail the gate | `test_NegativeFeedbackCanFailTheGate` |
| non-owner sets floors or the read ceiling | reverts | `test_OnlyTheOwnerSetsFloorsAndTheReadCeiling` |
| read ceiling set below the floor, or deployed too small | reverts | `test_TheOwnerCannotSetTheReadCeilingBelowTheFloor`, `test_DeployingWithTooSmallAReadCeilingReverts` |
| gas against history length | measured, not asserted | `test_GasAgainstHistoryLength` |

**The blueprint's gate v1** — "≥ 3 distinct attesters, ≥ 5 entries" computed from the
registry alone — cannot be evaluated on the real ERC-8004 ABI: `getSummary` returns no
distinct-attester count (DF-09). It survives only as a mock-only comparison model for
the A6 evaluation, which is EXTENDED-E2 and **was not run**.

## 6a. Every deadline is a chain timestamp

`deadline`, `grace`, the attestation's `lastUpdate` and the delivery signature's
`expiry` are all **chain** timestamps. The escrow writes `deadline` from
`block.timestamp` at funding, and `release()` compares `lastUpdate <= deadline` in that
same clock. **Nothing may compare one of them against a local clock.**

This is not a style rule. The two clocks are only incidentally related, and the failure
is silent in both directions:

- **chain behind the local clock** — a component believes a window has closed while it
  is still open. The validator refuses to attest, or the seller refuses a valid
  signature, and delivered work goes unpaid.
- **chain ahead** — a component believes there is time left when the deadline has
  passed on-chain. The validator posts an attestation the escrow rejects as late. The
  work still goes unpaid.

Either way **the seller pays**, and on a real chain the drift is small enough that it
misfires rarely and unreproducibly.

Five instances of this were found and fixed (2026-09-23 and 2026-09-25): the seller's
deadline margin, the seller's signature-expiry check, the validator's attestation
deadline, the validator's binding wait — and, instructively, **two in test code**: the
fixture that built signatures from `Date.now()`, and the test asserting a signature was
"already expired" using a wall-clock value that was a thousand seconds in the chain's
future. The test-side ones could not catch the production ones, because they shared the
defect.

They were invisible while the clocks agreed. What exposed them was a devnet whose chain
ran **1070 s behind** wall time after `anvil_reorg` rewound its timestamps.

The one deliberate exception is the seller's *pre-filter* at SPEC-002 §7 step 4. It runs
before any chain read, so it can only use a local clock; it is therefore given a
`MAX_CLOCK_SKEW_SECONDS` allowance and may only reject signatures that are stale beyond
any plausible drift. The authoritative comparison happens at step 11, in chain time.

## 7. What this does not cover

- **Feedback lifecycle** — who writes feedback, with what value and URI — is SPEC-004
  (CORE-P1). The escrow never routes feedback; the buyer writes it directly (DF-21).
- **The quote and delivery protocol** is `http-protocol.md` (SPEC-002).
- **Hash derivation and the cross-language vectors** are `canonical-hash.md` (SPEC-001).
- **Live registries.** Everything above is enforced against same-ABI mocks. The
  deployed registries are upgradeable by a single key (V-97), so a malicious upgrade
  could forge an attestation; that is a stated trust assumption, not a defended case.
