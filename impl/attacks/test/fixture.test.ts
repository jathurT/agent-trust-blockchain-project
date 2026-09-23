import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { keccak256, toHex, type Address, type Hex } from "viem";
import {
  createVulnerableFixture,
  FIXTURE_HEADER,
  FIXTURE_LABEL,
  FIXTURE_ID,
  type VulnerableAuthorization,
} from "../src/index.js";

/**
 * API-008 — the fixture must be (a) clearly labelled everywhere and (b) genuinely
 * vulnerable in the two specific ways the published attacks exploit. A fixture that
 * quietly worked would make the evaluation meaningless.
 */
const PAY_TO = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as Address;
const PRICE = 250_000n;
const BODY = '{"text":"One. Two. Three."}';

function authorization(overrides: Partial<VulnerableAuthorization> = {}): string {
  const auth: VulnerableAuthorization = {
    from: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address,
    to: PAY_TO,
    value: PRICE.toString(),
    validAfter: 0,
    validBefore: Math.floor(Date.now() / 1000) + 3600,
    nonce: keccak256(toHex("authorization-1")) as Hex,
    signature: `0x${"ab".repeat(65)}` as Hex,
    ...overrides,
  };
  return Buffer.from(JSON.stringify(auth), "utf8").toString("base64");
}

const build = (settle?: (a: VulnerableAuthorization) => Promise<{ ok: boolean; detail: string }>) =>
  createVulnerableFixture({ price: PRICE, payTo: PAY_TO, settle, log: () => {} });

describe("labelling", () => {
  it("names itself in the help route, the metrics and the response header", async () => {
    const fixture = build();
    const help = await request(fixture.app).get("/").expect(200);
    expect(help.body.label).toBe(FIXTURE_LABEL);
    expect(help.body.isVulnerableByDesign).toBe(true);
    expect(help.body.isUpstreamX402).toBe(false);
    expect(help.body.fixture).toBe(FIXTURE_ID);

    const served = await request(fixture.app)
      .post("/v1/summarise")
      .set("PAYMENT-SIGNATURE", authorization())
      .send(BODY)
      .expect(200);
    // The header carries the ASCII short form: the full label has an em dash, which
    // Node rejects in a header value.
    expect(served.headers["x-fixture-label"]).toBe(FIXTURE_HEADER);
    expect(FIXTURE_HEADER).toMatch(/^[\x20-\x7e]+$/);
    expect(FIXTURE_HEADER).toContain("not-upstream-x402");

    const metrics = await request(fixture.app).get("/__fixture/metrics").expect(200);
    expect(metrics.body.label).toBe(FIXTURE_LABEL);
  });

  it("says what it is not, in as many words", () => {
    // SEC-012 audits this string. It must deny upstream explicitly, not merely omit it.
    expect(FIXTURE_LABEL).toContain("DELIBERATELY VULNERABLE FIXTURE");
    expect(FIXTURE_LABEL).toContain("NOT upstream x402");
    expect(FIXTURE_LABEL).toContain("NOT the @x402/* packages");
    expect(FIXTURE_LABEL).toMatch(/2605\.11781/);
    expect(FIXTURE_LABEL).toMatch(/2605\.30998/);
  });

  it("logs the banner on startup and on every grant", async () => {
    const lines: Record<string, unknown>[] = [];
    const fixture = createVulnerableFixture({ price: PRICE, payTo: PAY_TO, log: (l) => lines.push(l) });
    expect(lines[0]?.["label"]).toBe(FIXTURE_LABEL);

    await request(fixture.app).post("/v1/summarise").set("PAYMENT-SIGNATURE", authorization()).send(BODY);
    const grant = lines.find((l) => l["msg"] === "granted");
    expect(grant?.["label"]).toBe(FIXTURE_LABEL);
  });
});

