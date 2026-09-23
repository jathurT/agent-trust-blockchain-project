/**
 * AGENT-001 — the x402 v2 envelopes, as fixed by SPEC-002 (docs/specs/http-protocol.md).
 *
 * Buyer, seller and harness all encode and decode through this one module, so a change
 * to the wire format cannot land on one side only.
 *
 * The shapes come from the specification itself, re-checked at SPEC-002 time (V-142),
 * not from task.md §6.5 — which described the PaymentRequired and PaymentPayload
 * envelopes one level too deep. Each header carries base64 JSON:
 *
 *   PAYMENT-REQUIRED   server → client   PaymentRequired
 *   PAYMENT-SIGNATURE  client → server   PaymentPayload
 *   PAYMENT-RESPONSE   server → client   SettlementResponse
 */
import type { Address, Hex } from "viem";

export const X402_VERSION = 2;
export const SCHEME = "agenttrust-escrow";
export const HEADER_REQUIRED = "PAYMENT-REQUIRED";
export const HEADER_SIGNATURE = "PAYMENT-SIGNATURE";
export const HEADER_RESPONSE = "PAYMENT-RESPONSE";

/** CAIP-2, e.g. "eip155:84532". */
export type Caip2 = `eip155:${number}`;

export const caip2 = (chainId: number): Caip2 => `eip155:${chainId}`;

export function chainIdFromCaip2(network: string): number {
  const match = /^eip155:(\d+)$/.exec(network);
  if (!match?.[1]) throw new X402Error(`not an eip155 CAIP-2 network: ${network}`);
  return Number(match[1]);
}

export class X402Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = "X402Error";
  }
}

export interface ResourceDescriptor {
  url: string;
  description?: string;
  mimeType?: string;
}

/** Project-specific `extra`. `paymentFlow: "escrow"` is a value the v2 spec reserves. */
export interface AgentTrustExtra {
  paymentFlow: "escrow";
  escrow: Address;
  sellerAgentId: string;
  acceptedValidators: Address[];
  minDeadlineMargin: number;
  canonicalVersion: string;
  quoteId: Hex;
  expiry: number;
}

export interface PaymentRequirements {
  scheme: string;
  network: string;
  /** Atomic units as a decimal string — "250000" is 0.25 USDC, not 250,000. */
  amount: string;
  asset: Address;
  payTo: Address;
  maxTimeoutSeconds: number;
  extra: AgentTrustExtra;
}

/** The 402 body, and the decoded PAYMENT-REQUIRED header. */
export interface PaymentRequired {
  x402Version: number;
  error: string;
  resource: ResourceDescriptor;
  accepts: PaymentRequirements[];
  extensions: Record<string, unknown>;
}

/** The scheme-specific part of the retry. SPEC-002 §4 explains why it is this small. */
export interface AgentTrustPayload {
  jobId: Hex;
  /** Advisory, for logs and reconciliation. The seller reads the chain instead. */
  fundTxHash: Hex;
  /** The only DeliveryRequest fields the seller cannot re-derive for itself. */
  deliveryRequest: { expiry: number; clientNonce: Hex };
  signature: Hex;
}

export interface PaymentPayload {
  x402Version: number;
  resource: ResourceDescriptor;
  accepted: PaymentRequirements;
  payload: AgentTrustPayload;
  extensions: Record<string, unknown>;
}

export type Disposition = "executed" | "replayed";

export interface SettlementResponse {
  success: boolean;
  network: string;
  /** The **funding** transaction. Nothing settles during the HTTP exchange. */
  transaction: Hex;
  extra: {
    scheme: string;
    jobId: Hex;
    disposition: Disposition;
    responseHash: Hex;
    evidenceId?: string;
    confirmations: number;
  };
  errorReason?: string;
}

// ------------------------------------------------------------ base64 transport

