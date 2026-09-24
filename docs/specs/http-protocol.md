# SPEC-002 — HTTP protocol: quote, payer-signed retry, delivery claim, confirmations

Normative for the seller (API-001…005), the buyer (AGENT-002) and the harness (SEC-002).
Where this document and `task.md` §6.5 disagree, **this document wins**: §6.5 was written
from the v2 summary in V-62, and re-checking the envelopes against the specification at
SPEC-002 time (V-142) showed two of the three were described one level too deep.

Companion specs: canonical hashing is [SPEC-001](canonical-hash.md); settlement and the
reputation gate are SPEC-003. Shared vectors: `impl/vectors/canonical-v1.json`.

---

## 1. What this protocol is, and what it is not

AgentTrust speaks the **x402 v2 wire format** — the same three headers, the same envelopes,
the same CAIP-2 network identifiers — with a **project-specific scheme**,
`agenttrust-escrow`.

> **Interoperability statement (quote this verbatim; DF-03).**
> AgentTrust uses the x402 v2 wire format with a project-specific scheme,
> `agenttrust-escrow`. It is **not interoperable** with stock x402 clients, servers or
> facilitators: a client that does not implement this scheme cannot pay an AgentTrust
> seller, and an AgentTrust buyer cannot pay a stock x402 server. Nothing here should be
> described as "x402-compliant".

Two consequences that are easy to get wrong:

- **No stock middleware on a paid route.** `paymentMiddleware` from `@x402/express`
  performs its own settlement. Mounted alongside this protocol it would charge the buyer
  a second time — once through the escrow and once through the middleware (DF-03). The
  paid routes must not be wrapped by it, and API-002's tests assert no settlement call
  is reachable from the request path.
- **No facilitator.** There is no `/verify` or `/settle` round trip. The chain is the
  facilitator: the seller reads `jobs(jobId)` directly.

The `exact`, `upto`, `batch-settlement` and `auth-capture` schemes are not implemented.
`auth-capture` is worth naming because it is close prior art — the x402 specification
already defines an escrow flow with a capture deadline and a refund deadline (V-143). The
difference here is the **reputation gate at funding time** and **release against a
validator attestation**, not the existence of an escrow.

---

## 2. Endpoints

| Route | Paid | Purpose |
|---|---|---|
| `GET /health` | no | liveness; no chain access |
| `GET /.well-known/agent-card` | no | the ERC-8004 agent card this seller publishes |
| `GET /` | no | human-readable help, carrying the interoperability statement above |
| `POST /v1/summarise` | **yes** | deterministic transform |
| `POST /v1/classify` | **yes** | deterministic transform, **priced identically** |

The two paid routes cost exactly the same on purpose. Equal price is what makes the A3
substitution attack meaningful: if the prices differed, a mismatch could be caught by the
amount alone and the test would prove nothing about resource binding (SEC-004).

Paid routes are deterministic: no randomness, no clock, no network, no model. The same
request body always produces byte-identical output, because the validator has to
recompute it independently (DF-08).

---

## 3. The unpaid request → 402

The seller answers any unauthenticated request to a paid route with `402 Payment Required`.

### 3.1 Headers

```
HTTP/1.1 402 Payment Required
PAYMENT-REQUIRED: <base64(JSON PaymentRequired)>
Content-Type: application/json
Cache-Control: no-store
Vary: PAYMENT-SIGNATURE, Accept-Encoding
```

`Cache-Control: no-store` is required on **every** response the seller sends — paid
route or not, 402 and 200 alike. A cached 200 is a delivered result served without a
payment, which is the HTTP/proxy cache-confusion class the x402 vulnerability paper
lists separately from A1–A6.

`Vary: PAYMENT-SIGNATURE, Accept-Encoding` is required alongside it (API-007). `no-store`
is the instruction; `Vary` is the fallback for anything that ignores it. A paid response
is a function of the payment header, so a cache keyed on the URL alone could hand one
payer's bytes to another. `Accept-Encoding` is there because a shared cache that
normalises encodings would otherwise key two different bodies together. A 402 carries
both too: a quote names a payee and a deadline, and a cached quote is a stale payee.

### 3.2 Body and header payload

Both carry the same **PaymentRequired** object. The header is the machine copy; the body
is so a human with `curl` can read it.

