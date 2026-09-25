/**
 * SEC-008 — A1: revert-grant under optimistic execution.
 *
 * Source: arXiv 2605.11781 §3.1.1/§4.2 (V-15). A server grants before the payment has
 * k confirmations; a reorg of depth d then removes the payment, and the work has
 * already been handed over. Their Hardhat simulation put the revert-grant probability
 * at 4.70–5.18%.
 *
 * ## The claim here is a bound, and it can never be "blocked"
 *
 * Serving only after k confirmations narrows the window; it cannot close it. A reorg
 * deeper than k defeats any k, so the only honest statement is **"mitigated up to
 * depth k"** (DF-11). A slide that says A1 is blocked would be claiming something no
 * confirmation policy can deliver.
 *
 * ## What this measures, and what is simply arithmetic
 *
 * The fund transaction lands in block B. The seller waits for k confirmations, so it
 * delivers when the tip is B+k. A reorg of depth d rewinds the last d blocks, which
 * removes B exactly when `d > k`. That much is arithmetic and nobody needs an
 * experiment for it.
 *
 * What the experiment is actually for is that the arithmetic only holds if the seller's
 * confirmation policy does what it claims end to end — that it really counts
 * confirmations against the funding transaction's block rather than, say, wall-clock
 * time or the tip alone, and that a job removed by a reorg really does read as gone
 * rather than lingering in some cached view. Both of those are places an implementation
 * can be wrong while the arithmetic stays right.
 *
 * ## Probabilities are not comparable to the paper's
 *
 * The published 4.70–5.18% came from a reorg *model* with its own depth distribution.
 * Here the depth is chosen, not sampled, so every cell is deterministic and the result
 * is a table of which (d, k) pairs survive — not a probability. Reporting a percentage
 * would invite a comparison that is not valid.
 */
import type { Address, Hex } from "viem";
import type { ChainClient } from "@agenttrust/core";
import type { Target } from "../targets.js";

export interface A1Trial {
  trial: number;
  depth: number;
  policy: number;
  /** Did the seller hand over the resource? */
  delivered: boolean;
  /** Did the funded job still exist after the reorg? */
  paymentSurvived: boolean;
  /** delivered && !paymentSurvived — work handed over for a payment that vanished. */
  revertGrant: boolean;
  detail: string;
}

export interface A1Deps {
  chain: ChainClient;
  escrow: Address;
  rpcUrl: string;
}

/** `anvil_reorg`. Verified on anvil 1.8.3: it rewinds state, and the dropped
 *  transactions are **not** re-mined afterwards. */
export async function reorg(rpcUrl: string, depth: number): Promise<void> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "anvil_reorg", params: [depth, []] }),
  });
  const body = (await res.json()) as { error?: { message: string } };
  if (body.error) throw new Error(`anvil_reorg(${depth}) failed: ${body.error.message}`);
}

async function mine(rpcUrl: string, blocks: number): Promise<void> {
  for (let i = 0; i < blocks; i++) {
    await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "evm_mine", params: [] }),
    });
  }
}

export async function runA1Trial(
  target: Target,
  deps: A1Deps,
  options: { depth: number; policy: number; path: string; body: string },
  trial: number,
): Promise<A1Trial> {
  // Pay, which funds the job on-chain.
  const ticket = await target.pay(options.path, options.body);

  // Advance to the seller's confirmation policy. Without this the seller refuses with
  // `insufficient_confirmations`, which is the policy working rather than the attack.
  if (options.policy > 0) await mine(deps.rpcUrl, options.policy);

  const response = await target
    .request(options.path, options.body, ticket.header)
    .catch((e: unknown) => ({ status: 0, text: String(e) }));
  const delivered = response.status === 200;

  // The reorg, after the resource has changed hands.
  await reorg(deps.rpcUrl, options.depth);

  let paymentSurvived = false;
  let detail = "";
  if (ticket.jobId !== undefined) {
    try {
      const job = await deps.chain.getJob(ticket.jobId);
      paymentSurvived = job !== undefined && Number(job.state) !== 0;
      detail = paymentSurvived ? `job still ${Number(job?.state)}` : "job gone after reorg";
    } catch (error) {
      detail = `job read failed: ${(error as Error).message}`;
    }
  } else {
    // The fixture has no on-chain job; its settlement is the EIP-3009 transfer, and the
    // reorg removing it is the same loss by a different name.
    const counters = await target.counters(ticket);
    paymentSurvived = counters.settlements > 0;
    detail = paymentSurvived ? "settlement survived" : "settlement gone after reorg";
  }

  return {
    trial,
    depth: options.depth,
    policy: options.policy,
    delivered,
    paymentSurvived,
    revertGrant: delivered && !paymentSurvived,
    detail,
  };
}

export function summariseA1(trials: A1Trial[]): Record<string, unknown> {
  const cells: Record<string, unknown> = {};
  const depths = [...new Set(trials.map((t) => t.depth))].sort((a, b) => a - b);
  const policies = [...new Set(trials.map((t) => t.policy))].sort((a, b) => a - b);

  for (const k of policies) {
    for (const d of depths) {
      const cell = trials.filter((t) => t.policy === k && t.depth === d);
      if (cell.length === 0) continue;
      cells[`k=${k},d=${d}`] = {
        trials: cell.length,
        delivered: cell.filter((t) => t.delivered).length,
        payment_survived: cell.filter((t) => t.paymentSurvived).length,
        revert_grants: cell.filter((t) => t.revertGrant).length,
      };
    }
  }

  // The bound the honest claim rests on: the largest depth every trial survived.
  const mitigatedTo: Record<string, number | null> = {};
  for (const k of policies) {
    let bound: number | null = null;
    for (const d of depths) {
      const cell = trials.filter((t) => t.policy === k && t.depth === d);
      if (cell.length > 0 && cell.every((t) => !t.revertGrant)) bound = d;
      else break;
    }
    mitigatedTo[`k=${k}`] = bound;
  }

  return {
    trials: trials.length,
    depths,
    policies,
    cells,
    mitigated_up_to_depth: mitigatedTo,
    total_revert_grants: trials.filter((t) => t.revertGrant).length,
  };
}