describe("A2 — replay without idempotency", () => {
  it("grants N times for one authorization replayed N times", async () => {
    const fixture = build();
    const auth = authorization();
    const N = 20;

    for (let i = 0; i < N; i++) {
      const res = await request(fixture.app)
        .post("/v1/summarise")
        .set("PAYMENT-SIGNATURE", auth)
        .send(BODY)
        .expect(200);
      expect(JSON.parse(res.text).summary).toBeTypeOf("string");
    }

    // The published condition: no idempotency, so replays are grants (V-13).
    expect(fixture.grants).toHaveLength(N);
    const nonce = JSON.parse(Buffer.from(auth, "base64").toString("utf8")).nonce as string;
    expect(fixture.grantsByAuthorization()[nonce]).toBe(N);
    expect(fixture.grants.map((g) => g.grantIndex)).toEqual(Array.from({ length: N }, (_, i) => i + 1));
  });

  it("grants far more often than it settles", async () => {
    // Settlement is asynchronous and does not gate the grant, which is what makes the
    // two countable separately -- the shape of the 248-grants/1-settlement result.
    const settle = vi.fn(async () => ({ ok: true, detail: "settled" }));
    const fixture = build(settle);
    const auth = authorization({ nonce: keccak256(toHex("one-authorization")) });

    for (let i = 0; i < 10; i++) {
      await request(fixture.app).post("/v1/classify").set("PAYMENT-SIGNATURE", auth).send(BODY).expect(200);
    }
    await fixture.settled();

    expect(fixture.grants).toHaveLength(10);
    // A real token would reject the repeats; the fixture does not wait to find out.
    expect(settle).toHaveBeenCalledTimes(10);
  });

  it("does not wait for settlement before granting", async () => {
    let released: (() => void) | undefined;
    const slow = new Promise<void>((resolve) => {
      released = resolve;
    });
    const fixture = build(async () => {
      await slow;
      return { ok: true, detail: "eventually" };
    });

    // The grant returns while settlement is still pending. If it blocked, this would
    // time out instead.
    await request(fixture.app).post("/v1/summarise").set("PAYMENT-SIGNATURE", authorization()).send(BODY).expect(200);
    expect(fixture.grants).toHaveLength(1);
    expect(fixture.settlements).toHaveLength(0);

    released?.();
    await fixture.settled();
    expect(fixture.settlements).toHaveLength(1);
  });
});

describe("A3 — no resource binding", () => {
  it("accepts an authorization minted for one sibling against the other", async () => {
    const fixture = build();
    // One authorization. Two different resources at the same price. The EIP-3009
    // authorization names `from`, `to`, `value` and a nonce -- and nothing at all
    // about which resource is being bought, so there is nothing here to check.
    const auth = authorization({ nonce: keccak256(toHex("for-summarise")) });

    const first = await request(fixture.app)
      .post("/v1/summarise")
      .set("PAYMENT-SIGNATURE", auth)
      .send(BODY)
      .expect(200);
    const second = await request(fixture.app)
      .post("/v1/classify")
      .set("PAYMENT-SIGNATURE", auth)
      .send(BODY)
      .expect(200);

    expect(JSON.parse(first.text).summary).toBeTypeOf("string");
    expect(JSON.parse(second.text).label).toBeTypeOf("string");
    expect(fixture.grants.map((g) => g.path)).toEqual(["/v1/summarise", "/v1/classify"]);
  });

  it("accepts an authorization against a body it was never minted for", async () => {
    const fixture = build();
    const auth = authorization();
    await request(fixture.app).post("/v1/summarise").set("PAYMENT-SIGNATURE", auth).send(BODY).expect(200);
    await request(fixture.app)
      .post("/v1/summarise")
      .set("PAYMENT-SIGNATURE", auth)
      .send('{"text":"something else entirely"}')
      .expect(200);
    expect(fixture.grants).toHaveLength(2);
    // Different requests, different results, one authorization.
    expect(fixture.grants[0]?.responseHash).not.toBe(fixture.grants[1]?.responseHash);
  });
});

describe("what it does still check", () => {
  it("refuses an under-priced, mis-addressed or expired authorization", async () => {
    const fixture = build();
    const cases: [string, string][] = [
      ["amount too low", authorization({ value: "1" })],
      ["wrong payee", authorization({ to: "0x0000000000000000000000000000000000000dEaD" as Address })],
      ["expired", authorization({ validBefore: 1 })],
      ["not yet valid", authorization({ validAfter: Math.floor(Date.now() / 1000) + 3600 })],
    ];
    for (const [name, header] of cases) {
      const res = await request(fixture.app).post("/v1/summarise").set("PAYMENT-SIGNATURE", header).send(BODY);
      expect(res.status, name).toBe(402);
      expect(res.body.label, name).toBe(FIXTURE_LABEL);
    }
    expect(fixture.grants).toHaveLength(0);
  });

  it("quotes when no authorization is presented", async () => {
    const fixture = build();
    const res = await request(fixture.app).post("/v1/summarise").send(BODY).expect(402);
    expect(res.body.accepts[0].amount).toBe(PRICE.toString());
    expect(res.body.isVulnerableByDesign).toBe(true);
  });
});
