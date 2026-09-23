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
import { verifyRequest, type NonceStore, type VerifiedRequest, type VerifyConfig } from "./verify.js";
import type { ClaimStore } from "./claims.js";

export interface GateDeps {
  chain: ChainClient;
  config: QuoteConfig;
  /** Present once API-003/004 are wired; absent leaves the gate quote-only. */
  verify?: { config: VerifyConfig; nonces: NonceStore };
  /** API-005. Absent means one execution is not enforced, so the gate refuses to run. */
  claims?: ClaimStore;
  /** SPEC-002 §6.2. `idempotent` re-serves stored bytes to the payer; `strict` refuses. */
  replayPolicy?: "idempotent" | "strict";
  /** Injected so tests can pin time; defaults to the wall clock. */
  now?: () => number;
}

/** Attached to the request once verification passes, for the handler and API-005. */
export interface GatedRequest extends RawRequest {
  verified?: VerifiedRequest;
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

    if (!deps.verify) {
      // Quote-only build. A presented payment is refused rather than honoured: serving
      // on an unverified header would be the whole attack.
      sendError(res, new SellerError("chain_unavailable", "payment verification is not configured"));
      return;
    }

    const verifyDeps = { chain: deps.chain, config: deps.verify.config, nonces: deps.verify.nonces, now: deps.now };
    verifyRequest(verifyDeps, req)
      .then(async (verified) => {
        // The nonce is spent once the request is known to be genuine and payable.
        await deps.verify!.nonces.remember(verified.jobId, verified.clientNonce);
        (req as GatedRequest).verified = verified;
        next();
      })
      .catch((error: unknown) => {
        if (error instanceof SellerError) return sendError(res, error);
        return sendError(res, new SellerError("execution_failed", (error as Error)?.message));
      });
  };
}
