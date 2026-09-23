/**
 * API-006 — deposit the result with the validator, file the validation request, bind it.
 *
 * The order is the point. The bytes do not reach the buyer until the result exists
 * **outside the seller**, deposited with the validator that will judge it. Without that
 * ordering the strongest honest claim would be "the seller says it delivered
 * something"; with it, payment is impossible unless the artefact is in a third party's
 * hands (DF-08).
 *
 * Then two transactions, in this order and no other:
 *
 *   `validationRequest(validator, agentId, requestURI, requestHash)`  — file it
 *   `bindValidation(jobId, salt)`                                     — tie it to the job
 *
 * The salt is generated **first**, because `requestHash` depends on it and the receipt
 * carries it so the validator can derive the same hash without being told.
 *
 * ERC-8004 request hashes are unique registry-wide and first-come, so filing can revert
 * `"exists"` — and the security review of CONTRACT-007 established that this is not a
 * bounded nuisance: the salt is public from the moment this transaction is broadcast,
 * so a mempool-watching adversary can squat every retry for gas only (DF-06, corrected).
 * The retry budget here is therefore finite and is what `minDeadlineMargin` must cover
 * (SPEC-002 §7.1). Exhausting it means the seller stops rather than delivering work it
 * cannot get attested.
 */
import { randomBytes } from "node:crypto";
import {
  domain as eip712Domain,
  EIP712_TYPES,
  escrowAbi,
  validationRegistryAbi,
  type ChainClient,
} from "@agenttrust/core";
import { keccak256, type Account, type Address, type Hex, type WalletClient } from "viem";

export interface EvidenceDeps {
  chain: ChainClient;
  wallet: WalletClient;
  account: Account;
  validationRegistry: Address;
  /** Where to POST the receipt and bytes. */
  validatorUrl: string;
  agentId: bigint;
  /** Bounded, and folded into minDeadlineMargin (SPEC-002 §7.1). */
  retryBudget?: number;
  fetchImpl?: typeof fetch;
  /**
   * Where salts come from. Defaults to `randomBytes(32)`, and exists so a test can
   * force a collision with a squatted hash — otherwise the retry path can only be
   * reached by luck, and acceptance (b) would be asserted rather than demonstrated.
   */
  saltSource?: () => Hex;
}

export interface DepositInput {
  jobId: Hex;
  resourceHash: Hex;
  requestBody: Buffer;
  responseBody: Buffer;
  path: string;
}

export interface DepositResult {
  salt: Hex;
  requestHash: Hex;
  evidenceId: string;
  validationRequestTx: Hex;
  bindTx: Hex;
  attempts: number;
}

export class EvidenceError extends Error {
  constructor(message: string, readonly attempts: number) {
    super(message);
    this.name = "EvidenceError";
  }
}

const randomSalt = (): Hex => `0x${randomBytes(32).toString("hex")}`;

export async function depositAndBind(deps: EvidenceDeps, input: DepositInput): Promise<DepositResult> {
  const budget = deps.retryBudget ?? 3;
  const fetchImpl = deps.fetchImpl ?? fetch;
  let lastError = "";

  for (let attempt = 1; attempt <= budget; attempt++) {
    // 1. Salt first: requestHash depends on it, and the receipt carries it.
    const salt = (deps.saltSource ?? randomSalt)();
    const requestHash = (await deps.chain.client.readContract({
      address: deps.chain.escrow,
      abi: escrowAbi,
      functionName: "previewRequestHash",
      args: [input.jobId, salt],
    })) as Hex;

    // 2. Deposit with the validator *before* anything is filed on-chain and before a
    //    single byte goes to the buyer. A receipt whose salt later changes is
    //    re-deposited, which is why this is inside the retry loop.
    const responseHash = keccak256(input.responseBody);
    const servedAt = Math.floor(Date.now() / 1000);
    const signature = await deps.wallet.signTypedData({
      account: deps.account,
      domain: eip712Domain({ chainId: deps.chain.chainId, verifyingContract: deps.chain.escrow }),
      types: { DeliveryReceipt: EIP712_TYPES.DeliveryReceipt },
      primaryType: "DeliveryReceipt",
      message: {
        jobId: input.jobId,
        resourceHash: input.resourceHash,
        responseHash,
        sellerAgentId: deps.agentId,
        servedAt: BigInt(servedAt),
        salt,
      },
    });

    const deposited = await fetchImpl(`${deps.validatorUrl}/evidence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        receipt: {
          jobId: input.jobId,
          resourceHash: input.resourceHash,
          responseHash,
          sellerAgentId: Number(deps.agentId),
          servedAt,
          salt,
        },
        signature,
        requestBodyBase64: input.requestBody.toString("base64"),
        responseBodyBase64: input.responseBody.toString("base64"),
        path: input.path,
      }),
    });

    // 3. File the request. This is where a squatter can beat us.
    let validationRequestTx: Hex;
    try {
      validationRequestTx = await deps.wallet.writeContract({
        address: deps.validationRegistry,
        abi: validationRegistryAbi,
        functionName: "validationRequest",
        args: [await validatorOf(deps, input.jobId), deps.agentId, `${deps.validatorUrl}/evidence`, requestHash],
        account: deps.account,
        chain: null,
      });
      await deps.chain.client.waitForTransactionReceipt({ hash: validationRequestTx });
    } catch (error) {
      lastError = (error as Error)?.message ?? String(error);
      if (/exists/i.test(lastError)) {
        // Squatted. A fresh salt gives a fresh hash; nothing is consumed by the
        // failed attempt, because binding only succeeds against an entry that already
        // names this job's agent and validator.
        continue;
      }
      throw new EvidenceError(`validationRequest failed: ${lastError}`, attempt);
    }

    // 4. Bind, once. After this the escrow reads only this hash.
    let bindTx: Hex;
    try {
      bindTx = await deps.wallet.writeContract({
        address: deps.chain.escrow,
        abi: escrowAbi,
        functionName: "bindValidation",
        args: [input.jobId, salt],
        account: deps.account,
        chain: null,
      });
      await deps.chain.client.waitForTransactionReceipt({ hash: bindTx });
    } catch (error) {
      lastError = (error as Error)?.message ?? String(error);
      if (/AlreadyBound/i.test(lastError)) {
        throw new EvidenceError(`this job is already bound: ${lastError}`, attempt);
      }
      throw new EvidenceError(`bindValidation failed: ${lastError}`, attempt);
    }

    // The evidence id is advisory; a validator that did not return one is still
    // holding the bytes, which is what the claim rests on.
    let evidenceId = "";
    try {
      evidenceId = ((await deposited.json()) as { evidenceId?: string }).evidenceId ?? "";
    } catch {
      /* the deposit succeeded; the body shape is not load-bearing */
    }

    return { salt, requestHash, evidenceId, validationRequestTx, bindTx, attempts: attempt };
  }

  throw new EvidenceError(
    `could not bind a validation request in ${budget} attempts; the last failure was: ${lastError}`,
    budget,
  );
}

async function validatorOf(deps: EvidenceDeps, jobId: Hex): Promise<Address> {
  const job = await deps.chain.getJob(jobId);
  if (!job) throw new EvidenceError(`job ${jobId} does not exist`, 0);
  return job.validator;
}
