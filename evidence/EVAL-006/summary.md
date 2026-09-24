runs: 10

| Stage | What happens | median | min | max | n |
|---|---|---:|---:|---:|---:|
| `services_up` → `purchase_begin` | harness idle before the purchase | 8 ms | 7 ms | 11 ms | 10 |
| `purchase_begin` → `delivered` | quote, gate, fund, signed retry, delivery | 778 ms | 408 ms | 796 ms | 10 |
| `delivered` → `validator_decided` | evidence deposit, binding, attestation | 512 ms | 261 ms | 519 ms | 10 |
| `validator_decided` → `released` | release transaction | 4 ms | 3 ms | 9 ms | 10 |
| `purchase_begin` → `verified` | whole paid job, end to end | 1090 ms | 933 ms | 1336 ms | 10 |

`validator_decided` → `released` is small because it is not the release latency: the validator calls `release()` itself immediately after attesting (DF-15), so by the time the buyer polls, the transaction is already mined. That span measures the buyer noticing, not the chain settling — the release itself is inside `delivered` → `validator_decided`.
