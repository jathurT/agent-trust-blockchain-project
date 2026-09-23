/**
 * The payment gate: the middleware every paid route passes through.
 *
 * API-002 builds the 402 half. API-003 (funded-job verification), API-004 (payer
 * signature) and API-005 (the delivery claim) fill in the rest, in the order SPEC-002 §7
 * fixes — with the claim taken **last**, so an unauthenticated caller can never burn a
 * buyer's grant.
 */
import type { NextFunction, Response } from "express";
import { encodeHeader, HEADER_REQUIRED, type ChainClient } from "@agenttrust/core";
import type { RawRequest } from "./rawBody.js";
import { buildPaymentRequired, resolvePayee, QuoteError, type QuoteConfig } from "./quote.js";
import { SellerError, sendError } from "./errors.js";

export interface GateDeps {
  chain: ChainClient;
  config: QuoteConfig;
  /** Injected so tests can pin time; defaults to the wall clock. */
  now?: () => number;
}

/**
 * Answer with a 402 carrying the quote. The `payTo` is resolved from the chain on every
 * quote rather than cached, because the escrow resolves it again at funding time and a
 * stale value would advertise an address the escrow would not pay.
 */
export async function sendQuote(deps: GateDeps, req: RawRequest, res: Response, error?: string): Promise<void> {
  const now = Math.floor((deps.now?.() ?? Date.now()) / 1000);
  const payee = await resolvePayee(deps.chain, deps.config.agentId);
  const quote = buildPaymentRequired(deps.config, { path: req.path, payee, now, error });

  res
    .status(402)
    .set(HEADER_REQUIRED, encodeHeader(quote))
    .set("Cache-Control", "no-store")
    .json(quote);
}

export function createPaymentGate(deps: GateDeps) {
  return function paymentGate(req: RawRequest, res: Response, next: NextFunction): void {
    const header = req.get("PAYMENT-SIGNATURE");

    // No payment offered: quote and stop. This path reads the chain once, writes
    // nothing, and takes no claim.
    if (!header) {
      sendQuote(deps, req, res).catch((error: unknown) => {
        if (error instanceof QuoteError) return sendError(res, new SellerError("chain_unavailable", error.message));
        return sendError(res, new SellerError("chain_unavailable", (error as Error)?.message));
      });
      return;
    }

    // API-003/004/005 land here. Until they do, a presented payment is refused rather
    // than honoured: serving on an unverified header would be the whole attack.
    sendError(
      res,
      new SellerError("chain_unavailable", "payment verification is not implemented yet (API-003..005)"),
    );
    next; // referenced so the signature stays honest about being middleware
  };
}
