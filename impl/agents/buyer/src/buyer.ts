/**
 * AGENT-002 — the deterministic buyer. This is the client every measurement uses; the
 * LangGraph/LiteLLM agent is demo narrative only and is EXTENDED-E2 (DF-24).
 *
 * The flow is SPEC-002 from the other side: discover, quote, pre-check the gate, fund,
 * wait for confirmations, retry with a payer signature, verify what came back.
 *
 * Two properties are worth stating because they are what the evaluation rests on:
 *
 *  - **The same nonce is reused on a retry.** A buyer that minted a fresh nonce after a
 *    timeout would fund the job twice, which is a double payment caused by the client
 *    rather than by the protocol. The nonce is derived from the request, so a retry of
 *    the same request is the same job by construction (DF-12).
 *  - **The buyer checks what it received.** `PAYMENT-RESPONSE` carries the seller's
 *    `responseHash`; the buyer hashes the bytes itself and compares. Without that, a
 *    seller could return anything and the validator's later attestation would be about
 *    a different artefact than the buyer holds.
 */
import {
  atomicFromWire,
  caip2,
  canonicalUri,
  decodePaymentRequired,
  domain as eip712Domain,
  EIP712_TYPES,
  encodeHeader,
  erc20Abi,
  escrowAbi,
  HEADER_REQUIRED,
  HEADER_RESPONSE,
  JobState,
  selectRequirements,
  X402Error,
  X402_VERSION,
  SCHEME,
  type ChainClient,
  type PaymentRequirements,
  type SettlementResponse,
} from "@agenttrust/core";
import {
  keccak256,
  parseEventLogs,
  parseAbi,
  toHex,
  type Account,
  type Address,
  type Hex,
  type WalletClient,
} from "viem";
import { BuyerAbort } from "./errors.js";
import { discover, type DiscoveryDeps } from "./discovery.js";
import { precheckGate, type GatePolicy } from "./gatecheck.js";

export interface BuyerConfig {
  chain: ChainClient;
  wallet: WalletClient;
  account: Account;
  identityRegistry: Address;
  reputationRegistry: Address;
  token: Address;
  /** Refuse any quote above this, in atomic units. */
  maxPrice: bigint;
  gate: GatePolicy;
  confirmations: number;
  ttlSeconds: number;
  /** Injected so tests can avoid the network for the agent card. */
  fetchJson?: DiscoveryDeps["fetchJson"];
  fetchImpl?: typeof fetch;
}

export interface PurchaseRequest {
  sellerAgentId: bigint;
  /** Origin the buyer will actually call, checked against the registry's agent card. */
  origin: string;
  path: string;
  body: string;
  validator: Address;
}

export interface PurchaseResult {
  jobId: Hex;
  fundTxHash: Hex;
  responseBody: string;
  responseHash: Hex;
  disposition: "executed" | "replayed";
  quote: PaymentRequirements;
  confirmations: number;
}

/**
 * The payer nonce for a request. Deterministic on purpose: a retry of the same request
 * derives the same nonce and therefore the same job, so a dropped connection cannot
 * turn into a second payment.
 */
export function nonceFor(request: PurchaseRequest, salt = ""): Hex {
  return keccak256(
    toHex(["agenttrust-buyer-nonce-v1", request.origin, request.path, request.body, String(request.sellerAgentId), salt].join("\n")),
  );
}

export function resourceRefFor(request: PurchaseRequest): {
  methodHash: Hex;
  uriHash: Hex;
  bodyHash: Hex;
} {
  const url = new URL(request.origin);
  return {
    methodHash: keccak256(toHex("POST")),
    uriHash: keccak256(
      toHex(
        canonicalUri({
          scheme: url.protocol.replace(":", "") as "http" | "https",
          host: url.hostname,
          port: url.port === "" ? undefined : Number(url.port),
          path: request.path,
        }),
      ),
    ),
    bodyHash: keccak256(toHex(request.body)),
  };
}

