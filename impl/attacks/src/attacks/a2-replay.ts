/**
 * SEC-003 — A2, replay.
 *
 * The published result is about a seller serving **one payment** many times: 50 replays
 * produced 50 grants with no idempotency, and the strongest round produced 248 grants
 * against a single settlement (V-13, V-24). The blueprint proposed testing this by
 * funding twice with one nonce and watching the escrow revert — which tests a different
 * layer entirely, and would have "passed" against a seller that served the resource
 * fifty times (DF-01).
 *
 * So the number that matters is `executions_completed`, read from the system's own
 * records. `http_2xx` is not the metric: under `REPLAY_POLICY=idempotent` a replay is
 * *supposed* to return 200 with the stored bytes, and counting that as a failure would
 * be as wrong as counting it as a success.
 *
 * Three variants, because the interesting question is what an attacker can do with what
 * it can actually obtain:
 *   `original`  — the payer's own header, captured in flight
 *   `none`      — no header at all, just the public jobId
 *   `foreign`   — a correctly-formed header signed by someone else
 *   `forged`    — the payer's own header with the signature bytes replaced by garbage.
 *                 This one asks a different question: does the target verify the
 *                 signature *at all*? A target that grants on a forged signature needs
 *                 no replay to be robbed.
 */
import { wilson } from "../stats.js";
import { accounts, type Counters, type Target } from "../targets.js";
import { domain as eip712Domain, EIP712_TYPES, encodeHeader } from "@agenttrust/core";
import { keccak256, toHex, type Hex } from "viem";

export type Variant = "original" | "none" | "foreign" | "forged";

export interface A2Config {
  replays: number;
  concurrency: number;
  variant: Variant;
  path: string;
  body: string;
}

export interface A2RunResult {
  run: number;
  variant: Variant;
  counters: Counters;
  statuses: Record<string, number>;
  /** 2xx responses obtained without a valid payer signature. The theft number. */
  unauthorized_2xx: number;
  distinct_bodies: number;
  secondFundRevert?: string;
}

async function foreignHeader(target: Target, ticket: { jobId?: Hex }, chainId: number, escrow: string): Promise<string> {
  // Correctly formed, correctly signed — by the wrong person. This is the attacker who
  // read jobId from the JobFunded event and knows everything that is public.
  const jobId = ticket.jobId ?? (`0x${"11".repeat(32)}` as Hex);
  const expiry = Math.floor(Date.now() / 1000) + 600;
  const clientNonce = keccak256(toHex(`thief-${Date.now()}-${Math.random()}`));
  const signature = await accounts.attacker.signTypedData({
    domain: eip712Domain({ chainId, verifyingContract: escrow as `0x${string}` }),
    types: { DeliveryRequest: EIP712_TYPES.DeliveryRequest },
    primaryType: "DeliveryRequest",
    message: {
      jobId,
      resourceHash: keccak256(toHex("whatever")),
      sellerOrigin: target.origin,
      expiry: BigInt(expiry),
      clientNonce,
    },
  });
  return encodeHeader({
    x402Version: 2,
    resource: { url: target.origin },
    accepted: {
      scheme: "agenttrust-escrow",
      network: `eip155:${chainId}`,
      amount: "250000",
      asset: `0x${"00".repeat(20)}`,
      payTo: `0x${"00".repeat(20)}`,
      maxTimeoutSeconds: 900,
      extra: {},
    },
    payload: { jobId, fundTxHash: `0x${"00".repeat(32)}`, deliveryRequest: { expiry, clientNonce }, signature },
    extensions: {},
  });
}

/** The payer's own header with the signature replaced by valid-looking garbage. */
function forgeSignature(header: string): string {
  const decoded = JSON.parse(Buffer.from(header, "base64").toString("utf8")) as Record<string, unknown>;
  const forged = `0x${"7f".repeat(65)}`;
  if (typeof decoded["signature"] === "string") {
    // The fixture's flat EIP-3009 authorization.
    decoded["signature"] = forged;
  } else if (decoded["payload"] && typeof decoded["payload"] === "object") {
    // AgentTrust's PaymentPayload.
    (decoded["payload"] as Record<string, unknown>)["signature"] = forged;
  }
  return Buffer.from(JSON.stringify(decoded), "utf8").toString("base64");
}

export async function runA2(
  target: Target,
  config: A2Config,
  env: { chainId: number; escrow: string },
  run: number,
): Promise<A2RunResult> {
  // One legitimate payment. Everything after this is the attack.
  const ticket = await target.pay(config.path, config.body);

  let header: string | undefined;
  if (config.variant === "original") header = ticket.header;
  else if (config.variant === "foreign") header = await foreignHeader(target, ticket, env.chainId, env.escrow);
  else if (config.variant === "forged") header = forgeSignature(ticket.header);
  // "none" leaves it undefined.

  const fire = () => target.request(config.path, config.body, header);

  const responses: { status: number; text: string }[] = [];
  if (config.concurrency <= 1) {
    for (let i = 0; i < config.replays; i++) responses.push(await fire());
  } else {
    for (let sent = 0; sent < config.replays; sent += config.concurrency) {
      const batch = Math.min(config.concurrency, config.replays - sent);
      responses.push(...(await Promise.all(Array.from({ length: batch }, fire))));
    }
  }

  const statuses: Record<string, number> = {};
  for (const r of responses) statuses[String(r.status)] = (statuses[String(r.status)] ?? 0) + 1;

  const counters = await target.counters(ticket);
  const ok = responses.filter((r) => r.status >= 200 && r.status < 300);

  return {
    run,
    variant: config.variant,
    counters,
    statuses,
    // Under `original` the payer is the one asking, so nothing here is unauthorized.
    // Under `original` the payer itself is asking, so nothing is unauthorized. Under
    // every other variant a 2xx is a resource handed to someone who did not pay for it.
    unauthorized_2xx: config.variant === "original" ? 0 : ok.length,
    distinct_bodies: new Set(ok.map((r) => r.text)).size,
  };
}

export function summariseA2(results: A2RunResult[], replays: number) {
  const executions = results.map((r) => r.counters.executions_completed);
  const distinct = results.map((r) => r.counters.distinct_results);
  const settlements = results.map((r) => r.counters.settlements);

  // The headline proportion: of the requests that were **replays**, how many became a
  // second execution. The first of the `replays` requests is the payer's legitimate
  // use of what it paid for, so the denominator is `replays - 1` per run — counting it
  // would understate the fixture's rate and flatter it.
  const replaysPerRun = Math.max(0, replays - 1);
  const attempted = results.length * replaysPerRun;
  const extraExecutions = executions.reduce((a, b) => a + Math.max(0, b - 1), 0);

  return {
    runs: results.length,
    requests_per_run: replays,
    replays_per_run: replaysPerRun,
    executions,
    distinct_results: distinct,
    settlements,
    extra_executions_total: extraExecutions,
    replay_success_rate: wilson(extraExecutions, attempted, "replays that became a second execution"),
    unauthorized_2xx_total: results.reduce((a, r) => a + r.unauthorized_2xx, 0),
  };
}
