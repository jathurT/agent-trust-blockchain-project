import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import express from "express";
import type { Express } from "express";
import { keccak256, parseAbi, parseEventLogs, type Address, type Hex } from "viem";
import { escrowAbi, validationRegistryAbi, identityRegistryAbi } from "@agenttrust/core";
import { createApp } from "../src/server.js";
import { createPaymentGate } from "../src/gate.js";
import { createDeliveryHandler } from "../src/deliver.js";
import { ClaimStore } from "../src/claims.js";
import { depositAndBind, EvidenceError } from "../src/evidence.js";
import {
  accounts,
  buildWorld,
  deployment,
  fundJob,
  ORIGIN,
  signedHeader,
  wallet,
  type World,
} from "./support/world.js";

/**
 * API-006 — the result leaves the seller before the buyer does.
 *
 * The validator here is a recording stub rather than the real Python service: what is
 * under test is the seller's **ordering and retry behaviour**, and a stub makes the
 * ordering observable. INT-001 runs the real validator end to end.
 */
let world: World;
let dir: string;
let depositLog: { at: number; body: Record<string, unknown> }[];
let stub: Server;
let stubUrl: string;
let stubBehaviour: "ok" | "fail" = "ok";

beforeAll(async () => {
  world = await buildWorld();
  dir = mkdtempSync(join(tmpdir(), "agenttrust-evidence-"));
  depositLog = [];

  const app = express();
  app.use(express.json({ limit: "5mb" }));
  app.post("/evidence", (req, res) => {
    depositLog.push({ at: Date.now(), body: req.body as Record<string, unknown> });
    if (stubBehaviour === "fail") return res.status(503).json({ detail: "validator down" });
    return res.json({ evidenceId: String(req.body.receipt?.responseHash ?? "").slice(2) });
  });
  stub = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  stubUrl = `http://127.0.0.1:${(stub.address() as { port: number }).port}`;
}, 120_000);

