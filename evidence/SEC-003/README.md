# SEC-003 — A2 replay

Eleven configurations, ten runs each, against both targets. Each subdirectory is one
configuration and holds `manifest.json` (commit, tool versions, chain, block, parameters,
seed), `results.json` (the aggregated counters and intervals) and `raw.ndjson` (one line
per run, before any aggregation).

## Reading the counters

**`executions_completed` is the metric.** It is read from each system's own records — the
claim store for AgentTrust, the grant log for the fixture — never inferred from HTTP
status codes. Under `REPLAY_POLICY=idempotent` a replay is *supposed* to return 200 with
the stored bytes to the authenticated payer, so counting 2xx as failures would be as
wrong as counting them as successes.

**`replays_per_run` is `requests_per_run − 1`.** Of the N requests fired after a single
payment, the first is the payer legitimately using what it bought; only the remaining
N−1 are replays. Counting the first would flatter the baseline.

**`unauthorized_2xx`** counts responses served to a caller with no valid payer signature.
It is zero by construction for the `original` variant, where the payer itself is asking.

## Variants

| variant | what it asks |
|---|---|
| `original` | the payer's own header, replayed — can one payment buy the work twice? |
| `none` | no header at all, just a public `jobId` — does the target require anything? |
| `foreign` | a correctly formed header signed by someone else — is the *payer* checked? |
| `forged` | the payer's header with garbage signature bytes — is the signature checked at all? |

## The baseline is a fixture

The `fixture` target is a deliberately vulnerable server written for this evaluation
(`impl/attacks/src/vulnerable-server.ts`). It is **not** upstream x402, **not** the
`@x402/*` packages, and **not** evidence about anyone else's implementation. Its label
travels in every manifest.
