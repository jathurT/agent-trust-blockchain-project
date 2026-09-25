/**
 * SEC-005 — A4: duplicate delivery from concurrency.
 *
 * Source: arXiv 2605.30998 §4.2 (V-25) — 50 rounds of 20 concurrent requests produced
 * duplicate delivery in 6% of rounds. The mechanism is a race **inside the
 * verify→settle window**: the server checks whether a payment has been used, calls out
 * to a facilitator, and only then records the use. Everything that arrives during the
 * call has already passed the check.
 *
 * ## Why AgentTrust's side of this is close to trivial, said plainly
 *
 * AgentTrust has no verify→settle window. There is no facilitator round trip: the chain
 * *is* the facilitator, the seller reads `jobs(jobId)` directly, and the claim is taken
 * atomically in one `BEGIN IMMEDIATE` transaction before any work starts. So the
 * expected result is zero duplicates, and it is zero by construction rather than by
 * luck — which makes this a weaker experiment than A2 or A6, where the defence could
 * plausibly have failed.
 *
 * It is still worth running for two reasons. The claim store's cross-process behaviour
 * has only ever been tested by a purpose-built driver, and this exercises it through
 * the real HTTP path under the same concurrency the paper used. And a fixture that
 * *does* have the window gives the comparison a floor: without it, "0 duplicates"
 * means nothing, because a server that refused everything would also score 0.
 *
 * ## The rate is a property of the window
 *
 * The published 6% came from whatever window that server had. Ours is a parameter
 * (`verifyWindowMs`), so the baseline rate here is **not** calibrated to reproduce 6%
 * and must not be presented as reproducing it. What is reproduced is the *condition*.
 */
import type { Target } from "../targets.js";

export interface A4RoundResult {
  round: number;
  concurrency: number;
  /** How many of the concurrent requests the server actually executed. */
  executions: number;
  /** 2xx responses, which is not the same thing. */
  http2xx: number;
  /** Refusals, by status. */
  statuses: Record<string, number>;
  duplicated: boolean;
}

export async function runA4Round(
  target: Target,
  options: { concurrency: number; path: string; body: string },
  round: number,
): Promise<A4RoundResult> {
  // One payment, then N requests carrying it, fired together.
  const ticket = await target.pay(options.path, options.body);

  const responses = await Promise.all(
    Array.from({ length: options.concurrency }, () =>
      target
        .request(options.path, options.body, ticket.header)
        .catch((e: unknown) => ({ status: 0, text: String(e) })),
    ),
  );

  const counters = await target.counters(ticket);
  const statuses: Record<string, number> = {};
  for (const r of responses) statuses[String(r.status)] = (statuses[String(r.status)] ?? 0) + 1;

  return {
    round,
    concurrency: options.concurrency,
    executions: counters.executions_completed,
    http2xx: counters.http_2xx,
    statuses,
    duplicated: counters.executions_completed > 1,
  };
}

export function summariseA4(rounds: A4RoundResult[]): Record<string, unknown> {
  const byConcurrency: Record<string, unknown> = {};
  for (const level of [...new Set(rounds.map((r) => r.concurrency))].sort((a, b) => a - b)) {
    const cell = rounds.filter((r) => r.concurrency === level);
    const duplicated = cell.filter((r) => r.duplicated).length;
    byConcurrency[String(level)] = {
      rounds: cell.length,
      rounds_with_duplicate_execution: duplicated,
      duplicate_round_rate: cell.length === 0 ? 0 : duplicated / cell.length,
      max_executions_in_a_round: Math.max(...cell.map((r) => r.executions)),
      total_executions: cell.reduce((a, r) => a + r.executions, 0),
      total_http_2xx: cell.reduce((a, r) => a + r.http2xx, 0),
    };
  }
  return {
    rounds: rounds.length,
    by_concurrency: byConcurrency,
    rounds_with_duplicate_execution: rounds.filter((r) => r.duplicated).length,
    max_executions_in_a_round: Math.max(...rounds.map((r) => r.executions)),
  };
}