export async function purchase(config: BuyerConfig, request: PurchaseRequest): Promise<PurchaseResult> {
  const fetchImpl = config.fetchImpl ?? fetch;

  // 1. Discovery: the registry decides who this seller is, not DNS.
  const discovered = await discover(
    { chain: config.chain, identityRegistry: config.identityRegistry, fetchJson: config.fetchJson },
    request.sellerAgentId,
    request.origin,
  );

  // 2. Ask, and read the 402.
  const unpaid = await fetchImpl(`${request.origin}${request.path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: request.body,
  });
  if (unpaid.status !== 402) {
    throw new BuyerAbort("quote_invalid", `expected 402, got ${unpaid.status}`, true);
  }
  const header = unpaid.headers.get(HEADER_REQUIRED);
  if (!header) throw new BuyerAbort("quote_invalid", `no ${HEADER_REQUIRED} header`, true);

  let quote: PaymentRequirements;
  try {
    quote = selectRequirements(decodePaymentRequired(header), {
      chainId: config.chain.chainId,
      asset: config.token,
      maxAmount: config.maxPrice,
    });
  } catch (error) {
    const reason = error instanceof X402Error && /over the limit/.test(error.message) ? "price_too_high" : "no_acceptable_offer";
    throw new BuyerAbort(reason, (error as Error).message, true);
  }

  // The quote must pay the agent the registry names. A seller that quoted its own
  // address would be quoting one destination and escrowing to another.
  if (quote.payTo.toLowerCase() !== discovered.payee.toLowerCase()) {
    throw new BuyerAbort(
      "payee_mismatch",
      `the quote pays ${quote.payTo} but the registry resolves agent ${request.sellerAgentId} to ${discovered.payee}`,
      true,
    );
  }
  if (quote.extra.escrow.toLowerCase() !== config.chain.escrow.toLowerCase()) {
    throw new BuyerAbort("quote_invalid", `the quote names escrow ${quote.extra.escrow}`, true);
  }

  const amount = atomicFromWire(quote.amount);

  // 3. Would the gate let this through? Answer before spending anything.
  const verdict = await precheckGate(config.chain, config.reputationRegistry, request.sellerAgentId, config.gate);
  if (!verdict.passes) {
    throw new BuyerAbort(
      "gate_would_refuse",
      `agent ${request.sellerAgentId} fails the ${verdict.failed} requirement ` +
        `(distinct ${verdict.distinct}, count ${verdict.count}, average ${verdict.average ?? "n/a"}); ` +
        `no funding transaction was sent`,
      true,
    );
  }

  // 4. Approve exactly what is needed, then fund.
  const nonce = nonceFor(request);
  const resource = resourceRefFor(request);
  const fundTxHash = await fundJob(config, request, amount, resource, nonce);

  const resourceHash = (await config.chain.client.readContract({
    address: config.chain.escrow,
    abi: escrowAbi,
    functionName: "previewResourceHash",
    args: [resource, amount, config.token],
  })) as Hex;
  const jobId = (await config.chain.client.readContract({
    address: config.chain.escrow,
    abi: escrowAbi,
    functionName: "previewJobId",
    args: [config.account.address, discovered.payee, resourceHash, nonce],
  })) as Hex;

  // 5. Wait for the seller's confirmation policy.
  const confirmations =
    config.confirmations > 0
      ? await config.chain.waitForConfirmations(fundTxHash, config.confirmations, { timeoutMs: 120_000 })
      : 1;

  // 6–7. Retry signed, then check what came back.
  return deliver(config, request, { jobId, fundTxHash, resourceHash, quote, confirmations });
}

async function fundJob(
  config: BuyerConfig,
  request: PurchaseRequest,
  amount: bigint,
  resource: { methodHash: Hex; uriHash: Hex; bodyHash: Hex },
  nonce: Hex,
): Promise<Hex> {
  // If this job was already funded — a retry after a dropped connection — reuse it
  // rather than paying again.
  const already = (await config.chain.client.readContract({
    address: config.chain.escrow,
    abi: escrowAbi,
    functionName: "consumedNonce",
    args: [config.account.address, nonce],
  })) as boolean;
  if (already) {
    const logs = await config.chain.client.getLogs({
      address: config.chain.escrow,
      event: parseAbi([
        "event JobFunded(bytes32 indexed jobId, address indexed payer, address indexed payee, uint256 payeeAgentId, address validator, address token, uint256 amount, bytes32 resourceHash, uint64 deadline)",
      ])[0],
      args: { payer: config.account.address },
      fromBlock: 0n,
    });
    const match = logs.at(-1);
    if (match?.transactionHash) return match.transactionHash;
    throw new BuyerAbort("funding_failed", "the nonce is spent but no JobFunded log was found", false);
  }

  const allowance = (await config.chain.client.readContract({
    address: config.token,
    abi: erc20Abi,
    functionName: "allowance",
    args: [config.account.address, config.chain.escrow],
  })) as bigint;
  if (allowance < amount) {
    // Exactly what is needed, not an unlimited approval: an allowance larger than the
    // job is the A5 overdraft surface (DF-10).
    const approveTx = await config.wallet.writeContract({
      address: config.token,
      abi: erc20Abi,
      functionName: "approve",
      args: [config.chain.escrow, amount],
      account: config.account,
      chain: null,
    });
    await config.chain.client.waitForTransactionReceipt({ hash: approveTx });
  }

  try {
    const tx = await config.wallet.writeContract({
      address: config.chain.escrow,
      abi: escrowAbi,
      functionName: "fund",
      args: [
        request.sellerAgentId,
        config.token,
        amount,
        resource,
        nonce,
        BigInt(config.ttlSeconds),
        request.validator,
        {
          trustedClients: config.gate.trustedClients,
          minDistinct: config.gate.minDistinct,
          minCount: config.gate.minCount,
          minAvgValue: config.gate.minAvgValue,
        },
      ],
      account: config.account,
      chain: null,
    });
    const receipt = await config.chain.client.waitForTransactionReceipt({ hash: tx });
    const funded = parseEventLogs({ abi: escrowAbi, eventName: "JobFunded", logs: receipt.logs });
    if (funded.length === 0) throw new Error("fund() emitted no JobFunded event");
    return tx;
  } catch (error) {
    throw new BuyerAbort("funding_failed", (error as Error)?.message ?? String(error), false);
  }
}

async function deliver(
  config: BuyerConfig,
  request: PurchaseRequest,
  ctx: { jobId: Hex; fundTxHash: Hex; resourceHash: Hex; quote: PaymentRequirements; confirmations: number },
): Promise<PurchaseResult> {
  const job = await config.chain.getJob(ctx.jobId);
  if (!job || job.state !== JobState.Funded) {
    throw new BuyerAbort("funding_failed", `job ${ctx.jobId} is not funded`, false);
  }

  const expiry = Number(job.deadline);
  const clientNonce = keccak256(toHex(`${ctx.jobId}:${Date.now()}:${Math.random()}`));
  const signature = await config.wallet.signTypedData({
    account: config.account,
    domain: eip712Domain({ chainId: config.chain.chainId, verifyingContract: config.chain.escrow }),
    types: { DeliveryRequest: EIP712_TYPES.DeliveryRequest },
    primaryType: "DeliveryRequest",
    message: {
      jobId: ctx.jobId,
      resourceHash: ctx.resourceHash,
      sellerOrigin: request.origin,
      expiry: BigInt(expiry),
      clientNonce,
    },
  });

  const payment = encodeHeader({
    x402Version: X402_VERSION,
    resource: { url: `${request.origin}${request.path}` },
    accepted: ctx.quote,
    payload: {
      jobId: ctx.jobId,
      fundTxHash: ctx.fundTxHash,
      deliveryRequest: { expiry, clientNonce },
      signature,
    },
    extensions: {},
  });

  const fetchImpl = config.fetchImpl ?? fetch;
  const res = await fetchImpl(`${request.origin}${request.path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "PAYMENT-SIGNATURE": payment },
    body: request.body,
  });
  const text = await res.text();
  if (res.status !== 200) {
    throw new BuyerAbort("delivery_refused", `seller answered ${res.status}: ${text}`, false);
  }

  const settlementHeader = res.headers.get(HEADER_RESPONSE);
  if (!settlementHeader) throw new BuyerAbort("response_mismatch", `no ${HEADER_RESPONSE} header`, false);
  const settlement = JSON.parse(Buffer.from(settlementHeader, "base64").toString("utf8")) as SettlementResponse;

  // Hash what actually arrived. Without this the buyer has the seller's word for it,
  // and the validator would later attest to a different artefact than the buyer holds.
  const responseHash = keccak256(toHex(text));
  if (settlement.extra.responseHash.toLowerCase() !== responseHash.toLowerCase()) {
    throw new BuyerAbort(
      "response_mismatch",
      `the seller reported ${settlement.extra.responseHash} but the body hashes to ${responseHash}`,
      false,
    );
  }
  if (settlement.extra.jobId.toLowerCase() !== ctx.jobId.toLowerCase()) {
    throw new BuyerAbort("response_mismatch", `the settlement names job ${settlement.extra.jobId}`, false);
  }
  if (settlement.network !== caip2(config.chain.chainId) || settlement.extra.scheme !== SCHEME) {
    throw new BuyerAbort("response_mismatch", "the settlement is for another scheme or network", false);
  }

  return {
    jobId: ctx.jobId,
    fundTxHash: ctx.fundTxHash,
    responseBody: text,
    responseHash,
    disposition: settlement.extra.disposition,
    quote: ctx.quote,
    confirmations: ctx.confirmations,
  };
}