export function encodeHeader(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

function decodeHeader(header: string, what: string): unknown {
  let text: string;
  try {
    text = Buffer.from(header, "base64").toString("utf8");
  } catch {
    throw new X402Error(`${what} is not valid base64`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new X402Error(`${what} is not valid JSON`);
  }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const HEX32 = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * Decode and validate a PAYMENT-SIGNATURE header.
 *
 * Everything here arrives from whoever made the request, so each field is checked for
 * shape before it is used. Passing this does **not** mean the request is authentic —
 * that is the signature recovery in SPEC-002 §7 step 4 — it only means the envelope is
 * well formed enough to reason about.
 */
export function decodePaymentPayload(header: string): PaymentPayload {
  const raw = decodeHeader(header, HEADER_SIGNATURE);
  if (!isObject(raw)) throw new X402Error(`${HEADER_SIGNATURE} is not an object`);
  if (raw["x402Version"] !== X402_VERSION) {
    throw new X402Error(`unsupported x402Version: ${String(raw["x402Version"])}`);
  }

  const accepted = raw["accepted"];
  if (!isObject(accepted)) throw new X402Error("accepted is missing");
  if (accepted["scheme"] !== SCHEME) {
    throw new X402Error(`unsupported scheme: ${String(accepted["scheme"])}`);
  }
  if (typeof accepted["network"] !== "string") throw new X402Error("accepted.network is missing");

  const payload = raw["payload"];
  if (!isObject(payload)) throw new X402Error("payload is missing");
  const request = payload["deliveryRequest"];
  if (!isObject(request)) throw new X402Error("payload.deliveryRequest is missing");

  const jobId = payload["jobId"];
  const signature = payload["signature"];
  const clientNonce = request["clientNonce"];
  const expiry = request["expiry"];

  if (typeof jobId !== "string" || !HEX32.test(jobId)) throw new X402Error("payload.jobId is not a bytes32");
  if (typeof clientNonce !== "string" || !HEX32.test(clientNonce)) {
    throw new X402Error("deliveryRequest.clientNonce is not a bytes32");
  }
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(signature)) {
    throw new X402Error("payload.signature is not hex");
  }
  if (typeof expiry !== "number" || !Number.isSafeInteger(expiry) || expiry <= 0) {
    throw new X402Error("deliveryRequest.expiry is not a unix timestamp");
  }

  const fundTxHash = payload["fundTxHash"];
  return {
    x402Version: X402_VERSION,
    resource: isObject(raw["resource"]) ? (raw["resource"] as unknown as ResourceDescriptor) : { url: "" },
    accepted: accepted as unknown as PaymentRequirements,
    payload: {
      jobId: jobId as Hex,
      fundTxHash: (typeof fundTxHash === "string" && HEX32.test(fundTxHash) ? fundTxHash : "0x") as Hex,
      deliveryRequest: { expiry, clientNonce: clientNonce as Hex },
      signature: signature as Hex,
    },
    extensions: isObject(raw["extensions"]) ? raw["extensions"] : {},
  };
}

/** Decode a PAYMENT-REQUIRED header, as the buyer does when it receives a 402. */
export function decodePaymentRequired(header: string): PaymentRequired {
  const raw = decodeHeader(header, HEADER_REQUIRED);
  if (!isObject(raw)) throw new X402Error(`${HEADER_REQUIRED} is not an object`);
  if (raw["x402Version"] !== X402_VERSION) {
    throw new X402Error(`unsupported x402Version: ${String(raw["x402Version"])}`);
  }
  const accepts = raw["accepts"];
  if (!Array.isArray(accepts) || accepts.length === 0) throw new X402Error("accepts is empty");

  for (const entry of accepts) {
    if (!isObject(entry)) throw new X402Error("accepts contains a non-object");
    if (typeof entry["amount"] !== "string" || !/^\d+$/.test(entry["amount"])) {
      throw new X402Error("amount must be a decimal string of atomic units");
    }
    for (const field of ["asset", "payTo"] as const) {
      const value = entry[field];
      if (typeof value !== "string" || !ADDRESS.test(value)) {
        throw new X402Error(`${field} is not an address`);
      }
    }
  }
  return raw as unknown as PaymentRequired;
}

/**
 * Pick the one offer this buyer can actually pay, and say why when it cannot.
 * A buyer that accepted any entry in `accepts` would be a buyer a seller could
 * redirect to an arbitrary token, chain or address.
 */
export function selectRequirements(
  quote: PaymentRequired,
  want: { chainId: number; asset: Address; maxAmount: bigint },
): PaymentRequirements {
  const reasons: string[] = [];
  for (const entry of quote.accepts) {
    if (entry.scheme !== SCHEME) {
      reasons.push(`scheme ${entry.scheme}`);
      continue;
    }
    if (entry.network !== caip2(want.chainId)) {
      reasons.push(`network ${entry.network}`);
      continue;
    }
    if (entry.asset.toLowerCase() !== want.asset.toLowerCase()) {
      reasons.push(`asset ${entry.asset}`);
      continue;
    }
    if (BigInt(entry.amount) > want.maxAmount) {
      reasons.push(`amount ${entry.amount} over the limit ${want.maxAmount}`);
      continue;
    }
    if (entry.extra?.paymentFlow !== "escrow") {
      reasons.push(`paymentFlow ${String(entry.extra?.paymentFlow)}`);
      continue;
    }
    return entry;
  }
  throw new X402Error(`no acceptable offer in the quote: ${reasons.join("; ")}`);
}
