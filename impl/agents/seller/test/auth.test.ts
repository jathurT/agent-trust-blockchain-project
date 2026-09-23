import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { decodePaymentRequired, HEADER_REQUIRED } from "@agenttrust/core";
import { createApp } from "../src/server.js";
import { createPaymentGate } from "../src/gate.js";
import { MemoryNonceStore } from "../src/verify.js";
import { accounts, buildWorld, fundJob, ORIGIN, signedHeader, type World } from "./support/world.js";

/**
 * API-004 — stop anyone who merely read `jobId` from the chain from consuming the grant.
 *
 * `jobId` is in the `JobFunded` event, so it is public the moment the buyer funds. The
 * payer signature is what turns a public identifier into an authenticated claim (DF-02).
 */
let world: World;
let app: Express;
const BODY = '{"text":"One. Two. Three."}';

beforeAll(async () => {
  world = await buildWorld();
  app = createApp({
    origin: ORIGIN,
    agentId: world.agentId.toString(),
    gated: true,
    paymentGate: createPaymentGate({
      chain: world.chain,
      config: world.quoteConfig,
      verify: { config: world.verifyConfig, nonces: new MemoryNonceStore() },
    }),
  });
}, 90_000);

describe("no signature", () => {
  it("quotes rather than forbidding", async () => {
    // A request with no payment is exactly what 402 exists for. Answering 403 would
    // tell a buyer that has never paid "forbidden" instead of "here is how to pay".
    const res = await request(app).post("/v1/summarise").set("Content-Type", "application/json").send(BODY);
    expect(res.status).toBe(402);
    const quote = decodePaymentRequired(res.headers[HEADER_REQUIRED.toLowerCase()] as string);
    expect(quote.accepts).toHaveLength(1);
  });
});

describe("a signature from someone who is not the payer", () => {
  it("is refused, even though the jobId is public", async () => {
    const job = await fundJob(world, "/v1/summarise", BODY);
    // The thief knows everything that is on-chain, and signs correctly — as itself.
    const header = await signedHeader(world, job, "/v1/summarise", BODY, { signer: accounts.stranger });

    const res = await request(app)
      .post("/v1/summarise")
      .set("Content-Type", "application/json")
      .set("PAYMENT-SIGNATURE", header)
      .send(BODY);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("signature_invalid");
    expect(res.body.summary).toBeUndefined();
  }, 30_000);

  it("is still refused when the thief replays the payer's own signature verbatim", async () => {
    const job = await fundJob(world, "/v1/summarise", BODY);
    const header = await signedHeader(world, job, "/v1/summarise", BODY);

    // First use by the genuine payer succeeds...
    await request(app)
      .post("/v1/summarise")
      .set("Content-Type", "application/json")
      .set("PAYMENT-SIGNATURE", header)
      .send(BODY)
      .expect(200);

    // ...and the captured header is worthless afterwards, because the nonce is spent.
    const res = await request(app)
      .post("/v1/summarise")
      .set("Content-Type", "application/json")
      .set("PAYMENT-SIGNATURE", header)
      .send(BODY);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("signature_replayed");
  }, 30_000);
});

describe("expiry", () => {
  it("refuses a signature that has already expired", async () => {
    const job = await fundJob(world, "/v1/summarise", BODY);
    const header = await signedHeader(world, job, "/v1/summarise", BODY, {
      expiry: Math.floor(Date.now() / 1000) - 1,
    });
    const res = await request(app)
      .post("/v1/summarise")
      .set("Content-Type", "application/json")
      .set("PAYMENT-SIGNATURE", header)
      .send(BODY);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("signature_expired");
  }, 30_000);

  it("refuses a signature that outlives the job deadline", async () => {
    // A signature good for longer than the job would let a captured header be used
    // after the buyer has already refunded.
    const job = await fundJob(world, "/v1/summarise", BODY, { ttlSeconds: 600 });
    const header = await signedHeader(world, job, "/v1/summarise", BODY, {
      expiry: Math.floor(Date.now() / 1000) + 86_400,
    });
    const res = await request(app)
      .post("/v1/summarise")
      .set("Content-Type", "application/json")
      .set("PAYMENT-SIGNATURE", header)
      .send(BODY);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("signature_expired");
  }, 30_000);
});

describe("a signature for a different seller", () => {
  it("is refused, and is indistinguishable from a forged one", async () => {
    const job = await fundJob(world, "/v1/summarise", BODY);
    const header = await signedHeader(world, job, "/v1/summarise", BODY, {
      sellerOrigin: "https://other-seller.example",
    });

    const res = await request(app)
      .post("/v1/summarise")
      .set("Content-Type", "application/json")
      .set("PAYMENT-SIGNATURE", header)
      .send(BODY);

    // The seller rebuilds the message with **its own** origin, so a signature made
    // over someone else's simply recovers to the wrong address. There is no separate
    // "wrong origin" answer to give, and giving one would confirm to a prober which
    // seller a captured signature was meant for.
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("signature_invalid");
  }, 30_000);
});

describe("a signature over a different resource", () => {
  it("is refused, because the seller signs over what it derived itself", async () => {
    const job = await fundJob(world, "/v1/summarise", BODY);
    const header = await signedHeader(world, job, "/v1/summarise", BODY, {
      resourceHash: `0x${"11".repeat(32)}`,
    });
    const res = await request(app)
      .post("/v1/summarise")
      .set("Content-Type", "application/json")
      .set("PAYMENT-SIGNATURE", header)
      .send(BODY);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("signature_invalid");
  }, 30_000);
});

describe("malformed signatures", () => {
  it("refuses garbage without reaching the chain", async () => {
    for (const header of ["", "!!!", "bm90IGpzb24=", Buffer.from("{}", "utf8").toString("base64")]) {
      const res = await request(app)
        .post("/v1/summarise")
        .set("Content-Type", "application/json")
        .set("PAYMENT-SIGNATURE", header)
        .send(BODY);
      // An empty header is "no payment offered", so it quotes; the rest are refused.
      expect([402, 403]).toContain(res.status);
      expect(res.body.summary).toBeUndefined();
    }
  }, 30_000);
});
