# Demo script (AGENT-006)

The commands blueprint §18 names, as they actually exist, plus what each one puts on
screen. The recording itself is PRES-003; this file is what it follows.

Everything here runs against a local Anvil devnet. No testnet transaction, no real
funds, no third-party endpoint.

---

## 0. Before the camera starts

Module loading under `tsx` on this workspace (WSL2 on a Windows drive, CLAUDE.md §15)
takes about a minute per service, so both targets are started and confirmed **before**
recording. Neither start-up belongs in a 45-second video.

```bash
anvil --port 8545 --chain-id 31337 &
bash impl/scripts/deploy.sh local
```

| Terminal | Command | Ready when |
|---|---|---|
| left | `cd impl && npm run target:vanilla` | `vulnerable-fixture-v1 listening on http://127.0.0.1:4021` |
| right | `cd impl && npm run target:agenttrust` | `seller http://127.0.0.1:4022 agent <id>` |
| bottom | — | — |

`target:vanilla` is blueprint §18's name and is kept so the documented command runs. It
prints a correction before anything else, because the target is a fixture written for
this project — not upstream x402, and not evidence about anyone else's code. The
neutral spelling `npm run target:fixture` starts the same thing without the scolding.

---

## 1. The money shot — A2 replay

```bash
cd impl
npm run attack -- --id a2_replay --target vanilla    --runs 10 --replays 50
npm run attack -- --id a2_replay --target agenttrust --runs 10 --replays 50
```

One payment, then 49 replays of the same payment artefact, ten times over. What the
two counter lines show, and what the recorded runs measured (`impl/attacks/results/`,
`a2_replay-*-original-50x1-*`):

| | executions | distinct results | settlements |
|---|---|---|---|
| fixture (left) | **50** per run, all 10 runs | 1 | 1 |
| AgentTrust (right) | **1** per run, all 10 runs | 1 | 1 |

The number on the left is the published shape of the attack: 50 grants against one
settlement, the seller doing the work 50 times for one payment (V-13). The number on
the right is the claim store refusing to execute twice for one funded job.

**The caption has to carry the distinction the counters make.** A 2xx is not an
execution: AgentTrust answers every replay with 200 and the stored bytes, and the work
runs once. "Requests refused" would be the wrong caption — nothing is refused, and
that is the point.

Two separate facts, often merged into one by §18's "second call reverts
`ReplayedNonce()`" (DF-13):

- the **HTTP replay** is absorbed by the claim store — 200, stored result, no execution;
- a **second `fund()`** for the same request reverts `ReplayedNonce`, because the
  payer-scoped nonce was burned. That is the payment layer, not the delivery layer.

## 2. A3 — cross-resource substitution

```bash
npm run attack -- --id a3_cross_resource --target vanilla    --rounds 100
npm run attack -- --id a3_cross_resource --target agenttrust --rounds 100
```

Pay for `/v1/summarise`, present the payment at `/v1/classify`. Both routes cost the
same, so price alone cannot tell them apart.

| | substitutions served, 100 rounds |
|---|---|
| fixture | **100** |
| AgentTrust | **0** |

The authorization on the left names an amount and a payee and nothing else. On the
right the escrow derives `resourceHash` on-chain from the method, URI and body, so a
payment for one request does not fit another.

## 3. The narrative commands

Optional colour for the voice-over; they are not what the counters come from.

```bash
npm run buy    -- --resource /v1/summarise --amount 250000
npm run status -- --job 0x…
npm run refund -- --job 0x…
```

- `buy` prints the job id, the fund transaction, the HTTP status **and the
  disposition** — `executed` the first time, `replayed` if the same request is retried
  before the job settles. Amounts are atomic units: `250000` is 0.25 USDC, and a
  decimal is refused rather than truncated.
- `status` reads the job from the escrow: state, amount, payee, validator, deadline,
  the grace snapshotted at funding, and when a refund would open.
- `refund` refuses before `deadline + grace`, and says why: there is no early refund on
  a failing attestation, because a pending validation request is indistinguishable from
  a response of 0 (DF-05).

Re-running the same `buy` after the job settles is refused, not double-charged: the
payer nonce is derived from the request, so the same request is always the same job.

---

## What the video must not imply

- The left pane is a **deliberately vulnerable fixture**, labelled as such on screen.
  It reproduces the conditions two published papers describe. It is not upstream x402,
  not the `@x402/*` packages, and not a measurement of anyone else's endpoint.
- Nothing in the recording was run against a third-party service.
- The numbers on screen are local-devnet numbers. The timings printed by `buy` are
  devnet latencies and are not testnet figures.
