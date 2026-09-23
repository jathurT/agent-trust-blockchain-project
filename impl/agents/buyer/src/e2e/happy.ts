/**
 * INT-001 — one job, all the way through: discovery, quote, gate check, fund, deliver,
 * deposit, bind, attest, release. Real seller, real Python validator, real escrow.
 */
import { keccak256, toHex } from "viem";
import { purchase } from "../buyer.js";
import { accounts, balanceOf, deployment, startStack, Timeline, wallet } from "./harness.js";
import { escrowAbi, validationRegistryAbi, JobState } from "@agenttrust/core";
import { join } from "node:path";
import { ROOT } from "./harness.js";

const runId = `int-001-${Date.now()}`;

async function main(): Promise<void> {
  const timeline = new Timeline(join(ROOT, "evidence", "INT-001"), runId);
  timeline.mark("start");

  const stack = await startStack({ sellerPort: 8621, validatorPort: 8622 });
  timeline.mark("services_up", { sellerOrigin: stack.sellerOrigin, agentId: stack.agentId.toString() });

  const failures: string[] = [];
  const expect = (ok: boolean, what: string) => {
    if (!ok) failures.push(what);
  };

  try {
    const buyerBefore = await balanceOf(stack.chain, accounts.buyer.address);
    const payeeBefore = await balanceOf(stack.chain, stack.payee);

    const body = `{"text":"Agents pay each other over HTTP. Escrow protects the buyer. An attack can replay a payment. ${runId}"}`;
    timeline.mark("purchase_begin");

    const result = await purchase(
      {
        chain: stack.chain,
        wallet: wallet(accounts.buyer),
        account: accounts.buyer,
        identityRegistry: deployment.identityRegistry,
        reputationRegistry: deployment.reputationRegistry,
        token: deployment.token,
        maxPrice: 1_000_000n,
        gate: {
          trustedClients: [accounts.trustedClient.address],
          minDistinct: 1,
          minCount: 1n,
          minAvgValue: 9000n,
        },
        confirmations: 0,
        ttlSeconds: 900,
        fetchJson: async (url: string) => (await fetch(url)).json(),
      },
      {
        sellerAgentId: stack.agentId,
        origin: stack.sellerOrigin,
        path: "/v1/summarise",
        body,
        validator: accounts.validator.address,
      },
    );
    timeline.mark("delivered", { jobId: result.jobId, disposition: result.disposition });

    expect(result.disposition === "executed", "the first purchase should execute, not replay");
    expect(result.responseHash === keccak256(toHex(result.responseBody)), "the buyer verified the response hash");

    // Wait for the validator to say it is finished, rather than for a fixed period.
    // A timeout is not a signal: the first version of this waited 60 seconds and then
    // reported "not released" for a job the validator had already released, because
    // the two were racing.
    let validatorDecision: Record<string, unknown> | { error: string } | null = null;
    const decisionDeadline = Date.now() + 90_000;
    for (;;) {
      try {
        const res = await fetch(`${stack.validatorUrl}/decisions/${result.jobId}`);
        if (res.ok) {
          validatorDecision = (await res.json()) as Record<string, unknown>;
          break;
        }
      } catch (error) {
        validatorDecision = { error: (error as Error).message };
      }
      if (Date.now() > decisionDeadline) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    timeline.mark("validator_decided", validatorDecision);

    // Only now ask the chain: the release transaction is already mined by this point.
    let state = JobState.Funded;
    const stateDeadline = Date.now() + 15_000;
    for (;;) {
      state = Number(
        await stack.chain.client.readContract({
          address: deployment.escrow,
          abi: escrowAbi,
          functionName: "jobState",
          args: [result.jobId],
        }),
      ) as JobState;
      if (state !== JobState.Funded || Date.now() > stateDeadline) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    timeline.mark("released", { state });

    expect(state === JobState.Released, `the job should be Released, got state ${state}`);

    const buyerAfter = await balanceOf(stack.chain, accounts.buyer.address);
    const payeeAfter = await balanceOf(stack.chain, stack.payee);
    expect(buyerBefore - buyerAfter === 250_000n, `the buyer should be down exactly 250000, was ${buyerBefore - buyerAfter}`);
    expect(payeeAfter - payeeBefore === 250_000n, `the payee should be up exactly 250000, was ${payeeAfter - payeeBefore}`);

    // Exactly one execution, and exactly one attestation.
    const key = `${deployment.chainId}:${deployment.escrow.toLowerCase()}:${result.jobId.toLowerCase()}`;
    const metrics = stack.claims.metrics(key);
    expect(metrics.executions_completed === 1, `exactly one execution, got ${metrics.executions_completed}`);
    expect(metrics.distinct_results === 1, `exactly one distinct result, got ${metrics.distinct_results}`);

    const job = await stack.chain.getJob(result.jobId);
    const status = (await stack.chain.client.readContract({
      address: deployment.validationRegistry,
      abi: validationRegistryAbi,
      functionName: "getValidationStatus",
      args: [job!.requestHash],
    })) as readonly [string, bigint, number, string, string, bigint];
    expect(status[2] === 100, `the attestation should be a pass, got ${status[2]}`);
    expect(
      status[0].toLowerCase() === accounts.validator.address.toLowerCase(),
      "the attestation should come from the agreed validator",
    );
    timeline.mark("verified", { attestation: status[2], metrics });

    const report = {
      runId,
      ok: failures.length === 0,
      failures,
      jobId: result.jobId,
      disposition: result.disposition,
      buyerDelta: (buyerAfter - buyerBefore).toString(),
      payeeDelta: (payeeAfter - payeeBefore).toString(),
      attestation: status[2],
      validatorDecision,
      metrics,
      durationsMs: timeline.durations(),
      note:
        "Local Anvil. These latencies are a devnet measurement and must never be quoted " +
        "as Base Sepolia numbers (EVAL-006).",
    };
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    process.exitCode = failures.length === 0 ? 0 : 1;
  } finally {
    await stack.stop();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${(error as Error)?.stack ?? String(error)}\n`);
  process.exit(1);
});
