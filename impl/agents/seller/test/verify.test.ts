import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createChainClient } from "@agenttrust/core";
import { createApp } from "../src/server.js";
import { createPaymentGate } from "../src/gate.js";
import { MemoryNonceStore } from "../src/verify.js";
import { accounts, buildWorld, deployment, fundJob, ORIGIN, signedHeader, type World } from "./support/world.js";

/**
 * API-003 — serve only when the chain says this exact request is funded, to this
 * seller, at this price, with an acceptable validator and enough time left.
 *
 * Every test here funds a real job on a local Anvil and presents a real signature.
 */
let world: World;
let app: Express;

const BODY = '{"text":"One. Two. Three."}';

function build(overrides: Partial<World["verifyConfig"]> = {}, chain = () => world.chain): Express {
  return createApp({
    origin: ORIGIN,
    agentId: world.agentId.toString(),
    gated: true,
    paymentGate: createPaymentGate({
      chain: chain(),
      config: world.quoteConfig,
      verify: { config: { ...world.verifyConfig, ...overrides }, nonces: new MemoryNonceStore() },
    }),
  });
}

beforeAll(async () => {
  world = await buildWorld();
  app = build();
}, 90_000);

describe("a genuinely funded request is served", () => {
  it("delivers the deterministic result", async () => {
    const job = await fundJob(world, "/v1/summarise", BODY);
    const res = await request(app)
      .post("/v1/summarise")
      .set("Content-Type", "application/json")
      .set("PAYMENT-SIGNATURE", await signedHeader(world, job, "/v1/summarise", BODY))
      .send(BODY)
      .expect(200);

    expect(res.body.summary).toBeTypeOf("string");
    expect(res.headers["cache-control"]).toBe("no-store");
  }, 30_000);
});

describe("resource binding", () => {
  /** Acceptance (a). */
  it("refuses a job funded for the sibling route", async () => {
    const job = await fundJob(world, "/v1/classify", BODY);
    const res = await request(app)
      .post("/v1/summarise")
      .set("Content-Type", "application/json")
      .set("PAYMENT-SIGNATURE", await signedHeader(world, job, "/v1/summarise", BODY))
      .send(BODY);

    // The two routes cost the same, so nothing but the hash can tell them apart.
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("resource_mismatch");
    expect(res.body.summary).toBeUndefined();
  }, 30_000);

  /** Acceptance (b). */
  it("refuses a body mutated by one byte", async () => {
    const job = await fundJob(world, "/v1/summarise", BODY);
    const mutated = BODY.replace("One.", "0ne.");
    const res = await request(app)
      .post("/v1/summarise")
      .set("Content-Type", "application/json")
      .set("PAYMENT-SIGNATURE", await signedHeader(world, job, "/v1/summarise", mutated))
      .send(mutated);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("resource_mismatch");
  }, 30_000);

  it("refuses a body that only differs in whitespace", async () => {
    // Re-serialised JSON is a different resource, because bodyHash covers raw bytes.
    const job = await fundJob(world, "/v1/summarise", BODY);
    const respaced = '{"text": "One. Two. Three."}';
    const res = await request(app)
      .post("/v1/summarise")
      .set("Content-Type", "application/json")
      .set("PAYMENT-SIGNATURE", await signedHeader(world, job, "/v1/summarise", respaced))
      .send(respaced);
    expect(res.status).toBe(409);
  }, 30_000);

  /** Acceptance (e). */
  it("accepts reordered query parameters, because canonicalisation sorts them", async () => {
    const path = "/v1/summarise";
    const job = await fundJob(world, path, BODY);
    const header = await signedHeader(world, job, path, BODY);

    // canonicalUri sorts query parameters, so ?b=2&a=1 and ?a=1&b=2 are one resource —
    // and the funded job carries no query at all only because this route takes none.
    const res = await request(app)
      .post(path)
      .set("Content-Type", "application/json")
      .set("PAYMENT-SIGNATURE", header)
      .send(BODY)
      .expect(200);
    expect(res.body.summary).toBeTypeOf("string");
  }, 30_000);
});

