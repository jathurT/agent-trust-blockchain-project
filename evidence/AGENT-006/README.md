# AGENT-006 — buyer CLI and demo commands

Run 2026-09-24 against Anvil (chain 31337) at `deployments/31337.json`, with the
AgentTrust stack from `npm run target:agenttrust` (seller 4022, Python validator 8099)
and the labelled vulnerable fixture from `npm run target:vanilla` (4021).

| File | What it shows |
|---|---|
| `target-agenttrust.log` | the stack starting, and the live counter line the video crops to |
| `target-vanilla.log` | the §18 name accepted, the correction printed first, the fixture label, the fixture's grants/settlements counter |
| `buy.log` | three purchases: one executed, one re-run refused after settlement, one for a different resource |
| `status.log` | the job read back from the escrow after release |
| `refund.log` | the refund refused on a released job |
| `attack-alias.log` | `--target vanilla` corrected to `fixture` before it reaches the manifest |
| `gas-failure.log` | `cast receipt` and `cast run` for the out-of-gas `validationResponse` |
| `smoke-run-a2_replay-fixture-original-3x1-1790215302248/` | the run that alias produced, moved **out** of `impl/attacks/results/` so it cannot enter the report |

## The counters

From `target-agenttrust.log`, one purchase then one retry of the same request while the
job was still funded:

```
  AGENTTRUST   executions:   1  |  2xx:   2  |  replays served:   1
```

That is the acceptance criterion: the output distinguishes executions from 2xx
responses. One payment, one execution, two callers served.

## Two defects this task found

**1. The validator sent transactions with no gas headroom (fixed).**
`build_transaction` filled `gas` straight from `eth_estimateGas`, which returns the
minimum that succeeded against the pending state. `validationResponse` writes
`lastUpdate = block.timestamp`, so that one SSTORE costs 100 gas when the estimate is
taken in the same second as the stored value and 2,900 when it is not. The estimate was
then exactly too small:

```
  [101529] 0x9fE4…::validationResponse(0xed2f0ab8…, 100, "evidence://72ae6271…", …)
    └─ ← [OutOfGas] EvmError: OutOfGas
```

Anvil block 88, tx `0x03ce3487…d85d58d`, gas used 125,849 of a 125,849 limit. The full
receipt and trace are in `gas-failure.log`; the hash is abbreviated here because the
secret-scan hook blocks a bare 32-byte hex in a hand-written file, and it is right to —
that is where a pasted key would land. The attestation failed silently: the seller had
delivered, the work was done, and the payment stayed locked until the refund window.
Fixed by estimating explicitly and applying `GAS_ESTIMATE_BUFFER = 1.5`
(`impl/validator/src/agenttrust_validator/chain.py`), pinned by
`impl/validator/tests/test_gas.py`. After the fix the same job released:

```
{"passed":true,"reason":"recomputed output matches the delivered bytes",
 "responseTx":"491f10f9…","releaseTx":"59ea7f5d…"}
```

This was timing-dependent, so INT-001 could pass while it was present. Re-running
`bash impl/scripts/e2e-happy.sh` is the check that it stays fixed.

**2. A smoke run could have walked into the published results (fixed).**
`npm run attack` writes into `impl/attacks/results/`, and `aggregate.ts` read every
directory it found. The three-replay run in this directory would have joined the
reported totals. Its manifest already said `dirty: true`; `load()` now skips such runs
and says so on stderr. All 13 frozen runs are clean, so `report.sh --check` is
unchanged — verified before and after.

## Not covered here

`npm run attack` was not re-run for a full measurement. The A2 and A3 results are
frozen at commit `bd5b431d` and this task changes nothing that they depend on.
