/**
 * API-003 / API-004 — deciding whether this exact request is paid for.
 *
 * The order is SPEC-002 §7 and it is normative. Everything decidable locally is decided
 * before the chain is touched, so an unauthenticated caller cannot make the seller spend
 * RPC budget by guessing job identifiers; the two comparisons that need a field of the
 * job (`signer == job.payer`, `expiry <= job.deadline`) come after the read.
 *
 * Every exit from this module is either a `SellerError` carrying a SPEC-002 §8 code, or
 * a verified job. There is no third outcome: an unreadable chain raises
 * `chain_unavailable`, never "no job found".
 */
import {
  canonicalUri,
  ChainUnavailable,
  decodePaymentPayload,
  domain as eip712Domain,
  EIP712_TYPES,
  JobState,
  resourceHash as deriveResourceHash,
  X402Error,
  chainIdFromCaip2,
  type ChainClient,
  type Job,
  type PaymentPayload,
} from "@agenttrust/core";
import { hashTypedData, keccak256, recoverAddress, toHex, type Address, type Hex } from "viem";
import { SellerError } from "./errors.js";
import { priceOf } from "./pricing.js";
import type { RawRequest } from "./rawBody.js";

export interface VerifyConfig {
  origin: string;
  agentId: bigint;
  payee: Address;
  token: Address;
  chainId: number;
  escrow: Address;
  acceptedValidators: Address[];
  minDeadlineMargin: number;
  confirmations: number;
}

export interface VerifiedRequest {
  jobId: Hex;
  job: Job;
  resourceHash: Hex;
  payload: PaymentPayload;
  clientNonce: Hex;
  responseKey: string;
  confirmations: number;
}

/** Nonces already spent, per job. Replaced by the claim store's table in API-005. */
export interface NonceStore {
  seen(jobId: Hex, nonce: Hex): Promise<boolean> | boolean;
  remember(jobId: Hex, nonce: Hex): Promise<void> | void;
}

export class MemoryNonceStore implements NonceStore {
  private readonly used = new Set<string>();
  seen(jobId: Hex, nonce: Hex): boolean {
    return this.used.has(`${jobId}:${nonce}`);
  }
  remember(jobId: Hex, nonce: Hex): void {
    this.used.add(`${jobId}:${nonce}`);
  }
}

/**
 * Re-derive the hash the chain computed, from what the seller can see for itself: the
 * raw bytes, its own configured origin and its own price table.
 *
 * Nothing the buyer sent is trusted here. That is the correction behind DF-04 — the
 * blueprint's `quotedMax` was a caller-supplied number that authenticated nothing.
 */
export function deriveRequestHash(config: VerifyConfig, req: RawRequest): Hex {
  const price = priceOf(req.path);
  if (price === undefined) throw new SellerError("resource_mismatch", `no price for ${req.path}`);

  const url = new URL(config.origin);
  const uri = canonicalUri({
    scheme: url.protocol.replace(":", "") as "http" | "https",
    host: url.hostname,
    port: url.port === "" ? undefined : Number(url.port),
    path: req.path,
    // Sorted and percent-normalised by canonicalUri, so a buyer that reorders query
    // parameters still derives the same hash (SPEC-001 §2.2).
    query: req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?") + 1) : undefined,
  });

  return deriveResourceHash({
    methodHash: keccak256(toHex(req.method.toUpperCase())),
    uriHash: keccak256(toHex(uri)),
    bodyHash: keccak256(req.rawBody ?? Buffer.alloc(0)),
    amount: price,
    token: config.token,
    chainId: BigInt(config.chainId),
  });
}

export interface VerifyDeps {
  chain: ChainClient;
  config: VerifyConfig;
  nonces: NonceStore;
  now?: () => number;
}

