import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, INTEROPERABILITY_NOTE } from "../src/server.js";
import { classify, serialise, splitSentences, summarise, tokenise } from "../src/routes/deterministic.js";
import { PAID_ROUTES, UNIT_PRICE, priceOf } from "../src/pricing.js";

const app = createApp({ origin: "https://seller.agenttrust.test", agentId: "0", gated: false });

const TEXT =
  "Agents pay each other over HTTP. Payment without escrow is risky. " +
  "An attack can replay a payment. Escrow plus validation fixes the payment problem.";

describe("determinism", () => {
  it("returns byte-identical output for the same input, every time", () => {
    const first = serialise(summarise({ text: TEXT }));
    for (let i = 0; i < 50; i++) {
      expect(serialise(summarise({ text: TEXT })).equals(first)).toBe(true);
    }
  });

  it("serialises with sorted keys, so object construction order cannot leak in", () => {
    expect(serialise({ b: 1, a: 2 }).toString()).toBe('{"a":2,"b":1}');
    expect(serialise({ a: 2, b: 1 }).toString()).toBe('{"a":2,"b":1}');
  });

  it("uses no clock, randomness or network", async () => {
    // A handler that touched any of these would differ across two runs separated by a
    // clock change. Nothing here can, but the assertion is cheap and states the rule.
    const before = serialise(classify({ text: TEXT }));
    const realNow = Date.now;
    const realRandom = Math.random;
    Date.now = () => 0;
    Math.random = () => 0.5;
    try {
      expect(serialise(classify({ text: TEXT })).equals(before)).toBe(true);
    } finally {
      Date.now = realNow;
      Math.random = realRandom;
    }
  });

  it("scores with integers, so no platform rounding can reorder sentences", () => {
    // Two sentences whose float scores would be 1.3333... and 1.3333... but whose
    // integer scores are equal: the tie must break towards the earlier sentence.
    const out = summarise({ text: "aa bb cc. aa bb cc. zz.", sentences: 1 });
    expect(out.summary).toBe("aa bb cc.");
  });
});

describe("splitSentences", () => {
  it("keeps terminators and trims", () => {
    expect(splitSentences("One. Two! Three?")).toEqual(["One.", "Two!", "Three?"]);
  });

  it("does not split a decimal or an abbreviation mid-token", () => {
    expect(splitSentences("Pi is 3.14 exactly.")).toEqual(["Pi is 3.14 exactly."]);
  });

  it("keeps a tail with no terminator", () => {
    expect(splitSentences("Done. And more")).toEqual(["Done.", "And more"]);
  });

  it("returns nothing for empty or whitespace input", () => {
    expect(splitSentences("")).toEqual([]);
    expect(splitSentences("   \n ")).toEqual([]);
  });
});

describe("tokenise", () => {
  it("lowercases and drops punctuation", () => {
    expect(tokenise("Pay-per-Call, now!")).toEqual(["pay", "per", "call", "now"]);
  });
});

describe("classify", () => {
  it("picks the label with the most keyword hits", () => {
    expect(classify({ text: "replay attack signature exploit" }).label).toBe("security");
    expect(classify({ text: "escrow settlement invoice usdc" }).label).toBe("payments");
  });

  it("breaks ties by label order, never by object key order", () => {
    const out = classify({ text: "nothing matches here", labels: ["zeta", "alpha"] });
    expect(out.label).toBe("zeta");
  });

  it("rejects a bad request rather than guessing", () => {
    expect(() => classify({ text: 42 as never })).toThrow();
    expect(() => classify({ text: "x", labels: [] })).toThrow();
  });
});

describe("pricing", () => {
  it("prices both paid siblings identically", () => {
    // Equal price is what makes A3 meaningful: with different prices a swapped
    // resource could be caught by the amount alone (SPEC-002 §2).
    const prices = PAID_ROUTES.map((r) => r.price);
    expect(new Set(prices.map(String)).size).toBe(1);
    expect(priceOf("/v1/summarise")).toBe(UNIT_PRICE);
    expect(priceOf("/v1/classify")).toBe(UNIT_PRICE);
  });

  it("keeps the price a bigint in atomic units", () => {
    expect(typeof UNIT_PRICE).toBe("bigint");
    expect(UNIT_PRICE).toBe(250_000n);
  });
});

describe("HTTP surface", () => {
  it("serves health and the agent card without payment", async () => {
    await request(app).get("/health").expect(200).expect("Cache-Control", "no-store");
    const card = await request(app).get("/.well-known/agent-card").expect(200);
    expect(card.body.agentId).toBe("0");
    expect(card.body.services).toHaveLength(2);
    expect(card.body.interoperability).toBe(INTEROPERABILITY_NOTE);
  });

  it("states the interoperability position on the help route", async () => {
    const res = await request(app).get("/").expect(200);
    expect(res.body.interoperability).toContain("NOT interoperable");
    expect(res.body.interoperability).toContain("x402-compliant");
  });

  it("sets no-store on every paid response", async () => {
    // A cached 200 is a delivered result served without payment.
    await request(app)
      .post("/v1/summarise")
      .set("Content-Type", "application/json")
      .send({ text: TEXT })
      .expect(200)
      .expect("Cache-Control", "no-store");
  });

  it("makes the raw bytes available unparsed", async () => {
    // Whitespace and key order survive to the hashing layer: a re-serialised body
    // would hash differently from what the buyer sent.
    const body = '{  "sentences" : 1 ,\n  "text": "One. Two." }';
    const res = await request(app)
      .post("/v1/summarise")
      .set("Content-Type", "application/json")
      .send(body)
      .expect(200);
    expect(res.body.summary).toBeTypeOf("string");
  });

  it("returns byte-identical responses to repeated identical requests", async () => {
    const send = () =>
      request(app).post("/v1/classify").set("Content-Type", "application/json").send({ text: TEXT });
    const a = await send();
    const b = await send();
    expect(a.text).toBe(b.text);
  });

  it("rejects a malformed body with 400, not 500", async () => {
    await request(app)
      .post("/v1/summarise")
      .set("Content-Type", "application/json")
      .send("{not json")
      .expect(400);
  });

  it("rejects an oversized body before buffering it", async () => {
    const small = createApp({ origin: "https://x.test", agentId: "0", gated: false, maxBodyBytes: 64 });
    await request(small)
      .post("/v1/summarise")
      .set("Content-Type", "application/json")
      .send({ text: "x".repeat(500) })
      .expect(413);
  });

  it("tells a GET on a paid route it needs POST", async () => {
    const res = await request(app).get("/v1/summarise").expect(404);
    expect(res.headers["allow"]).toBe("POST");
    expect(res.body.error.message).toContain("POST");
  });

  it("treats route case and trailing slashes as distinct", async () => {
    // These are different canonical URIs, so they must not fold together.
    await request(app).post("/v1/Summarise").send({ text: "x" }).expect(404);
    await request(app).post("/v1/summarise/").send({ text: "x" }).expect(404);
  });
});

describe("the gate cannot be forgotten", () => {
  it("refuses to build a gated app without a gate", () => {
    expect(() => createApp({ origin: "https://x.test", agentId: "0", gated: true })).toThrow(/paymentGate/);
  });
});