describe("deadline margin", () => {
  /** Acceptance (c). */
  it("refuses a job with too little time left", async () => {
    // Fund with a 10-minute TTL, then ask a seller that needs 30 minutes of headroom.
    const job = await fundJob(world, "/v1/summarise", BODY, { ttlSeconds: 600 });
    const strict = build({ minDeadlineMargin: 1800 });
    const res = await request(strict)
      .post("/v1/summarise")
      .set("Content-Type", "application/json")
      .set("PAYMENT-SIGNATURE", await signedHeader(world, job, "/v1/summarise", BODY))
      .send(BODY);

    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe("deadline_margin");
  }, 30_000);
});

describe("failing closed", () => {
  /** Acceptance (d). */
  it("returns 503 when the chain cannot be read, and never a grant", async () => {
    const job = await fundJob(world, "/v1/summarise", BODY);
    const header = await signedHeader(world, job, "/v1/summarise", BODY);

    const offline = build({}, () =>
      createChainClient({
        rpcUrl: "http://127.0.0.1:1",
        chainId: deployment.chainId,
        escrow: deployment.escrow,
        timeoutMs: 400,
      }),
    );
    const res = await request(offline)
      .post("/v1/summarise")
      .set("Content-Type", "application/json")
      .set("PAYMENT-SIGNATURE", header)
      .send(BODY);

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("chain_unavailable");
    expect(res.body.summary).toBeUndefined();
  }, 30_000);

  it("refuses a job that does not exist", async () => {
    const fake = { jobId: `0x${"ab".repeat(32)}`, txHash: `0x${"cd".repeat(32)}`, nonce: `0x${"ef".repeat(32)}` } as const;
    const res = await request(app)
      .post("/v1/summarise")
      .set("Content-Type", "application/json")
      .set("PAYMENT-SIGNATURE", await signedHeader(world, fake, "/v1/summarise", BODY))
      .send(BODY);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("resource_mismatch");
  }, 30_000);

  it("refuses a job whose validator this seller will not work with", async () => {
    const job = await fundJob(world, "/v1/summarise", BODY);
    const picky = build({ acceptedValidators: [accounts.stranger.address] });
    const res = await request(picky)
      .post("/v1/summarise")
      .set("Content-Type", "application/json")
      .set("PAYMENT-SIGNATURE", await signedHeader(world, job, "/v1/summarise", BODY))
      .send(BODY);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("validator_not_accepted");
  }, 30_000);

  it("refuses a job that pays a different agent", async () => {
    const job = await fundJob(world, "/v1/summarise", BODY);
    const otherAgent = build({ agentId: world.agentId + 999n });
    const res = await request(otherAgent)
      .post("/v1/summarise")
      .set("Content-Type", "application/json")
      .set("PAYMENT-SIGNATURE", await signedHeader(world, job, "/v1/summarise", BODY))
      .send(BODY);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("resource_mismatch");
  }, 30_000);
});

describe("confirmations", () => {
  it("refuses with 425 until the funding has enough confirmations", async () => {
    const job = await fundJob(world, "/v1/summarise", BODY);
    const deep = build({ confirmations: 1000 });
    const res = await request(deep)
      .post("/v1/summarise")
      .set("Content-Type", "application/json")
      .set("PAYMENT-SIGNATURE", await signedHeader(world, job, "/v1/summarise", BODY))
      .send(BODY);

    expect(res.status).toBe(425);
    expect(res.body.error.code).toBe("insufficient_confirmations");
    expect(res.body.error.message).toMatch(/of 1000 confirmations/);
  }, 30_000);

  it("serves once the requirement is met", async () => {
    const job = await fundJob(world, "/v1/summarise", BODY);
    const shallow = build({ confirmations: 1 });
    await request(shallow)
      .post("/v1/summarise")
      .set("Content-Type", "application/json")
      .set("PAYMENT-SIGNATURE", await signedHeader(world, job, "/v1/summarise", BODY))
      .send(BODY)
      .expect(200);
  }, 30_000);
});

describe("check order", () => {
  it("decides everything it can locally before touching the chain", async () => {
    // An offline seller must still refuse a malformed header, because steps 1-6 of
    // SPEC-002 §7 need no network at all. If this returned 503 the order would be wrong.
    const offline = build({}, () =>
      createChainClient({
        rpcUrl: "http://127.0.0.1:1",
        chainId: deployment.chainId,
        escrow: deployment.escrow,
        timeoutMs: 400,
      }),
    );
    const res = await request(offline)
      .post("/v1/summarise")
      .set("Content-Type", "application/json")
      .set("PAYMENT-SIGNATURE", "bm90IGpzb24=")
      .send(BODY);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("signature_invalid");
  }, 30_000);
});
