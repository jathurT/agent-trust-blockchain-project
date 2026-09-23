/**
 * INT-002 — the buyer's safety valve, in the two failure modes that actually happen,
 * and the case where it must *not* work.
 *
 *   A. The validator never attests. The seller delivered, the buyer holds the result,
 *      and nobody ever judged it. After deadline + grace the buyer gets its money back.
 *   B. The validator attests **fail**. Same outcome, reached differently.
 *   C. A timely pass exists. The refund must be refused — this is the case the
 *      blueprint's `refund()` got wrong, since it never looked at the attestation at
 *      all (DF-05).
 *
 * Time is moved with `evm_increaseTime`, which is a devnet facility. On Base Sepolia
 * the wait is real, which is why `GRACE` is 15 minutes and not hours.
 */
import express from "express";
import type { Server } from "node:http";
import { join } from "node:path";
import { keccak256, toHex, type Hex } from "viem";
import { escrowAbi, JobState, validationRegistryAbi } from "@agenttrust/core";
import { purchase } from "../buyer.js";
import { BuyerAbort } from "../errors.js";
import { accounts, balanceOf, deployment, ROOT, RPC, startStack, Timeline, wallet } from "./harness.js";

const runId = `int-002-${Date.now()}`;
const failures: string[] = [];
const expect = (ok: boolean, what: string) => {
  if (!ok) failures.push(what);
};

