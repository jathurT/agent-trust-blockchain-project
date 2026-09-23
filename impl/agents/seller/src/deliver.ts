/**
 * API-005 — the delivery step: take the claim, execute once, persist, then send.
 *
 * The order is the whole point, and it is the reverse of the obvious one:
 *
 *   1. take the claim — **after** every check in SPEC-002 §7, so an unauthenticated
 *      caller can never burn a buyer's grant;
 *   2. execute;
 *   3. **persist the result**;
 *   4. only then write bytes to the socket.
 *
 * Step 3 before step 4 is what makes a crash recoverable. If the bytes went first, a
 * process that died in between would leave a job that looks untouched but has already
 * been delivered, and the next request would execute it again.
 */
import { keccak256, type Hex } from "viem";
import type { NextFunction, Response } from "express";
import {
  encodeHeader,
  HEADER_RESPONSE,
  caip2,
  type Disposition,
  type SettlementResponse,
} from "@agenttrust/core";
import type { ClaimStore } from "./claims.js";
import { SellerError, sendError } from "./errors.js";
import { parseJsonBody } from "./rawBody.js";
import { classify, serialise, summarise, BadRequest } from "./routes/deterministic.js";
import type { GatedRequest } from "./gate.js";

export interface DeliverDeps {
  claims: ClaimStore;
  chainId: number;
  replayPolicy: "idempotent" | "strict";
}

type Handler = (body: unknown) => unknown;

const HANDLERS: Record<string, Handler> = {
  "/v1/summarise": (body) => summarise(body as never),
  "/v1/classify": (body) => classify(body as never),
};

function settlement(
  deps: DeliverDeps,
  req: GatedRequest,
  disposition: Disposition,
  responseHash: Hex,
): SettlementResponse {
  const verified = req.verified!;
  return {
    success: true,
    network: caip2(deps.chainId),
    // The funding transaction: nothing settles during the HTTP exchange (SPEC-002 §5).
    transaction: verified.payload.payload.fundTxHash,
    extra: {
      scheme: "agenttrust-escrow",
      jobId: verified.jobId,
      disposition,
      responseHash,
      confirmations: verified.confirmations,
    },
  };
}

function send(deps: DeliverDeps, req: GatedRequest, res: Response, body: Buffer, hash: Hex, contentType: string, disposition: Disposition): void {
  res
    .status(200)
    .set("Content-Type", contentType)
    .set("Cache-Control", "no-store")
    .set("Content-Length", String(body.length))
    .set(HEADER_RESPONSE, encodeHeader(settlement(deps, req, disposition, hash)))
    .end(body);
}

export function createDeliveryHandler(deps: DeliverDeps) {
  return function deliver(req: GatedRequest, res: Response, next: NextFunction): void {
    const verified = req.verified;
    if (!verified) {
      // Unreachable through the gate, and a loud failure is better than a quiet
      // delivery if it ever becomes reachable.
      return sendError(res, new SellerError("execution_failed", "delivery reached without verification"));
    }

    const key = verified.responseKey;
    const handler = HANDLERS[req.path];
    if (!handler) return sendError(res, new SellerError("resource_mismatch", `no handler for ${req.path}`));

    let outcome;
    try {
      outcome = deps.claims.acquire(key);
    } catch (error) {
      return next(error);
    }

    switch (outcome.kind) {
      case "replay": {
        // SPEC-002 §6.2. The work is done once either way; the policy only decides
        // what a payer that lost its response sees.
        if (deps.replayPolicy === "strict") {
          return sendError(res, new SellerError("already_delivered"));
        }
        deps.claims.markServed(key, true);
        return send(deps, req, res, outcome.body, outcome.responseHash, outcome.contentType, "replayed");
      }
      case "busy":
        return sendError(res, new SellerError("claim_in_progress"));
      case "exhausted":
        return sendError(res, new SellerError("execution_failed", `gave up after ${outcome.attempts} attempts`));
      case "execute":
        break;
    }

    let body: Buffer;
    try {
      body = serialise(handler(parseJsonBody(req)));
    } catch (error) {
      deps.claims.markFailed(key);
      if (error instanceof BadRequest) return sendError(res, new SellerError("bad_request", error.message));
      if (error instanceof SyntaxError) return sendError(res, new SellerError("bad_request", "body is not valid JSON"));
      return sendError(res, new SellerError("execution_failed", (error as Error)?.message));
    }

    const responseHash = keccak256(body);
    const contentType = "application/json; charset=utf-8";
    // Persist, then send. Never the other way round.
    deps.claims.storeResult(key, body, responseHash, contentType);
    deps.claims.markServed(key, false);
    send(deps, req, res, body, responseHash, contentType, "executed");
  };
}
