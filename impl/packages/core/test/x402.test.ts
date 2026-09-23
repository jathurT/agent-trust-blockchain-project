import { describe, expect, it } from "vitest";
import {
  caip2,
  chainIdFromCaip2,
  decodePaymentPayload,
  decodePaymentRequired,
  encodeHeader,
  selectRequirements,
  SCHEME,
  X402_VERSION,
  X402Error,
  type PaymentRequired,
  type PaymentPayload,
} from "../src/x402.js";

const ESCROW = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as const;
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;
const PAYTO = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as const;
const B32 = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as const;

function quote(overrides: Partial<PaymentRequired["accepts"][number]> = {}): PaymentRequired {
  return {
    x402Version: X402_VERSION,
    error: "No PAYMENT-SIGNATURE header provided",
    resource: { url: "https://seller.agenttrust.test/v1/summarise", mimeType: "application/json" },
    accepts: [
      {
        scheme: SCHEME,
        network: caip2(84532),
        amount: "250000",
        asset: USDC,
        payTo: PAYTO,
        maxTimeoutSeconds: 600,
        extra: {
          paymentFlow: "escrow",
          escrow: ESCROW,
          sellerAgentId: "0",
          acceptedValidators: [PAYTO],
          minDeadlineMargin: 180,
          canonicalVersion: "canonical-v1",
          quoteId: B32(9),
          expiry: 1_790_000_600,
        },
        ...overrides,
      },
    ],
    extensions: {},
  };
}

function payload(overrides: Record<string, unknown> = {}): PaymentPayload {
  return {
    x402Version: X402_VERSION,
    resource: { url: "https://seller.agenttrust.test/v1/summarise" },
    accepted: quote().accepts[0]!,
    payload: {
      jobId: B32(1),
      fundTxHash: B32(2),
      deliveryRequest: { expiry: 1_790_000_400, clientNonce: B32(3) },
      signature: `0x${"ab".repeat(65)}`,
      ...overrides,
    },
    extensions: {},
  } as PaymentPayload;
}

describe("CAIP-2", () => {
  it("round-trips a chain id", () => {
    expect(caip2(84532)).toBe("eip155:84532");
    expect(chainIdFromCaip2("eip155:84532")).toBe(84532);
  });

  it("rejects the deprecated v1 network name", () => {
    // v1 used "base-sepolia"; accepting it would let a v1 client think it was talking
    // to something it understands.
    expect(() => chainIdFromCaip2("base-sepolia")).toThrow(X402Error);
  });
});

describe("decodePaymentRequired", () => {
  it("accepts a well-formed quote", () => {
    const decoded = decodePaymentRequired(encodeHeader(quote()));
    expect(decoded.accepts[0]?.amount).toBe("250000");
  });

  it("rejects an amount written as a decimal", () => {
    // "0.25" on the wire would be 0.00000025 USDC if taken as atomic units. Refusing
    // is the only safe reading.
    expect(() => decodePaymentRequired(encodeHeader(quote({ amount: "0.25" })))).toThrow(X402Error);
  });

  it("rejects a non-address payTo and asset", () => {
    expect(() => decodePaymentRequired(encodeHeader(quote({ payTo: "not-an-address" as never })))).toThrow(X402Error);
    expect(() => decodePaymentRequired(encodeHeader(quote({ asset: "0x00" as never })))).toThrow(X402Error);
  });

  it("rejects a v1 envelope", () => {
    const v1 = { ...quote(), x402Version: 1 };
    expect(() => decodePaymentRequired(encodeHeader(v1))).toThrow(X402Error);
  });

  it("rejects malformed base64 and JSON", () => {
    expect(() => decodePaymentRequired("!!!not base64!!!")).toThrow(X402Error);
    expect(() => decodePaymentRequired(Buffer.from("{not json", "utf8").toString("base64"))).toThrow(X402Error);
  });
});

describe("selectRequirements", () => {
  const want = { chainId: 84532, asset: USDC, maxAmount: 1_000_000n };

  it("returns the matching offer", () => {
    expect(selectRequirements(decodePaymentRequired(encodeHeader(quote())), want).payTo).toBe(PAYTO);
  });

  it("refuses an offer on another chain, in another token, or over the price limit", () => {
    for (const override of [
      { network: caip2(1) },
      { asset: "0x036CbD53842c5426634e7929541eC2318f3dCF00" as never },
      { amount: "9999999" },
    ]) {
      const q = decodePaymentRequired(encodeHeader(quote(override)));
      expect(() => selectRequirements(q, want), JSON.stringify(override)).toThrow(X402Error);
    }
  });

  it("refuses a stock x402 scheme", () => {
    // A seller offering `exact` wants stock settlement, which would charge twice.
    const q = decodePaymentRequired(encodeHeader(quote({ scheme: "exact" })));
    expect(() => selectRequirements(q, want)).toThrow(X402Error);
  });

  it("says which part did not match", () => {
    const q = decodePaymentRequired(encodeHeader(quote({ amount: "9999999" })));
    expect(() => selectRequirements(q, want)).toThrow(/over the limit/);
  });
});

describe("decodePaymentPayload", () => {
  it("accepts a well-formed retry", () => {
    const decoded = decodePaymentPayload(encodeHeader(payload()));
    expect(decoded.payload.jobId).toBe(B32(1));
    expect(decoded.payload.deliveryRequest.clientNonce).toBe(B32(3));
  });

  it("rejects a jobId, nonce or signature of the wrong shape", () => {
    expect(() => decodePaymentPayload(encodeHeader(payload({ jobId: "0x01" })))).toThrow(X402Error);
    expect(() =>
      decodePaymentPayload(encodeHeader(payload({ deliveryRequest: { expiry: 1, clientNonce: "0x01" } }))),
    ).toThrow(X402Error);
    expect(() => decodePaymentPayload(encodeHeader(payload({ signature: "nope" })))).toThrow(X402Error);
  });

  it("rejects a non-numeric or absent expiry", () => {
    for (const expiry of ["1790000400", 0, -1, 1.5, Number.MAX_VALUE]) {
      expect(() =>
        decodePaymentPayload(encodeHeader(payload({ deliveryRequest: { expiry, clientNonce: B32(3) } }))),
        String(expiry),
      ).toThrow(X402Error);
    }
  });

  it("rejects a foreign scheme even when everything else is well formed", () => {
    const foreign = payload();
    foreign.accepted = { ...foreign.accepted, scheme: "exact" };
    expect(() => decodePaymentPayload(encodeHeader(foreign))).toThrow(/unsupported scheme/);
  });

  it("tolerates a missing fundTxHash, which is advisory", () => {
    const decoded = decodePaymentPayload(encodeHeader(payload({ fundTxHash: undefined })));
    expect(decoded.payload.fundTxHash).toBe("0x");
  });

  it("never throws something other than X402Error on hostile input", () => {
    const hostile = [
      encodeHeader(null),
      encodeHeader([]),
      encodeHeader("string"),
      encodeHeader({ x402Version: 2 }),
      encodeHeader({ x402Version: 2, accepted: { scheme: SCHEME, network: "eip155:1" } }),
      "",
    ];
    for (const h of hostile) {
      expect(() => decodePaymentPayload(h), h.slice(0, 24)).toThrow(X402Error);
    }
  });
});