/** Anvil only. Moves the chain clock so a deadline can pass without waiting for it. */
async function increaseTime(seconds: number): Promise<void> {
  for (const [method, params] of [
    ["evm_increaseTime", [seconds]],
    ["evm_mine", []],
  ] as const) {
    const res = await fetch(RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const body = (await res.json()) as { error?: { message: string } };
    if (body.error) throw new Error(`${method} failed: ${body.error.message}`);
  }
}

function buyerConfig(stack: Awaited<ReturnType<typeof startStack>>) {
  return {
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
  };
}

async function refund(stack: Awaited<ReturnType<typeof startStack>>, jobId: Hex): Promise<void> {
  const tx = await wallet(accounts.buyer).writeContract({
    address: deployment.escrow,
    abi: escrowAbi,
    functionName: "refund",
    args: [jobId],
    account: accounts.buyer,
    chain: null,
  });
  await stack.chain.client.waitForTransactionReceipt({ hash: tx });
}

/** A validator that takes the evidence and then does nothing at all. */
async function silentValidator(port: number): Promise<Server> {
  const app = express();
  app.use(express.json({ limit: "5mb" }));
  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  app.post("/evidence", (req, res) =>
    res.json({ evidenceId: String(req.body?.receipt?.responseHash ?? "none"), accepted: true }),
  );
  return new Promise<Server>((resolve) => {
    const s = app.listen(port, () => resolve(s));
  });
}

async function main(): Promise<void> {
  const timeline = new Timeline(join(ROOT, "evidence", "INT-002"), runId);
  timeline.mark("start");
  const results: Record<string, unknown> = {};

  // ─── A. the validator never attests ────────────────────────────────────────────
  {
    const stub = await silentValidator(8632);
    const stack = await startStack({ sellerPort: 8631, validatorPort: 8632, startValidator: false });
    try {
      const before = await balanceOf(stack.chain, accounts.buyer.address);
      const purchased = await purchase(buyerConfig(stack), {
        sellerAgentId: stack.agentId,
        origin: stack.sellerOrigin,
        path: "/v1/summarise",
        body: `{"text":"One. Two. Three. ${runId}-A"}`,
        validator: accounts.validator.address,
      });
      timeline.mark("A_delivered", { jobId: purchased.jobId });

      const job = (await stack.chain.getJob(purchased.jobId))!;
      // The seller delivered and bound; nobody attested.
      expect(job.requestHash !== `0x${"00".repeat(32)}`, "A: the seller should have bound a request");
      expect(!(await stack.chain.client.readContract({
        address: deployment.escrow, abi: escrowAbi, functionName: "isReleasable", args: [purchased.jobId],
      })), "A: the job must not be releasable without an attestation");

      // Before deadline + grace the valve is shut.
      let refusedEarly = false;
      try {
        await refund(stack, purchased.jobId);
      } catch {
        refusedEarly = true;
      }
      expect(refusedEarly, "A: refund before deadline + grace must revert");

      await increaseTime(Number(job.deadline - job.fundedAt) + Number(job.grace) + 60);
      timeline.mark("A_warped");

      await refund(stack, purchased.jobId);
      const after = await balanceOf(stack.chain, accounts.buyer.address);
      const state = Number(await stack.chain.client.readContract({
        address: deployment.escrow, abi: escrowAbi, functionName: "jobState", args: [purchased.jobId],
      }));

      expect(state === JobState.Refunded, `A: the job should be Refunded, got ${state}`);
      expect(after === before, `A: the buyer should be made whole; net was ${after - before}`);
      results["A_noAttestation"] = { jobId: purchased.jobId, state, netToBuyer: (after - before).toString() };
      timeline.mark("A_refunded");
    } finally {
      await stack.stop();
      await new Promise<void>((r) => stub.close(() => r()));
    }
  }

  // ─── B. the validator attests "fail" ───────────────────────────────────────────
  {
    // A silent stub takes the deposit so the seller files and binds, and the validator
    // account then posts a **0** directly. That is what a genuine "this output is
    // wrong" looks like on-chain, and the point is that a failing attestation must not
    // block the buyer's refund -- there is no early refund on fail (a pending request
    // reads as 0 too), but after deadline + grace the money comes back.
    const stub = await silentValidator(8634);
    const stack = await startStack({ sellerPort: 8633, validatorPort: 8634, startValidator: false });
    try {
      const before = await balanceOf(stack.chain, accounts.buyer.address);
      const purchased = await purchase(buyerConfig(stack), {
        sellerAgentId: stack.agentId,
        origin: stack.sellerOrigin,
        path: "/v1/summarise",
        body: `{"text":"One. Two. Three. ${runId}-B"}`,
        validator: accounts.validator.address,
      });
      const job = (await stack.chain.getJob(purchased.jobId))!;
      expect(job.requestHash !== `0x${"00".repeat(32)}`, "B: the seller should have bound a request");

      const failTx = await wallet(accounts.validator).writeContract({
        address: deployment.validationRegistry,
        abi: validationRegistryAbi,
        functionName: "validationResponse",
        args: [job.requestHash, 0, "", keccak256(toHex("wrong output")), "agenttrust"],
        account: accounts.validator,
        chain: null,
      });
      await stack.chain.client.waitForTransactionReceipt({ hash: failTx });
      timeline.mark("B_failed_attestation");

      const status = (await stack.chain.client.readContract({
        address: deployment.validationRegistry,
        abi: validationRegistryAbi,
        functionName: "getValidationStatus",
        args: [job.requestHash],
      })) as readonly [string, bigint, number, Hex, string, bigint];
      expect(status[2] === 0, `B: the attestation should be a fail, got ${status[2]}`);
      expect(!(await stack.chain.client.readContract({
        address: deployment.escrow, abi: escrowAbi, functionName: "isReleasable", args: [purchased.jobId],
      })), "B: a failed job must not be releasable");

      await increaseTime(Number(job.deadline - job.fundedAt) + Number(job.grace) + 60);
      await refund(stack, purchased.jobId);

      const after = await balanceOf(stack.chain, accounts.buyer.address);
      const state = Number(await stack.chain.client.readContract({
        address: deployment.escrow, abi: escrowAbi, functionName: "jobState", args: [purchased.jobId],
      }));
      expect(state === JobState.Refunded, `B: the job should be Refunded, got ${state}`);
      expect(after === before, `B: the buyer should be made whole; net was ${after - before}`);
      results["B_failingAttestation"] = {
        jobId: purchased.jobId,
        attestation: status[2],
        state,
        netToBuyer: (after - before).toString(),
      };
      timeline.mark("B_refunded");
    } finally {
      await stack.stop();
      await new Promise<void>((r) => stub.close(() => r()));
    }
  }

  // ─── C. a timely pass makes the refund impossible ──────────────────────────────
  {
    const stack = await startStack({ sellerPort: 8635, validatorPort: 8636 });
    try {
      const purchased = await purchase(buyerConfig(stack), {
        sellerAgentId: stack.agentId,
        origin: stack.sellerOrigin,
        path: "/v1/classify",
        body: `{"text":"escrow settlement invoice usdc ${runId}-C"}`,
        validator: accounts.validator.address,
      });
      const deadline = Date.now() + 60_000;
      for (;;) {
        const res = await fetch(`${stack.validatorUrl}/decisions/${purchased.jobId}`);
        if (res.ok || Date.now() > deadline) break;
        await new Promise((r) => setTimeout(r, 250));
      }
      const job = (await stack.chain.getJob(purchased.jobId))!;
      await increaseTime(Number(job.grace) + 3600);

      let error = "";
      try {
        await refund(stack, purchased.jobId);
      } catch (e) {
        error = (e as Error).message;
      }
      // Released jobs report BadState; a still-funded one with a pass reports
      // ValidationExists. Either way the money cannot be taken back.
      expect(/BadState|ValidationExists/.test(error), `C: the refund must be refused, got: ${error.slice(0, 120)}`);
      results["C_timelyPassBlocksRefund"] = { jobId: purchased.jobId, refusedWith: error.slice(0, 160) };
      timeline.mark("C_checked");
    } finally {
      await stack.stop();
    }
  }

  const report = {
    runId,
    ok: failures.length === 0,
    failures,
    cases: results,
    durationsMs: timeline.durations(),
    note: "Local Anvil; time moved with evm_increaseTime. Devnet measurement only.",
  };
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  process.exitCode = failures.length === 0 ? 0 : 1;
}

main().catch((error: unknown) => {
  process.stderr.write(`${(error as Error)?.stack ?? String(error)}\n`);
  process.exit(1);
});