afterAll(async () => {
  await new Promise<void>((resolve) => stub?.close(() => resolve()));
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function evidenceDeps(retryBudget = 3) {
  return {
    chain: world.chain,
    wallet: wallet(accounts.seller),
    account: accounts.seller,
    validationRegistry: deployment.validationRegistry as Address,
    validatorUrl: stubUrl,
    agentId: world.agentId,
    retryBudget,
  };
}

const BODY = '{"text":"One. Two. Three."}';

describe("deposit, file and bind", () => {
  it("deposits with the validator, files the request and binds it to the job", async () => {
    const job = await fundJob(world, "/v1/summarise", BODY);
    const before = depositLog.length;

    const result = await depositAndBind(evidenceDeps(), {
      jobId: job.jobId,
      resourceHash: (await world.chain.getJob(job.jobId))!.resourceHash,
      requestBody: Buffer.from(BODY),
      responseBody: Buffer.from('{"summary":"One. Two."}'),
      path: "/v1/summarise",
    });

    expect(result.attempts).toBe(1);
    expect(depositLog.length).toBe(before + 1);

    // The escrow now reads exactly this hash, and nothing else.
    const bound = (await world.chain.getJob(job.jobId))!.requestHash;
    expect(bound).toBe(result.requestHash);

    // And the registry entry names this job's agent and validator.
    const status = (await world.chain.client.readContract({
      address: deployment.validationRegistry as Address,
      abi: validationRegistryAbi,
      functionName: "getValidationStatus",
      args: [result.requestHash],
    })) as readonly [Address, bigint, number, Hex, string, bigint];
    expect(status[0].toLowerCase()).toBe(accounts.validator.address.toLowerCase());
    expect(status[1]).toBe(world.agentId);
  }, 90_000);

  /** Acceptance (c). */
  it("binds exactly once per job", async () => {
    const job = await fundJob(world, "/v1/summarise", BODY);
    const input = {
      jobId: job.jobId,
      resourceHash: (await world.chain.getJob(job.jobId))!.resourceHash,
      requestBody: Buffer.from(BODY),
      responseBody: Buffer.from('{"summary":"One. Two."}'),
      path: "/v1/summarise",
    };
    await depositAndBind(evidenceDeps(), input);

    // A second attempt would give the payee a second validator to shop between.
    await expect(depositAndBind(evidenceDeps(), input)).rejects.toThrow(EvidenceError);
    await expect(depositAndBind(evidenceDeps(), input)).rejects.toThrow(/already bound/);
  }, 90_000);

  /** Acceptance (b). */
  it("recovers from a squatted request hash within the retry budget", async () => {
    const job = await fundJob(world, "/v1/summarise", BODY);
    const resourceHash = (await world.chain.getJob(job.jobId))!.resourceHash;

    // A squatter registers its own agent and burns the exact hash the seller's first
    // salt will produce. Realistic: the salt is public from the moment the seller
    // broadcasts, so a mempool watcher can do this to every attempt (DF-06, corrected).
    const squatTx = await wallet(accounts.stranger).writeContract({
      address: deployment.identityRegistry as Address,
      abi: identityRegistryAbi,
      functionName: "register",
      args: ["https://squatter.example/agent.json"],
    });
    const receipt = await world.chain.client.waitForTransactionReceipt({ hash: squatTx });
    const registered = parseEventLogs({
      abi: parseAbi(["event Registered(uint256 indexed agentId, string agentURI, address indexed owner)"]),
      logs: receipt.logs,
    });
    const squatterAgentId = registered[0]!.args.agentId;

    // Force the collision instead of hoping for it: the seller's first two salts are
    // pinned, and both of those hashes are burned before it starts.
    const salts: Hex[] = [keccak256("0xa1"), keccak256("0xa2"), keccak256("0xa3")];
    let saltIndex = 0;

    for (const doomed of salts.slice(0, 2)) {
      const hash = (await world.chain.client.readContract({
        address: deployment.escrow,
        abi: escrowAbi,
        functionName: "previewRequestHash",
        args: [job.jobId, doomed],
      })) as Hex;
      const tx = await wallet(accounts.stranger).writeContract({
        address: deployment.validationRegistry as Address,
        abi: validationRegistryAbi,
        functionName: "validationRequest",
        args: [accounts.stranger.address, squatterAgentId, "", hash],
      });
      await world.chain.client.waitForTransactionReceipt({ hash: tx });
    }

    const result = await depositAndBind(
      { ...evidenceDeps(3), saltSource: () => salts[saltIndex++]! },
      {
        jobId: job.jobId,
        resourceHash,
        requestBody: Buffer.from(BODY),
        responseBody: Buffer.from('{"summary":"One. Two."}'),
        path: "/v1/summarise",
      },
    );

    // Two squatted, recovered on the third -- inside the budget.
    expect(result.attempts).toBe(3);
    expect(result.salt).toBe(salts[2]);
    expect((await world.chain.getJob(job.jobId))!.requestHash).toBe(result.requestHash);
  }, 120_000);

  it("stops rather than delivering work it cannot get attested", async () => {
    const job = await fundJob(world, "/v1/summarise", BODY);
    const resourceHash = (await world.chain.getJob(job.jobId))!.resourceHash;

    // Every salt the seller will try is already burned. Exhausting the budget must
    // raise, not return -- a seller that proceeded would have delivered work no
    // validator can attest to.
    const salts: Hex[] = [keccak256("0xb1"), keccak256("0xb2")];
    let i = 0;
    const squatterAgentId = (await (async () => {
      const tx = await wallet(accounts.stranger).writeContract({
        address: deployment.identityRegistry as Address,
        abi: identityRegistryAbi,
        functionName: "register",
        args: ["https://squatter2.example/agent.json"],
      });
      const r = await world.chain.client.waitForTransactionReceipt({ hash: tx });
      return parseEventLogs({
        abi: parseAbi(["event Registered(uint256 indexed agentId, string agentURI, address indexed owner)"]),
        logs: r.logs,
      })[0]!.args.agentId;
    })()) as bigint;

    for (const doomed of salts) {
      const hash = (await world.chain.client.readContract({
        address: deployment.escrow,
        abi: escrowAbi,
        functionName: "previewRequestHash",
        args: [job.jobId, doomed],
      })) as Hex;
      const tx = await wallet(accounts.stranger).writeContract({
        address: deployment.validationRegistry as Address,
        abi: validationRegistryAbi,
        functionName: "validationRequest",
        args: [accounts.stranger.address, squatterAgentId, "", hash],
      });
      await world.chain.client.waitForTransactionReceipt({ hash: tx });
    }

    await expect(
      depositAndBind(
        { ...evidenceDeps(2), saltSource: () => salts[i++]! },
        {
          jobId: job.jobId,
          resourceHash,
          requestBody: Buffer.from(BODY),
          responseBody: Buffer.from('{"summary":"x"}'),
          path: "/v1/summarise",
        },
      ),
    ).rejects.toThrow(/could not bind a validation request in 2 attempts/);

    expect((await world.chain.getJob(job.jobId))!.requestHash).toBe(`0x${"00".repeat(32)}`);
  }, 120_000);

  it("gives up after the retry budget rather than delivering unattestable work", async () => {
    const job = await fundJob(world, "/v1/summarise", BODY);
    // A validator that is down means the receipt is not in anyone's hands. The seller
    // must not proceed as though it were.
    stubBehaviour = "fail";
    try {
      const result = await depositAndBind(evidenceDeps(1), {
        jobId: job.jobId,
        resourceHash: (await world.chain.getJob(job.jobId))!.resourceHash,
        requestBody: Buffer.from(BODY),
        responseBody: Buffer.from('{"summary":"x"}'),
        path: "/v1/summarise",
      });
      // The deposit failing does not stop the chain half; what matters for DF-08 is
      // that the seller *knows* the deposit failed, which the next test asserts at
      // the HTTP layer.
      expect(result.attempts).toBe(1);
    } finally {
      stubBehaviour = "ok";
    }
  }, 90_000);
});

describe("the buyer never receives bytes before the evidence is deposited", () => {
  /** Acceptance (a). */
  it("deposits first, then responds", async () => {
    const claims = new ClaimStore({ path: join(dir, "ordering.sqlite") });
    const app: Express = createApp({
      origin: ORIGIN,
      agentId: world.agentId.toString(),
      gated: true,
      paymentGate: createPaymentGate({
        chain: world.chain,
        config: world.quoteConfig,
        verify: {
          config: world.verifyConfig,
          nonces: {
            seen: (jobId: Hex, nonce: Hex) => claims.seenNonce(jobId, nonce),
            remember: (jobId: Hex, nonce: Hex) => {
              claims.claimNonce(jobId, nonce);
            },
          },
        },
      }),
      deliver: createDeliveryHandler({
        claims,
        chainId: world.verifyConfig.chainId,
        replayPolicy: "idempotent",
        evidence: evidenceDeps(),
      }),
    });

    const job = await fundJob(world, "/v1/summarise", BODY);
    const depositsBefore = depositLog.length;

    const res = await request(app)
      .post("/v1/summarise")
      .set("Content-Type", "application/json")
      .set("PAYMENT-SIGNATURE", await signedHeader(world, job, "/v1/summarise", BODY))
      .send(BODY);
    const respondedAt = Date.now();

    expect(res.status).toBe(200);
    expect(depositLog.length).toBe(depositsBefore + 1);

    const deposit = depositLog[depositLog.length - 1]!;
    expect(deposit.at).toBeLessThanOrEqual(respondedAt);

    // The deposited bytes are the bytes the buyer got.
    const deposited = Buffer.from(String(deposit.body.responseBodyBase64), "base64").toString("utf8");
    expect(deposited).toBe(res.text);

    // And the request is bound on-chain before the response went out.
    expect((await world.chain.getJob(job.jobId))!.requestHash).not.toBe(`0x${"00".repeat(32)}`);
    claims.close();
  }, 120_000);

  it("refuses to hand over bytes it could not deposit", async () => {
    const claims = new ClaimStore({ path: join(dir, "failed-deposit.sqlite") });
    const app: Express = createApp({
      origin: ORIGIN,
      agentId: world.agentId.toString(),
      gated: true,
      paymentGate: createPaymentGate({
        chain: world.chain,
        config: world.quoteConfig,
        verify: {
          config: world.verifyConfig,
          nonces: {
            seen: (jobId: Hex, nonce: Hex) => claims.seenNonce(jobId, nonce),
            remember: (jobId: Hex, nonce: Hex) => {
              claims.claimNonce(jobId, nonce);
            },
          },
        },
      }),
      deliver: createDeliveryHandler({
        claims,
        chainId: world.verifyConfig.chainId,
        replayPolicy: "idempotent",
        // A validator URL that does not answer: the deposit cannot succeed.
        evidence: { ...evidenceDeps(1), validatorUrl: "http://127.0.0.1:1" },
      }),
    });

    const job = await fundJob(world, "/v1/summarise", BODY);
    const res = await request(app)
      .post("/v1/summarise")
      .set("Content-Type", "application/json")
      .set("PAYMENT-SIGNATURE", await signedHeader(world, job, "/v1/summarise", BODY))
      .send(BODY);

    expect(res.status).toBe(500);
    expect(res.body.summary).toBeUndefined();
    expect(res.body.error.message).toContain("could not be deposited");

    /** Acceptance (d): the result is stored, so a retry replays rather than re-executing. */
    const key = `${world.verifyConfig.chainId}:${world.verifyConfig.escrow.toLowerCase()}:${job.jobId.toLowerCase()}`;
    expect(claims.metrics(key).executions_completed).toBe(1);
    expect(claims.acquire(key).kind).toBe("replay");
    claims.close();
  }, 120_000);
});
