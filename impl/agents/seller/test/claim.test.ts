import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { keccak256, toHex, type Hex } from "viem";
import { createApp } from "../src/server.js";
import { createPaymentGate } from "../src/gate.js";
import { createDeliveryHandler } from "../src/deliver.js";
import { ClaimStore, defaultClaimsPath } from "../src/claims.js";
import type { NonceStore } from "../src/verify.js";
import { buildWorld, fundJob, ORIGIN, signedHeader, type World } from "./support/world.js";

/**
 * API-005 — one funded job, one execution. Across concurrency, retries and restarts.
 *
 * This is the defence the published A2 result actually calls for: 248 grants for one
 * settlement came from a seller serving one payment many times, not from a second
 * payment (V-13, DF-01).
 */
let world: World;
let dir: string;

const BODY = '{"text":"One. Two. Three."}';
const KEY = "31337:0xescrow:0xjob";

beforeAll(async () => {
  world = await buildWorld();
  dir = mkdtempSync(join(tmpdir(), "agenttrust-claims-"));
}, 90_000);

afterAll(() => rmSync(dir, { recursive: true, force: true }));

function storeAt(name: string, options: Partial<ConstructorParameters<typeof ClaimStore>[0]> = {}): ClaimStore {
  return new ClaimStore({ path: join(dir, `${name}.sqlite`), ...options });
}

/** A nonce store backed by the claim store, as the running seller uses. */
function nonces(claims: ClaimStore): NonceStore {
  return {
    seen: (jobId: Hex, nonce: Hex) => claims.seenNonce(jobId, nonce),
    remember: (jobId: Hex, nonce: Hex) => {
      claims.claimNonce(jobId, nonce);
    },
  };
}

function appWith(claims: ClaimStore, replayPolicy: "idempotent" | "strict" = "idempotent"): Express {
  return createApp({
    origin: ORIGIN,
    agentId: world.agentId.toString(),
    gated: true,
    paymentGate: createPaymentGate({
      chain: world.chain,
      config: world.quoteConfig,
      verify: { config: world.verifyConfig, nonces: nonces(claims) },
    }),
    deliver: createDeliveryHandler({ claims, chainId: world.verifyConfig.chainId, replayPolicy }),
  });
}

describe("the store itself", () => {
  it("grants exactly one claim and then reports busy", () => {
    const claims = storeAt("one-claim");
    expect(claims.acquire(KEY)).toEqual({ kind: "execute", attempt: 1 });
    expect(claims.acquire(KEY).kind).toBe("busy");
    claims.close();
  });

  it("serves a replay once a result exists, forever", () => {
    const claims = storeAt("replay");
    claims.acquire(KEY);
    claims.storeResult(KEY, Buffer.from("result"), keccak256(toHex("result")), "application/json");

    for (let i = 0; i < 10; i++) {
      const again = claims.acquire(KEY);
      expect(again.kind).toBe("replay");
      if (again.kind === "replay") expect(again.body.toString()).toBe("result");
    }
    expect(claims.metrics(KEY).executions_completed).toBe(1);
    claims.close();
  });

  /** Acceptance (c). */
  it("allows a retry after a failure, up to the limit, then gives up", () => {
    const claims = storeAt("retries", { maxAttempts: 3 });
    for (let attempt = 1; attempt <= 3; attempt++) {
      expect(claims.acquire(KEY), `attempt ${attempt}`).toEqual({ kind: "execute", attempt });
      claims.markFailed(KEY);
    }
    expect(claims.acquire(KEY).kind).toBe("exhausted");
    expect(claims.metrics(KEY).executions_completed).toBe(0);
    claims.close();
  });

  it("lets another process take over an expired lease, but only with no result", () => {
    let now = 1_000_000;
    const claims = storeAt("lease", { leaseMs: 1_000, now: () => now });
    expect(claims.acquire(KEY).kind).toBe("execute");

    now += 500;
    expect(claims.acquire(KEY).kind).toBe("busy");

    // Expired with nothing stored: "in doubt", and safe to redo only because the
    // routes are deterministic (DF-17).
    now += 1_000;
    expect(claims.acquire(KEY)).toEqual({ kind: "execute", attempt: 2 });
    expect(claims.metrics(KEY).aborted_executions).toBe(1);

    claims.storeResult(KEY, Buffer.from("r"), keccak256(toHex("r")), "application/json");
    now += 10_000;
    // A result ends the question, however stale the lease.
    expect(claims.acquire(KEY).kind).toBe("replay");
    claims.close();
  });

  it("refuses a duplicate client nonce through the UNIQUE constraint", () => {
    const claims = storeAt("nonces");
    const nonce = `0x${"11".repeat(32)}` as Hex;
    expect(claims.claimNonce(KEY, nonce)).toBe(true);
    expect(claims.claimNonce(KEY, nonce)).toBe(false);
    expect(claims.claimNonce(KEY, `0x${"22".repeat(32)}`)).toBe(true);
    claims.close();
  });

  /** Acceptance (d). */
  it("warns about a /mnt/ path and still runs", () => {
    const warnings: string[] = [];
    const claims = new ClaimStore({ path: ":memory:", warn: (m) => warnings.push(m) });
    claims.close();
    expect(warnings).toHaveLength(0);

    // The path is only inspected, not opened, so this does not touch the filesystem.
    const warned: string[] = [];
    try {
      new ClaimStore({ path: "/mnt/d/nope/claims.sqlite", warn: (m) => warned.push(m) });
    } catch {
      // Opening may fail; the warning must already have been emitted.
    }
    expect(warned.join(" ")).toMatch(/38x slower/);
    expect(warned.join(" ")).toContain(defaultClaimsPath());
  });
});

