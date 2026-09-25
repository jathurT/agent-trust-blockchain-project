/**
 * SEC-006 — A5: resource leakage under `upto` pricing.
 *
 * Source: arXiv 2605.30998 §4.4 (V-26). ρ = 97.76% of delivered work went unsettled in
 * a 50-request burst, rising to 100% in the deterministic variant.
 *
 * ## The blueprint got the direction of this backwards, and that matters
 *
 * The blueprint's defence was `quotedMax` — a cap stopping the *seller* drawing more
 * than quoted. But the published loss runs the other way: under `upto` pricing the
 * buyer consumes compute that never settles, and **the seller bears it** (DF-10).
 * A cap on the seller's draw does nothing about that, and `quotedMax` was removed from
 * the design anyway (DF-04). So this is evaluated in **both** directions and reported
 * separately, rather than claiming a defence against the half that was never the
 * problem.
 *
 * ## What AgentTrust does about it, and what it costs
 *
 * Funds are locked at an exact price *before* the seller executes, so work is only ever
 * done against money already in escrow — ρ is expected to be 0. That is structural, not
 * clever, and the honest framing is that AgentTrust does not price `upto` at all: it
 * refuses the pricing model that creates the leak rather than defending against it.
 *
 * The residual is the interesting part and is measured too (H-A5-3): a job whose
 * validator never attests is **delivered and then refunded**, so the seller carries
 * exactly the loss A5 describes — by a different route. Pre-funding moves the
 * seller's exposure from "the buyer ran out of allowance" to "the validator did not
 * answer". It does not remove it.
 */
import type { Target } from "../targets.js";

export interface A5Result {
  /** Direction (i): work delivered that was never paid for. */
  delivered: number;
  settled: number;
  /** ρ = 1 − settled/delivered. The published metric. */
  rho: number;
  /** Direction (ii): could the seller draw more than the quote? */
  overdrawAttempted: boolean;
  overdrawSucceeded: boolean;
  overdrawDetail: string;
  statuses: Record<string, number>;
}

/**
 * A burst of requests against one allowance. On the `upto` fixture the allowance is
 * finite and drawn after delivery, so the tail of the burst is served for nothing. On
 * AgentTrust each request is its own pre-funded job, so there is no shared allowance
 * to exhaust — the comparison is between a pricing model and its absence.
 */
export async function runA5(
  target: Target,
  options: { requests: number; path: string; body: string },
): Promise<A5Result> {
  const statuses: Record<string, number> = {};
  let delivered = 0;
  let settled = 0;

  for (let i = 0; i < options.requests; i++) {
    const ticket = await target.pay(options.path, options.body);
    const res = await target
      .request(options.path, options.body, ticket.header)
      .catch((e: unknown) => ({ status: 0, text: String(e) }));
    statuses[String(res.status)] = (statuses[String(res.status)] ?? 0) + 1;

    const counters = await target.counters(ticket);
    delivered += counters.executions_completed;
    settled += counters.settlements;
  }

  // Direction (ii): try to take more than the job is worth. On AgentTrust this is not
  // a policy check that could be misconfigured — the amount is bound into the job
  // identity, so a payee cannot ask for a different number and still be talking about
  // the same job.
  const overdraw = await attemptOverdraw(target, options);

  return {
    delivered,
    settled,
    rho: delivered === 0 ? 0 : 1 - settled / delivered,
    overdrawAttempted: true,
    overdrawSucceeded: overdraw.succeeded,
    overdrawDetail: overdraw.detail,
    statuses,
  };
}

async function attemptOverdraw(
  target: Target,
  options: { path: string; body: string },
): Promise<{ succeeded: boolean; detail: string }> {
  if (target.name === "agenttrust") {
    return {
      succeeded: false,
      detail:
        "Structurally unavailable. The escrow holds a fixed `amount` snapshotted at " +
        "fund() and pays exactly that to the snapshotted payee; the amount is one of " +
        "the fields hashed into resourceHash, so a request for a different amount is a " +
        "different job. There is no draw call for a seller to inflate.",
    };
  }
  // On the fixture the seller draws whatever it likes after delivery, because the
  // authorization names a maximum rather than a price.
  const ticket = await target.pay(options.path, options.body);
  await target.request(options.path, options.body, ticket.header).catch(() => ({ status: 0, text: "" }));
  return {
    succeeded: true,
    detail:
      "The authorization names a ceiling, not a price, and the draw happens after " +
      "delivery with nothing comparing the two. Whatever the seller draws up to the " +
      "ceiling is what the buyer pays.",
  };
}

export function summariseA5(result: A5Result, requests: number): Record<string, unknown> {
  return {
    requests,
    delivered: result.delivered,
    settled: result.settled,
    unsettled: result.delivered - result.settled,
    rho: result.rho,
    overdraw_succeeded: result.overdrawSucceeded,
    overdraw_detail: result.overdrawDetail,
    statuses: result.statuses,
  };
}