export async function verifyRequest(deps: VerifyDeps, req: RawRequest): Promise<VerifiedRequest> {
  const { config } = deps;
  const nowSeconds = Math.floor((deps.now?.() ?? Date.now()) / 1000);

  // 1–2. Decode, and check this is our scheme on our chain.
  const header = req.get("PAYMENT-SIGNATURE");
  if (!header) throw new SellerError("signature_invalid", "no PAYMENT-SIGNATURE header");

  let payload: PaymentPayload;
  try {
    payload = decodePaymentPayload(header);
  } catch (error) {
    if (error instanceof X402Error) throw new SellerError("signature_invalid", error.message);
    throw error;
  }
  if (chainIdFromCaip2(payload.accepted.network) !== config.chainId) {
    throw new SellerError("resource_mismatch", `quote is for ${payload.accepted.network}`);
  }

  // 3. Re-derive the hash from what we can see ourselves.
  const resourceHash = deriveRequestHash(config, req);

  // 4. Origin and expiry: local, and cheap to refuse.
  const { expiry, clientNonce } = payload.payload.deliveryRequest;
  if (expiry <= nowSeconds) throw new SellerError("signature_expired", "the signature has expired");

  // 5. Recover the signer. The message is rebuilt from **our** values, not the
  //    buyer's: a buyer that lied about the origin or the resource recovers to the
  //    wrong address rather than to a passing check.
  const jobId = payload.payload.jobId;
  const digest = hashTypedData({
    domain: eip712Domain({ chainId: config.chainId, verifyingContract: config.escrow }),
    types: { DeliveryRequest: EIP712_TYPES.DeliveryRequest },
    primaryType: "DeliveryRequest",
    message: { jobId, resourceHash, sellerOrigin: config.origin, expiry: BigInt(expiry), clientNonce },
  });
  let signer: Address;
  try {
    signer = await recoverAddress({ hash: digest, signature: payload.payload.signature });
  } catch {
    throw new SellerError("signature_invalid", "signature could not be recovered");
  }

  // 6. One delivery per client nonce.
  if (await deps.nonces.seen(jobId, clientNonce)) {
    throw new SellerError("signature_replayed");
  }

  // 7. The chain's account of the job. This is the first network call.
  let job: Job | undefined;
  try {
    job = await deps.chain.getJob(jobId);
  } catch (error) {
    if (error instanceof ChainUnavailable) throw new SellerError("chain_unavailable", error.message);
    throw error;
  }
  if (!job) throw new SellerError("resource_mismatch", "no such job");
  if (job.state !== JobState.Funded) throw new SellerError("resource_mismatch", "job is not funded");

  // One code for several causes, on purpose: splitting it would tell an
  // unauthenticated prober which part of its guess was wrong (SPEC-002 §8).
  if (job.resourceHash.toLowerCase() !== resourceHash.toLowerCase()) {
    throw new SellerError("resource_mismatch", "this job is for a different request");
  }
  if (job.payee.toLowerCase() !== config.payee.toLowerCase()) {
    throw new SellerError("resource_mismatch", "this job pays someone else");
  }
  if (job.payeeAgentId !== config.agentId) throw new SellerError("resource_mismatch", "this job is for another agent");
  if (job.token.toLowerCase() !== config.token.toLowerCase()) {
    throw new SellerError("resource_mismatch", "this job is in another token");
  }
  const price = priceOf(req.path);
  if (price === undefined || job.amount !== price) {
    throw new SellerError("resource_mismatch", "this job is for a different amount");
  }

  // 8–9. The two comparisons that needed the job.
  if (signer.toLowerCase() !== job.payer.toLowerCase()) {
    throw new SellerError("signature_invalid", "the signature is not from the payer");
  }
  if (BigInt(expiry) > job.deadline) {
    throw new SellerError("signature_expired", "the signature outlives the job deadline");
  }

  // 10. A validator the seller is willing to be judged by.
  const accepted = config.acceptedValidators.map((v) => v.toLowerCase());
  if (!accepted.includes(job.validator.toLowerCase())) {
    throw new SellerError("validator_not_accepted");
  }

  // 11. Enough time left to deliver, get attested and get bound (SPEC-002 §7.1).
  //     Measured in **chain time**: `job.deadline` was written by the contract from
  //     `block.timestamp`, so subtracting a local clock is the wrong subtraction — and
  //     it fails open, since a seller whose clock lags the chain would believe there
  //     was more time left than there is.
  let chainNow: number;
  try {
    chainNow = await deps.chain.blockTimestamp();
  } catch (error) {
    if (error instanceof ChainUnavailable) throw new SellerError("chain_unavailable", error.message);
    throw error;
  }
  const remaining = Number(job.deadline) - chainNow;
  if (remaining < config.minDeadlineMargin) {
    throw new SellerError("deadline_margin", `${remaining}s left, ${config.minDeadlineMargin}s needed`);
  }

  // 12. Confirmations, by polling. Fail closed on anything unreadable.
  let confirmations = 0;
  if (config.confirmations > 0) {
    try {
      confirmations = await deps.chain.confirmations(payload.payload.fundTxHash);
    } catch (error) {
      if (error instanceof ChainUnavailable) throw new SellerError("chain_unavailable", error.message);
      throw error;
    }
    if (confirmations < config.confirmations) {
      throw new SellerError(
        "insufficient_confirmations",
        `${confirmations} of ${config.confirmations} confirmations`,
      );
    }
  }

  return {
    jobId,
    job,
    resourceHash,
    payload,
    clientNonce,
    responseKey: `${config.chainId}:${config.escrow.toLowerCase()}:${jobId.toLowerCase()}`,
    confirmations,
  };
}
