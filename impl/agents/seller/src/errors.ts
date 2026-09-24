/**
 * API-001 — the SPEC-002 §8 error table, as code.
 *
 * Every failure the seller can produce maps to exactly one entry here, so the table in
 * the spec and the behaviour of the service cannot drift apart. The body shape is fixed
 * by SPEC-002 §8 and deliberately says nothing about other jobs.
 */
import type { Response } from "express";
import { applyCachePolicy, tag } from "./observability.js";

export const ERRORS = {
  signature_invalid: { status: 403, message: "payment signature missing, malformed, or not from the payer" },
  signature_expired: { status: 403, message: "payment signature has expired or outlives the job deadline" },
  // No `wrong_origin`: `sellerOrigin` never travels, so a signature made over another
  // seller's origin simply recovers to the wrong address and is `signature_invalid`.
  // A distinct code would confirm to a prober which seller a captured signature was for
  // (SPEC-002 §8).
  resource_mismatch: { status: 409, message: "the funded job does not match this request" },
  validator_not_accepted: { status: 409, message: "the job names a validator this seller does not accept" },
  signature_replayed: { status: 409, message: "this client nonce has already been used for this job" },
  claim_in_progress: { status: 409, message: "another request is already executing this job" },
  already_delivered: { status: 409, message: "this job has already been delivered" },
  deadline_margin: { status: 410, message: "too little time remains before the job deadline" },
  insufficient_confirmations: { status: 425, message: "the funding transaction needs more confirmations" },
  execution_failed: { status: 500, message: "the handler failed" },
  chain_unavailable: { status: 503, message: "the chain could not be read" },
  bad_request: { status: 400, message: "the request body is not valid for this route" },
  payload_too_large: { status: 413, message: "the request body is too large" },
  not_found: { status: 404, message: "no such route" },
} as const;

export type ErrorCode = keyof typeof ERRORS;

export class SellerError extends Error {
  constructor(readonly code: ErrorCode, message?: string) {
    super(message ?? ERRORS[code].message);
    this.name = "SellerError";
  }
  get status(): number {
    return ERRORS[this.code].status;
  }
}

export function sendError(res: Response, error: SellerError): void {
  // The code, not the message, is what the access log carries: the harness counts
  // rejections by reason, and a sentence cannot be counted (API-007).
  tag(res, { logReason: error.code });
  applyCachePolicy(res);
  res.status(error.status).json({ error: { code: error.code, message: error.message } });
}