```json
{
  "x402Version": 2,
  "error": "No PAYMENT-SIGNATURE header provided",
  "resource": {
    "url": "https://seller.agenttrust.test/v1/summarise",
    "description": "Deterministic extractive summary",
    "mimeType": "application/json"
  },
  "accepts": [
    {
      "scheme": "agenttrust-escrow",
      "network": "eip155:84532",
      "amount": "250000",
      "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      "payTo": "0x…",
      "maxTimeoutSeconds": 600,
      "extra": {
        "paymentFlow": "escrow",
        "escrow": "0x…",
        "sellerAgentId": "0",
        "acceptedValidators": ["0x…"],
        "minDeadlineMargin": 180,
        "canonicalVersion": "canonical-v1",
        "quoteId": "0x…",
        "expiry": 1790000600
      }
    }
  ],
  "extensions": {}
}
```

Field notes, in the order a reader will question them:

| Field | Rule |
|---|---|
| `amount` | **atomic units, as a decimal string.** USDC has 6 decimals, so 250000 is 0.25 USDC. Never a float, never a display string |
| `asset` | the ERC-20 address, checksummed. It is part of `resourceHash`, so a buyer paying in a different token derives a different job |
| `payTo` | the **registry-resolved payee**: `getAgentWallet(sellerAgentId)`, falling back to `ownerOf` when that is zero (DF-12). Never a value typed into configuration, so it cannot drift from what the escrow will snapshot |
| `maxTimeoutSeconds` | the TTL the seller wants the buyer to pass to `fund()`. It must lie inside the escrow's on-chain `[minTtl, maxTtl]` |
| `extra.paymentFlow` | `"escrow"` — a value the v2 spec reserves and other escrow schemes already use (V-142) |
| `extra.minDeadlineMargin` | seconds. The seller refuses to deliver a job whose deadline is nearer than this; see §7 |
| `extra.acceptedValidators` | validators the seller will work with. The buyer picks one **it** trusts from this set; that intersection is where validator independence actually comes from (DF-06) |
| `extra.quoteId` | `keccak256` of the canonical request plus price and expiry. Advisory only — **it authenticates nothing** until the EIP-712 signed quote lands in E1 (SPEC-002b/CONTRACT-006). Until then the binding that matters is the on-chain `resourceHash`, which `fund()` computes itself |
| `extra.expiry` | unix seconds after which the price may change. Advisory, for the same reason |

A 402 is **read-only**: it touches no database and takes no claim.

---

## 4. The paid retry

The buyer funds on-chain, waits for confirmations, then repeats the **byte-identical**
request with one extra header.

```
POST /v1/summarise
PAYMENT-SIGNATURE: <base64(JSON PaymentPayload)>
Content-Type: application/json

<the same raw bytes as the 402 attempt>
```

```json
{
  "x402Version": 2,
  "resource": { "url": "https://seller.agenttrust.test/v1/summarise", "mimeType": "application/json" },
  "accepted": { "scheme": "agenttrust-escrow", "network": "eip155:84532", "amount": "250000", "asset": "0x…", "payTo": "0x…", "maxTimeoutSeconds": 600, "extra": { … } },
  "payload": {
    "jobId": "0x…",
    "fundTxHash": "0x…",
    "deliveryRequest": { "expiry": 1790000400, "clientNonce": "0x…" },
    "signature": "0x…"
  },
  "extensions": {}
}
```

`payload` is the scheme-specific part, and it is deliberately small.

- `jobId` — which funded job this request is spending.
- `fundTxHash` — advisory, for logs and for the buyer's own reconciliation. The seller
  **never** trusts it; it reads `jobs(jobId)` from the chain.
- `deliveryRequest` — only the two fields the seller cannot derive.
- `signature` — an EIP-712 signature over the full `DeliveryRequest` struct (SPEC-001 §4):
  `{jobId, resourceHash, sellerOrigin, expiry, clientNonce}`.

**Why only two fields travel.** `resourceHash` and `sellerOrigin` are *reconstructed by
the seller* — from the raw request bytes, its own configured origin and its own price
table — and then fed into signature recovery. A buyer that lies about either simply
produces a signature that recovers to the wrong address. Sending them would invite a
seller to verify the buyer's copy instead of its own, which is the mistake `quotedMax`
made in the blueprint (DF-04).

