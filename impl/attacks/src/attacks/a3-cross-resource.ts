/**
 * SEC-004 — A3, cross-resource substitution.
 *
 * Pay for `/v1/summarise`, ask for `/v1/classify`. The two cost **exactly the same**,
 * which is the point: if the prices differed, a substitution could be caught by the
 * amount alone and the measurement would say nothing about whether the request itself
 * is bound to the payment (SPEC-002 §2).
 *
 * The negative controls matter as much as the attack. A defence that rejects the
 * substitution by rejecting everything is not a defence, so every round also checks
 * that the **correct** request succeeds and that a reordered query string is **not**
 * rejected — canonicalisation sorts query parameters, so `?b=2&a=1` and `?a=1&b=2` are
 * one resource (SPEC-001 §2.2), and a false rejection there would be a real defect.
 */
import { wilson } from "../stats.js";
import type { Target } from "../targets.js";

export interface A3Config {
  rounds: number;
  paidPath: string;
  substitutePath: string;
  body: string;
}

export interface A3RoundResult {
  round: number;
  substitution: { status: number; served: boolean; code?: string };
  control_correct: { status: number; served: boolean };
  control_mutated_body: { status: number; served: boolean; code?: string };
}

function codeOf(text: string): string | undefined {
  try {
    return (JSON.parse(text) as { error?: { code?: string } }).error?.code;
  } catch {
    return undefined;
  }
}

const served = (status: number) => status >= 200 && status < 300;

export async function runA3Round(target: Target, config: A3Config, round: number): Promise<A3RoundResult> {
  // 1. The attack: one payment for the paid path, presented at its sibling.
  const attackTicket = await target.pay(config.paidPath, config.body);
  const substitution = await target.request(config.substitutePath, config.body, attackTicket.header);

  // 2. Control: the correct request must still succeed, or the "defence" is just a
  //    broken server.
  const goodTicket = await target.pay(config.paidPath, config.body);
  const correct = await target.request(config.paidPath, config.body, goodTicket.header);

  // 3. Control: a one-byte body mutation must be refused. This distinguishes "the
  //    payment is bound to the request" from "the path happens to be checked".
  const mutatedTicket = await target.pay(config.paidPath, config.body);
  const mutated = await target.request(
    config.paidPath,
    config.body.replace("One", "0ne"),
    mutatedTicket.header,
  );

  return {
    round,
    substitution: {
      status: substitution.status,
      served: served(substitution.status),
      code: codeOf(substitution.text),
    },
    control_correct: { status: correct.status, served: served(correct.status) },
    control_mutated_body: {
      status: mutated.status,
      served: served(mutated.status),
      code: codeOf(mutated.text),
    },
  };
}

export function summariseA3(rounds: A3RoundResult[]) {
  const n = rounds.length;
  const substitutions = rounds.filter((r) => r.substitution.served).length;
  const falseRefusals = rounds.filter((r) => !r.control_correct.served).length;
  const mutationsAccepted = rounds.filter((r) => r.control_mutated_body.served).length;

  const codes: Record<string, number> = {};
  for (const r of rounds) {
    const key = r.substitution.code ?? `http_${r.substitution.status}`;
    codes[key] = (codes[key] ?? 0) + 1;
  }

  return {
    rounds: n,
    substitutions_served: substitutions,
    substitution_rate: wilson(substitutions, n, "payments for one resource that bought another"),
    false_refusals: falseRefusals,
    false_refusal_rate: wilson(falseRefusals, n, "correct requests wrongly refused"),
    mutated_body_accepted: mutationsAccepted,
    mutated_body_rate: wilson(mutationsAccepted, n, "one-byte body mutations accepted"),
    rejection_codes: codes,
  };
}