describe("persistence across a restart", () => {
  /** Acceptance (b), the recoverable half. */
  it("a result stored before a crash is replayed, never re-executed", () => {
    const path = join(dir, "restart.sqlite");
    const first = new ClaimStore({ path });
    first.acquire(KEY);
    first.storeResult(KEY, Buffer.from("survived"), keccak256(toHex("survived")), "application/json");
    first.close(); // stands in for the process dying

    const second = new ClaimStore({ path });
    const outcome = second.acquire(KEY);
    expect(outcome.kind).toBe("replay");
    if (outcome.kind === "replay") expect(outcome.body.toString()).toBe("survived");
    expect(second.metrics(KEY).executions_completed).toBe(1);
    second.close();
  });

  it("a claim with no result is retried, and only one result ever lands", () => {
    // The unrecoverable half: the process died mid-execution, so nothing was stored.
    // Re-executing is correct, and the count still ends at one.
    const path = join(dir, "restart-mid.sqlite");
    let now = 1_000;
    const first = new ClaimStore({ path, leaseMs: 100, now: () => now });
    first.acquire(KEY);
    first.close();

    now += 1_000;
    const second = new ClaimStore({ path, leaseMs: 100, now: () => now });
    expect(second.acquire(KEY)).toEqual({ kind: "execute", attempt: 2 });
    second.storeResult(KEY, Buffer.from("once"), keccak256(toHex("once")), "application/json");
    expect(second.metrics(KEY).executions_completed).toBe(1);
    expect(second.metrics(KEY).distinct_results).toBe(1);
    second.close();
  });
});

describe("end to end over HTTP", () => {
  it("executes once and replays afterwards, with the disposition saying which", async () => {
    const claims = storeAt("http-replay");
    const app = appWith(claims);
    const job = await fundJob(world, "/v1/summarise", BODY);

    const first = await request(app)
      .post("/v1/summarise")
      .set("Content-Type", "application/json")
      .set("PAYMENT-SIGNATURE", await signedHeader(world, job, "/v1/summarise", BODY))
      .send(BODY)
      .expect(200);

    const header = first.headers["payment-response"] as string;
    const settlement = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    expect(settlement.extra.disposition).toBe("executed");
    expect(settlement.extra.jobId).toBe(job.jobId);

    // A fresh signature for the same job: the work must not be done again.
    const second = await request(app)
      .post("/v1/summarise")
      .set("Content-Type", "application/json")
      .set("PAYMENT-SIGNATURE", await signedHeader(world, job, "/v1/summarise", BODY))
      .send(BODY)
      .expect(200);

    expect(second.text).toBe(first.text);
    const replay = JSON.parse(Buffer.from(second.headers["payment-response"] as string, "base64").toString("utf8"));
    expect(replay.extra.disposition).toBe("replayed");

    const metrics = claims.metrics(`${world.verifyConfig.chainId}:${world.verifyConfig.escrow.toLowerCase()}:${job.jobId.toLowerCase()}`);
    expect(metrics.executions_completed).toBe(1);
    expect(metrics.distinct_results).toBe(1);
    expect(metrics.http_2xx).toBe(2);
    expect(metrics.replays_served).toBe(1);
    claims.close();
  }, 60_000);

  it("refuses the replay under the strict policy", async () => {
    const claims = storeAt("http-strict");
    const app = appWith(claims, "strict");
    const job = await fundJob(world, "/v1/classify", BODY);

    await request(app)
      .post("/v1/classify")
      .set("Content-Type", "application/json")
      .set("PAYMENT-SIGNATURE", await signedHeader(world, job, "/v1/classify", BODY))
      .send(BODY)
      .expect(200);

    const res = await request(app)
      .post("/v1/classify")
      .set("Content-Type", "application/json")
      .set("PAYMENT-SIGNATURE", await signedHeader(world, job, "/v1/classify", BODY))
      .send(BODY);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("already_delivered");

    // Either way the work happened once.
    const key = `${world.verifyConfig.chainId}:${world.verifyConfig.escrow.toLowerCase()}:${job.jobId.toLowerCase()}`;
    expect(claims.metrics(key).executions_completed).toBe(1);
    claims.close();
  }, 60_000);

  /** Acceptance (a), the single-process half; the two-process half is the shell script. */
  it("serves 50 concurrent authenticated retries with exactly one execution", async () => {
    const claims = storeAt("http-concurrent");
    const app = appWith(claims);
    const job = await fundJob(world, "/v1/summarise", BODY);

    // Distinct signatures, as 50 genuine retries from the payer would be.
    const headers = await Promise.all(
      Array.from({ length: 50 }, () => signedHeader(world, job, "/v1/summarise", BODY)),
    );
    const responses = await Promise.all(
      headers.map((h) =>
        request(app)
          .post("/v1/summarise")
          .set("Content-Type", "application/json")
          .set("PAYMENT-SIGNATURE", h)
          .send(BODY),
      ),
    );

    const key = `${world.verifyConfig.chainId}:${world.verifyConfig.escrow.toLowerCase()}:${job.jobId.toLowerCase()}`;
    const metrics = claims.metrics(key);

    expect(metrics.executions_completed, "exactly one execution").toBe(1);
    expect(metrics.distinct_results, "exactly one distinct result").toBe(1);

    const serverErrors = responses.filter((r) => r.status >= 500);
    expect(serverErrors.map((r) => r.status), "no 5xx").toEqual([]);

    // Every response is either the result or an honest "someone else is doing it".
    const bodies = new Set(responses.filter((r) => r.status === 200).map((r) => r.text));
    expect(bodies.size, "all 200s carry identical bytes").toBeLessThanOrEqual(1);
    for (const r of responses) {
      expect([200, 409], `unexpected ${r.status}`).toContain(r.status);
    }
    claims.close();
  }, 120_000);
});