**Why the request must be byte-identical.** The hash covers the raw body before any
parsing (SPEC-001 §2.3). Re-serialising JSON — even reordering keys — changes it.

---

## 5. Success

```
HTTP/1.1 200 OK
PAYMENT-RESPONSE: <base64(JSON SettlementResponse)>
Content-Type: application/json
Cache-Control: no-store

{ …the deterministic result… }
```

```json
{
  "success": true,
  "network": "eip155:84532",
  "transaction": "0x…",
  "extra": {
    "scheme": "agenttrust-escrow",
    "jobId": "0x…",
    "disposition": "executed",
    "responseHash": "0x…",
    "evidenceId": "…",
    "confirmations": 3
  }
}
```

`transaction` is the **funding** transaction, not a settlement one: in this scheme the
money moves at `fund()` and again at `release()`, never during the HTTP exchange.
`disposition` is `"executed"` on the run that did the work and `"replayed"` on every
idempotent re-serve (§6). `responseHash` is `keccak256` of the exact bytes in the body, so
the buyer can check what it received against what the validator later attests.

---

## 6. One grant, one execution

The rule, stated once:

> **A funded job is worth exactly one execution.** Not one per connection, not one per
> process, not one per restart. Retries, concurrency and crashes may cause a stored
> result to be re-served to the authenticated payer, but they never cause the work to be
> done twice.

This is the correction at the centre of DF-01. The escrow's payer nonce prevents a second
*payment*; it has nothing to say about a seller serving one payment fifty times, which is
what the published A2 result measured (248 grants for one settlement, V-13). The defence
lives here, in the claim store (API-005), not in the contract.

### 6.1 Claim states

Keyed by `(chainId, escrow, jobId)` — never by `jobId` alone, because the same job
identifier on another chain or another escrow deployment is a different job.

```
          ┌──────────────┐  result persisted   ┌────────────────┐  bytes sent  ┌────────┐
 none ──► │   CLAIMED    │ ──────────────────► │ RESULT_STORED  │ ───────────► │ SERVED │
          └──────┬───────┘                     └────────────────┘              └────────┘
                 │ handler threw / lease expired with no result
                 ▼
          ┌──────────────┐  attempts < MAX_EXEC_ATTEMPTS   ┌──────────────┐
          │    FAILED    │ ──────────────────────────────► │   CLAIMED    │
          └──────┬───────┘                                 └──────────────┘
                 │ attempts exhausted
                 ▼
          ┌──────────────┐
          │ FAILED_FINAL │
          └──────────────┘
```

Rules that make the diagram true:

1. Every transition happens inside one `BEGIN IMMEDIATE` transaction. SQLite in WAL mode
   gives one writer at a time across processes, which is what makes "one execution" hold
   for two seller processes on one host.
2. **The result is persisted before any byte leaves the process.** A crash after sending
   but before storing would otherwise look identical to a crash before doing anything.
3. Bytes may only be sent from `RESULT_STORED` or `SERVED`.
4. A lease may be taken over **only when no result exists**. A `CLAIMED` row whose lease
   expired with nothing stored is "in doubt": re-execution is safe precisely because the
   route is deterministic, so the second run produces the same bytes (DF-17).
5. The claim is taken **last** — after every check in §7 passes. A claim taken before
   verification would let an unauthenticated caller burn a buyer's grant.

### 6.2 `REPLAY_POLICY`

| Value | Second authenticated request from the payer | Counted as |
|---|---|---|
| `idempotent` *(default, and what every measurement uses)* | `200` with the stored bytes and `disposition: "replayed"` | a replay |
| `strict` | `409 already_delivered` | neither |

Under both values the work is done once. The choice only changes what a well-behaved
payer sees after a dropped connection, and `idempotent` is the default because a buyer
that lost the response would otherwise have paid for nothing.

### 6.3 What the harness counts

Per job: `executions_completed`, `distinct_results`, `http_2xx`, `replays_served`,
`aborted_executions`. The A2 claim is about the first two: a defence is
`executions_completed == 1` **and** `distinct_results == 1`, under load, across
processes. `http_2xx > 1` is expected under `idempotent` and is not a failure.

---

## 7. The seller's check order

Strictly in this order. Each step names the error it raises; §8 defines them. The order
is normative because it decides what an attacker learns and what state is touched.

