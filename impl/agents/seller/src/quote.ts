/**
 * API-002 — the 402 quote, in the x402 v2 wire format.
 *
 * Shapes are SPEC-002 §3, which fixed them against the specification itself (V-142).
 * Nothing in this file settles anything: there is no facilitator call and no
 * `paymentMiddleware`, because the stock middleware performs its own settlement and,
 * mounted alongside the escrow, would charge the buyer twice (DF-03).
 */
import {
  caip2,
  atomicToWire,
  escrowAbi,
  SCHEME,
  X402_VERSION,
  type ChainClient,
  type PaymentRequired,
  type PaymentRequirements,
} from "@agenttrust/core";
import { keccak256, toHex, type Address, type Hex } from "viem";
import { routeFor, TOKEN_DECIMALS } from "./pricing.js";

export interface QuoteConfig {
  origin: string;
  agentId: bigint;
  escrow: Address;
  token: Address;
  chainId: number;
  acceptedValidators: Address[];
  /** Seconds the seller wants the buyer to pass to `fund()` as the TTL. */
  ttlSeconds: number;
  /** Seconds of headroom the seller needs after delivery (SPEC-002 §7.1). */
  minDeadlineMargin: number;
  /** Seconds a quote is advertised as good for. */
  quoteTtlSeconds: number;
}

export class QuoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuoteError";
  }
}

/**
 * Resolve the address the escrow will snapshot as the payee.
 *
 * Read from the chain, not from configuration. `previewPayee` runs the same
 * `getAgentWallet` → `ownerOf` fallback the escrow uses at funding time (DF-12), so a
 * quote cannot advertise a `payTo` that the escrow would not actually pay. A seller
 * that typed its own address into a config file would eventually transfer its agent NFT
 * and start quoting an address that no longer receives anything.
 */
export async function resolvePayee(chain: ChainClient, agentId: bigint): Promise<Address> {
  const payee = (await chain.client.readContract({
    address: chain.escrow,
    abi: escrowAbi,
    functionName: "previewPayee",
    args: [agentId],
  })) as Address;
  if (payee === "0x0000000000000000000000000000000000000000") {
    throw new QuoteError(`agent ${agentId} resolves to the zero address`);
  }
  return payee;
}

/**
 * The advisory quote identifier. It commits to the request, the price and the expiry,
 * so a buyer can tell two quotes apart — but it **authenticates nothing**: the seller
 * does not sign it, so anyone can mint one. The binding that matters is `resourceHash`,
 * which `fund()` computes on-chain from the same inputs (DF-04). The EIP-712 signed
 * quote that would make this meaningful is E1 (SPEC-002b / CONTRACT-006).
 */
export function quoteId(input: {
  origin: string;
  path: string;
  price: bigint;
  token: Address;
  chainId: number;
  expiry: number;
}): Hex {
  return keccak256(
    toHex(
      ["agenttrust-quote-v1", input.origin, input.path, input.price.toString(), input.token, String(input.chainId), String(input.expiry)].join(
        "\n",
      ),
    ),
  );
}

export interface BuildQuoteOptions {
  path: string;
  payee: Address;
  /** Unix seconds; injected so the quote is testable and the handler stays pure. */
  now: number;
  error?: string;
}

export function buildPaymentRequired(config: QuoteConfig, options: BuildQuoteOptions): PaymentRequired {
  const route = routeFor(options.path);
  if (!route) throw new QuoteError(`no price for ${options.path}`);

  const expiry = options.now + config.quoteTtlSeconds;
  const requirements: PaymentRequirements = {
    scheme: SCHEME,
    network: caip2(config.chainId),
    // Atomic units as a decimal string. "250000" is 0.25 USDC — never a display value.
    amount: atomicToWire(route.price),
    asset: config.token,
    payTo: options.payee,
    maxTimeoutSeconds: config.ttlSeconds,
    extra: {
      paymentFlow: "escrow",
      escrow: config.escrow,
      sellerAgentId: config.agentId.toString(),
      acceptedValidators: config.acceptedValidators,
      minDeadlineMargin: config.minDeadlineMargin,
      canonicalVersion: "canonical-v1",
      quoteId: quoteId({
        origin: config.origin,
        path: options.path,
        price: route.price,
        token: config.token,
        chainId: config.chainId,
        expiry,
      }),
      expiry,
    },
  };

  return {
    x402Version: X402_VERSION,
    error: options.error ?? "No PAYMENT-SIGNATURE header provided",
    resource: {
      // The **configured** origin, never the Host header (DF-04).
      url: `${config.origin}${options.path}`,
      description: route.description,
      mimeType: route.mimeType,
    },
    accepts: [requirements],
    extensions: {},
  };
}

export const TOKEN_DECIMALS_FOR_DISPLAY = TOKEN_DECIMALS;
