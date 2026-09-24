/**
 * REG-006 — the agent card, and the rule the buyer checks it against.
 *
 * Discovery is what makes the seller's identity mean anything: the buyer resolves
 * `agentURI` through the Identity registry and refuses unless the card's endpoint
 * origin equals the host it is calling. Without that, the chain of trust starts at
 * whatever DNS returned.
 */
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/server.js";
import { PAID_ROUTES } from "../src/pricing.js";

const ORIGIN = "http://127.0.0.1:4097";
const VALIDATOR = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";

const app = (acceptedValidators?: string[]) =>
  createApp({ origin: ORIGIN, agentId: "7", gated: false, accessLog: false, acceptedValidators });

describe("the seller card", () => {
  it("names the agent id and an endpoint whose origin is the seller's own", async () => {
    const res = await request(app()).get("/.well-known/agent-card");
    expect(res.status).toBe(200);
    expect(res.body.agentId).toBe("7");
    expect(new URL(res.body.endpoint as string).origin).toBe(ORIGIN);
  });

  it("lists every paid route with a price in atomic units", async () => {
    const res = await request(app()).get("/.well-known/agent-card");
    const paths = (res.body.services as { path: string }[]).map((s) => s.path);
    expect(paths).toEqual(PAID_ROUTES.map((r) => r.path));
    for (const s of res.body.services as { price: { atomic: string; decimals: number } }[]) {
      expect(s.price.atomic).toMatch(/^[0-9]+$/);
      expect(s.price.decimals).toBe(6);
    }
  });

  it("publishes the validator policy, so a buyer can choose before it asks for a quote", async () => {
    const res = await request(app([VALIDATOR])).get("/.well-known/agent-card");
    expect(res.body.validatorPolicy.accepted).toEqual([VALIDATOR]);
    expect(res.body.validatorPolicy.note).toContain("extra.acceptedValidators");
  });

  it("says so when no validator policy is configured, rather than implying an empty one is the policy", async () => {
    const res = await request(app()).get("/.well-known/agent-card");
    expect(res.body.validatorPolicy.accepted).toEqual([]);
    expect(res.body.validatorPolicy.note).toContain("not configured");
  });

  it("states the origin rule on the card, so it is checkable rather than folklore", async () => {
    const res = await request(app()).get("/.well-known/agent-card");
    expect(res.body.originRule).toContain("must equal the origin the buyer is calling");
    expect(res.body.originRule).toContain("Identity registry");
  });

  it("denies x402 compliance rather than merely not claiming it", async () => {
    // The phrase "x402-compliant" does appear — inside "Nothing here should be
    // described as x402-compliant". Asserting its absence would be the wrong test and
    // would fail on the very sentence that makes the claim honest (DF-03).
    const res = await request(app()).get("/.well-known/agent-card");
    expect(res.body.interoperability).toContain("NOT interoperable");
    expect(res.body.interoperability).toContain("Nothing here should be described as x402-compliant");
    expect(res.body.protocol.scheme).toBe("agenttrust-escrow");
  });

  it("is not cacheable, like every other response", async () => {
    const res = await request(app()).get("/.well-known/agent-card");
    expect(res.headers["cache-control"]).toBe("no-store");
  });
});