| # | Check | Local or chain | Failure |
|---|---|---|---|
| 1 | `PAYMENT-SIGNATURE` present and decodable | local | `402` (re-quote) |
| 2 | `accepted.scheme == "agenttrust-escrow"` and `accepted.network` matches the configured chain | local | `402` |
| 3 | Re-derive `resourceHash` from the **raw body**, the **configured origin** and the **price table** | local | — |
| 4 | `expiry > now` | local | `403 signature_expired` |
| 5 | Recover the `DeliveryRequest` signer from `(jobId, resourceHash, sellerOrigin, expiry, clientNonce)` | local | `403 signature_invalid` |
| 6 | `clientNonce` unused for this job | local | `409 signature_replayed` |
| 7 | Read `jobs(jobId)`: state `Funded`; `resourceHash` equal; `payee == my wallet`; `payeeAgentId == mine`; `token` and `amount` equal | chain | `409 resource_mismatch` |
| 8 | `signer == job.payer` | — | `403 signature_invalid` |
| 9 | `expiry ≤ job.deadline` | — | `403 signature_expired` |
| 10 | `validator ∈ ACCEPTED_VALIDATORS` | — | `409 validator_not_accepted` |
| 11 | `job.deadline − now ≥ minDeadlineMargin` | — | `410 deadline_margin` |
| 12 | Funding transaction has ≥ `CONFIRMATIONS` blocks | chain | `425 insufficient_confirmations` |
| 13 | **Take the claim** | local | `409 claim_in_progress` / `409 already_delivered` |
| 14 | Execute, persist, send | local | `500` (claim → `FAILED`) |

**Everything that can be decided locally is decided before the chain is touched.** An
unauthenticated caller should not be able to make the seller spend RPC budget by
guessing job identifiers, and steps 1–6 need no network at all.

The two checks that *sound* local but are not — `signer == job.payer` and
`expiry ≤ job.deadline` — are split out as steps 8 and 9, because both need a field of
the job. Recovery itself (step 5) is local: it produces an address from the message and
the signature, and only the comparison waits. An earlier draft of this table folded the
comparison into step 5 and put the whole thing before the chain read, which was simply
impossible to implement in that order; it was corrected while writing API-003/004.

Step 3 uses the **configured origin, never the `Host` header**. A `Host` an attacker
controls would let it steer the hash (DF-04).

### 7.1 Where `minDeadlineMargin` comes from

It is not a guess. It must cover everything that has to happen after delivery, before the
deadline:

```
minDeadlineMargin  ≥  evidence deposit
                    + validationRequest inclusion
                    + bindValidation inclusion
                    + (retryBudget × (squat detection + re-file + re-bind))
                    + validationResponse inclusion
                    + validator scheduling slack
```

The `retryBudget` term is there because of a finding from the CONTRACT-007 security
review: the salt in `requestHash` is secret only until the seller **broadcasts**
`validationRequest`. From that moment it is public in the mempool, and an adversary can
front-run and squat it — repeatedly, against every retry, for gas only (DF-06, corrected).
The seller therefore needs a bounded number of retries and must stop delivering when the
remaining time can no longer cover them. A seller that ignores this delivers work it
cannot get attested.

Default: `minDeadlineMargin = 180` seconds on Base Sepolia with `retryBudget = 3`.
Measured, not assumed, in INT-001.

### 7.2 Confirmations, and failing closed

`CONFIRMATIONS` blocks on the unsafe head; **1** locally, **3** on Base Sepolia (DF-23).
The trade-off is explicit and reported: fewer blocks means a faster demo and more exposure
to A1 (a reorg that unwinds the funding after delivery), more blocks means the opposite.
The security claim is therefore always bounded — "mitigated up to reorg depth k" — never
"blocked".

The public Base Sepolia RPC is **HTTP-only** (V-83), so confirmations are established by
**polling**. A WebSocket subscription is not available and must not be attempted.

**Fail closed, always.** If the RPC is unreachable, slow, or answers inconsistently, the
seller returns `503` and delivers nothing. There is no configuration in which an
unverifiable job is served. A seller that grants on a failed lookup is the whole attack.

---

## 8. Errors

Every code has a trigger and an expected client action. A client that does something else
is misbehaving.

| Status | Code | Trigger | The buyer should |
|---|---|---|---|
| 402 | — | no/undecodable `PAYMENT-SIGNATURE`, wrong scheme or network | read `PAYMENT-REQUIRED`, fund, retry |
| 403 | `signature_invalid` | signature missing, malformed, or not from `job.payer` | stop; this is a bug or a theft attempt |
| 403 | `signature_expired` | `expiry` passed, or `expiry > job.deadline` | re-sign with a valid expiry and retry |
| 409 | `resource_mismatch` | the job's `resourceHash`, payee, agent, token or amount does not match this request | stop; **do not** retry — fund the right resource |
| 409 | `validator_not_accepted` | `job.validator` is outside `ACCEPTED_VALIDATORS` | stop; refund after the deadline |
| 409 | `signature_replayed` | `clientNonce` already used for this job | retry once with a fresh nonce |
| 409 | `claim_in_progress` | another request holds the claim | retry after a short backoff |
| 409 | `already_delivered` | delivered, and `REPLAY_POLICY=strict` | stop; it already has the result |
| 410 | `deadline_margin` | less than `minDeadlineMargin` left | stop; refund after the deadline |
| 425 | `insufficient_confirmations` | funding has fewer than `CONFIRMATIONS` blocks | wait and retry |
| 500 | `execution_failed` | the handler threw | retry up to `MAX_EXEC_ATTEMPTS` |
| 503 | `chain_unavailable` | RPC unreachable or inconsistent | retry with backoff |

Error bodies are JSON `{"error": {"code": "...", "message": "..."}}` and **never** leak
the stored result, the claim state of another job, or anything about a job the caller has
not authenticated against.

`409 resource_mismatch` is deliberately one code for several causes. Splitting it would
tell an unauthenticated prober which part of its guess was wrong.

**There is no `wrong_origin` code, and an earlier draft of this table was wrong to list
one.** `sellerOrigin` never travels (§4): the seller rebuilds the signed message with its
*own* origin, so a signature made over a different seller's origin recovers to some other
address and is refused as `signature_invalid`. That is not a gap — a distinct answer would
confirm to a prober which seller a captured signature was meant for. The same argument
applies to a signature over a different `resourceHash`. Found while implementing API-004.

**A request with no `PAYMENT-SIGNATURE` at all is answered `402` with a quote, never
`403`.** That is the case 402 exists for; a buyer that has never paid should be told how
to pay, not that it is forbidden. API-004's original acceptance criterion said `403` and
was written before this document existed.

---

## 9. Logging

Structured JSON, one object per line (NDJSON), every line carrying `runId` and — where
one exists — `jobId`. Logged: the decision at each step of §7, the claim transition,
timings, and the `responseHash`. Never logged: private keys, signatures, raw request or
response bodies, or anything from `.env`.

The access line is written once per request, on `finish`, so its status and duration are
the ones the client saw:

```json
{"level":"info","msg":"request","runId":"run-42","requestId":"…","method":"POST",
 "path":"/v1/summarise","status":409,"reason":"signature_replayed",
 "jobId":"0x…","durationMs":3.4,"at":"2026-09-24T08:00:00.000Z"}
```

**`reason` is a code from the §8 table, never a sentence.** The harness counts
rejections by reason, and a sentence cannot be counted. A successful delivery carries
`disposition` (`executed` or `replayed`) instead, which is the same distinction the
counters report.

The log can be turned off (`accessLog: false`), and the measurement harnesses do so: one
line per replay, across 50 replays and 10 runs, would out-shout the counters the run is
about.

---

## 10. Conformance

| Requirement | Test |
|---|---|
| §3 402 shape and header | API-002 `quote` |
| §4 retry parsing and signature recovery | API-004 `auth` |
| §5 success envelope | API-002 `quote`, API-005 `claim` |
| §6 one execution under load, across processes | API-005 `claim` + `impl/scripts/claim-multiproc.sh` |
| §7 check order and each failure | API-003 `verify`, API-004 `auth` |
| §7.2 fail closed | API-003 `verify` (RPC down) |
| §8 every code | API-003/004/005 |
| §3.1 `no-store` and `Vary` on every response | API-007 `headers` |
| §9 one NDJSON line per request, reason as a code | API-007 `headers` |

The two paid routes exist to be confused with one another. `SEC-004` funds one and
presents the other; §7 step 6 is what must refuse it.
